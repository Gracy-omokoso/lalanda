// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord des encaissements — RUN › Ventes › Encaissements (ADR-0067)
//
// Un seul calcul, côté serveur, pour les cartes, les graphiques et les compteurs
// des filtres de la liste : l'écran ne fait qu'afficher.
//
// Règles (ADR-0067, sur le modèle d'ADR-0056) :
// - Encaissement : document `sales_receipts` NON ANNULÉ, à sa date de réception.
//   Les paiements déclarés à l'émission d'une facture n'en sont pas (ils restent
//   dans l'« encaissé » de l'écran Factures).
// - Montants dans la DEVISE DE RÉFÉRENCE, chaque lettrage converti AU TAUX FIGÉ
//   SUR SA FACTURE (`referenceRatioOf`, ADR-0056). Un lettrage sur une facture
//   sans taux est EXCLU DES MONTANTS ET COMPTÉ (total dans sa devise).
// - Moyens de paiement : les six moyens d'ADR-0031 (`RECEIPT_METHODS`).
// - Délai moyen d'encaissement : pour chaque lettrage reçu dans les 90 derniers
//   jours, jours entre l'émission de la facture et la réception (0 si la réception
//   est datée avant l'émission), moyenne simple arrondie au jour, demi vers le haut.
//   Ne dépend d'aucune devise.
// - Restant dû et retard : ceux de `computeInvoiceStats` (ADR-0056), tels quels :
//   le chiffre concorde avec la carte « Reste à encaisser » de l'écran Factures.
//
// Aucune horloge : `asOf` est fourni.
// ─────────────────────────────────────────────────────────────────────────────

import type { Fixed } from '../invoice-totals/decimal.js';
import { isCalendarDate, monthOfDate } from './calendar.js';
import { computeInvoiceStats, type InvoiceStatsDocument } from './invoice-stats.js';
import { formatPositive, trustedAmount } from './money.js';
import {
  addDaysTo,
  addMonths,
  convertAtRatio,
  daysBetween,
  percentOf,
  referenceRatioOf,
  type Ratio,
  type StatsCurrency,
} from './reference-rate.js';
import { divRound } from '../invoice-totals/decimal.js';
import { RECEIPT_METHODS, type ReceiptMethod } from './types.js';
import type { CalendarDate, CalendarMonth } from './types.js';

/** Version du calcul du tableau de bord des encaissements. */
export const RECEIPT_STATS_VERSION = '1.0.0';

/** Fenêtre du délai moyen d'encaissement, en jours (ADR-0067). */
export const RECEIPT_DELAY_WINDOW_DAYS = 90;

export interface ReceiptStatsReceipt {
  id: string;
  /** `recorded` ou `cancelled`. */
  status: string;
  receivedOn: CalendarDate;
  currency: StatsCurrency;
  method: string;
  allocations: readonly { invoiceId: string; amount: string }[];
}

export interface ReceiptStatsInput {
  referenceCurrency: StatsCurrency;
  asOf: CalendarDate;
  months: number;
  /** Documents de vente de l'organisation (mêmes valeurs que pour les factures). */
  documents: readonly InvoiceStatsDocument[];
  receipts: readonly ReceiptStatsReceipt[];
}

export interface ReceiptStatsResult {
  currency: StatsCurrency;
  asOf: CalendarDate;
  from: CalendarMonth;
  to: CalendarMonth;
  months: { month: CalendarMonth; collected: string; count: number }[];
  totals: { collected: string; count: number };
  thisMonth: { amount: string; count: number };
  previousMonth: { month: CalendarMonth; amount: string; count: number };
  /** (mois en cours − mois précédent) / mois précédent, % entier ; `null` si rien le mois précédent. */
  changePercent: number | null;
  averageDelay: {
    windowDays: number;
    since: CalendarDate;
    /** Jours entiers ; `null` sans lettrage dans la fenêtre. */
    days: number | null;
    allocations: number;
  };
  outstanding: { amount: string; count: number };
  overdue: { amount: string; count: number };
  /** Fenêtre des mois, dans l'ordre des moyens d'ADR-0031. */
  byMethod: { method: ReceiptMethod; amount: string; count: number }[];
  statusCounts: { all: number; recorded: number; cancelled: number };
  excluded: {
    /** Lettrages de la fenêtre sur une facture sans taux, par devise. */
    notConvertible: { currency: StatsCurrency; count: number; total: string }[];
  };
  version: string;
}

