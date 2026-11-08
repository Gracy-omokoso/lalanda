// ─────────────────────────────────────────────────────────────────────────────
// Tableaux de bord des écrans Achats (ADR-0071) : Factures fournisseurs, À payer,
// Commandes.
//
// Lectures des règles existantes, AUCUNE règle nouvelle : le reste à payer est
// celui de `payableSettlement` (fourni par l'appelant), l'ancienneté celle de
// `payablesAging`, les totaux de commande ceux stockés par `computeOrderTotals`.
// Montants PAR DEVISE, jamais additionnés ni convertis (ADR-0044 § 7). Les
// compteurs des onglets ne dépendent d'aucune devise. Aucune horloge : `asOf`
// est le jour de Kinshasa calculé par l'appelant.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, dayNumber } from '../treasury/calendar.js';
import { centsOf, checkCurrency, checkDay, divHalfUp, formatCents } from './money.js';
import { payablesAging } from './payables.js';
import type { CurrencyAging, PurchaseCurrency } from './types.js';

/** Version du calcul des tableaux de bord des achats. */
export const PURCHASES_STATS_VERSION = '1.0.0';

/** Fenêtre des délais moyens (paiement, approbation), en jours (ADR-0071). */
export const PURCHASES_DELAY_WINDOW_DAYS = 90;

/** Fenêtres « sous N jours » de l'écran À payer (ADR-0071 § 5). */
export const PAYABLES_DUE_WITHIN_DAYS = [7, 30] as const;

export interface PurchaseStatsAmountCount {
  amount: string;
  count: number;
}

export interface PurchaseStatsMonthPoint {
  month: string;
  amount: string;
  count: number;
}

// ─── Outils communs (internes) ───────────────────────────────────────────────

interface Acc {
  amount: bigint;
  count: number;
}
const acc = (): Acc => ({ amount: 0n, count: 0 });
const push = (a: Acc, cents: bigint): void => {
  a.amount += cents;
  a.count += 1;
};
const outAcc = (a: Acc): PurchaseStatsAmountCount => ({
  amount: formatCents(a.amount),
  count: a.count,
});

function checkMonths(months: number): number {
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    throw new RangeError(`Fenêtre de mois invalide : ${months}`);
  }
  return months;
}

/** `AAAA-MM` décalé de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

/** Les `months` mois civils qui finissent au mois de `asOf`, du plus ancien au plus récent. */
export function monthWindow(asOf: string, months: number): string[] {
  const to = asOf.slice(0, 7);
  return Array.from({ length: months }, (_, i) => shiftMonth(to, i - (months - 1)));
}

/** (a − b) / b en % entier, demi vers le haut (en valeur absolue) ; `null` si b = 0. */
export function changePercentOf(current: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  const diff = current - previous;
  const abs = divHalfUp((diff < 0n ? -diff : diff) * 100n, previous);
  return Number(diff < 0n ? -abs : abs);
}

/** Moyenne simple de jours entiers, arrondie au jour demi vers le haut ; `null` sans valeur. */
function averageDays(sum: number, count: number): number | null {
  return count === 0 ? null : Number(divHalfUp(BigInt(sum), BigInt(count)));
}

/** Devises rangées du plus de documents au moins ; égalité : ordre alphabétique. */
function currencyOrder(counts: Map<PurchaseCurrency, number>): PurchaseCurrency[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([c]) => c);
}

interface MonthSeries {
  byMonth: Map<string, Acc>;
  prevMonth: string;
  prev: Acc;
}
function monthSeries(keys: readonly string[]): MonthSeries {
  return {
    byMonth: new Map(keys.map((k) => [k, acc()])),
    prevMonth: shiftMonth(keys[keys.length - 1]!, -1),
    prev: acc(),
  };
}
/** Ajoute un montant au mois de `day` s'il est dans la fenêtre (ou le mois précédent). */
function addToSeries(s: MonthSeries, day: string, cents: bigint): boolean {
  const m = day.slice(0, 7);
  const b = s.byMonth.get(m);
  if (b) push(b, cents);
  if (m === s.prevMonth) push(s.prev, cents);
  return b !== undefined;
}
function seriesOut(s: MonthSeries, keys: readonly string[]) {
  const current = s.byMonth.get(keys[keys.length - 1]!)!;
  // Avec une fenêtre d'un mois, le mois précédent n'est pas dans `byMonth`.
  return {
    months: keys.map((m) => ({ month: m, ...outAcc(s.byMonth.get(m)!) })),
    thisMonth: outAcc(current),
    previousMonth: { month: s.prevMonth, ...outAcc(s.prev) },
    changePercent: changePercentOf(current.amount, s.prev.amount),
  };
}

