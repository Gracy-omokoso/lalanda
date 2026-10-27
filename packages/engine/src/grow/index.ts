// GROW — santé de l'entreprise, indicateurs investisseurs, parcours (ADR-0032).
// Versionné à part (`GROW_VERSION`) : ne touche aucun calcul de plan ni de facture.

export * from './types.js';
export {
  addMonths,
  daysBetween,
  kinshasaDateOf,
  kinshasaMonthOf,
  lastCompleteMonth,
  monthWindow,
} from './periods.js';
// Ventes RUN : la règle de chiffre d'affaires est celle d'ADR-0031 (`revenueAmountsFor`).
export { salesRevenue, type GrowSalesRevenue } from './run-sales.js';
export {
  computeInvestorIndicators,
  GROW_ACTUAL_LINES,
  GROW_GROSS_MARGIN_LINES,
  GROW_WINDOWS_V1,
} from './indicators.js';
export * from './journey.js';
export * from './health.js';