export function computeReceiptStats(input: ReceiptStatsInput): ReceiptStatsResult {
  if (!isCalendarDate(input.asOf)) throw new RangeError(`Date du jour illisible : ${input.asOf}`);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) {
    throw new RangeError(`Fenêtre de mois invalide : ${input.months}`);
  }
  const ref = input.referenceCurrency;
  const asOf = input.asOf;
  const to = monthOfDate(asOf);
  const from = addMonths(to, -(input.months - 1));
  const previous = addMonths(to, -1);
  const monthKeys = Array.from({ length: input.months }, (_, i) => addMonths(from, i));
  const since = addDaysTo(asOf, -(RECEIPT_DELAY_WINDOW_DAYS - 1));

  const recorded = input.receipts.filter((r) => r.status === 'recorded');
  for (const r of input.receipts) {
    if (!isCalendarDate(r.receivedOn)) throw new RangeError(`Date illisible : ${r.receivedOn}`);
  }

  // Reste à encaisser et retard : le calcul de l'écran Factures, sur les mêmes données.
  const invoiceStats = computeInvoiceStats({
    referenceCurrency: ref,
    asOf,
    months: 1,
    documents: input.documents,
    allocations: recorded.flatMap((r) =>
      r.allocations.map((a) => ({
        invoiceId: a.invoiceId,
        amount: a.amount,
        receivedOn: r.receivedOn,
      })),
    ),
  });

  const docs = new Map(input.documents.map((d) => [d.id, d]));
  const ratios = new Map<string, Ratio>();
  const ratioFor = (invoiceId: string): Ratio => {
    if (!ratios.has(invoiceId)) {
      const d = docs.get(invoiceId);
      ratios.set(invoiceId, d && d.total !== null ? referenceRatioOf(d, ref) : null);
    }
    return ratios.get(invoiceId) ?? null;
  };

  const byMonth = new Map<string, { amount: Fixed; count: number }>(
    monthKeys.map((m) => [m, { amount: 0n, count: 0 }]),
  );
  const prev = { amount: 0n as Fixed, count: 0 };
  const methods = new Map<string, { amount: Fixed; count: number }>(
    RECEIPT_METHODS.map((m) => [m, { amount: 0n, count: 0 }]),
  );
  const notConvertible = new Map<StatsCurrency, { count: number; total: Fixed }>();
  let delaySum = 0;
  let delayCount = 0;

  for (const r of recorded) {
    if (r.receivedOn > asOf) continue;
    const m = r.receivedOn.slice(0, 7);
    const inWindow = byMonth.has(m);
    const isPrev = m === previous;
    if (!inWindow && !isPrev) continue;
    let converted: Fixed = 0n;
    for (const a of r.allocations) {
      const amount = trustedAmount(a.amount, 'Lettrage');
      const ratio = ratioFor(a.invoiceId);
      if (ratio === null) {
        if (inWindow) {
          const n = notConvertible.get(r.currency) ?? { count: 0, total: 0n };
          n.count += 1;
          n.total += amount;
          notConvertible.set(r.currency, n);
        }
      } else {
        converted += convertAtRatio(amount, ratio);
      }
      const issuedOn = docs.get(a.invoiceId)?.issuedOn ?? null;
      if (issuedOn !== null && r.receivedOn >= since) {
        delaySum += Math.max(0, daysBetween(issuedOn, r.receivedOn));
        delayCount += 1;
      }
    }
    if (isPrev) {
      prev.amount += converted;
      prev.count += 1;
    }
    if (!inWindow) continue;
    const b = byMonth.get(m)!;
    b.amount += converted;
    b.count += 1;
    const meth = methods.get(r.method);
    if (meth) {
      meth.amount += converted;
      meth.count += 1;
    }
  }

  let total: Fixed = 0n;
  let count = 0;
  for (const b of byMonth.values()) {
    total += b.amount;
    count += b.count;
  }
  const current = byMonth.get(to)!;
  const cancelled = input.receipts.length - recorded.length;

  return {
    currency: ref,
    asOf,
    from,
    to,
    months: monthKeys.map((m) => ({
      month: m,
      collected: formatPositive(byMonth.get(m)!.amount),
      count: byMonth.get(m)!.count,
    })),
    totals: { collected: formatPositive(total), count },
    thisMonth: { amount: formatPositive(current.amount), count: current.count },
    previousMonth: { month: previous, amount: formatPositive(prev.amount), count: prev.count },
    changePercent: percentOf(current.amount - prev.amount, prev.amount),
    averageDelay: {
      windowDays: RECEIPT_DELAY_WINDOW_DAYS,
      since,
      days:
        delayCount === 0 ? null : Number(divRound(BigInt(delaySum), BigInt(delayCount), 'half_up')),
      allocations: delayCount,
    },
    outstanding: invoiceStats.outstanding,
    overdue: invoiceStats.overdue,
    byMethod: RECEIPT_METHODS.map((method) => ({
      method,
      amount: formatPositive(methods.get(method)!.amount),
      count: methods.get(method)!.count,
    })),
    statusCounts: { all: input.receipts.length, recorded: recorded.length, cancelled },
    excluded: {
      notConvertible: [...notConvertible.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, n]) => ({ currency, count: n.count, total: formatPositive(n.total) })),
    },
    version: RECEIPT_STATS_VERSION,
  };
}
