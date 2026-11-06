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
// ADR-0040 — C8 : solde dû d'un client par devise (fiche 360°).
export * from './outstanding.js';
// ADR-0056 : tableau de bord des factures (cartes, graphiques, compteurs).
export * from './invoice-stats.js';
// ADR-0067 : tableaux de bord des devis et des encaissements.
export { convertAtRatio, referenceRatioOf, type ReferenceRateDocument } from './reference-rate.js';
export * from './quote-stats.js';
export * from './receipt-stats.js';