// ─── Factures fournisseurs ───────────────────────────────────────────────────

export interface SupplierInvoiceStatsInvoice {
  id: string;
  kind: 'invoice' | 'credit_note';
  status: 'draft' | 'validated' | 'cancelled';
  currency: PurchaseCurrency;
  invoiceDate: string;
  dueDate: string;
  total: string;
  /** Statut du rapprochement enregistré sur la facture. */
  matchingStatus: string;
  disputed: boolean;
  /** Reste à payer du moteur (`payableSettlement`) ; « 0.00 » hors facture validée. */
  remaining: string;
  costAllocations: readonly { category: string; amount: string }[];
}

export interface SupplierInvoiceStatsInput {
  asOf: string;
  months: number;
  invoices: readonly SupplierInvoiceStatsInvoice[];
}

export interface SupplierInvoiceCurrencyStats {
  currency: PurchaseCurrency;
  months: PurchaseStatsMonthPoint[];
  thisMonth: PurchaseStatsAmountCount;
  previousMonth: PurchaseStatsMonthPoint;
  changePercent: number | null;
  outstanding: PurchaseStatsAmountCount;
  overdue: PurchaseStatsAmountCount;
  disputed: PurchaseStatsAmountCount;
  drafts: PurchaseStatsAmountCount;
  variances: PurchaseStatsAmountCount;
  /** Imputations des factures validées de la fenêtre, montant décroissant. */
  byCategory: { category: string; amount: string; count: number }[];
}

export interface SupplierInvoiceStats {
  asOf: string;
  from: string;
  to: string;
  statusCounts: {
    all: number;
    draft: number;
    variance: number;
    validated: number;
    overdue: number;
    disputed: number;
  };
  byCurrency: SupplierInvoiceCurrencyStats[];
  version: string;
}

export function computeSupplierInvoiceStats(
  input: SupplierInvoiceStatsInput,
): SupplierInvoiceStats {
  const asOf = checkDay(input.asOf, 'Jour de référence');
  const keys = monthWindow(asOf, checkMonths(input.months));
  const counts = { all: 0, draft: 0, variance: 0, validated: 0, overdue: 0, disputed: 0 };
  const docCount = new Map<PurchaseCurrency, number>();
  const blocks = new Map<
    PurchaseCurrency,
    {
      series: MonthSeries;
      outstanding: Acc;
      overdue: Acc;
      disputed: Acc;
      drafts: Acc;
      variances: Acc;
      categories: Map<string, Acc>;
    }
  >();
  const blockOf = (c: PurchaseCurrency) => {
    let b = blocks.get(c);
    if (!b) {
      b = {
        series: monthSeries(keys),
        outstanding: acc(),
        overdue: acc(),
        disputed: acc(),
        drafts: acc(),
        variances: acc(),
        categories: new Map(),
      };
      blocks.set(c, b);
    }
    return b;
  };

  input.invoices.forEach((inv, i) => {
    const what = `Facture ${i + 1}`;
    const currency = checkCurrency(inv.currency, what);
    const invoiceDate = checkDay(inv.invoiceDate, `${what} : date`);
    const dueDate = checkDay(inv.dueDate, `${what} : échéance`);
    const total = centsOf(inv.total, `${what} : total`);
    const remaining = centsOf(inv.remaining, `${what} : reste`);
    counts.all += 1;
    docCount.set(currency, (docCount.get(currency) ?? 0) + 1);
    const b = blockOf(currency);
    if (inv.disputed) counts.disputed += 1;
    if (inv.status === 'draft') {
      counts.draft += 1;
      push(b.drafts, total);
      if (inv.matchingStatus === 'variance') {
        counts.variance += 1;
        push(b.variances, total);
      }
      return;
    }
    if (inv.status !== 'validated') return;
    counts.validated += 1;
    if (inv.kind !== 'invoice') return;
    const late = remaining > 0n && dueDate < asOf;
    if (late) counts.overdue += 1;
    if (remaining > 0n) {
      push(b.outstanding, remaining);
      if (inv.disputed) push(b.disputed, remaining);
      if (late) push(b.overdue, remaining);
    }
    if (invoiceDate > asOf) return;
    if (addToSeries(b.series, invoiceDate, total)) {
      inv.costAllocations.forEach((a, k) => {
        const c = b.categories.get(a.category) ?? acc();
        push(c, centsOf(a.amount, `${what} : imputation ${k + 1}`));
        b.categories.set(a.category, c);
      });
    }
  });

  return {
    asOf,
    from: keys[0]!,
    to: keys[keys.length - 1]!,
    statusCounts: counts,
    byCurrency: currencyOrder(docCount).map((currency) => {
      const b = blocks.get(currency)!;
      return {
        currency,
        ...seriesOut(b.series, keys),
        outstanding: outAcc(b.outstanding),
        overdue: outAcc(b.overdue),
        disputed: outAcc(b.disputed),
        drafts: outAcc(b.drafts),
        variances: outAcc(b.variances),
        byCategory: [...b.categories.entries()]
          .sort((x, y) =>
            x[1].amount === y[1].amount
              ? x[0] < y[0]
                ? -1
                : 1
              : x[1].amount > y[1].amount
                ? -1
                : 1,
          )
          .map(([category, a]) => ({ category, ...outAcc(a) })),
      };
    }),
    version: PURCHASES_STATS_VERSION,
  };
}

