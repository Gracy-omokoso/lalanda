// `@lalanda/shared/accounting` — contrats de la comptabilité (ADR-0049 O8).
// Sous-chemin seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0049, zones de conflit) : K0 pose les constantes et les
// briques communes ; K4 à K7 AJOUTENT leurs fichiers (et leur ligne ici), jamais dans
// ceux d'un autre lot.

// ADR-0049 — K0
export * from './constants.js';
export * from './common.js';
