// `@lalanda/shared/assets` — contrats des équipements (ADR-0046 O8).
// Sous-chemin seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0046, zones de conflit) : S0 pose les constantes et les
// briques communes ; S5 et S7 AJOUTENT leurs fichiers (et leur ligne ici), jamais dans ceux
// d'un autre lot.

// ADR-0046 — S0
export * from './constants.js';
export * from './common.js';
// ADR-0046 — S5
export * from './registry.js';
export * from './views.js';
// ADR-0046 — S7
export * from './agenda.js';
