// Agrégats des dépenses et plan de report vers le réalisé (ADR-0034 § 5).
//
// `planExpenseActuals` dit ce que les dépenses DEVRAIENT porter dans
// `actual_periods` ; l'API compare ensuite ce plan à ce qui est stocké et
// n'écrit que les différences (idempotence). Règles :
//   - période = mois civil de `spentOn`, converti en (exercice, mois) ;
//   - montant = montant PAYÉ (décision ouverte n° 1 : prudent) ;
//   - aucune conversion : une case (ligne, mois) qui contient UNE dépense dans
//     une autre devise que le projet n'est pas reportée du tout — un chiffre
//     partiel présenté comme le réalisé serait fabriqué (docs/08) ;
//   - une catégorie non rattachée va dans la file des non rattachées.

import { exercisePeriodOf, monthKeyOf } from './calendar.js';
import { formatCents, trustedCents } from './money.js';
import {
  EXPENSE_CATEGORY_CODES,
  TREASURY_CURRENCIES,
  TREASURY_VERSION,
  type ExpenseActualsCell,
  type ExpenseActualsInput,
  type ExpenseActualsPlan,
  type ExpenseActualsSkipped,
  type ExpenseAggregation,
  type ExpenseCategory,
  type ExpenseInput,
  type ExpenseMonthlyTotal,
  type ExpenseUnmapped,
  type TreasuryCurrency,
} from './types.js';

const categoryRank = (c: ExpenseCategory): number => EXPENSE_CATEGORY_CODES.indexOf(c);
const currencyRank = (c: TreasuryCurrency): number => TREASURY_CURRENCIES.indexOf(c);

function totalsByCurrency(
  expenses: readonly ExpenseInput[],
): Partial<Record<TreasuryCurrency, string>> {
  const totals = new Map<TreasuryCurrency, bigint>();
  for (const e of expenses) {
    totals.set(e.currency, (totals.get(e.currency) ?? 0n) + trustedCents(e.amount, 'Dépense'));
  }
  const out: Partial<Record<TreasuryCurrency, string>> = {};
  for (const c of TREASURY_CURRENCIES) {
    const v = totals.get(c);
    if (v !== undefined) out[c] = formatCents(v);
  }
  return out;
}

/** Totaux par mois civil, devise et catégorie — utilisables sans projet ni plan. */
export function aggregateExpenses(expenses: readonly ExpenseInput[]): ExpenseAggregation {
  const groups = new Map<string, { row: Omit<ExpenseMonthlyTotal, 'total'>; total: bigint }>();
  for (const e of expenses) {
    const month = monthKeyOf(e.spentOn);
    const key = `${month}|${e.currency}|${e.category}`;
    const g = groups.get(key) ?? {
      row: { month, currency: e.currency, category: e.category, count: 0 },
      total: 0n,
    };
    g.total += trustedCents(e.amount, 'Dépense');
    g.row.count += 1;
    groups.set(key, g);
  }
  const byMonth = [...groups.values()]
    .map((g) => ({ ...g.row, total: formatCents(g.total) }))
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        currencyRank(a.currency) - currencyRank(b.currency) ||
        categoryRank(a.category) - categoryRank(b.category),
    );
  return { version: TREASURY_VERSION, byMonth, totalsByCurrency: totalsByCurrency(expenses) };
}

/** Ce que les dépenses doivent porter au réalisé du projet relié. */
export function planExpenseActuals(input: ExpenseActualsInput): ExpenseActualsPlan {
  const cellsByKey = new Map<
    string,
    { calendarMonth: string; lineId: string; expenses: ExpenseInput[] }
  >();
  const unmapped = new Map<string, ExpenseUnmapped & { cents: bigint }>();

  for (const e of input.expenses) {
    const calendarMonth = monthKeyOf(e.spentOn);
    const lineId = input.mapping[e.category];
    if (lineId === undefined) {
      const key = `${calendarMonth}|${e.category}|${e.currency}`;
      const u = unmapped.get(key) ?? {
        calendarMonth,
        category: e.category,
        currency: e.currency,
        total: '0.00',
        count: 0,
        cents: 0n,
      };
      u.cents += trustedCents(e.amount, 'Dépense');
      u.count += 1;
      unmapped.set(key, u);
      continue;
    }
    const key = `${calendarMonth}|${lineId}`;
    const cell = cellsByKey.get(key) ?? { calendarMonth, lineId, expenses: [] };
    cell.expenses.push(e);
    cellsByKey.set(key, cell);
  }

  const cells: ExpenseActualsCell[] = [];
  const skipped: ExpenseActualsSkipped[] = [];
  for (const cell of cellsByKey.values()) {
    const period = exercisePeriodOf(cell.calendarMonth, input.firstMonth);
    const ids = cell.expenses.map((e) => e.id).sort();
    if (period === null) {
      skipped.push({
        calendarMonth: cell.calendarMonth,
        year: null,
        month: null,
        lineId: cell.lineId,
        reason: 'OUTSIDE_PLAN_HORIZON',
        expenseIds: ids,
        totalsByCurrency: totalsByCurrency(cell.expenses),
      });
      continue;
    }
    if (cell.expenses.some((e) => e.currency !== input.projectCurrency)) {
      skipped.push({
        calendarMonth: cell.calendarMonth,
        year: period.year,
        month: period.month,
        lineId: cell.lineId,
        reason: 'CURRENCY_NOT_CONVERTIBLE',
        expenseIds: ids,
        totalsByCurrency: totalsByCurrency(cell.expenses),
      });
      continue;
    }
    const byCategory = new Map<ExpenseCategory, bigint>();
    let total = 0n;
    for (const e of cell.expenses) {
      const cents = trustedCents(e.amount, 'Dépense');
      total += cents;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0n) + cents);
    }
    cells.push({
      year: period.year,
      month: period.month,
      calendarMonth: cell.calendarMonth,
      lineId: cell.lineId,
      amount: formatCents(total),
      documents: ids,
      categories: [...byCategory.entries()]
        .sort(([a], [b]) => categoryRank(a) - categoryRank(b))
        .map(([category, cents]) => ({ category, amount: formatCents(cents) })),
    });
  }

  const byPeriod = (
    a: { calendarMonth: string; lineId: string },
    b: { calendarMonth: string; lineId: string },
  ): number => a.calendarMonth.localeCompare(b.calendarMonth) || a.lineId.localeCompare(b.lineId);
  cells.sort(byPeriod);
  skipped.sort(byPeriod);

  return {
    version: TREASURY_VERSION,
    cells,
    skipped,
    unmapped: [...unmapped.values()]
      .map(({ cents, ...u }) => ({ ...u, total: formatCents(cents) }))
      .sort(
        (a, b) =>
          a.calendarMonth.localeCompare(b.calendarMonth) ||
          categoryRank(a.category) - categoryRank(b.category) ||
          currencyRank(a.currency) - currencyRank(b.currency),
      ),
  };
}