// ─── À payer ─────────────────────────────────────────────────────────────────

export interface PayablesStatsInvoice {
  id: string;
  supplierId: string;
  currency: PurchaseCurrency;
  invoiceDate: string;
  dueDate: string;
  /** Reste à payer du moteur, non nul (facture validée ouverte). */
  remaining: string;
  disputed: boolean;
}

export interface PayablesStatsPayment {
  id: string;
  status: string;
  currency: PurchaseCurrency;
  paidOn: string;
  amount: string;
  /** Date de facture de chaque imputation (résolue par l'appelant ; `null` inconnue). */
  allocations: readonly { invoiceId: string; invoiceDate: string | null }[];
}

export interface PayablesStatsInput {
  asOf: string;
  months: number;
  /** Fenêtre « bientôt » des réglages des achats (ADR-0044 § 2.2). */
  dueSoonDays: number;
  invoices: readonly PayablesStatsInvoice[];
  payments: readonly PayablesStatsPayment[];
}

export interface PayablesCurrencyStats {
  currency: PurchaseCurrency;
  due: PurchaseStatsAmountCount;
  overdue: PurchaseStatsAmountCount;
  dueWithin7: PurchaseStatsAmountCount;
  dueWithin30: PurchaseStatsAmountCount;
  disputed: PurchaseStatsAmountCount;
  months: PurchaseStatsMonthPoint[];
  thisMonth: PurchaseStatsAmountCount;
  previousMonth: PurchaseStatsMonthPoint;
  changePercent: number | null;
  averageDelay: { windowDays: number; since: string; days: number | null; allocations: number };
  aging: Omit<CurrencyAging, 'currency'>;
  /** Cinq fournisseurs au plus grand dû (hors litige). */
  topSuppliers: { supplierId: string; amount: string; count: number }[];
}

export interface PayablesStats {
  asOf: string;
  from: string;
  to: string;
  dueSoonDays: number;
  dueSoonUntil: string;
  /** Groupes de l'écran : en retard, bientôt, plus tard (hors litige), en litige. */
  groupCounts: { overdue: number; soon: number; later: number; disputed: number };
  byCurrency: PayablesCurrencyStats[];
  version: string;
}

const EMPTY_AGING = (): Omit<CurrencyAging, 'currency'> => {
  const z = { amount: '0.00', count: 0 };
  return {
    notDue: z,
    days1To30: z,
    days31To60: z,
    days61To90: z,
    over90: z,
    open: z,
    disputed: z,
  };
};

