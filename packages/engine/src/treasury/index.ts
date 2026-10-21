// Dépenses et trésorerie réelle (ADR-0034) — point d'entrée du module.
// `money.ts` reste interne ; `calendar.ts` n'exporte que ce dont l'API a besoin.

export * from './types.js';
export {
  addDays as treasuryAddDays,
  exercisePeriodOf,
  isCalendarDay,
  isCalendarMonthKey,
  monthKeyOf,
  PLAN_EXERCISE_COUNT,
} from './calendar.js';
export {
  isOccurrenceOf,
  monthlyEquivalentCents,
  nthOccurrence,
  occurrencesOf,
} from './recurrence.js';
export { computeAccountBalances } from './balances.js';
export { aggregateExpenses, planExpenseActuals } from './expenses.js';
export { reconcileExpenses } from './reconciliation.js';
export {
  DEFAULT_SCENARIO_HYPOTHESES,
  forecastTreasury,
  isValidScenarioHypotheses,
  OVERDUE_RECURRING_LOOKBACK_DAYS,
  SCENARIO_BOUNDS,
} from './forecast.js';
export { centsOf as treasuryCentsOf, formatCents as treasuryFormatCents } from './money.js';
