// Comportements de formulaire (ADR-0074 § 9) :
// - `Form` : Cmd/Ctrl+Entrée enregistre, focus automatique du premier champ,
//   avertissement avant de quitter la page avec des modifications ;
// - `SubmitButton` : état de chargement annoncé (`aria-busy`) ;
// - `StickyActions` : barre d'actions collée en bas des longs formulaires ;
// - `ErrorSummary` : résumé cliquable des erreurs en tête, à la soumission ;
// - `useBlurValidation` : une erreur apparaît à la SORTIE du champ, jamais à
//   chaque frappe, et disparaît dès que la valeur est corrigée.

import { AlertCircle, Loader2 } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';

import { Button, type ButtonProps } from '../components/button.js';
import { cn } from '../utils.js';

import { estRaccourciEnregistrer, phraseResume, type ErreurResumee } from './logic.js';

/** Avertit avant de quitter la page (rechargement, fermeture d'onglet) si `actif`. */
export function useUnsavedChangesWarning(actif: boolean): void {
  useEffect(() => {
    if (!actif) return;
    const avant = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Requis par certains navigateurs ; le texte affiché est le leur.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avant);
    return () => window.removeEventListener('beforeunload', avant);
  }, [actif]);
}

const PREMIER_CHAMP =
  'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly]), [role="combobox"]:not([disabled]), [role="radio"][tabindex="0"]';

export interface FormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Modifications non enregistrées : avertissement avant de quitter la page. */
  dirty?: boolean;
  /** Focus sur le premier champ au montage (défaut oui). */
  autoFocusFirst?: boolean;
}

/** `<form noValidate>` avec raccourci d'enregistrement et focus initial. */
export const Form = forwardRef<HTMLFormElement, FormProps>(function Form(
  { onSubmit, dirty = false, autoFocusFirst = true, onKeyDown, children, ...props },
  ref,
) {
  const interne = useRef<HTMLFormElement | null>(null);
  useUnsavedChangesWarning(dirty);
  useEffect(() => {
    if (!autoFocusFirst || !interne.current) return;
    // Pas de vol de focus si l'utilisateur est déjà ailleurs dans le formulaire.
    if (interne.current.contains(document.activeElement)) return;
    interne.current.querySelector<HTMLElement>(PREMIER_CHAMP)?.focus({ preventScroll: true });
  }, [autoFocusFirst]);
  return (
    <form
      ref={(el) => {
        interne.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      noValidate
      {...props}
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && estRaccourciEnregistrer(e)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      {children}
    </form>
  );
});

export interface SubmitButtonProps extends Omit<ButtonProps, 'type'> {
  /** Texte pendant l'envoi (« Enregistrement… »). */
  busyLabel?: React.ReactNode;
  /** Affiche le raccourci ⌘/Ctrl+Entrée en infobulle. */
  showShortcut?: boolean;
}

export const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(function SubmitButton(
  { busy = false, busyLabel, children, variant = 'primary', showShortcut = true, title, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="submit"
      variant={variant}
      busy={busy}
      title={title ?? (showShortcut ? 'Enregistrer : Ctrl+Entrée (⌘+Entrée sur Mac)' : undefined)}
      {...props}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      ) : null}
      {busy ? (busyLabel ?? children) : children}
    </Button>
  );
});

export interface StickyActionsProps {
  children: React.ReactNode;
  /** Texte d'état à gauche (« Modifications non enregistrées »). */
  status?: React.ReactNode;
  className?: string;
}

/** Barre d'actions collée en bas de la zone qui défile ; boutons pleine largeur sur téléphone. */
export function StickyActions({
  children,
  status,
  className,
}: StickyActionsProps): React.ReactElement {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] sm:mx-0 sm:rounded-b-[var(--radius-md)] max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <p aria-live="polite" className="min-w-0 flex-1 text-xs text-[var(--foreground-muted)]">
        {status}
      </p>
      <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row [&>*]:max-sm:w-full [&>*]:max-sm:h-11">
        {children}
      </div>
    </div>
  );
}

export interface ErrorSummaryProps {
  errors: readonly ErreurResumee[];
  /** Incrémenté à chaque soumission : le résumé reprend le focus. */
  submitCount?: number;
  title?: string;
  className?: string;
}

/** Résumé d'erreurs en tête : annoncé, focalisé, chaque ligne mène au champ. */
export function ErrorSummary({
  errors,
  submitCount = 0,
  title,
  className,
}: ErrorSummaryProps): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);
  const visible = errors.length > 0;
  useEffect(() => {
    if (visible && submitCount > 0) ref.current?.focus();
  }, [visible, submitCount]);
  if (!visible) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={cn(
        'flex gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--foreground)]',
        className,
      )}
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold text-[var(--danger)]">{title ?? phraseResume(errors.length)}</p>
        <ul className="flex flex-col gap-0.5">
          {errors.map((e, i) => (
            <li key={`${e.id}-${i}`}>
              {e.id ? (
                <a
                  href={`#${e.id}`}
                  onClick={(ev) => {
                    ev.preventDefault();
                    const cible = document.getElementById(e.id);
                    cible?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    cible?.focus({ preventScroll: true });
                  }}
                  className="underline underline-offset-2 hover:text-[var(--danger)]"
                >
                  {e.libelle ? <strong className="font-medium">{e.libelle} : </strong> : null}
                  {e.message}
                </a>
              ) : (
                <span>{e.message}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Validation à la sortie du champ. `validate` rend toutes les erreurs du
 * formulaire ; seules celles des champs QUITTÉS (ou toutes après une
 * soumission) sont montrées.
 */
export function useBlurValidation<K extends string>(
  validate: () => Partial<Record<K, string>>,
): {
  errors: Partial<Record<K, string>>;
  /** À poser sur `onBlur` du champ. */
  touch: (field: K) => void;
  /** Soumission : tout montrer ; `true` si rien n'est en faute. */
  validateAll: () => boolean;
  submitCount: number;
  reset: () => void;
} {
  const [touches, setTouches] = useState<ReadonlySet<K>>(new Set());
  const [soumis, setSoumis] = useState(0);
  const toutes = validate();
  const errors: Partial<Record<K, string>> = {};
  for (const [k, m] of Object.entries(toutes) as [K, string | undefined][]) {
    if (m && (soumis > 0 || touches.has(k))) errors[k] = m;
  }
  const touch = useCallback((field: K) => {
    setTouches((t) => (t.has(field) ? t : new Set([...t, field])));
  }, []);
  return {
    errors,
    touch,
    validateAll: () => {
      setSoumis((n) => n + 1);
      return Object.values(validate()).every((m) => !m);
    },
    submitCount: soumis,
    reset: () => {
      setTouches(new Set());
      setSoumis(0);
    },
  };
}
