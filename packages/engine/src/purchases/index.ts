// Achats et fournisseurs (ADR-0044 § 7) — point d'entrée du module.
// Versionné à part (`PURCHASES_VERSION`) ; ne touche ni la trésorerie, ni la
// marge, ni aucun calcul de plan. `money.ts` reste interne.

export * from './types.js';
export {
  checkApprovalTiers,
  computeOrderTotals,
  orderReceptionStatus,
  orderRemainingToInvoice,
  requiredApprovals,
} from './orders.js';
export {
  checkCostAllocations,
  checkInvoiceTotal,
  matchInvoice,
  type MatchInvoiceArgs,
} from './matching.js';
export {
  checkSupplierPayment,
  dueDateOf,
  DUE_SOON_DAYS_BOUNDS,
  DUPLICATE_EXPENSE_WINDOW_DAYS,
  PAYABLES_SCHEDULE_WEEKS,
  PAYMENT_TERMS_BOUNDS,
  payableSettlement,
  payablesAging,
  payablesSchedule,
  possibleDuplicateExpenses,
  splitAllocation,
} from './payables.js';
export { purchasesSummary } from './summary.js';
export {
  computePayablesStats,
  computePurchaseOrderStats,
  computeSupplierInvoiceStats,
  PAYABLES_DUE_WITHIN_DAYS,
  PURCHASE_OPEN_ORDER_STATUSES,
  PURCHASES_DELAY_WINDOW_DAYS,
  PURCHASES_STATS_VERSION,
  type PayablesCurrencyStats,
  type PayablesStats,
  type PayablesStatsInput,
  type PayablesStatsInvoice,
  type PayablesStatsPayment,
  type PurchaseOrderCurrencyStats,
  type PurchaseOrderStats,
  type PurchaseOrderStatsInput,
  type PurchaseOrderStatsOrder,
  type PurchaseStatsAmountCount,
  type PurchaseStatsMonthPoint,
  type SupplierInvoiceCurrencyStats,
  type SupplierInvoiceStats,
  type SupplierInvoiceStatsInput,
  type SupplierInvoiceStatsInvoice,
} from './stats.js';
