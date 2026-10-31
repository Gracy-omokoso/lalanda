// Stocks (ADR-0046 § 7.1) — point d'entrée du module.
// Versionné à part (`STOCK_VERSION`) ; ne touche ni la trésorerie, ni le réalisé,
// ni la marge, ni aucun calcul de plan. `decimal.ts` reste interne.

export * from './types.js';
export { entryUnitCost, toStockQuantity } from './conversions.js';
export { checkStockAvailability, stockLevelDrift, stockLevels } from './ledger.js';
export { stockValuation, weightedAverageValuation } from './valuation.js';
export { countVariances } from './counts.js';
export { replenishmentSuggestions } from './replenishment.js';
export { stockFindings } from './findings.js';
export { projectMaterials, stockReport } from './reports.js';
