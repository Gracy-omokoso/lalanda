// `@lalanda/shared/crm` — contrats du CRM complet (ADR-0040 O5). Sous-chemin
// seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0040, zones de conflit) : C0 pose les constantes
// et les comptes ; C2 (`forecast.ts`), C3 (`reports.ts`), C4 (`agenda.ts`) et C7
// AJOUTENT leurs fichiers, jamais dans ceux d'un autre lot.

// ADR-0040 — C0
export * from './constants.js';
export * from './accounts.js';

// ADR-0040 — C4
export * from './agenda.js';

// ADR-0040 — C5
export * from './overview.js';
