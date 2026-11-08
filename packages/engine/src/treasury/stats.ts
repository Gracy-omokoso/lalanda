// ─────────────────────────────────────────────────────────────────────────────
// Tableaux de bord des écrans Trésorerie (ADR-0071) : Dépenses, Comptes.
//
// Lectures des règles d'ADR-0034, AUCUNE règle nouvelle : une dépense compte
// pour son montant PAYÉ à sa date ; un solde est celui de `computeAccountBalances`
// (ouverture + entrées − sorties). Montants PAR DEVISE, jamais additionnés ni
// convertis. Ce sont les comptes RÉELS : la trésorerie mensuelle des plans BUILD
// est une vue simplifiée distincte. Aucune horloge : `asOf` est fourni.
// ─────────────────────────────────────────────────────────────────────────────

import { computeAccountBalances } from './balances.js';
import { daysInMonth, isCalendarDay, isCalendarMonthKey, partsOf } from './calendar.js';
import { divHalfUp, formatCents, trustedCents } from './money.js';
import {
  EXPENSE_CATEGORY_CODES,
  TREASURY_CURRENCIES,
  type ExpenseCategory,
  type TreasuryAccountInput,
  type TreasuryCurrency,
  type TreasuryMovementInput,
} from './types.js';

/** Version du calcul des tableaux de bord de la trésorerie. */
export const TREASURY_STATS_VERSION = '1.0.0';

export interface TreasuryStatsAmountCount {
  amount: string;
  count: number;
}

function checkAsOf(asOf: string): string {
  if (!isCalendarDay(asOf)) throw new RangeError(`Date du jour illisible : ${asOf}`);
  return asOf;
}
function checkMonths(months: number): number {
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    throw new RangeError(`Fenêtre de mois invalide : ${months}`);
  }
  return months;
}
function shift(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}
function windowOf(asOf: string, months: number): string[] {
  const to = asOf.slice(0, 7);
  return Array.from({ length: months }, (_, i) => shift(to, i - (months - 1)));
}
function lastDay(month: string): string {
  const { year, month: m } = partsOf(`${month}-01`);
  return `${month}-${String(daysInMonth(year, m)).padStart(2, '0')}`;
}
/** (a − b) / b en % entier, demi vers le haut en valeur absolue ; `null` si b ≤ 0. */
function changePercent(current: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  const diff = current - previous;
  const abs = divHalfUp((diff < 0n ? -diff : diff) * 100n, previous);
  return Number(diff < 0n ? -abs : abs);
}
const currencyRank = (c: TreasuryCurrency): number => TREASURY_CURRENCIES.indexOf(c);
/** Devises du plus de documents au moins ; égalité : ordre des devises (CDF, USD). */
function order(counts: Map<TreasuryCurrency, number>): TreasuryCurrency[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || currencyRank(a[0]) - currencyRank(b[0]))
    .map(([c]) => c);
}

// ─── Dépenses ────────────────────────────────────────────────────────────────

export interface ExpenseStatsExpense {
  id: string;
  status: 'recorded' | 'cancelled';
  spentOn: string;
  amount: string;
  currency: TreasuryCurrency;
  category: ExpenseCategory;
  hasAttachment: boolean;
}

export interface ExpenseStatsInput {
  asOf: string;
  months: number;
  /** Mois affiché par la liste : compteurs des onglets (`AAAA-MM`). */
  listMonth: string;
  expenses: readonly ExpenseStatsExpense[];
}

export interface ExpenseCurrencyStats {
  currency: TreasuryCurrency;
  months: { month: string; amount: string; count: number }[];
  thisMonth: TreasuryStatsAmountCount;
  previousMonth: { month: string; amount: string; count: number };
  changePercent: number | null;
  /** Moyenne mensuelle des mois COMPLETS de la fenêtre (mois en cours exclu), au centime. */
  monthlyAverage: string | null;
  /** Catégories du mois en cours, montant décroissant (égalité : ordre d'ADR-0034). */
  byCategoryThisMonth: { category: ExpenseCategory; amount: string; count: number }[];
  withoutAttachmentThisMonth: TreasuryStatsAmountCount;
}

