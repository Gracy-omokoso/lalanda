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
// ADR-0057 : aperçu d'un projet (santé, avancement, charge, jalons).
export * from './overview.js';
// ADR-0058 : accueil des projets (portefeuille), santé et chiffres.
export * from './portfolio.js';
