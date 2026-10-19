// ─────────────────────────────────────────────────────────────────────────────
// Paiements d'une facture (ADR-0023 § S25e.8 et § S25e.9)
//
// Règles DGI reprises en substance : paiements multiples parmi les sept modes
// e-DEF ; total de la facture = somme des paiements ; aucun montant nul ou
// négatif ; `CREDIT` déclare la part non réglée. Les montants sont dans la
// devise du document (ou en CDF après conversion) et restent des chaînes
// décimales : l'arithmétique passe par `decimal.ts` (entiers `bigint`).
//
// Signatures figées par le jalon E0 ; corps du chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import {
  formatAmount,
  hasAtMostDecimals,
  parseFixed,
  splitDecimal,
  type Fixed,
} from './decimal.js';
import {
  PAYMENT_METHODS,
  type InvoiceCheckIssue,
  type OriginLine,
  type PaymentInput,
  type PaymentsCheck,
} from './invoice-checks.types.js';
import type { DecimalString } from './types.js';

const METHODS: readonly string[] = PAYMENT_METHODS;
/** Position d'un paiement (entier), sans écrire le type flottant natif. */
type Index = OriginLine['index'];

/** Montant de paiement : décimal canonique d'au plus 2 décimales, strictement positif. */
function paymentAmount(value: unknown): Fixed | null {
  const parts = splitDecimal(value);
  if (parts === null || !hasAtMostDecimals(parts, 2)) return null;
  const fixed = parseFixed(value);
  return fixed !== null && fixed > 0n ? fixed : null;
}

/** Total de la facture (sortie du moteur) : décimal d'au plus 2 décimales, sinon erreur. */
function invoiceTotal(value: DecimalString): Fixed {
  const parts = splitDecimal(value);
  const fixed = parts !== null && hasAtMostDecimals(parts, 2) ? parseFixed(value) : null;
  if (fixed === null) {
    throw new RangeError(
      `Total de facture : décimal d’au plus 2 décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return fixed;
}

const NO_PAYMENTS: InvoiceCheckIssue = Object.freeze({
  code: 'NO_PAYMENTS',
  lineIndex: null,
  message: 'Indiquez au moins un paiement.',
});

function invalidAmount(index: Index, amount: unknown): InvoiceCheckIssue {
  return {
    code: 'PAYMENT_AMOUNT_INVALID',
    lineIndex: null,
    message: `Paiement n° ${index + 1} : le montant doit être un décimal strictement positif d’au plus 2 décimales.`,
    details: { paymentIndex: `${index}`, amount: typeof amount === 'string' ? amount : '' },
  };
}

function unknownMethod(index: Index, method: unknown): InvoiceCheckIssue {
  // Aucun code dédié dans le contrat figé (ADR-0023 § S25e.9) : le mode inconnu est
  // signalé comme paiement invalide, avec `details.field = 'method'`.
  return {
    code: 'PAYMENT_AMOUNT_INVALID',
    lineIndex: null,
    message: `Paiement n° ${index + 1} : mode de paiement inconnu (attendu : ${METHODS.join(', ')}).`,
    details: { paymentIndex: `${index}`, field: 'method', method: `${String(method)}` },
  };
}

/**
 * Somme des paiements = total, chaque montant > 0 ; part `CREDIT` dans `amountOnCredit`.
 *
 * Tous les problèmes sont rendus d'un coup. L'écart à la somme n'est signalé que si
 * chaque montant est lisible : sinon la somme partielle n'aurait pas de sens.
 * `paidTotal` additionne les montants lisibles. Lève une `RangeError` si `total`
 * n'est pas un décimal d'au plus 2 décimales (il sort de `computeInvoiceTotals`).
 */
export function checkPayments(
  total: DecimalString,
  payments: readonly PaymentInput[],
): PaymentsCheck {
  const expected = invoiceTotal(total);
  const issues: InvoiceCheckIssue[] = [];
  if (payments.length === 0) issues.push(NO_PAYMENTS);

  let paid = 0n;
  let onCredit = 0n;
  let allAmountsReadable = true;
  payments.forEach((payment, index) => {
    if (!METHODS.includes(payment.method)) issues.push(unknownMethod(index, payment.method));
    const amount = paymentAmount(payment.amount);
    if (amount === null) {
      allAmountsReadable = false;
      issues.push(invalidAmount(index, payment.amount));
      return;
    }
    paid += amount;
    if (payment.method === 'CREDIT') onCredit += amount;
  });

  if (payments.length > 0 && allAmountsReadable && paid !== expected) {
    const gap = paid > expected ? paid - expected : expected - paid;
    issues.push({
      code: 'PAYMENTS_TOTAL_MISMATCH',
      lineIndex: null,
      message: `La somme des paiements (${formatAmount(paid)}) ne correspond pas au total de la facture (${formatAmount(expected)}).`,
      details: {
        total: formatAmount(expected),
        paidTotal: formatAmount(paid),
        difference: formatAmount(gap),
        direction: paid > expected ? 'over' : 'under',
      },
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    paidTotal: formatAmount(paid),
    amountOnCredit: formatAmount(onCredit),
  };
}

/**
 * Porte l'écart d'arrondi sur le plus gros paiement (le premier à égalité) pour que la
 * somme égale exactement `total` ; refuse si un paiement devient ≤ 0.
 *
 * Sert après la conversion en CDF : chaque paiement converti est arrondi au centime,
 * le total CDF est recalculé à partir des prix unitaires convertis ; leurs écarts ne
 * coïncident pas. Les montants rendus sont au format canonique à 2 décimales ; l'ordre
 * et les modes sont conservés. Le mode de paiement n'est pas recontrôlé ici
 * (`checkPayments` le fait).
 */
export function reconcilePayments(
  total: DecimalString,
  payments: readonly PaymentInput[],
):
  | { ok: true; payments: readonly PaymentInput[] }
  | { ok: false; issues: readonly InvoiceCheckIssue[] } {
  const expected = invoiceTotal(total);
  if (payments.length === 0) return { ok: false, issues: [NO_PAYMENTS] };

  const issues: InvoiceCheckIssue[] = [];
  const amounts: Fixed[] = [];
  payments.forEach((payment, index) => {
    const amount = paymentAmount(payment.amount);
    if (amount === null) issues.push(invalidAmount(index, payment.amount));
    amounts.push(amount ?? 0n);
  });
  if (issues.length > 0) return { ok: false, issues };

  let largest = 0;
  let sum = 0n;
  amounts.forEach((amount, index) => {
    sum += amount;
    if (amount > (amounts[largest] ?? 0n)) largest = index;
  });
  const adjusted = (amounts[largest] ?? 0n) + (expected - sum);
  if (adjusted <= 0n) {
    return {
      ok: false,
      issues: [
        {
          code: 'PAYMENT_AMOUNT_INVALID',
          lineIndex: null,
          message: `L’écart entre les paiements (${formatAmount(sum)}) et le total (${formatAmount(expected)}) rendrait le paiement n° ${largest + 1} nul ou négatif.`,
          details: {
            paymentIndex: `${largest}`,
            total: formatAmount(expected),
            paidTotal: formatAmount(sum),
          },
        },
      ],
    };
  }
  amounts[largest] = adjusted;
  return {
    ok: true,
    payments: payments.map((payment, index) => ({
      method: payment.method,
      amount: formatAmount(amounts[index] ?? 0n),
    })),
  };
}
