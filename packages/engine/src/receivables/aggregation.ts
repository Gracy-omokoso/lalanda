// ─────────────────────────────────────────────────────────────────────────────
// Agrégats mensuels et réalisé issu des ventes (ADR-0031 § 3)
//
// - Encaissements : total par mois civil de réception et par devise. Jamais de
//   somme entre devises.
// - Chiffre d'affaires : somme des bases HT des groupes hors H, I, J, L, N,
//   factures moins avoirs, par mois civil d'émission (ADR-0023 § S25e.13).
// - Devise : AUCUN taux n'est appliqué. Montants du document s'il est dans la
//   devise visée ; montants CDF normalisés si la cible est le CDF ; sinon le
//   document n'est pas convertible et son mois n'est pas reporté — un chiffre
//   partiel serait fabriqué (docs/08 § Règle cardinale).
// ─────────────────────────────────────────────────────────────────────────────

import { fiscalPeriodOfMonth, isCalendarMonth, monthOfDate } from './calendar.js';
import { formatPositive, formatSigned, sum, trustedAmount, type Fixed } from './money.js';
import {
  REVENUE_EXCLUDED_TAX_GROUPS,
  RECEIVABLES_VERSION,
  type MonthlyCurrencyTotal,
  type MonthlyRevenue,
  type ReceiptForAggregation,
  type RevenueAmounts,
  type RevenueDocumentInput,
  type RevenueGroupAmount,
  type RunActualsInput,
  type RunActualsPeriod,
  type RunActualsPlan,
  type RunActualsSkipped,
} from './types.js';

const EXCLUDED: readonly string[] = REVENUE_EXCLUDED_TAX_GROUPS;

const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function aggregateReceiptsByMonth(
  receipts: readonly ReceiptForAggregation[],
): MonthlyCurrencyTotal[] {
  const buckets = new Map<
    string,
    { month: string; currency: string; total: Fixed; count: number }
  >();
  for (const receipt of receipts) {
    const month = monthOfDate(receipt.receivedOn);
    const key = `${month}|${receipt.currency}`;
    const bucket = buckets.get(key) ?? { month, currency: receipt.currency, total: 0n, count: 0 };
    bucket.total += trustedAmount(receipt.amount, 'Encaissement');
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => byKey(a, b))
    .map(([, b]) => ({
      month: b.month,
      currency: b.currency as MonthlyCurrencyTotal['currency'],
      total: formatPositive(b.total),
      count: b.count,
    }));
}

/** Base HT des groupes qui forment un chiffre d'affaires. */
export function revenueBaseOf(groups: readonly RevenueGroupAmount[]): string {
  return formatPositive(
    sum(
      groups.filter((g) => !EXCLUDED.includes(g.group)).map((g) => trustedAmount(g.ht, 'Base HT')),
    ),
  );
}

/** Montant HT d'un document dans la devise visée, sans aucun taux. */
export function revenueAmountsFor(
  document: RevenueDocumentInput,
  targetCurrency: string,
): RevenueAmounts {
  // Le CDF normalisé est la seule valeur fiscale : il passe en premier quand il existe.
  if (targetCurrency === 'CDF' && document.normalized !== null) {
    return {
      ok: true,
      currency: 'CDF',
      ht: revenueBaseOf(document.normalized.groups),
      source: 'normalized',
    };
  }
  if (document.document.currency === targetCurrency) {
    return {
      ok: true,
      currency: targetCurrency,
      ht: revenueBaseOf(document.document.groups),
      source: 'document',
    };
  }
  return { ok: false, reason: 'CURRENCY_NOT_CONVERTIBLE' };
}

