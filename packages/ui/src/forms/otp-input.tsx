// Code à usage unique (ADR-0074 § 5) : six cases, avance automatique, collage
// du code entier, Retour arrière qui recule, flèches gauche/droite,
// `autocomplete="one-time-code"` (remplissage par iOS et Android) et
// `inputmode="numeric"`. `onComplete` est appelé dès la dernière case remplie :
// l'écran soumet sans bouton à atteindre (le bouton reste là pour qui le veut).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { cn } from '../utils.js';

import { controlA11y, useField } from './field.js';
import { casesOtp, effacerOtp, saisirOtp } from './logic.js';

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Toutes les cases remplies (saisie, collage ou remplissage automatique). */
  onComplete?: (code: string) => void;
  length?: number;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Nom du groupe si le champ n'est pas dans un `Field group`. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
}

export interface OtpInputHandle {
  focus: () => void;
}

export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  {
    value,
    onChange,
    onComplete,
    length = 6,
    id: idDonne,
    disabled,
    autoFocus = false,
    'aria-label': ariaLabel,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    className,
  },
  ref,
) {
  const ctx = useField();
  const a11y = controlA11y(ctx, {
    id: idDonne,
    'aria-describedby': ariaDescribedBy,
    'aria-invalid': ariaInvalid,
    disabled,
  });
  const [cases, setCases] = useState<string[]>(() => casesOtp(value, length));
  const champs = useRef<(HTMLInputElement | null)[]>([]);

  // Une valeur remise à zéro (ou fixée) par l'écran remplace la saisie.
  useEffect(() => {
    setCases((c) => (c.join('') === value ? c : casesOtp(value, length)));
  }, [value, length]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const vide = cases.findIndex((c) => c === '');
      champs.current[vide < 0 ? length - 1 : vide]?.focus();
    },
  }));

  useEffect(() => {
    if (autoFocus) champs.current[0]?.focus();
  }, [autoFocus]);

  function appliquer(etat: { cases: string[]; focus: number; complet: boolean }): void {
    setCases(etat.cases);
    const code = etat.cases.join('');
    onChange(code);
    champs.current[etat.focus]?.focus();
    if (etat.complet) onComplete?.(code);
  }

  return (
    <div
      role="group"
      aria-labelledby={ctx && !ariaLabel ? ctx.labelId : undefined}
      aria-label={ariaLabel}
      aria-describedby={a11y['aria-describedby']}
      className={cn('flex items-center gap-2 max-sm:gap-1.5', className)}
    >
      {cases.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            champs.current[i] = el;
          }}
          id={i === 0 ? a11y.id : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          // Le premier accepte le code entier (remplissage automatique).
          maxLength={i === 0 ? length : 2}
          aria-label={`Chiffre ${i + 1} sur ${length}`}
          aria-invalid={a11y['aria-invalid']}
          disabled={a11y.disabled}
          value={c}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            let t = e.currentTarget.value;
            // Une case pleine retapée : seul le nouveau chiffre compte.
            if (c !== '' && t.length === 2) t = t.startsWith(c) ? t.slice(1) : t.slice(0, 1);
            appliquer(saisirOtp(cases, i, t));
          }}
          onPaste={(e) => {
            e.preventDefault();
            appliquer(saisirOtp(cases, i, e.clipboardData.getData('text')));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              appliquer(effacerOtp(cases, i));
            } else if (e.key === 'ArrowLeft' && i > 0) {
              e.preventDefault();
              champs.current[i - 1]?.focus();
            } else if (e.key === 'ArrowRight' && i < length - 1) {
              e.preventDefault();
              champs.current[i + 1]?.focus();
            }
          }}
          className={cn(
            'h-12 w-11 min-w-0 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] text-center font-mono text-xl font-semibold text-[var(--foreground)] caret-[var(--accent)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] aria-[invalid=true]:border-[var(--danger)] disabled:opacity-60 max-sm:h-12 max-sm:w-[clamp(2.5rem,12vw,3rem)]',
            c !== '' && 'border-[var(--accent)] bg-[var(--accent-soft)]',
            // Séparation visuelle 3 + 3 pour un code de six.
            length === 6 && i === 3 ? 'ml-2 max-sm:ml-1' : null,
          )}
        />
      ))}
    </div>
  );
});
