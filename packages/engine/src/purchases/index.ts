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
