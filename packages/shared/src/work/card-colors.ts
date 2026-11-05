// Couleur d'une carte de tâche, façon post-it (ADR-0061 § 4).
//
// Palette FERMÉE de 8 teintes pastel claires : la valeur stockée est une CLÉ, jamais
// un code couleur. Les teintes vivent dans le design system (`packages/ui`, jetons
// `--card-<clé>-bg` et `--card-<clé>-border`, déclinés pour Lalanda, Lagune et Ébène,
// contrastes vérifiés par `tokens.test.ts`). `null` : aucune couleur, affichage actuel.

export const WORK_CARD_COLORS = [
  'yellow',
  'orange',
  'pink',
  'purple',
  'blue',
  'teal',
  'green',
  'gray',
] as const;
export type WorkCardColor = (typeof WORK_CARD_COLORS)[number];

export const WORK_CARD_COLOR_LABELS: Readonly<Record<WorkCardColor, string>> = {
  yellow: 'Jaune',
  orange: 'Abricot',
  pink: 'Rose',
  purple: 'Lilas',
  blue: 'Bleu',
  teal: 'Menthe',
  green: 'Vert',
  gray: 'Gris',
};
