'use client';

// Infobulle d'aide — remplace les paragraphes d'aide affichés en permanence
// sous chaque champ du wizard.
//
// Trois contraintes ont dicté la forme :
//
//  1. **Le déclencheur est un `<button>`, pas un `<span title>`.** Une bulle qui
//     n'ouvre qu'au survol est morte au clavier et sur téléphone. Ici le survol,
//     le focus ET le clic l'ouvrent; `Échap` la ferme en gardant le focus sur le
//     déclencheur (docs/04-UX-UI.md : navigation clavier complète).
//  2. **La bulle reste dans le DOM une fois fermée**, masquée par `opacity`
//     seulement — jamais `display:none` ni `visibility:hidden`. Le champ la cite
//     via `aria-describedby` : la faire disparaître de l'arbre d'accessibilité
//     casserait l'annonce du lecteur d'écran.
//  3. **Aucune dépendance.** Le placement est en CSS; seule la correction
//     horizontale (pour ne pas sortir de l'écran à 375 px) mesure le DOM, et sa
//     règle est isolée dans `decalageInfobulle`, testable sans navigateur.
//
// Le clic n'referme jamais la bulle : sur mobile, un doigt qui tape deux fois
// sans le vouloir la ferait clignoter. On sort par `Échap`, par le blur, ou en
// éloignant le pointeur.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Marge minimale conservée entre la bulle et le bord de la fenêtre (px). */
export const MARGE_ECRAN = 12;

interface DecalageArgs {
  /** Abscisse du centre du déclencheur, en coordonnées fenêtre. */
  centreDeclencheur: number;
  largeurBulle: number;
  largeurFenetre: number;
  marge?: number;
}

/**
 * Décalage horizontal (px) à appliquer à une bulle centrée sur son déclencheur
 * pour qu'elle tienne entièrement dans la fenêtre.
 *
 * Renvoie 0 quand la position centrée convient déjà. Si la bulle est plus large
 * que la fenêtre — cas limite d'un très petit écran — elle est collée au bord
 * gauche plutôt que centrée : mieux vaut un débordement à droite, du côté que
 * l'utilisateur atteint en faisant défiler le texte, qu'un début de phrase
 * coupé.
 */
export function decalageInfobulle({
  centreDeclencheur,
  largeurBulle,
  largeurFenetre,
  marge = MARGE_ECRAN,
}: DecalageArgs): number {
  const gaucheCentree = centreDeclencheur - largeurBulle / 2;
  const gaucheMin = marge;
  const gaucheMax = largeurFenetre - marge - largeurBulle;

  const gaucheVoulue =
    gaucheMax < gaucheMin ? gaucheMin : Math.min(Math.max(gaucheCentree, gaucheMin), gaucheMax);

  return Math.round(gaucheVoulue - gaucheCentree);
}

interface InfobulleProps {
  /** Id de la bulle — le champ décrit doit le citer dans `aria-describedby`. */
  id: string;
  /** Texte d'aide. Descriptif uniquement : jamais une alerte de validation. */
  texte: string;
  /** Libellé du champ, pour le nom accessible du déclencheur. */
  libelle: string;
}

export function Infobulle({ id, texte, libelle }: InfobulleProps): React.ReactElement {
  const [ouverte, setOuverte] = useState(false);
  const [decalage, setDecalage] = useState(0);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  const bulleRef = useRef<HTMLSpanElement>(null);

  // Mesure avant peinture : la bulle ne doit jamais être vue hors écran, même
  // une frame.
  useLayoutEffect(() => {
    if (!ouverte) return;
    const declencheur = declencheurRef.current;
    const bulle = bulleRef.current;
    if (!declencheur || !bulle) return;

    const rd = declencheur.getBoundingClientRect();
    const rb = bulle.getBoundingClientRect();
    setDecalage(
      decalageInfobulle({
        centreDeclencheur: rd.left + rd.width / 2,
        largeurBulle: rb.width,
        largeurFenetre: window.innerWidth,
      }),
    );
  }, [ouverte]);

  const surTouche = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // `stopPropagation` : `Échap` ferme la bulle, pas le dialogue qui l'entoure.
    e.stopPropagation();
    setOuverte(false);
    declencheurRef.current?.focus();
  }, []);

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setOuverte(true)}
      onPointerLeave={() => setOuverte(false)}
    >
      <button
        ref={declencheurRef}
        type="button"
        aria-expanded={ouverte}
        aria-controls={id}
        onFocus={() => setOuverte(true)}
        onBlur={() => setOuverte(false)}
        onClick={() => setOuverte(true)}
        onKeyDown={surTouche}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-[0.6rem] font-semibold leading-none text-[var(--foreground-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">Aide : {libelle}</span>
      </button>

      <span
        ref={bulleRef}
        id={id}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${decalage}px))` }}
        className={[
          'absolute left-1/2 top-full z-30 mt-2 w-[min(17rem,calc(100vw-1.5rem))]',
          'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2',
          'text-left text-xs font-normal not-italic leading-relaxed text-[var(--foreground)]',
          'shadow-lg transition-opacity duration-100',
          ouverte ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      >
        {texte}
      </span>
    </span>
  );
}
