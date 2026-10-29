// Marge par projet du RUN (ADR-0039 § 5) — point d'entrée du module.
// Versionné à part (`WORK_MARGIN_VERSION`) ; ne touche aucun calcul de plan.

export * from './types.js';
export { computeProjectMargin } from './margin.js';
