// Contrats clients, commandes clients, acomptes et abonnements (ADR-0050 § 7) —
// point d'entrée du module. Versionné à part (`CONTRACTS_VERSION`) ; ne touche
// ni `ENGINE_VERSION`, ni `INVOICE_TOTALS_VERSION`, ni `TREASURY_VERSION`.
// `common.ts` reste interne.

export * from './types.js';
export { contractTerms, noticeCheck, termsAt } from './terms.js';
export { billingOccurrences, nthBillingDate, occurrenceStatus } from './occurrences.js';
export { depositSummary, orderInvoicing } from './invoicing.js';
export { contractAlerts } from './alerts.js';
