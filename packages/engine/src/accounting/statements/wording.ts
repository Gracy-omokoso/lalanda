// Libellés imposés aux projets d'états et aux exports (ADR-0049 § 10, § 9,
// risques juridiques n° 1). Aucun libellé de ce module ne dit que Lalanda
// vérifie, garantit ou dépose quoi que ce soit.
//
// Écart assumé à la lettre du § 10 : le bandeau proposé par l'ADR (« ni
// certifié, ni déposé ») contient lui-même un mot interdit par le critère 14 ;
// il est rendu ici par « non vérifié, non déposé », de même sens.

/** Statut porté par chaque projet d'état, sans exception. */
export const STATEMENT_STATUS = 'draft_unverified' as const;
export type StatementStatus = typeof STATEMENT_STATUS;

/** Bandeau de chaque projet d'état (écran, page PDF, feuille, réponse d'API). */
export const STATEMENT_DISCLAIMER =
  'Projet — à valider par un expert-comptable. Établi automatiquement par Lalanda à partir des opérations enregistrées ; non vérifié, non déposé.';

/** En-tête court d'un export en mode actif. */
export const PROJECT_BANNER = 'Projet — à valider par un expert-comptable';

/** En-tête d'un export ou d'un état en mode simulation. */
export const SIMULATION_BANNER =
  "SIMULATION — plan comptable non relu par un expert-comptable ; rien n'est enregistré";

/** Note sur le format des lignes d'export (§ 9). */
export const EXPORT_FORMAT_NOTE =
  "Colonnes de type FEC (fichier des écritures comptables utilisé en France), retenues comme format pratique pour l'expert-comptable ; ce format n'est pas une obligation en RDC.";

/** Mention portée par tout élément du pack non relu. */
export const TO_CONFIRM_NOTE = "À confirmer par l'expert-comptable";

/**
 * Mots interdits dans toute sortie (ADR-0049 critère 14, § 10). Les formes
 * sont comparées sans accents ni casse, mot entier.
 */
export const FORBIDDEN_WORDS = ['conforme', 'certifié', 'définitif', 'liasse'] as const;

const FORBIDDEN_PATTERNS: readonly { word: string; pattern: RegExp }[] = [
  { word: 'conforme', pattern: /\bconform(e|es|ement|ite)\b/ },
  { word: 'certifié', pattern: /\bcertifi(e|es|ee|ees|er|cation|cations)\b/ },
  { word: 'définitif', pattern: /\bdefiniti(f|fs|ve|ves|vement)\b/ },
  { word: 'liasse', pattern: /\bliasses?\b/ },
];

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Mots interdits trouvés dans un texte (vide si aucun). */
export function findForbiddenWords(text: string): string[] {
  const folded = fold(text);
  return FORBIDDEN_PATTERNS.filter((f) => f.pattern.test(folded)).map((f) => f.word);
}
