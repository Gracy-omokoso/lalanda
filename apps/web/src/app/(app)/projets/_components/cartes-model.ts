// Couleur des cartes (post-it) et numéros de tâche — ADR-0061 § 3 et § 4. Pur, testé.
//
// La couleur est une CLÉ de palette fermée (`WORK_CARD_COLORS`) ; ses teintes sont des
// jetons du design system (`--card-<clé>-bg`, `--card-<clé>-dot`), déclinés par thème,
// contrastes vérifiés dans `packages/ui/src/tokens.test.ts`. Sans couleur : la carte
// garde exactement son affichage actuel.

import {
  WORK_CARD_COLORS,
  WORK_CARD_COLOR_LABELS,
  type WorkCardColor,
} from '@lalanda/shared/work';

export { WORK_CARD_COLORS as COULEURS_CARTE, WORK_CARD_COLOR_LABELS as LIBELLES_COULEUR };

export function estCouleurCarte(v: unknown): v is WorkCardColor {
  return typeof v === 'string' && (WORK_CARD_COLORS as readonly string[]).includes(v);
}

/** Style du fond d'une carte du Tableau ; `undefined` sans couleur (affichage actuel). */
export function styleCarte(color: string | null | undefined): React.CSSProperties | undefined {
  if (!estCouleurCarte(color)) return undefined;
  return {
    background: `var(--card-${color}-bg)`,
    borderColor: `color-mix(in srgb, var(--card-${color}-dot) 45%, var(--border))`,
    boxShadow: `inset 3px 0 0 var(--card-${color}-dot), var(--shadow-card)`,
  };
}

/** Pastille discrète de la Liste ; `undefined` sans couleur. */
export function stylePastille(color: string | null | undefined): React.CSSProperties | undefined {
  if (!estCouleurCarte(color)) return undefined;
  return { background: `var(--card-${color}-dot)` };
}

/** « #12 » si les numéros sont affichés (réglage `showTaskNumbers`), sinon `null`. */
export function numeroVisible(number: number, show: boolean | undefined): string | null {
  return show === false ? null : `#${number}`;
}
