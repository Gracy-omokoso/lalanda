// `@lalanda/shared/hr` — contrats des ressources humaines (ADR-0045 O7).
// Sous-chemin seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0045, zones de conflit) : H0 pose les constantes et
// les briques communes ; H2 à H5 AJOUTENT leurs fichiers (et leur ligne ici), jamais
// dans ceux d'un autre lot.

// ADR-0045 — H0
export * from './constants.js';
export * from './common.js';
