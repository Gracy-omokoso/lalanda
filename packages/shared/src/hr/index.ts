// `@lalanda/shared/hr` — contrats des ressources humaines (ADR-0045 O7).
// Sous-chemin seulement : rien n'est réexporté par la racine du paquet.
//
// Une ligne d'export par lot (ADR-0045, zones de conflit) : H0 pose les constantes et
// les briques communes ; H2 à H5 AJOUTENT leurs fichiers (et leur ligne ici), jamais
// dans ceux d'un autre lot.

// ADR-0045 — H0
export * from './constants.js';
export * from './common.js';

// ADR-0045 — H2 (dossiers, services, organigramme, données sensibles)
export * from './employees.js';

// ADR-0045 — H3 (absences, congés, fériés, calendrier, réglages en écriture, « Mes tâches »)
export * from './leave.js';

// ADR-0045 — H5 (rapports, registre exporté)
export * from './reports.js';
// ADR-0045 — H4 (documents, listes d'entrée et de sortie, échéances)
export * from './documents.js';
