// `@lalanda/shared/sales-invoices` — contrats partagés des documents de vente qui ne
// sont pas figés dans `invoice.contract.ts` (ADR-0023). Sous-chemin seulement : rien
// n'est réexporté par la racine du paquet.

// ADR-0056 — tableau de bord des factures.
export * from './stats.js';
