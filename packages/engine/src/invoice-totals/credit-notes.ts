// ─────────────────────────────────────────────────────────────────────────────
// Contrôles d'un avoir (ADR-0023 § S25e.5 et § S25e.9)
//
// Jalon E0 : signatures seulement, figées. Les corps appartiennent au chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import type { CreditNoteCheck, OriginLine } from './invoice-checks.types.js';
import type { DecimalString } from './types.js';

/** Lignes présentes sur l'origine, prix unitaire identique, quantité cumulée ≤ vendue,
 *  montant cumulé comparé à celui de l'origine. */
export function checkCreditNote(input: {
  originLines: readonly OriginLine[];
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[];
  lines: readonly { originLineIndex: number; quantity: DecimalString; unitPrice: DecimalString }[];
  originTotal: DecimalString;
  previousCreditTotals: readonly DecimalString[];
  creditTotal: DecimalString;
}): CreditNoteCheck {
  throw new Error('E1');
}

/** Quantité restant à créditer, par ligne de l'origine. */
export function remainingQuantities(
  originLines: readonly OriginLine[],
  alreadyCredited: readonly { lineIndex: number; quantity: DecimalString }[],
): readonly { lineIndex: number; quantity: DecimalString }[] {
  throw new Error('E1');
}
