// Calcul conforme des factures (ADR-0022, lot S25d) — point d'entrée du module.
//
// Barrel initial du jalon D0 : il ne réexporte que les deux fichiers figés du
// contrat (types et groupes de taxation). Le chantier D3 y ajoute ses exports
// (`computeInvoiceTotals`, `INVOICE_TOTALS_VERSION`, …) ICI seulement, sans
// toucher `packages/engine/src/index.ts`, qui réexporte déjà tout ce barrel.

export * from './types.js';
export * from './tax-groups.js';
