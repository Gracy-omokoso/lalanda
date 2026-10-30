// Modal — fenêtre de dialogue partagée (création « + », confirmations, aperçus).
//
// Contrat d'accessibilité (ADR-0030 § 5, docs/04 § Fenêtres modales) :
// - `<dialog>` ouvert par `showModal()` : `role="dialog"`, `aria-modal`, le
//   reste de la page devient inerte ; le titre est relié par `aria-labelledby`,
//   la description éventuelle par `aria-describedby` ;
// - le focus va au premier champ du contenu (sinon au bouton Fermer), `Tab`
//   tourne à l'intérieur de la fenêtre, et le focus revient à l'élément qui
//   l'a ouverte à la fermeture ;
// - fermeture par `Échap`, par le bouton Fermer et par un clic sur le fond.
//   Si la saisie a commencé, une confirmation est demandée avant d'abandonner ;
//   pendant un envoi (`busy`), rien ne ferme ;
// - le contenu défile, l'en-tête reste visible ; la page derrière ne défile pas ;
// - un dialogue imbriqué dans le contenu (`aria-modal`) garde `Échap` et `Tab`
//   tant qu'il détient le focus ;
// - plein écran sur téléphone (< 640 px), centrée et bornée au-delà ;
// - couleurs par jetons : clair et sombre sans code dédié.
//
// La fenêtre n'est montée que lorsqu'elle est ouverte : un formulaire repart de
// zéro à chaque ouverture.

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../utils.js';

import { Button } from './button.js';

export type ModalSize = 'sm' | 'md' | 'lg';

/** Largeur maximale au-delà du téléphone. */
export const MODAL_WIDTHS: Record<ModalSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
};

/** Ce que doit faire une demande de fermeture (Échap, bouton, fond). */
export type ModalCloseDecision = 'close' | 'confirm' | 'ignore';

export function modalCloseDecision({
  busy,
  dirty,
  confirming,
}: {
  busy: boolean;
  dirty: boolean;
  confirming: boolean;
}): ModalCloseDecision {
  if (busy) return 'ignore';
  // Une seconde demande pendant la confirmation vaut « continuer la saisie » :
  // elle est traitée par l'appelant, jamais comme un abandon silencieux.
  if (confirming) return 'ignore';
  return dirty ? 'confirm' : 'close';
}

/**
 * Indice du prochain élément focalisable quand `Tab` (ou `Maj+Tab`) quitte la
 * fenêtre : on boucle sur le premier ou le dernier. `null` laisse faire le
 * navigateur (déplacement interne).
 */
