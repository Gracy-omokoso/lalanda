// `@lalanda/shared/purchases` — contrats des achats et fournisseurs (ADR-0044 O7).
// Sous-chemin seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0044, zones de conflit) : P0 pose les constantes,
// les briques communes et les fournisseurs ; P3 à P6 AJOUTENT leurs fichiers (et leur
// ligne ici), jamais dans ceux d'un autre lot.

// ADR-0044 — P0
export * from './constants.js';
export * from './common.js';
export * from './suppliers.js';
// ADR-0044 — P3
export * from './orders.js';
export * from './settings.js';
export * from './agenda.js';
// ADR-0044 — P4
export * from './receptions.js';
export * from './invoices.js';
