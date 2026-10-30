// `@lalanda/shared/work` — contrats du gestionnaire de projets et de tâches du
// RUN (ADR-0039 § 3). Sous-chemin seulement : rien n'est réexporté par la racine
// du paquet, pour que les consommateurs qui n'en ont pas besoin ne chargent pas
// ces schémas.

export * from './constants.js';
export * from './scheduling.js';
export * from './schemas.js';
export * from './views.js';
// ADR-0045 — H5 : feuille de temps hebdomadaire en lecture (§ 6.3).
export * from './timesheets.js';
