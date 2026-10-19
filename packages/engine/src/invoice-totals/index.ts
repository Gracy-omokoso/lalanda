// Calcul conforme des factures (ADR-0022, lot S25d) — point d'entrée du module.
//
// Les deux premiers fichiers sont figés par le jalon D0 (contrat). Les exports
// du chantier D3 suivent ; `decimal.ts` reste interne et n'est pas réexporté.
// `packages/engine/src/index.ts` réexporte déjà tout ce barrel.

export * from './types.js';
export * from './tax-groups.js';

export { DGI_ROUNDING_POLICY, INVOICE_TOTALS_VERSION, computeInvoiceTotals } from './compute.js';
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
