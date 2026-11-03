// ─────────────────────────────────────────────────────────────────────────────
// Tableau de bord des factures — RUN › Ventes › Factures (ADR-0056)
//
// Un seul calcul, côté serveur, pour les cartes de chiffres, les trois graphiques
// et les compteurs des filtres de la liste : l'écran ne fait qu'afficher.
//
// Règles (décisions de la dirigeante du 3 nov. 2026, ADR-0056) :
// - Montants TTC, dans la DEVISE DE RÉFÉRENCE donnée par l'appelant, convertis au
//   TAUX FIGÉ SUR LA FACTURE (montants CDF normalisés, conversion du document,
//   contre-valeur USD). Jamais un taux du jour, d'une autre pièce ni inverse : un
//   document sans représentation dans la devise de référence est EXCLU ET COMPTÉ
//   (avec son total dans sa devise), comme en GROW (ADR-0032 § 2).
// - Facturé : factures finales (`issued`, `normalized`) de vente FV/EV hors série
//   d'essai, MOINS les avoirs finaux FA/EA, au mois civil d'émission. Pro forma et
//   brouillons exclus ; acomptes FT/ET exclus et comptés (ADR-0031, décision
//   ouverte n° 1, reprise telle quelle).
// - Encaissé : part réglée à l'émission (total − part `CREDIT`) des factures,
//   lettrages des encaissements non annulés à leur date de réception, MOINS la
//   part remboursée à l'émission d'un avoir (total − part `CREDIT`).
// - Reste à encaisser et retard : `computeSettlement` d'ADR-0031, tel quel. « En
//   retard » = facture finale, échéance dépassée, non soldée.
//
// Arithmétique exacte en virgule fixe (`bigint`, 10⁸), arrondi au centime demi
// vers le haut à chaque conversion. Aucune horloge : `asOf` est fourni.
// ─────────────────────────────────────────────────────────────────────────────

import { CENT, divRound, parseFixed, type Fixed } from '../invoice-totals/decimal.js';
import { isCalendarDate, monthOfDate } from './calendar.js';
import { formatPositive, formatSigned, trustedAmount } from './money.js';
import { computeSettlement } from './settlement.js';
import type { DecimalString } from '../invoice-totals/types.js';
import type { CalendarDate, CalendarMonth } from './types.js';

/** Version du calcul du tableau de bord des factures. */
export const INVOICE_STATS_VERSION = '1.0.0';

export type StatsCurrency = 'CDF' | 'USD';

const FINAL: readonly string[] = ['issued', 'normalized'];
const SALE_TYPES: readonly string[] = ['FV', 'EV'];
const CREDIT_TYPES: readonly string[] = ['FA', 'EA'];
const DEPOSIT_TYPES: readonly string[] = ['FT', 'ET'];

/** Document de vente tel que le tableau de bord le lit (valeurs figées). */
export interface InvoiceStatsDocument {
  id: string;
  /** `draft`, `issued`, `pending_normalization`, `normalized`, `normalization_failed`. */
  status: string;
  /** FV, FT, FA, EV, ET, EA. */
  type: string;
  series: string | null;
  /** Jour civil d'émission à Kinshasa, `null` hors document final. */
  issuedOn: CalendarDate | null;
  currency: StatsCurrency;
  /** Total TTC du document dans sa devise, `null` s'il n'est pas calculable. */
  total: DecimalString | null;
  customerKey: string | null;
  customerName: string | null;
  /** Total TTC CDF de la normalisation (seul à valeur fiscale), sinon `null`. */
  normalizedTotalCdf: DecimalString | null;
  /** Conversion figée du document : 1 `from` = `rate` `to`. */
  conversion: { from: string; to: string; rate: string } | null;
  /** Contre-valeur USD figée d'un document CDF (montant du total). */
  usdCounterValue: DecimalString | null;
  /** Part `CREDIT` déclarée au gel ; `null` : aucun paiement déclaré. */
  amountOnCredit: DecimalString | null;
  dueDate: CalendarDate | null;
  /** Avoir : facture d'origine. */
  originInvoiceId: string | null;
}

/** Lettrage d'un encaissement non annulé. */
export interface InvoiceStatsAllocation {
  invoiceId: string;
  amount: DecimalString;
  receivedOn: CalendarDate;
}

export interface InvoiceStatsInput {
  referenceCurrency: StatsCurrency;
  /** Jour du calcul à Kinshasa. */
  asOf: CalendarDate;
  /** Nombre de mois civils de la fenêtre, le mois d'`asOf` compris (1 à 36). */
  months: number;
  documents: readonly InvoiceStatsDocument[];
  allocations: readonly InvoiceStatsAllocation[];
  /** Nombre de clients du classement (défaut 5). */
  topCustomers?: number;
}