export function aggregateRevenueByMonth(
  documents: readonly RevenueDocumentInput[],
  targetCurrency: string,
): MonthlyRevenue[] {
  interface Bucket {
    invoices: Fixed;
    creditNotes: Fixed;
    invoiceIds: string[];
    creditNoteIds: string[];
    depositIds: string[];
    nonConvertibleIds: string[];
  }
  const buckets = new Map<string, Bucket>();
  for (const doc of documents) {
    const month = monthOfDate(doc.issuedOn);
    const bucket = buckets.get(month) ?? {
      invoices: 0n,
      creditNotes: 0n,
      invoiceIds: [],
      creditNoteIds: [],
      depositIds: [],
      nonConvertibleIds: [],
    };
    buckets.set(month, bucket);
    if (doc.kind === 'deposit') {
      bucket.depositIds.push(doc.id);
      continue;
    }
    const amounts = revenueAmountsFor(doc, targetCurrency);
    if (!amounts.ok) {
      bucket.nonConvertibleIds.push(doc.id);
      continue;
    }
    const ht = trustedAmount(amounts.ht, 'Base HT');
    if (doc.kind === 'invoice') {
      bucket.invoices += ht;
      bucket.invoiceIds.push(doc.id);
    } else {
      bucket.creditNotes += ht;
      bucket.creditNoteIds.push(doc.id);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => byKey(a, b))
    .map(([month, b]) => ({
      month,
      currency: targetCurrency,
      revenueHt: b.nonConvertibleIds.length > 0 ? null : formatSigned(b.invoices - b.creditNotes),
      invoicesHt: formatPositive(b.invoices),
      creditNotesHt: formatPositive(b.creditNotes),
      invoiceIds: [...b.invoiceIds].sort(byKey),
      creditNoteIds: [...b.creditNoteIds].sort(byKey),
      depositIds: [...b.depositIds].sort(byKey),
      nonConvertibleIds: [...b.nonConvertibleIds].sort(byKey),
    }));
}

/**
 * Ce que le pont doit écrire dans le réalisé du projet : une valeur de chiffre
 * d'affaires par mois d'exercice, et la liste de ce qui n'est PAS reporté, avec
 * sa raison. Les mois sans vente n'apparaissent pas : « aucune vente » n'est pas
 * une observation à zéro que le moteur aurait le droit d'inventer.
 */
export function planRunActuals(input: RunActualsInput): RunActualsPlan {
  if (!isCalendarMonth(input.exerciseStart)) {
    throw new RangeError(`Début d'exercice illisible : ${input.exerciseStart}`);
  }
  const periods: RunActualsPeriod[] = [];
  const skipped: RunActualsSkipped[] = [];
  const excludedDepositIds: string[] = [];
  for (const month of aggregateRevenueByMonth(input.documents, input.projectCurrency)) {
    excludedDepositIds.push(...month.depositIds);
    const documentIds = [...month.invoiceIds, ...month.creditNoteIds].sort(byKey);
    if (documentIds.length === 0 && month.nonConvertibleIds.length === 0) continue; // acomptes seuls
    const fiscal = fiscalPeriodOfMonth(month.month, input.exerciseStart);
    if (fiscal === null) {
      skipped.push({
        calendarMonth: month.month,
        reason: 'OUTSIDE_PLAN_HORIZON',
        fiscal: null,
        documentIds: [...documentIds, ...month.nonConvertibleIds].sort(byKey),
      });
      continue;
    }
    if (month.revenueHt === null) {
      skipped.push({
        calendarMonth: month.month,
        reason: 'CURRENCY_NOT_CONVERTIBLE',
        fiscal,
        documentIds: month.nonConvertibleIds,
      });
      continue;
    }
    periods.push({
      calendarMonth: month.month,
      year: fiscal.year,
      month: fiscal.month,
      values: { [input.revenueLineId]: month.revenueHt },
      documentIds,
    });
  }
  return {
    version: RECEIVABLES_VERSION,
    periods,
    skipped,
    excludedDepositIds: excludedDepositIds.sort(byKey),
  };
}

// ── frontière JSON : début
// `actual_periods.values` stocke des nombres JSON (docs/08). Seul passage d'un
// montant signé à deux décimales vers un nombre ; la chaîne est validée avant.
const SIGNED_CENTS = /^-?\d{1,13}\.\d{2}$/;
export function signedAmountToJsonNumber(value: string): number {
  if (!SIGNED_CENTS.test(value)) throw new RangeError(`Montant signé illisible : ${value}`);
  return Number(value);
}
// ── frontière JSON : fin
