// `@lalanda/shared/platform` — contrats de la console Lalanda (ADR-0053). Sous-chemin
// seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0053, zones de conflit) : P0 pose le catalogue et les
// briques communes ; les lots suivants AJOUTENT leurs fichiers (et leur ligne ici).

// ADR-0053 — P0
export * from './constants.js';
export * from './schemas.js';
// ADR-0053 — P5
export * from './audit.js';
