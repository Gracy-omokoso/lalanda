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
// ADR-0060 : membres d'un projet (utilisateurs et équipes), visibilité.
export * from './members.js';
// ADR-0061 : comportement des projets, préférences de notification, couleurs des cartes.
export * from './behavior.js';
export * from './notification-preferences.js';
export * from './card-colors.js';
// ADR-0062 / ADR-0063 : plan de projet commun à l'import de fichier et à l'IA.
export * from './plan.js';
// ADR-0064 : notifications des Projets par Slack (connexion, canal d'un projet).
export * from './slack.js';