export function trapFocusIndex(current: number, total: number, backwards: boolean): number | null {
  if (total === 0) return null;
  if (current < 0) return backwards ? total - 1 : 0;
  if (backwards && current === 0) return total - 1;
  if (!backwards && current === total - 1) return 0;
  return null;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * Dialogue imbriqué (un `aria-modal` rendu dans le contenu) qui détient le
 * focus : il garde la main sur `Échap` et sur la circulation au clavier.
 */
function dialogueImbrique(dialog: HTMLDialogElement): HTMLElement | null {
  const actif = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const imbrique = actif?.closest<HTMLElement>('[aria-modal="true"]') ?? null;
  return imbrique && imbrique !== dialog && dialog.contains(imbrique) ? imbrique : null;
}

function focusables(racine: HTMLElement): HTMLElement[] {
  return Array.from(racine.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );
}

export interface ModalProps {
  open: boolean;
  /** Fermeture acceptée (après confirmation éventuelle). */
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: ModalSize;
  /** Envoi en cours : aucune fermeture possible. */
  busy?: boolean;
  /**
   * Saisie modifiée. Par défaut, la fenêtre le déduit seule du premier
   * événement `input` ou `change` dans son contenu ; passer une valeur
   * explicite remplace cette détection.
   */
  dirty?: boolean;
  /** Pied fixe (boutons) sous la zone qui défile. */
  footer?: React.ReactNode;
  /** Libellés de la confirmation d'abandon. */
  discardTitle?: string;
  className?: string;
  children: React.ReactNode;
}

export function Modal(props: ModalProps): React.ReactElement | null {
  if (!props.open) return null;
  return <ModalOuverte {...props} />;
}

function ModalOuverte({
  onClose,
  title,
  description,
  size = 'md',
  busy = false,
  dirty,
  footer,
  discardTitle = 'Abandonner la saisie ?',
  className,
  children,
}: ModalProps): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const corpsRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const appuiSurFond = useRef(false);
  const id = useId();
  const [modifie, setModifie] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const sale = dirty ?? modifie;

  // Ouverture : `showModal`, focus initial, page figée ; fermeture : focus rendu.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const origine = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    if (!d.open) d.showModal();
    const premier =
      corpsRef.current?.querySelector<HTMLElement>('[autofocus]') ??
      (corpsRef.current ? focusables(corpsRef.current)[0] : undefined);
    premier?.focus();
    return () => {
      if (d.open) d.close();
      html.style.overflow = overflow;
      if (origine && origine.isConnected) origine.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmation) confirmRef.current?.focus();
  }, [confirmation]);

  const demanderFermeture = useCallback(() => {
    const decision = modalCloseDecision({ busy, dirty: sale, confirming: confirmation });
    if (decision === 'close') onClose();
    else if (decision === 'confirm') setConfirmation(true);
  }, [busy, sale, confirmation, onClose]);

  function surTouche(e: React.KeyboardEvent<HTMLDialogElement>): void {
    if (e.key !== 'Tab' || !ref.current) return;
    const liste = focusables(dialogueImbrique(ref.current) ?? ref.current);
    const actif = document.activeElement as HTMLElement | null;
    const i = actif ? liste.indexOf(actif) : -1;
    const cible = trapFocusIndex(i, liste.length, e.shiftKey);
    if (cible !== null) {
      e.preventDefault();
      liste[cible]?.focus();
    }
  }

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={`${id}-titre`}
      aria-describedby={description ? `${id}-desc` : undefined}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        // Échap : la fenêtre décide elle-même (confirmation, envoi en cours).
        e.preventDefault();
        if (ref.current && dialogueImbrique(ref.current)) return;
        if (confirmation) setConfirmation(false);
        else demanderFermeture();
      }}
      onKeyDown={surTouche}
      onPointerDown={(e) => {
        appuiSurFond.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Clic sur le fond (le `::backdrop` appartient au `<dialog>`). Un
        // glissé commencé dans un champ et relâché dehors ne ferme pas.
        if (e.target === e.currentTarget && appuiSurFond.current) demanderFermeture();
        appuiSurFond.current = false;
      }}
      onInput={() => setModifie(true)}
      onChange={() => setModifie(true)}
      className={cn(
        // Téléphone : plein écran.
        'm-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-[var(--surface)] p-0 text-[var(--foreground)]',
        // Au-delà : centrée, bornée, défilement interne.
        'sm:m-auto sm:h-auto sm:max-h-[min(90dvh,56rem)] sm:w-[calc(100%-2rem)] sm:rounded-[var(--radius-lg)] sm:border sm:border-[var(--border)] sm:shadow-[var(--shadow-pop)]',
        MODAL_WIDTHS[size],
        'backdrop:bg-[color-mix(in_srgb,var(--foreground)_45%,transparent)]',
        className,
      )}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        <header className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={`${id}-titre`}
              className="font-display text-lg font-bold tracking-tight text-[var(--foreground)]"
            >
              {title}
            </h2>
            {description ? (
              <p id={`${id}-desc`} className="mt-1 text-sm text-[var(--foreground-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 px-0"
            aria-label="Fermer"
            disabled={busy}
            onClick={demanderFermeture}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </header>

        {confirmation ? (
          <div
            role="alertdialog"
            aria-labelledby={`${id}-abandon`}
            className="flex flex-wrap items-center gap-3 border-b border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,var(--surface))] px-4 py-3 sm:px-5"
          >
            <p id={`${id}-abandon`} className="min-w-0 flex-1 text-sm font-medium">
              {discardTitle} Ce qui a été saisi sera perdu.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button ref={confirmRef} size="sm" onClick={() => setConfirmation(false)}>
                Continuer la saisie
              </Button>
              <Button variant="danger" size="sm" onClick={onClose}>
                Abandonner
              </Button>
            </div>
          </div>
        ) : null}

        <div
          ref={corpsRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5"
        >
          {children}
        </div>

        {footer ? (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}
