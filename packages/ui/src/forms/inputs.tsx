// Montant et téléphone (ADR-0074 § 8).
//
// `MoneyInput` : séparateurs français à la saisie (1 234 567,50), devise
// affichée dans le champ, valeur transmise en chaîne décimale (`1234567.5`).
// AUCUNE opération : ni arrondi, ni conversion, ni total (ADR-0025).
//
// `PhoneInput` : indicatif (+243 par défaut) choisi à part, numéro national
// groupé pour la lecture (81 234 5678) ; valeur transmise lisible
// (`+243 81 234 5678`). Aucune validation du numéro : l'API juge.

import { forwardRef, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '../utils.js';

import { CONTROL_CLASSES, controlA11y, useField } from './field.js';
import { ecrireTelephone, grouperNational, INDICATIFS, lireTelephone } from './logic.js';
import {
  afficherMontant,
  curseurApresFormat,
  formaterSaisieMontant,
  valeurMontant,
} from './money.js';
import { Select } from './select.js';

export interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  /** Chaîne décimale (`1234.5`) ou vide. */
  value: string;
  onChange: (value: string) => void;
  /** Devise affichée dans le champ (USD, CDF…). */
  currency?: string | null;
  decimals?: number;
  allowNegative?: boolean;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, currency, decimals = 2, allowNegative = false, className, ...props },
  ref,
) {
  const a11y = controlA11y(useField(), props);
  const options = { decimales: decimals, negatif: allowNegative };
  const [affiche, setAffiche] = useState(() => afficherMontant(value, options));
  const interne = useRef<HTMLInputElement | null>(null);
  const curseur = useRef<number | null>(null);

  // Valeur changée par l'écran (rechargement) : on la réaffiche.
  if (valeurMontant(affiche, options) !== value) {
    const nouveau = afficherMontant(value, options);
    if (nouveau !== affiche) setAffiche(nouveau);
  }

  useLayoutEffect(() => {
    if (curseur.current !== null && interne.current === document.activeElement) {
      interne.current?.setSelectionRange(curseur.current, curseur.current);
      curseur.current = null;
    }
  });

  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        ref={(el) => {
          interne.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        {...props}
        {...a11y}
        value={affiche}
        onChange={(e) => {
          const brut = e.target.value;
          const suivant = formaterSaisieMontant(brut, options);
          curseur.current = curseurApresFormat(
            brut,
            e.target.selectionStart ?? brut.length,
            suivant,
          );
          setAffiche(suivant);
          onChange(valeurMontant(suivant, options));
        }}
        className={cn(
          CONTROL_CLASSES,
          'text-right font-mono tabular-nums',
          currency ? 'pr-14' : null,
        )}
      />
      {currency ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 font-mono text-xs font-semibold text-[var(--foreground-muted)]"
        >
          {currency}
        </span>
      ) : null}
      {currency ? <span className="sr-only">en {currency}</span> : null}
    </div>
  );
});

export interface PhoneInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  value: string;
  onChange: (value: string) => void;
  defaultCountryCode?: string;
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, defaultCountryCode = '+243', className, ...props },
  ref,
) {
  const a11y = controlA11y(useField(), props);
  const lu = lireTelephone(value, defaultCountryCode);
  const [indicatif, setIndicatif] = useState(lu.indicatif);
  const [national, setNational] = useState(grouperNational(lu.indicatif, lu.national));

  // Valeur changée par l'écran : on la relit.
  if (ecrireTelephone(indicatif, national) !== value && value !== '') {
    const r = lireTelephone(value, defaultCountryCode);
    const g = grouperNational(r.indicatif, r.national);
    if (r.indicatif !== indicatif) setIndicatif(r.indicatif);
    if (g !== national) setNational(g);
  }

  const options = INDICATIFS.some((i) => i.code === indicatif)
    ? INDICATIFS
    : [{ code: indicatif, pays: 'Autre' }, ...INDICATIFS];

  return (
    <div className={cn('flex min-w-0 items-stretch gap-1.5', className)}>
      <Select
        aria-label="Indicatif du pays"
        id={a11y.id ? `${a11y.id}-indicatif` : undefined}
        value={indicatif}
        disabled={a11y.disabled}
        searchable={false}
        onChange={(code) => {
          setIndicatif(code);
          onChange(ecrireTelephone(code, national));
        }}
        options={options.map((i) => ({
          value: i.code,
          label: i.code,
          description: i.pays,
          keywords: i.pays,
        }))}
        className="w-[6.5rem] shrink-0"
      />
      <input
        ref={ref}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={indicatif === '+243' ? '81 234 5678' : undefined}
        {...props}
        {...a11y}
        value={national}
        onChange={(e) => {
          // Un numéro complet collé (« +243… », « 0812… ») est relu en entier.
          const brut = e.target.value;
          const r = /^\s*(\+|00)/.test(brut)
            ? lireTelephone(brut, indicatif)
            : { indicatif, national: brut.replace(/\D/g, '').replace(/^0+/, '') };
          setIndicatif(r.indicatif);
          setNational(grouperNational(r.indicatif, r.national));
          onChange(ecrireTelephone(r.indicatif, r.national));
        }}
        className={cn(CONTROL_CLASSES, 'min-w-0 flex-1 tabular-nums')}
      />
    </div>
  );
});