export function computePayablesStats(input: PayablesStatsInput): PayablesStats {
  const asOf = checkDay(input.asOf, 'Jour de référence');
  const keys = monthWindow(asOf, checkMonths(input.months));
  if (!Number.isInteger(input.dueSoonDays) || input.dueSoonDays < 1 || input.dueSoonDays > 30) {
    throw new RangeError('Fenêtre « bientôt » : entier de 1 à 30 attendu');
  }
  const soonUntil = addDays(asOf, input.dueSoonDays);
  const since = addDays(asOf, -(PURCHASES_DELAY_WINDOW_DAYS - 1));
  const asOfN = dayNumber(asOf);
  const groups = { overdue: 0, soon: 0, later: 0, disputed: 0 };
  const docCount = new Map<PurchaseCurrency, number>();
  type Block = {
    due: Acc;
    overdue: Acc;
    within7: Acc;
    within30: Acc;
    disputed: Acc;
    series: MonthSeries;
    delaySum: number;
    delayCount: number;
    suppliers: Map<string, Acc>;
  };
  const blocks = new Map<PurchaseCurrency, Block>();
  const blockOf = (c: PurchaseCurrency): Block => {
    let b = blocks.get(c);
    if (!b) {
      b = {
        due: acc(),
        overdue: acc(),
        within7: acc(),
        within30: acc(),
        disputed: acc(),
        series: monthSeries(keys),
        delaySum: 0,
        delayCount: 0,
        suppliers: new Map(),
      };
      blocks.set(c, b);
    }
    return b;
  };

  input.invoices.forEach((inv, i) => {
    const what = `Facture ${i + 1}`;
    const currency = checkCurrency(inv.currency, what);
    const dueDate = checkDay(inv.dueDate, `${what} : échéance`);
    checkDay(inv.invoiceDate, `${what} : date`);
    const remaining = centsOf(inv.remaining, `${what} : reste`);
    if (remaining === 0n) return;
    docCount.set(currency, (docCount.get(currency) ?? 0) + 1);
    const b = blockOf(currency);
    if (inv.disputed) {
      groups.disputed += 1;
      push(b.disputed, remaining);
      return;
    }
    push(b.due, remaining);
    const s = b.suppliers.get(inv.supplierId) ?? acc();
    push(s, remaining);
    b.suppliers.set(inv.supplierId, s);
    const n = dayNumber(dueDate);
    if (dueDate < asOf) {
      groups.overdue += 1;
      push(b.overdue, remaining);
      return;
    }
    if (dueDate <= soonUntil) groups.soon += 1;
    else groups.later += 1;
    if (n - asOfN <= PAYABLES_DUE_WITHIN_DAYS[0]) push(b.within7, remaining);
    if (n - asOfN <= PAYABLES_DUE_WITHIN_DAYS[1]) push(b.within30, remaining);
  });

  input.payments.forEach((p, i) => {
    const what = `Paiement ${i + 1}`;
    if (p.status === 'cancelled') return;
    const currency = checkCurrency(p.currency, what);
    const paidOn = checkDay(p.paidOn, `${what} : date`);
    const amount = centsOf(p.amount, `${what} : montant`);
    if (paidOn > asOf) return;
    const b = blockOf(currency);
    if (!docCount.has(currency)) docCount.set(currency, 0);
    addToSeries(b.series, paidOn, amount);
    if (paidOn < since) return;
    for (const a of p.allocations) {
      if (a.invoiceDate === null) continue;
      const d = dayNumber(paidOn) - dayNumber(checkDay(a.invoiceDate, `${what} : facture`));
      b.delaySum += d > 0 ? d : 0;
      b.delayCount += 1;
    }
  });

  const aging = payablesAging(
    input.invoices.map((inv) => ({
      id: inv.id,
      currency: inv.currency,
      dueDate: inv.dueDate,
      remaining: inv.remaining,
      disputed: inv.disputed,
    })),
    asOf,
  );
  const agingOf = new Map(aging.byCurrency.map((a) => [a.currency, a]));

  return {
    asOf,
    from: keys[0]!,
    to: keys[keys.length - 1]!,
    dueSoonDays: input.dueSoonDays,
    dueSoonUntil: soonUntil,
    groupCounts: groups,
    byCurrency: currencyOrder(docCount).map((currency) => {
      const b = blocks.get(currency)!;
      const a = agingOf.get(currency);
      const { currency: _c, ...agingFigures } = a ?? { currency, ...EMPTY_AGING() };
      return {
        currency,
        due: outAcc(b.due),
        overdue: outAcc(b.overdue),
        dueWithin7: outAcc(b.within7),
        dueWithin30: outAcc(b.within30),
        disputed: outAcc(b.disputed),
        ...seriesOut(b.series, keys),
        averageDelay: {
          windowDays: PURCHASES_DELAY_WINDOW_DAYS,
          since,
          days: averageDays(b.delaySum, b.delayCount),
          allocations: b.delayCount,
        },
        aging: agingFigures,
        topSuppliers: [...b.suppliers.entries()]
          .sort((x, y) =>
            x[1].amount === y[1].amount
              ? x[0] < y[0]
                ? -1
                : 1
              : x[1].amount > y[1].amount
                ? -1
                : 1,
          )
          .slice(0, 5)
          .map(([supplierId, s]) => ({ supplierId, ...outAcc(s) })),
      };
    }),
    version: PURCHASES_STATS_VERSION,
  };
}

// ─── Commandes ───────────────────────────────────────────────────────────────

/** Statuts d'une commande ouverte (ADR-0071 § 6), ceux du résumé des achats. */
export const PURCHASE_OPEN_ORDER_STATUSES = [
  'approved',
  'sent',
  'partially_received',
  'received',
] as const;

