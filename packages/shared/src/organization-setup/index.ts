// `@lalanda/shared/organization-setup` — statut de complétude de la mise en route d'une
// société (ADR-0052 § 3). Sous-chemin seulement : rien n'est réexporté par la racine du
// paquet.
//
// Une ligne d'export par lot (ADR-0052, zones de conflit) : O0 pose le contrat de lecture ;
// les lots suivants AJOUTENT leurs fichiers (et leur ligne ici).

// ADR-0052 — O0
export * from './constants.js';
export * from './schemas.js';
// ADR-0052 — O2/O3
export * from './declarations.js';
