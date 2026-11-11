// Choix (ADR-0074 § 7) :
// - `SegmentedControl` : 2 à 5 options COURTES (TTC/HT, USD/CDF, mode de client) ;
// - `ChoiceCards` : choix unique avec une phrase d'explication par option ;
// - `Switch` : un réglage booléen « activer… » qui prend effet tel quel ;
// - `Checkbox` : cases d'une liste à cocher, ou un accord explicite.
//
// Les deux premiers suivent le modèle WAI-ARIA « radio group » : un seul arrêt
// de tabulation (l'option choisie), les flèches déplacent ET choisissent.

import { Check, Minus } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef } from 'react';

import { cn } from '../utils.js';

import { controlA11y, useField } from './field.js';
import { idSur, prochainIndex } from './logic.js';

export interface ChoiceOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  /** Icône (segments) ; décorative. */
  icon?: React.ReactNode;
}

interface GroupeRadioProps<V extends string> {
  value: V | '';
  onChange: (value: V) => void;
  options: readonly ChoiceOption<V>[];
  id?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
  onBlur?: () => void;
}

/** Clavier et focus communs aux groupes de boutons radio. */
function useGroupeRadio<V extends string>(
  options: readonly ChoiceOption<V>[],
  value: V | '',
  onChange: (v: V) => void,
  desactive: boolean,
): {
  refs: React.MutableRefObject<(HTMLElement | null)[]>;
  tabulable: (i: number) => boolean;
  surTouche: (e: React.KeyboardEvent, i: number) => void;
} {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const actives = options.map((o) => !o.disabled && !desactive);
  const choisi = options.findIndex((o) => o.value === value);
  const premier = actives.indexOf(true);
  const tabulable = (i: number): boolean => (choisi >= 0 ? i === choisi : i === premier);
  function surTouche(e: React.KeyboardEvent, i: number): void {
    const touche = e.key === 'ArrowRight' ? 'ArrowDown' : e.key === 'ArrowLeft' ? 'ArrowUp' : e.key;
    let suivant: number | null = null;
    if (touche === 'ArrowDown' || touche === 'ArrowUp') {
      // Bouclage, comme les radios natifs.
      suivant = prochainIndex(actives, i, touche);
      if (suivant === i) suivant = touche === 'ArrowDown' ? premier : actives.lastIndexOf(true);
    } else if (touche === 'Home' || touche === 'End') {
      suivant = prochainIndex(actives, i, touche);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const o = options[i];
      if (o && !o.disabled) onChange(o.value);
      return;
    }
    if (suivant === null || suivant < 0) return;
    e.preventDefault();
    const o = options[suivant];
    if (o) onChange(o.value);
    refs.current[suivant]?.focus();
  }
  return { refs, tabulable, surTouche };
}