/** Catégories exclusives du graphique « Documents par statut ». */
export const INVOICE_STATS_CATEGORIES = [
  'paid',
  'to_collect',
  'overdue',
  'draft',
  'pending_normalization',
  'normalization_failed',
  'credit_note',
  'other_final',
] as const;
export type InvoiceStatsCategory = (typeof INVOICE_STATS_CATEGORIES)[number];

export interface InvoiceStatsMonth {
  month: CalendarMonth;
  /** Factures moins avoirs du mois, signé. */
  billed: string;
  /** Encaissé net du mois, signé. */
  collected: string;
  /** Reste à encaisser à la fin du mois (au jour `asOf` pour le mois courant). */
  outstanding: string;
  /** Dont en retard à la même date. */
  overdue: string;
}

export interface InvoiceStatsResult {
  currency: StatsCurrency;
  asOf: CalendarDate;
  from: CalendarMonth;
  to: CalendarMonth;
  months: InvoiceStatsMonth[];
  totals: {
    billed: string;
    collected: string;
    /** Encaissé / facturé de la fenêtre, en % entier ; `null` si rien de facturé. */
    collectedRatePercent: number | null;
    invoiceCount: number;
    creditNoteCount: number;
  };
  outstanding: { amount: string; count: number };
  overdue: { amount: string; count: number };
  /** Tous les documents de l'organisation, une catégorie chacun. */
  categories: { category: InvoiceStatsCategory; count: number }[];
  /** Compteurs des filtres de la liste (mêmes définitions que `GET /sales/invoices`). */
  statusCounts: {
    all: number;
    draft: number;
    issued: number;
    pending_normalization: number;
    normalized: number;
    normalization_failed: number;
    final: number;
  };
  topCustomers: { key: string; name: string; billed: string }[];
  excluded: {
    deposits: number;
    testSeries: number;
    /** Documents sans représentation dans la devise de référence, par devise. */
    notConvertible: { currency: StatsCurrency; count: number; total: string }[];
  };
  version: string;
}

/** Ratio figé document → référence : montant × num / den. `null` : non convertible. */
type Ratio = { num: Fixed; den: Fixed } | null;

const ONE: Fixed = parseFixed('1') as Fixed;

function fixed(value: string, what: string): Fixed {
  const v = parseFixed(value);
  if (v === null) throw new RangeError(`${what} illisible : ${JSON.stringify(value)}`);
  return v;
}

function ratioOf(doc: InvoiceStatsDocument, ref: StatsCurrency): Ratio {
  if (doc.currency === ref) return { num: ONE, den: ONE };
  const total = doc.total === null ? null : fixed(doc.total, 'Total');
  if (ref === 'CDF') {
    if (doc.normalizedTotalCdf !== null && total !== null && total > 0n) {
      return { num: fixed(doc.normalizedTotalCdf, 'Total normalisé'), den: total };
    }
    const c = doc.conversion;
    if (c !== null && c.from === doc.currency && c.to === 'CDF') {
      const rate = fixed(c.rate, 'Taux');
      if (rate > 0n) return { num: rate, den: ONE };
    }
    return null;
  }
  // Référence USD, document CDF : contre-valeur figée sur la facture.
  if (doc.usdCounterValue !== null && total !== null && total > 0n) {
    return { num: fixed(doc.usdCounterValue, 'Contre-valeur USD'), den: total };
  }
  return null;
}

/** Montant converti, arrondi au centime demi vers le haut. */
function convert(amount: Fixed, ratio: { num: Fixed; den: Fixed }): Fixed {
  return divRound(amount * ratio.num, ratio.den * CENT, 'half_up') * CENT;
}

