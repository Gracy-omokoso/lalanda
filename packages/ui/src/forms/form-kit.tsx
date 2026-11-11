// Comportements de formulaire (ADR-0074 § 9) :
// - `Form` : Cmd/Ctrl+Entrée enregistre, focus automatique du premier champ,
//   avertissement avant de quitter la page avec des modifications (rechargement,
//   fermeture d'onglet : `beforeunload` ; lien interne de l'application : petite
//   fenêtre « Quitter sans enregistrer ? », décision n° 3 du 11 nov. 2026) ;
// - `SubmitButton` : état de chargement annoncé (`aria-busy`) ;
// - `StickyActions` : barre d'actions collée en bas des longs formulaires ;
// - `ErrorSummary` : résumé cliquable des erreurs en tête, à la soumission ;
// - `useBlurValidation` : une erreur apparaît à la SORTIE du champ, jamais à
//   chaque frappe, et disparaît dès que la valeur est corrigée.

import { AlertCircle, Loader2 } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, type ButtonProps } from '../components/button.js';
import { cn } from '../utils.js';

import {
  estRaccourciEnregistrer,
  navigationInterne,
  phraseResume,
  type ErreurResumee,
} from './logic.js';

/**
 * Avertit avant de quitter la page (rechargement, fermeture d'onglet) si `actif`.
 * `libere` (facultatif) : départ déjà confirmé dans la fenêtre du garde de
 * navigation — le navigateur ne redemande pas.
 */
export function useUnsavedChangesWarning(actif: boolean, libere?: React.RefObject<boolean>): void {
  useEffect(() => {
    if (!actif) return;
    const avant = (e: BeforeUnloadEvent): void => {
      if (libere?.current) return;
      e.preventDefault();
      // Requis par certains navigateurs ; le texte affiché est le leur.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avant);
    return () => window.removeEventListener('beforeunload', avant);
  }, [actif, libere]);
}

/** Durée après « Quitter » pendant laquelle le garde se tait (le temps de partir). */
const DUREE_LIBERATION_MS = 1500;

/**
 * Garde des modifications non enregistrées (ADR-0074 § 9, décision n° 3) :
 * `beforeunload` pour le rechargement et la fermeture d'onglet, et capture des
 * clics sur les liens internes de l'application (même origine, sans touche de
 * modification, hors `target="_blank"` et téléchargements) — le routeur de
 * Next n'offre pas d'API pour cela. Le clic est retenu, une petite fenêtre
 * demande « Quitter sans enregistrer ? » ; « Quitter » rejoue le clic sur le
 * même lien (le routeur le traite comme avant), « Rester » ne fait rien.
 *
 * Actif seulement si `actif` (formulaire modifié) : il se tait dès que
 * l'écran remet `actif` à `false` (envoi réussi, retour à l'état enregistré).
 * Rend la fenêtre à afficher (portail vers `document.body`).
 */
export function useUnsavedChangesGuard(actif: boolean): React.ReactElement | null {
  const libere = useRef(false);
  const [lien, setLien] = useState<HTMLAnchorElement | null>(null);
  useUnsavedChangesWarning(actif, libere);

  useEffect(() => {
    if (!actif) {
      setLien(null);
      return;
    }
    libere.current = false;
    const surClic = (e: MouseEvent): void => {
      if (libere.current) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const cible = navigationInterne(
        e,
        { href: a.href, target: a.target, hasDownload: a.hasAttribute('download') },
        window.location.href,
      );
      if (cible === null) return;
      // Capture sur `document` : le clic n'atteint ni le lien ni le routeur.
      e.preventDefault();
      e.stopPropagation();
      setLien(a);
    };
    document.addEventListener('click', surClic, true);
    return () => document.removeEventListener('click', surClic, true);
  }, [actif]);

  const rester = useCallback(() => setLien(null), []);
  const quitter = useCallback(() => {
    const a = lien;
    setLien(null);
    if (!a || !a.isConnected) return;
    libere.current = true;
    window.setTimeout(() => {
      libere.current = false;
    }, DUREE_LIBERATION_MS);
    a.click();
  }, [lien]);

  if (!lien || typeof document === 'undefined') return null;
  return createPortal(<ConfirmLeaveDialog onStay={rester} onLeave={quitter} />, document.body);
}

export interface ConfirmLeaveDialogProps {
  onStay: () => void;
  onLeave: () => void;
  title?: string;
  description?: string;
}

/**
 * Petite fenêtre « Quitter sans enregistrer ? » : `<dialog>` modal (le reste de
 * la page devient inerte), focus sur « Rester » (le choix sans perte), Échap
 * et clic sur le fond valent « Rester ». Compacte aussi sur téléphone.
 */
export function ConfirmLeaveDialog({
  onStay,
  onLeave,
  title = 'Quitter sans enregistrer ?',
  description = 'Les modifications de ce formulaire ne sont pas enregistrées : elles seront perdues.',
}: ConfirmLeaveDialogProps): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const rester = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const origine = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    rester.current?.focus();
    return () => {
      if (d.open) d.close();
      if (origine && origine.isConnected) origine.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-titre`}
      aria-describedby={`${id}-desc`}
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onStay();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] shadow-[var(--shadow-pop)] backdrop:bg-[color-mix(in_srgb,var(--foreground)_45%,transparent)]"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <h2 id={`${id}-titre`} className="text-base font-semibold">
            {title}
          </h2>
          <p id={`${id}-desc`} className="text-sm text-[var(--foreground-muted)]">
            {description}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:max-sm:h-11 [&>*]:max-sm:w-full">
          <Button type="button" variant="danger" onClick={onLeave}>
            Quitter
          </Button>
          <Button ref={rester} type="button" variant="primary" onClick={onStay}>
            Rester
          </Button>
        </div>
      </div>
    </dialog>
  );
}

const PREMIER_CHAMP =
  'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly]), [role="combobox"]:not([disabled]), [role="radio"][tabindex="0"]';

export interface FormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  /**
   * Modifications non enregistrées : avertissement avant de quitter la page
   * (rechargement, fermeture d'onglet, lien interne). Remis à `false` après un
   * envoi réussi, il ne garde plus rien.
   */
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
  const garde = useUnsavedChangesGuard(dirty);
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
      {garde}
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