export interface PurchaseOrderStatsOrder {
  id: string;
  phase: 'request' | 'order';
  status: string;
  currency: PurchaseCurrency;
  requestedBy: string;
  /** Total TTC stocké par le moteur des commandes. */
  total: string;
  /** Jour de soumission (Kinshasa), `null` jamais soumise. */
  submittedOn: string | null;
  /** Jour d'approbation (Kinshasa), `null` pas approuvée. */
  approvedOn: string | null;
}

export interface PurchaseOrderStatsInput {
  asOf: string;
  months: number;
  /** Utilisateur qui consulte : compteur « mes demandes ». */
  me: string;
  orders: readonly PurchaseOrderStatsOrder[];
}

export interface PurchaseOrderCurrencyStats {
  currency: PurchaseCurrency;
  months: PurchaseStatsMonthPoint[];
  thisMonth: PurchaseStatsAmountCount;
  previousMonth: PurchaseStatsMonthPoint;
  changePercent: number | null;
  open: PurchaseStatsAmountCount;
  pendingApproval: PurchaseStatsAmountCount;
  averageApprovalDelay: {
    windowDays: number;
    since: string;
    days: number | null;
    approvals: number;
  };
}

export interface PurchaseOrderStats {
  asOf: string;
  from: string;
  to: string;
  statusCounts: { all: number; mine: number; draft: number; submitted: number; order: number };
  /** Nombre de demandes et commandes par statut (toutes devises). */
  byStatus: { status: string; count: number }[];
  byCurrency: PurchaseOrderCurrencyStats[];
  version: string;
}

export function computePurchaseOrderStats(input: PurchaseOrderStatsInput): PurchaseOrderStats {
  const asOf = checkDay(input.asOf, 'Jour de référence');
  const keys = monthWindow(asOf, checkMonths(input.months));
  const since = addDays(asOf, -(PURCHASES_DELAY_WINDOW_DAYS - 1));
  const counts = { all: 0, mine: 0, draft: 0, submitted: 0, order: 0 };
  const byStatus = new Map<string, number>();
  const docCount = new Map<PurchaseCurrency, number>();
  type Block = {
    series: MonthSeries;
    open: Acc;
    pending: Acc;
    delaySum: number;
    delayCount: number;
  };
  const blocks = new Map<PurchaseCurrency, Block>();
  const open = new Set<string>(PURCHASE_OPEN_ORDER_STATUSES);

  input.orders.forEach((o, i) => {
    const what = `Commande ${i + 1}`;
    const currency = checkCurrency(o.currency, what);
    const total = centsOf(o.total, `${what} : total`);
    counts.all += 1;
    if (o.requestedBy === input.me) counts.mine += 1;
    if (o.status === 'draft') counts.draft += 1;
    if (o.status === 'submitted') counts.submitted += 1;
    if (o.phase === 'order') counts.order += 1;
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    docCount.set(currency, (docCount.get(currency) ?? 0) + 1);
    let b = blocks.get(currency);
    if (!b) {
      b = { series: monthSeries(keys), open: acc(), pending: acc(), delaySum: 0, delayCount: 0 };
      blocks.set(currency, b);
    }
    if (o.status === 'submitted') push(b.pending, total);
    if (open.has(o.status)) push(b.open, total);
    if (o.approvedOn !== null) {
      const approvedOn = checkDay(o.approvedOn, `${what} : approbation`);
      if (approvedOn <= asOf) addToSeries(b.series, approvedOn, total);
      if (o.submittedOn !== null && approvedOn >= since && approvedOn <= asOf) {
        const d =
          dayNumber(approvedOn) - dayNumber(checkDay(o.submittedOn, `${what} : soumission`));
        b.delaySum += d > 0 ? d : 0;
        b.delayCount += 1;
      }
    }
  });

  return {
    asOf,
    from: keys[0]!,
    to: keys[keys.length - 1]!,
    statusCounts: counts,
    byStatus: [...byStatus.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([status, count]) => ({ status, count })),
    byCurrency: currencyOrder(docCount).map((currency) => {
      const b = blocks.get(currency)!;
      return {
        currency,
        ...seriesOut(b.series, keys),
        open: outAcc(b.open),
        pendingApproval: outAcc(b.pending),
        averageApprovalDelay: {
          windowDays: PURCHASES_DELAY_WINDOW_DAYS,
          since,
          days: averageDays(b.delaySum, b.delayCount),
          approvals: b.delayCount,
        },
      };
    }),
    version: PURCHASES_STATS_VERSION,
  };
}
