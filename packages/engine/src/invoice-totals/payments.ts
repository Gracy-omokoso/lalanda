// ─────────────────────────────────────────────────────────────────────────────
// Paiements d'une facture (ADR-0023 § S25e.8 et § S25e.9)
//
// Jalon E0 : signatures seulement, figées. Les corps appartiennent au chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import type { InvoiceCheckIssue, PaymentInput, PaymentsCheck } from './invoice-checks.types.js';
import type { DecimalString } from './types.js';

/** Somme des paiements = total, chaque montant > 0 ; part `CREDIT` dans `amountOnCredit`. */
export function checkPayments(
  total: DecimalString,
  payments: readonly PaymentInput[],
): PaymentsCheck {
  throw new Error('E1');
}

/** Porte l'écart d'arrondi sur le plus gros paiement (le premier à égalité) pour que la
 *  somme égale exactement `total` ; refuse si un paiement devient ≤ 0. */
export function reconcilePayments(
  total: DecimalString,
  payments: readonly PaymentInput[],
):
  | { ok: true; payments: readonly PaymentInput[] }
  | { ok: false; issues: readonly InvoiceCheckIssue[] } {
  throw new Error('E1');
}
