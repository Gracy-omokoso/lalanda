// ─────────────────────────────────────────────────────────────────────────────
// LIMITE DE PROJETS — la règle, et surtout ce qu'elle NE fait pas
//
// ── Le cas qui a motivé ce module ────────────────────────────────────────────
//
// La grille est passée de trois à cinq offres et le décideur a tranché : aucune
// antériorité. Une organisation de production détient 5 projets alors que
// l'offre gratuite en autorise 1. Elle est donc AU-DESSUS de sa limite sans
// avoir rien fait.
//
// ── La règle non négociable ──────────────────────────────────────────────────
//
// Un dépassement constaté sur des données existantes ne détruit rien et ne cache
// rien. Ces 5 projets sont de vrais plans financiers, possiblement des dossiers
// bancaires en cours :
//
//   ✓ ils restent LISIBLES, EXPORTABLES et MODIFIABLES — aucun chemin de lecture
//     ne consulte cette limite, et c'est vérifié par un test;
//   ✓ la CRÉATION d'un projet de plus est refusée;
//   ✓ le refus DIT combien l'organisation en a, combien son offre autorise, et
//     ce qu'elle peut faire.
//
// Supprimer, archiver d'office ou rendre inaccessible un plan financier parce
// qu'une grille tarifaire a changé serait une faute. La limite s'applique aux
// gestes futurs, pas au patrimoine déjà là. C'est aussi la position de docs/13 §
// Changements de plan : « aucune suppression automatique de projet ».
// ─────────────────────────────────────────────────────────────────────────────

import { PLAN_CATALOG, PLANS, isSelfServePlan, type Plan } from '@lalanda/shared/pricing';

import type { Entitlements } from './entitlements.js';

/** Code d'erreur du refus à la création (inchangé depuis S16b). */
export const PROJECT_LIMIT_ERROR_CODE = 'PLAN_LIMIT_PROJECTS' as const;

/** Identifiant du quota, pour qu'une interface distingue les refus sans lire le français. */
export const PROJECTS_QUOTA = 'projects' as const;

export interface ProjectLimitStatus {
  plan: Plan;
  /** Projets autorisés. `null` = illimité. */
  limit: number | null;
  /** Projets détenus aujourd'hui. */
  used: number;
  /** Projets créables encore. `null` = illimité. */
  remaining: number | null;
  unlimited: boolean;
  /** La création d'un projet supplémentaire est-elle refusée ? */
  blocked: boolean;
  /**
   * L'organisation détient-elle PLUS que sa limite ?
   *
   * Distinct de `blocked` : être PILE à la limite bloque la création sans être un
   * dépassement. Les deux méritent des mots différents — « vous avez atteint
   * votre limite » et « vous êtes au-dessus de votre limite » ne décrivent pas la
   * même situation, et la seconde n'est pas la faute de l'utilisateur.
   */
  overLimit: boolean;
  /** Projets détenus au-delà de la limite. 0 si aucun dépassement. */
  excess: number;
}

export function projectLimitStatus(
  plan: Plan,
  entitlements: Entitlements,
  used: number,
): ProjectLimitStatus {
  const limit = entitlements.maxProjects;
  const unlimited = limit === null;
  const safeUsed = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  return {
    plan,
    limit,
    used: safeUsed,
    remaining: unlimited ? null : Math.max(limit - safeUsed, 0),
    unlimited,
    blocked: unlimited ? false : safeUsed >= limit,
    overLimit: unlimited ? false : safeUsed > limit,
    excess: unlimited ? 0 : Math.max(safeUsed - limit, 0),
  };
}

/**
 * L'offre la MOINS CHÈRE, souscriptible en ligne, qui couvrirait `needed` projets.
 *
 * Proposer « passez à Business » à qui a besoin d'un sixième projet serait une
 * vente forcée : Cabinet suffit. `null` si aucune offre en libre-service ne
 * couvre le besoin — le cas se produit au-delà des offres publiées, et la
 * réponse est alors « nous contacter », pas un palier inventé.
 *
 * `PLANS` est ordonné du moins au plus riche, et le prix croît avec le rang :
 * le premier qui couvre est donc le moins cher.
 */
export function cheapestPlanFor(needed: number): Plan | null {
  return (
    PLANS.find((p) => {
      if (!isSelfServePlan(p)) return false;
      const max = PLAN_CATALOG[p].entitlements.maxProjects;
      return max === null || max >= needed;
    }) ?? null
  );
}

/** Corps du refus opposé à la création d'un projet. */
export interface ProjectLimitExceededPayload {
  code: typeof PROJECT_LIMIT_ERROR_CODE;
  quota: typeof PROJECTS_QUOTA;
  plan: Plan;
  limit: number;
  used: number;
  /** Projets détenus au-delà de la limite (0 si l'organisation est pile dessus). */
  excess: number;
  /** Offre la moins chère qui couvrirait le projet demandé, ou `null`. */
  suggestedPlan: Plan | null;
  message: string;
  upgradeUrl: string;
}

/**
 * Construit le refus.
 *
 * Deux messages, parce que ce sont deux situations :
 *
 * - PILE À LA LIMITE — l'utilisateur a consommé ce qu'il a acheté. Le message
 *   constate et propose.
 * - AU-DESSUS — l'organisation détient plus que ce que l'offre autorise, sans
 *   avoir rien fait de mal : la grille a changé sous ses pieds. Le message le
 *   dit, rassure explicitement sur le fait que RIEN n'est perdu ni bloqué en
 *   lecture, et laisse le choix entre monter en gamme et supprimer soi-même.
 *   Taire le dépassement laisserait l'utilisateur devant un bouton « Nouveau
 *   projet » qui refuse sans raison compréhensible.
 */
export function projectLimitExceededPayload(
  status: ProjectLimitStatus,
): ProjectLimitExceededPayload {
  if (status.limit === null) {
    throw new Error('projectLimitExceededPayload appelé sur une offre sans limite de projets.');
  }

  const offre = PLAN_CATALOG[status.plan].name;
  const suggestedPlan = cheapestPlanFor(status.used + 1);
  const suggestion =
    suggestedPlan === null
      ? 'Contactez-nous pour une offre adaptée à ce volume.'
      : `Passez à l'offre ${PLAN_CATALOG[suggestedPlan].name} pour en créer davantage`;

  const message = status.overLimit
    ? `Votre organisation compte ${status.used} projets, alors que l'offre ${offre} en ` +
      `autorise ${status.limit}. Vos ${status.used} projets restent accessibles, modifiables ` +
      `et exportables — rien n'a été supprimé. Seule la création d'un nouveau projet est ` +
      `suspendue. ${suggestion}${suggestedPlan === null ? '' : ', ou supprimez un projet existant.'}`
    : `Votre organisation compte ${status.used} projet${status.used > 1 ? 's' : ''}, soit la ` +
      `totalité des ${status.limit} inclus dans l'offre ${offre}. ` +
      `${suggestion}${suggestedPlan === null ? '' : ', ou supprimez un projet existant.'}`;

  return {
    code: PROJECT_LIMIT_ERROR_CODE,
    quota: PROJECTS_QUOTA,
    plan: status.plan,
    limit: status.limit,
    used: status.used,
    excess: status.excess,
    suggestedPlan,
    message,
    upgradeUrl: '/pricing',
  };
}
