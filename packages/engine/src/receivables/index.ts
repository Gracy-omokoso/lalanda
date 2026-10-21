// Encaissements, statut de règlement et réalisé issu des ventes (ADR-0031).
// Versionné à part (`RECEIVABLES_VERSION`) ; ne touche ni `invoice-totals` ni
// aucun calcul de plan.

export * from './types.js';
export { checkReceipt, computeSettlement } from './settlement.js';
export {
  PLAN_EXERCISES,
  fiscalPeriodOfMonth,
  isCalendarDate,
  isCalendarMonth,
  monthOfDate,
} from './calendar.js';
export {
  aggregateReceiptsByMonth,
  aggregateRevenueByMonth,
  planRunActuals,
  revenueAmountsFor,
  revenueBaseOf,
  signedAmountToJsonNumber,
} from './aggregation.js';