/** Bouton segmenté : 2 à 5 options courtes, toutes visibles d'un coup d'œil. */
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  id: idDonne,
  disabled,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  className,
  onBlur,
  fullWidth = false,
}: GroupeRadioProps<V> & { fullWidth?: boolean }): React.ReactElement {
  const ctx = useField();
  const a11y = controlA11y(ctx, {
    id: idDonne,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    disabled,
  });
  const { refs, tabulable, surTouche } = useGroupeRadio(
    options,
    value,
    onChange,
    Boolean(a11y.disabled),
  );
  return (
    <div
      id={a11y.id}
      role="radiogroup"
      aria-labelledby={ctx && !ariaLabel ? ctx.labelId : undefined}
      aria-label={ariaLabel}
      aria-describedby={a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
      aria-disabled={a11y.disabled || undefined}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
      className={cn(
        'inline-flex max-w-full gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-muted)] p-0.5 aria-[invalid=true]:border-[var(--danger)]',
        fullWidth ? 'flex w-full' : 'self-start',
        className,
      )}
    >
      {options.map((o, i) => {
        const choisi = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={choisi}
            tabIndex={tabulable(i) ? 0 : -1}
            disabled={a11y.disabled || o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => surTouche(e, i)}
            className={cn(
              'inline-flex min-h-[calc(var(--control-h)-6px)] min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-10',
              fullWidth && 'flex-1',
              choisi &&
                'bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-card)] ring-1 ring-[var(--border)]',
            )}
          >
            {o.icon ? (
              <span aria-hidden="true" className="inline-flex">
                {o.icon}
              </span>
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Cartes de choix : un choix unique, chaque option expliquée en une phrase. */
export function ChoiceCards<V extends string>({
  value,
  onChange,
  options,
  id: idDonne,
  disabled,
  required,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  className,
  onBlur,
  columns = 2,
}: GroupeRadioProps<V> & { columns?: 1 | 2 | 3 }): React.ReactElement {
  const ctx = useField();
  const base = idSur(useId(), 'carte');
  const a11y = controlA11y(ctx, {
    id: idDonne,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    required,
    disabled,
  });
  const { refs, tabulable, surTouche } = useGroupeRadio(
    options,
    value,
    onChange,
    Boolean(a11y.disabled),
  );
  const colonnes =
    columns === 1 ? '' : columns === 2 ? '@lg:grid-cols-2' : '@lg:grid-cols-2 @3xl:grid-cols-3';
  return (
    <div className={cn('@container', className)}>
      <div
        id={a11y.id}
        role="radiogroup"
        aria-labelledby={ctx && !ariaLabel ? ctx.labelId : undefined}
        aria-label={ariaLabel}
        aria-describedby={a11y['aria-describedby']}
        aria-invalid={a11y['aria-invalid']}
        aria-required={a11y['aria-required']}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
        }}
        className={cn('grid grid-cols-1 gap-2', colonnes)}
      >
        {options.map((o, i) => {
          const choisi = o.value === value;
          const off = a11y.disabled || o.disabled;
          return (
            <div
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={choisi}
              aria-disabled={off || undefined}
              aria-labelledby={`${base}-${i}-t`}
              aria-describedby={o.description ? `${base}-${i}-d` : undefined}
              tabIndex={off ? -1 : tabulable(i) ? 0 : -1}
              onClick={() => {
                if (!off) onChange(o.value);
              }}
              onKeyDown={(e) => surTouche(e, i)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border bg-[var(--surface)] p-3 text-sm transition-colors duration-[var(--motion-fast)] max-sm:min-h-11',
                choisi
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent-soft)_60%,var(--surface))] ring-1 ring-[var(--accent)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]',
                a11y['aria-invalid'] &&
                  !choisi &&
                  'border-[color-mix(in_srgb,var(--danger)_55%,var(--border))]',
                off && 'cursor-not-allowed opacity-60',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                  choisi ? 'border-[var(--accent)]' : 'border-[var(--border-strong)]',
                )}
              >
                {choisi ? <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={`${base}-${i}-t`} className="font-medium text-[var(--foreground)]">
                  {o.label}
                </span>
                {o.description ? (
                  <span id={`${base}-${i}-d`} className="text-xs text-[var(--foreground-muted)]">
                    {o.description}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Libellé à droite de l'interrupteur (sinon : celui du `Field`, ou `aria-label`). */
  label?: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Interrupteur (`role="switch"`) pour un réglage « activer… ». */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onChange,
    label,
    description,
    id: idDonne,
    disabled,
    className,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
  },
  ref,
) {
  const ctx = useField();
  const base = idSur(useId(), 'inter');
  const a11y = controlA11y(
    ctx,
    { id: idDonne, 'aria-describedby': ariaDescribedBy, disabled },
    description ? `${base}-d` : undefined,
  );
  const id = a11y.id ?? base;
  const bouton = (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={label && !ariaLabel ? `${base}-l` : undefined}
      aria-describedby={a11y['aria-describedby']}
      disabled={a11y.disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // Cible de 44 px sur téléphone par la marge, piste de 36 × 20.
        'group relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] disabled:cursor-not-allowed disabled:opacity-50 max-sm:my-3 max-sm:h-6 max-sm:w-11',
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--border-strong)] bg-[var(--surface-muted)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] max-sm:h-4.5 max-sm:w-4.5',
          checked
            ? 'translate-x-[18px] bg-[var(--accent-foreground)] max-sm:translate-x-[22px]'
            : 'translate-x-[2px] bg-[var(--foreground-muted)]',
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{bouton}</span>;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <span className="pt-0.5 max-sm:pt-0">{bouton}</span>
      <span className="flex min-w-0 flex-col gap-0.5 max-sm:pt-3">
        <label id={`${base}-l`} htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description ? (
          <span id={`${base}-d`} className="text-xs text-[var(--foreground-muted)]">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
});

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** État mixte (« tout cocher » partiellement coché). */
  indeterminate?: boolean;
}

/** Case à cocher stylée ; l'`<input>` natif reste dessous (clavier, formulaires, lecteurs). */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    checked,
    onChange,
    label,
    description,
    indeterminate = false,
    className,
    id: idDonne,
    ...props
  },
  ref,
) {
  const ctx = useField();
  const base = idSur(useId(), 'case');
  const interne = useRef<HTMLInputElement | null>(null);
  const a11y = controlA11y(
    label ? null : ctx,
    { ...props, id: idDonne },
    description ? `${base}-d` : undefined,
  );
  const id = a11y.id ?? base;
  useEffect(() => {
    if (interne.current) interne.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const boite = (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center max-sm:h-5 max-sm:w-5">
      <input
        ref={(el) => {
          interne.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="checkbox"
        {...props}
        {...a11y}
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-[var(--radius-sm)] border-2 border-[var(--border-strong)] bg-[var(--surface)] transition-colors checked:border-[var(--accent)] checked:bg-[var(--accent)] indeterminate:border-[var(--accent)] indeterminate:bg-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      {indeterminate ? (
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none relative h-3 w-3 text-[var(--accent-foreground)]"
        />
      ) : (
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none relative hidden h-3 w-3 text-[var(--accent-foreground)] peer-checked:block"
        />
      )}
    </span>
  );
  if (!label) return <span className={cn('inline-flex', className)}>{boite}</span>;
  return (
    <div className={cn('flex items-start gap-2.5 max-sm:min-h-11 max-sm:items-center', className)}>
      <span className="pt-0.5 max-sm:pt-0">{boite}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm leading-snug">
          {label}
        </label>
        {description ? (
          <span id={`${base}-d`} className="text-xs text-[var(--foreground-muted)]">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
});
