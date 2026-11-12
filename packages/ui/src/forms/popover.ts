// Ancrage des listes et calendriers (ADR-0074).
//
// Position `fixed` calculée depuis le champ : la liste n'est jamais rognée par
// une zone qui défile (contenu d'une fenêtre modale, tableau). Elle s'ouvre
// 6 px sous le champ, ou au-dessus quand la place manque en bas. Sous 640 px,
// elle devient une feuille basse (classes `FEUILLE_BASSE`) et ce calcul se tait.

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/** Écart entre le champ et la liste. */
export const ECART_POPOVER = 6;

/** Feuille basse sur téléphone : pleine largeur, collée en bas, cibles de 44 px. */
export const FEUILLE_BASSE =
  'max-sm:!fixed max-sm:!inset-x-0 max-sm:!bottom-0 max-sm:!top-auto max-sm:!left-0 max-sm:!w-full max-sm:!max-w-none max-sm:max-h-[75dvh] max-sm:rounded-b-none max-sm:rounded-t-[var(--radius-lg)] max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]';

export interface PositionPopover {
  /** Bord haut (liste sous le champ). */
  top: number | null;
  /** Bord bas, depuis le bas de l'écran (liste au-dessus du champ : collée au champ quelle
   * que soit sa hauteur réelle). */
  bottom: number | null;
  left: number;
  minWidth: number;
  maxHeight: number;
  /** Ouverte au-dessus du champ. */
  dessus: boolean;
}

/** Calcul pur, testé : place sous le champ, ou au-dessus si elle y tient mieux. */
export function placerPopover(
  ancre: { top: number; bottom: number; left: number; width: number },
  ecran: { width: number; height: number },
  hauteurVoulue: number,
  largeurVoulue = 0,
): PositionPopover {
  const marge = 8;
  const dessous = ecran.height - ancre.bottom - ECART_POPOVER - marge;
  const audessus = ancre.top - ECART_POPOVER - marge;
  const dessus = dessous < Math.min(hauteurVoulue, 240) && audessus > dessous;
  const place = Math.max(dessus ? audessus : dessous, 120);
  const maxHeight = Math.min(hauteurVoulue, place);
  const largeur = Math.max(ancre.width, largeurVoulue);
  const left = Math.max(marge, Math.min(ancre.left, ecran.width - largeur - marge));
  return {
    top: dessus ? null : ancre.bottom + ECART_POPOVER,
    bottom: dessus ? ecran.height - ancre.top + ECART_POPOVER : null,
    left,
    minWidth: ancre.width,
    maxHeight,
    dessus,
  };
}

export function useEstTelephone(): boolean {
  const [tel, setTel] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 639px)');
    const maj = (): void => setTel(mq.matches);
    maj();
    mq.addEventListener('change', maj);
    return () => mq.removeEventListener('change', maj);
  }, []);
  return tel;
}

/** Style `fixed` de la liste ouverte, recalculé au défilement et au redimensionnement. */
export function useAncrage(
  ouvert: boolean,
  ancre: React.RefObject<HTMLElement | null>,
  hauteurVoulue = 320,
  largeurVoulue = 0,
): React.CSSProperties | undefined {
  const [pos, setPos] = useState<PositionPopover | null>(null);
  const calculer = useCallback(() => {
    const el = ancre.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(
      placerPopover(
        r,
        { width: window.innerWidth, height: window.innerHeight },
        hauteurVoulue,
        largeurVoulue,
      ),
    );
  }, [ancre, hauteurVoulue, largeurVoulue]);

  useLayoutEffect(() => {
    if (!ouvert) return;
    calculer();
    window.addEventListener('scroll', calculer, true);
    window.addEventListener('resize', calculer);
    return () => {
      window.removeEventListener('scroll', calculer, true);
      window.removeEventListener('resize', calculer);
    };
  }, [ouvert, calculer]);

  if (!ouvert || !pos) return undefined;
  return {
    position: 'fixed',
    ...(pos.top !== null ? { top: pos.top } : { bottom: pos.bottom ?? 0 }),
    left: pos.left,
    minWidth: pos.minWidth,
    maxHeight: pos.maxHeight,
  };
}

/**
 * Un choix fait sans frappe (option d'une liste, jour du calendrier, segment,
 * interrupteur, fiche créée par le « + ») est annoncé comme une saisie : un
 * événement `input` qui remonte depuis `el`. La fenêtre modale qui entoure le
 * champ (`Modal`, détection par `input`/`change`) le compte alors comme une
 * modification et demande confirmation avant d'abandonner. `el` ne doit pas
 * être un `<input>` (React y lirait un changement de valeur) : on passe
 * l'enveloppe ou le bouton du composant.
 */
export function signalerSaisie(el: Element | null | undefined): void {
  if (!el || typeof Event === 'undefined') return;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Fermeture sur un appui hors des éléments donnés. */
export function useAppuiExterieur(
  actif: boolean,
  refs: readonly React.RefObject<HTMLElement | null>[],
  fermer: () => void,
): void {
  useEffect(() => {
    if (!actif) return;
    const surAppui = (e: PointerEvent): void => {
      const cible = e.target as Node | null;
      if (refs.some((r) => r.current && cible && r.current.contains(cible))) return;
      fermer();
    };
    document.addEventListener('pointerdown', surAppui, true);
    return () => document.removeEventListener('pointerdown', surAppui, true);
  }, [actif, refs, fermer]);
}
