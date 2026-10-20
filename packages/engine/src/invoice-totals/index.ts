// Calcul conforme des factures (ADR-0022, lot S25d) — point d'entrée du module.
//
// Les deux premiers fichiers sont figés par le jalon D0 (contrat). Les exports
// du chantier D3 suivent ; `decimal.ts` reste interne et n'est pas réexporté.
// `packages/engine/src/index.ts` réexporte déjà tout ce barrel.

export * from './types.js';
export * from './tax-groups.js';

export {
  DGI_ROUNDING_POLICY,
  DGI_ROUNDING_POLICY_2026_1,
  INVOICE_TOTALS_VERSION,
  computeInvoiceTotals,
} from './compute.js';
export {
  EDEF_TOTALS_FIELDS,
  compareWithEdefResponse,
  decimalFromJsonNumber,
  decimalToJsonNumber,
  isValidDecimal,
  toEdefTotals,
  type EdefTotals,
  type TotalsDifference,
} from './edef-shape.js';
export { isExchangeRateWithinTolerance, usdCounterValue } from './currency.js';
export {
  convertUnitPrice,
  discountedUnitPrice,
  type DiscountedUnitPriceResult,
  type LineDiscount,
} from './pricing.js';
export {
  CALIBRATION_ROUNDING_POLICIES,
  CURRENCY_REFERENCE_CASES,
  INVOICE_TOTALS_REFERENCE_CASES,
  type CurrencyReferenceCase,
  type InvoiceTotalsReferenceCase,
  type ReferenceExpectation,
} from './reference-cases.js';
// ADR-0024 § 7.3 : relevé d'étalonnage, rempli après l'étalonnage réel du 20 oct. 2026.
export { ROUNDING_CALIBRATION, type RoundingCalibrationRecord } from './rounding-calibration.js';

// ADR-0023 § S25e.9 (jalon E0) : types figés et signatures ; corps livrés par E1.
export * from './invoice-checks.types.js';
export { checkPayments, reconcilePayments } from './payments.js';
export {
  CURRENCY_CONVERSION_VERSION,
  convertDocumentToCdf,
  decimalFromJsonRate,
} from './conversion.js';
export { checkCreditNote, remainingQuantities } from './credit-notes.js';
export {
  INVOICE_CHECK_REFERENCE_CASES,
  type InvoiceCheckReferenceCase,
} from './check-reference-cases.js';
// ADR-0023 § S25e.6, amendement du 20 oct. 2026 : groupes et assujettissement du vendeur.
export {
  NON_VAT_REGISTERED_TAX_GROUP,
  TAX_GROUPS_RESERVED_TO_VAT_REGISTERED,
  checkSellerVatStatus,
  type SellerVatStatusCheck,
  type SellerVatStatusFinding,
  type SellerVatStatusInput,
  type SellerVatStatusIssueCode,
  type SellerVatStatusLine,
  type SellerVatStatusWarningCode,
} from './seller-vat-status.js';