function addMonths(month: CalendarMonth, delta: number): CalendarMonth {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${year}-${String(mm + 1).padStart(2, '0')}`;
}

function lastDayOf(month: CalendarMonth): CalendarDate {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

function percent(num: Fixed, den: Fixed): number | null {
  if (den <= 0n) return null;
  return Number(divRound(num * 100n, den, 'half_up'));
}

interface Settleable {
  doc: InvoiceStatsDocument;
  ratio: Ratio;
  credits: { amount: string; on: CalendarDate }[];
  allocations: { amount: string; on: CalendarDate }[];
}

export function computeInvoiceStats(input: InvoiceStatsInput): InvoiceStatsResult {
  if (!isCalendarDate(input.asOf)) throw new RangeError(`Date du jour illisible : ${input.asOf}`);
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) {
    throw new RangeError(`Fenêtre de mois invalide : ${input.months}`);
  }
  const ref = input.referenceCurrency;
  const to = monthOfDate(input.asOf);
  const from = addMonths(to, -(input.months - 1));
  const monthKeys = Array.from({ length: input.months }, (_, i) => addMonths(from, i));
  const inWindow = (on: CalendarDate | null): on is CalendarDate =>
    on !== null && on.slice(0, 7) >= from && on.slice(0, 7) <= to && on <= input.asOf;

  const billed = new Map<CalendarMonth, Fixed>(monthKeys.map((m) => [m, 0n]));
  const collected = new Map<CalendarMonth, Fixed>(monthKeys.map((m) => [m, 0n]));
  const add = (map: Map<CalendarMonth, Fixed>, on: CalendarDate, v: Fixed) => {
    const m = on.slice(0, 7);
    if (map.has(m)) map.set(m, (map.get(m) ?? 0n) + v);
  };

  const statusCounts = {
    all: 0,
    draft: 0,
    issued: 0,
    pending_normalization: 0,
    normalized: 0,
    normalization_failed: 0,
    final: 0,
  };
  const categories = new Map<InvoiceStatsCategory, number>(
    INVOICE_STATS_CATEGORIES.map((c) => [c, 0]),
  );
  const bump = (c: InvoiceStatsCategory) => categories.set(c, (categories.get(c) ?? 0) + 1);
  const excluded = { deposits: 0, testSeries: 0 };
  const notConvertible = new Map<StatsCurrency, { count: number; total: Fixed }>();
  const customers = new Map<string, { name: string; billed: Fixed }>();
  let invoiceCount = 0;
  let creditNoteCount = 0;

  const byId = new Map(input.documents.map((d) => [d.id, d]));
  const settleables = new Map<string, Settleable>();
  const ratios = new Map<string, Ratio>();

  // 1. Compteurs, exclusions et conversion de chaque document final.
  for (const doc of input.documents) {
    statusCounts.all += 1;
    if (doc.status in statusCounts) statusCounts[doc.status as keyof typeof statusCounts] += 1;
    const final = FINAL.includes(doc.status);
    if (final) statusCounts.final += 1;
    if (!final) {
      if (doc.status === 'draft') bump('draft');
      else if (doc.status === 'pending_normalization') bump('pending_normalization');
      else if (doc.status === 'normalization_failed') bump('normalization_failed');
      continue;
    }
    if (doc.series === 'test') {
      excluded.testSeries += 1;
      bump('other_final');
      continue;
    }
    if (DEPOSIT_TYPES.includes(doc.type)) {
      excluded.deposits += 1;
      bump('other_final');
      continue;
    }
    const isCredit = CREDIT_TYPES.includes(doc.type);
    if (!isCredit && !SALE_TYPES.includes(doc.type)) {
      bump('other_final');
      continue;
    }
    const ratio = doc.total === null ? null : ratioOf(doc, ref);
    ratios.set(doc.id, ratio);
    if (ratio === null) {
      const n = notConvertible.get(doc.currency) ?? { count: 0, total: 0n };
      n.count += 1;
      n.total += doc.total === null ? 0n : trustedAmount(doc.total, 'Total');
      notConvertible.set(doc.currency, n);
    }
    if (isCredit) {
      bump('credit_note');
      continue;
    }
    if (doc.amountOnCredit === null) {
      bump('other_final');
      continue;
    }
    // Le statut de règlement ne dépend d'aucun taux : une facture non convertible
    // garde sa catégorie, seuls ses montants sont écartés.
    settleables.set(doc.id, { doc, ratio, credits: [], allocations: [] });
  }

  // 2. Avoirs rattachés et lettrages (seulement ceux des factures suivies).
  for (const doc of input.documents) {
    if (!FINAL.includes(doc.status) || !CREDIT_TYPES.includes(doc.type)) continue;
    if (doc.series === 'test' || doc.originInvoiceId === null || doc.amountOnCredit === null) {
      continue;
    }
    const s = settleables.get(doc.originInvoiceId);
    if (s && doc.issuedOn !== null)
      s.credits.push({ amount: doc.amountOnCredit, on: doc.issuedOn });
  }
  for (const a of input.allocations) {
    if (!isCalendarDate(a.receivedOn)) throw new RangeError(`Date illisible : ${a.receivedOn}`);
    const s = settleables.get(a.invoiceId);
    if (s) s.allocations.push({ amount: a.amount, on: a.receivedOn });
  }

  // 3. Facturé, encaissé à l'émission, clients.
  for (const doc of input.documents) {
    const ratio = ratios.get(doc.id);
    if (!ratio || doc.total === null || !inWindow(doc.issuedOn)) continue;
    const isCredit = CREDIT_TYPES.includes(doc.type);
    const total = convert(trustedAmount(doc.total, 'Total'), ratio);
    const signed = isCredit ? -total : total;
    add(billed, doc.issuedOn, signed);
    if (isCredit) creditNoteCount += 1;
    else invoiceCount += 1;
    if (doc.amountOnCredit !== null) {
      const paidAtIssue =
        trustedAmount(doc.total, 'Total') - trustedAmount(doc.amountOnCredit, 'Part à crédit');
      if (paidAtIssue > 0n)
        add(
          collected,
          doc.issuedOn,
          isCredit ? -convert(paidAtIssue, ratio) : convert(paidAtIssue, ratio),
        );
    }
    const origin = isCredit && doc.originInvoiceId ? byId.get(doc.originInvoiceId) : undefined;
    const key = doc.customerKey ?? origin?.customerKey ?? null;
    const name = doc.customerName ?? origin?.customerName ?? null;
    if (key !== null) {
      const c = customers.get(key) ?? { name: name ?? key, billed: 0n };
      c.billed += signed;
      customers.set(key, c);
    }
  }

  // 4. Encaissements lettrés, au taux de leur facture.
  for (const s of settleables.values()) {
    const ratio = s.ratio;
    if (ratio === null) continue;
    for (const a of s.allocations) {
      if (!inWindow(a.on)) continue;
      add(collected, a.on, convert(trustedAmount(a.amount, 'Lettrage'), ratio));
    }
  }

  // 5. Reste à encaisser et retard, à la fin de chaque mois (au jour pour le dernier).
  const balanceAt = (s: Settleable, day: CalendarDate) => {
    if (s.doc.issuedOn === null || s.doc.issuedOn > day) return null;
    return computeSettlement({
      amountOnCredit: s.doc.amountOnCredit as string,
      creditNoteCredits: s.credits.filter((c) => c.on <= day).map((c) => c.amount),
      allocations: s.allocations.filter((a) => a.on <= day).map((a) => a.amount),
      dueDate: s.doc.dueDate,
      asOf: day,
    });
  };
  const monthsOut: InvoiceStatsMonth[] = monthKeys.map((m) => {
    const day = m === to ? input.asOf : lastDayOf(m);
    let outstanding = 0n;
    let overdue = 0n;
    for (const s of settleables.values()) {
      const st = s.ratio === null ? null : balanceAt(s, day);
      if (st === null || s.ratio === null) continue;
      const left = convert(trustedAmount(st.outstanding, 'Reste'), s.ratio);
      outstanding += left;
      if (st.overdue) overdue += left;
    }
    return {
      month: m,
      billed: formatSigned(billed.get(m) ?? 0n),
      collected: formatSigned(collected.get(m) ?? 0n),
      outstanding: formatPositive(outstanding),
      overdue: formatPositive(overdue),
    };
  });

  // 6. Situation au jour : catégories et cartes.
  let outstandingNow = 0n;
  let overdueNow = 0n;
  let outstandingCount = 0;
  let overdueCount = 0;
  for (const s of settleables.values()) {
    const st = balanceAt(s, input.asOf);
    if (st === null) {
      bump('to_collect');
      continue;
    }
    if (st.status === 'paid') bump('paid');
    else if (st.overdue) bump('overdue');
    else bump('to_collect');
    if (s.ratio === null) continue;
    const left = convert(trustedAmount(st.outstanding, 'Reste'), s.ratio);
    if (left > 0n) {
      outstandingNow += left;
      outstandingCount += 1;
    }
    if (st.overdue) {
      overdueNow += left;
      overdueCount += 1;
    }
  }

  let billedTotal = 0n;
  let collectedTotal = 0n;
  for (const m of monthKeys) {
    billedTotal += billed.get(m) ?? 0n;
    collectedTotal += collected.get(m) ?? 0n;
  }

  const top = [...customers.entries()]
    .filter(([, c]) => c.billed > 0n)
    .sort((a, b) =>
      a[1].billed === b[1].billed
        ? a[1].name.localeCompare(b[1].name)
        : b[1].billed > a[1].billed
          ? 1
          : -1,
    )
    .slice(0, input.topCustomers ?? 5)
    .map(([key, c]) => ({ key, name: c.name, billed: formatSigned(c.billed) }));

  return {
    currency: ref,
    asOf: input.asOf,
    from,
    to,
    months: monthsOut,
    totals: {
      billed: formatSigned(billedTotal),
      collected: formatSigned(collectedTotal),
      collectedRatePercent: percent(collectedTotal, billedTotal),
      invoiceCount,
      creditNoteCount,
    },
    outstanding: { amount: formatPositive(outstandingNow), count: outstandingCount },
    overdue: { amount: formatPositive(overdueNow), count: overdueCount },
    categories: INVOICE_STATS_CATEGORIES.map((category) => ({
      category,
      count: categories.get(category) ?? 0,
    })),
    statusCounts,
    topCustomers: top,
    excluded: {
      ...excluded,
      notConvertible: [...notConvertible.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([currency, n]) => ({ currency, count: n.count, total: formatPositive(n.total) })),
    },
    version: INVOICE_STATS_VERSION,
  };
}
