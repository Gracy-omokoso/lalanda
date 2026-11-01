// Moteur d'écritures (ADR-0049 § 6 et § 12) — lot K2. `money.ts` et `build.ts`
// restent internes.
export { applyRate, type ApplyRateInput, type DraftEntry, type DraftLine } from './rate.js';
export { checkEntry, type CheckEntryOptions } from './check.js';
export { reverseEntry, syncSourceEntries, type ReverseOptions, type SyncPlan } from './reverse.js';
export {
  expenseKey,
  parseSourceKey,
  receiptKey,
  reversalKey,
  salesInvoiceKey,
  stockMovementKey,
  supplierInvoiceKey,
  supplierPaymentKey,
  treasuryMovementKey,
  type ParsedSourceKey,
} from './source-keys.js';
export { entriesForSalesInvoice } from './sales.js';
export { entriesForReceipt, entriesForSupplierPayment } from './settlements.js';
export { entriesForExpense, entriesForSupplierInvoice } from './purchases.js';
export { entriesForStockMovement, entriesForTreasuryMovement } from './treasury.js';
