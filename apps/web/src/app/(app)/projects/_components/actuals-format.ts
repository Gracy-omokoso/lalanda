// Helpers de présentation de l'onglet « Réalisé » (S18b).
// AUCUNE règle financière ici (docs/26) : uniquement du formatage. Les montants,
// écarts, statuts et projections sont calculés par l'API.

/** Montant en devise du projet. `null` → tiret cadratin (valeur non applicable). */
export function money(value: number | null, currency: string, fractionDigits = 0): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Écart relatif reçu en fraction (0.05) → « +5,0 % ». `null` → tiret. */
export function percent(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
}

/** Montant signé, pour la colonne « Écart ». */
export function signedMoney(value: number | null, currency: string): string {
  if (value === null) return '—';
  const formatted = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(value);
  return formatted;
}

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Libellé court d'un mois d'exercice — « M1 » … « M12 » (pas un mois calendaire). */
export function monthLabel(month: number): string {
  return `M${month}`;
}

/** Phrase d'explication d'une ligne non comparable (ADR-0011 friction n°3). */
export function raisonLabel(raison: string | null): string {
  switch (raison) {
    case 'LIGNE_ABSENTE_DU_PLAN':
      return "Cette ligne n'existe pas dans le plan validé comparé — aucun écart ne peut être calculé.";
    case 'LIGNE_HORS_COMPTE_EXPLOITATION':
      return "Cette ligne du plan est hors du compte d'exploitation — elle n'entre pas dans le suivi mensuel.";
    case 'EXERCICE_ABSENT_DU_PLAN':
      return "Le plan validé comparé ne publie pas de montant pour cet exercice — l'exercice 1 n'est jamais extrapolé.";
    default:
      return 'Ligne sans référence dans le plan validé comparé.';
  }
}

/** Origine de la base annuelle, affichée à côté du chiffre (docs/08 § Projection). */
export function baseLabel(base: string | null): string {
  switch (base) {
    case 'projection':
      return 'série annuelle du plan';
    case 'activite_x12':
      return 'mensuel × 12';
    default:
      return '—';
  }
}

/**
 * Parse une saisie de montant au clavier français : la virgule est acceptée comme
 * séparateur décimal (« 1,5 » → 1.5), les espaces de milliers sont ignorés.
 * Renvoie `null` si l'entrée n'est pas un nombre fini.
 */
export function parseAmount(raw: string): number | null {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