export interface ExpenseStats {
  asOf: string;
  from: string;
  to: string;
  listMonth: string;
  statusCounts: { recorded: number; cancelled: number; all: number };
  byCurrency: ExpenseCurrencyStats[];
  version: string;
}

interface Acc {
  amount: bigint;
  count: number;
}
const acc = (): Acc => ({ amount: 0n, count: 0 });
const out = (a: Acc): TreasuryStatsAmountCount => ({
  amount: formatCents(a.amount),
  count: a.count,
});

export function computeExpenseStats(input: ExpenseStatsInput): ExpenseStats {
  const asOf = checkAsOf(input.asOf);
  const keys = windowOf(asOf, checkMonths(input.months));
  if (!isCalendarMonthKey(input.listMonth)) {
    throw new RangeError(`Mois de la liste illisible : ${input.listMonth}`);
  }
  const current = keys[keys.length - 1]!;
  const previous = shift(current, -1);
  const counts = { recorded: 0, cancelled: 0, all: 0 };
  const docs = new Map<TreasuryCurrency, number>();
  type Block = {
    byMonth: Map<string, Acc>;
    prev: Acc;
    categories: Map<ExpenseCategory, Acc>;
    noAttachment: Acc;
  };
  const blocks = new Map<TreasuryCurrency, Block>();

  for (const e of input.expenses) {
    if (!isCalendarDay(e.spentOn)) throw new RangeError(`Date illisible : ${e.spentOn}`);
    const cents = trustedCents(e.amount, 'Dépense');
    const month = e.spentOn.slice(0, 7);
    if (month === input.listMonth) {
      counts.all += 1;
      if (e.status === 'cancelled') counts.cancelled += 1;
      else counts.recorded += 1;
    }
    if (e.status !== 'recorded' || e.spentOn > asOf) continue;
    let b = blocks.get(e.currency);
    if (!b) {
      b = {
        byMonth: new Map(keys.map((k) => [k, acc()])),
        prev: acc(),
        categories: new Map(),
        noAttachment: acc(),
      };
      blocks.set(e.currency, b);
    }
    const m = b.byMonth.get(month);
    if (month === previous) {
      b.prev.amount += cents;
      b.prev.count += 1;
    }
    if (!m) continue;
    docs.set(e.currency, (docs.get(e.currency) ?? 0) + 1);
    m.amount += cents;
    m.count += 1;
    if (month === current) {
      const c = b.categories.get(e.category) ?? acc();
      c.amount += cents;
      c.count += 1;
      b.categories.set(e.category, c);
      if (!e.hasAttachment) {
        b.noAttachment.amount += cents;
        b.noAttachment.count += 1;
      }
    }
  }
  for (const c of blocks.keys()) if (!docs.has(c)) docs.set(c, 0);

  return {
    asOf,
    from: keys[0]!,
    to: current,
    listMonth: input.listMonth,
    statusCounts: counts,
    byCurrency: order(docs).map((currency) => {
      const b = blocks.get(currency)!;
      const now = b.byMonth.get(current)!;
      const complete = keys.slice(0, -1);
      const sum = complete.reduce((s, k) => s + b.byMonth.get(k)!.amount, 0n);
      return {
        currency,
        months: keys.map((month) => ({ month, ...out(b.byMonth.get(month)!) })),
        thisMonth: out(now),
        previousMonth: { month: previous, ...out(b.prev) },
        changePercent: changePercent(now.amount, b.prev.amount),
        monthlyAverage:
          complete.length === 0 || sum < 0n
            ? null
            : formatCents(divHalfUp(sum, BigInt(complete.length))),
        byCategoryThisMonth: [...b.categories.entries()]
          .sort((x, y) =>
            x[1].amount === y[1].amount
              ? EXPENSE_CATEGORY_CODES.indexOf(x[0]) - EXPENSE_CATEGORY_CODES.indexOf(y[0])
              : x[1].amount > y[1].amount
                ? -1
                : 1,
          )
          .map(([category, a]) => ({ category, ...out(a) })),
        withoutAttachmentThisMonth: out(b.noAttachment),
      };
    }),
    version: TREASURY_STATS_VERSION,
  };
}

