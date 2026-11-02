// `@lalanda/shared/sales-contracts` — contrats des commandes clients, contrats, avenants,
// acomptes et abonnements (ADR-0050 O9). Sous-chemin seulement : rien n'est réexporté par
// la racine du paquet.
//
// Une ligne d'export par lot (ADR-0050, zones de conflit) : V0 pose les constantes et les
// briques communes ; V2 à V6 AJOUTENT leurs fichiers (et leur ligne ici), jamais dans ceux
// d'un autre lot.

// ADR-0050 — V0
export * from './constants.js';
export * from './common.js';
// ADR-0050 — V6
export * from './agenda.js';