// ─── Comptes ─────────────────────────────────────────────────────────────────

export interface AccountStatsInput {
  asOf: string;
  months: number;
  accounts: readonly TreasuryAccountInput[];
  /** Grand livre des comptes (dépenses payées, virements, autres mouvements, encaissements). */
  movements: readonly TreasuryMovementInput[];
}

export interface AccountCurrencyStats {
  currency: TreasuryCurrency;
  /** Somme des soldes des comptes ACTIFS au jour (`computeAccountBalances`). */
  balance: string;
  activeAccounts: number;
  overdrawn: number;
  months: { month: string; inflows: string; outflows: string; closingBalance: string }[];
  thisMonth: { inflows: string; outflows: string; net: string };
  /** Comptes actifs, solde décroissant. */
  accounts: { accountId: string; balance: string }[];
}

export interface AccountStats {
  asOf: string;
  from: string;
  to: string;
  byCurrency: AccountCurrencyStats[];
  version: string;
}

export function computeAccountStats(input: AccountStatsInput): AccountStats {
  const asOf = checkAsOf(input.asOf);
  const keys = windowOf(asOf, checkMonths(input.months));
  const active = input.accounts.filter((a) => a.active !== false);
  const currencyOf = new Map(active.map((a) => [a.id, a.currency]));
  const docs = new Map<TreasuryCurrency, number>();
  for (const a of active) docs.set(a.currency, (docs.get(a.currency) ?? 0) + 1);

  const today = computeAccountBalances(input.accounts, input.movements, asOf);
  const closings = keys.map((m) => {
    const end = m === keys[keys.length - 1] ? asOf : lastDay(m);
    return computeAccountBalances(input.accounts, input.movements, end).totalsByCurrency;
  });
  const flows = new Map<string, { in: bigint; out: bigint }>();
  const keySet = new Set(keys);
  for (const mv of input.movements) {
    const currency = currencyOf.get(mv.accountId);
    if (currency === undefined || !isCalendarDay(mv.date) || mv.date > asOf) continue;
    const month = mv.date.slice(0, 7);
    if (!keySet.has(month)) continue;
    const k = `${currency}|${month}`;
    const f = flows.get(k) ?? { in: 0n, out: 0n };
    const cents = trustedCents(mv.amount, 'Mouvement');
    if (mv.direction === 'in') f.in += cents;
    else f.out += cents;
    flows.set(k, f);
  }

  return {
    asOf,
    from: keys[0]!,
    to: keys[keys.length - 1]!,
    byCurrency: order(docs).map((currency) => {
      const balances = today.accounts.filter((b) => currencyOf.get(b.accountId) === currency);
      const months = keys.map((month, i) => {
        const f = flows.get(`${currency}|${month}`) ?? { in: 0n, out: 0n };
        return {
          month,
          inflows: formatCents(f.in),
          outflows: formatCents(f.out),
          closingBalance: closings[i]![currency] ?? '0.00',
        };
      });
      const now = flows.get(`${currency}|${keys[keys.length - 1]!}`) ?? { in: 0n, out: 0n };
      return {
        currency,
        balance: today.totalsByCurrency[currency] ?? '0.00',
        activeAccounts: balances.length,
        overdrawn: balances.filter((b) => b.balance.startsWith('-')).length,
        months,
        thisMonth: {
          inflows: formatCents(now.in),
          outflows: formatCents(now.out),
          net: formatCents(now.in - now.out),
        },
        accounts: balances
          .map((b) => ({
            accountId: b.accountId,
            balance: b.balance,
            cents: trustedCents(b.balance, 'Solde'),
          }))
          .sort((x, y) =>
            x.cents === y.cents ? (x.accountId < y.accountId ? -1 : 1) : x.cents > y.cents ? -1 : 1,
          )
          .map(({ accountId, balance }) => ({ accountId, balance })),
      };
    }),
    version: TREASURY_STATS_VERSION,
  };
}
