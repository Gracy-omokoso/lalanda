// ─────────────────────────────────────────────────────────────────────────────
// ENTITLEMENTS — ce que l'API applique réellement
//
// Les VALEURS ne sont pas ici : elles vivent dans `@lalanda/shared/pricing`,
// importé aussi par la page tarifs. Ce module est le point d'entrée des
// consommateurs de l'API (`projects/`, `reports/`, `ai/`, `billing.service.ts`),
// dont aucun n'a besoin de connaître le catalogue partagé.
//
// Règle de docs/13, qui est le fond du sujet : « l'interface peut expliquer une
// limite, mais l'API l'impose ». Un quota contourné en appelant l'API
// directement n'est pas un quota.
//
// ── ANTÉRIORITÉ : ARBITRÉE, ET IL N'Y EN A PAS ───────────────────────────────
//
// La question a été posée au décideur : les comptes déjà inscrits sous l'ancienne
// grille (« projets illimités en Pro ») passent-ils aux nouvelles limites, ou
// gardent-ils leurs droits ? **Décision : tous les comptes passent aux nouvelles
// limites. Aucune antériorité.**
//
// Il n'existe donc PAS de seconde grille dans ce fichier, et c'est délibéré : un
// `LEGACY_PLAN_ENTITLEMENTS` conservé « au cas où » serait une branche que rien
// n'emprunte, que personne ne teste, et qu'un lecteur croirait active.
// `PLAN_ENTITLEMENTS` est la seule grille, appliquée à tout le monde.
//
// ── CE QUE LA DÉCISION IMPLIQUE, ET QUI EST TRAITÉ AILLEURS ──────────────────
//
// Une organisation peut se retrouver AU-DESSUS de sa limite du jour au
// lendemain : en production, une organisation détient 5 projets alors que l'offre
// gratuite en autorise 1. La limite s'applique alors aux GESTES FUTURS, jamais au
// patrimoine déjà là :
//
//   · les 5 projets restent lisibles, exportables et modifiables;
//   · la CRÉATION d'un sixième est refusée, avec un message qui dit combien
//     l'organisation en a, combien son offre autorise, et quoi faire;
//   · rien n'est supprimé, archivé d'office ni rendu inaccessible.
//
// Voir `apps/api/src/projects/projects.controller.ts` (refus à la création) et
// `apps/api/src/organization-space/dashboard.ts` (`depassements()`, qui rend le
// dépassement LISIBLE au lieu de le laisser surprendre l'utilisateur).
// ─────────────────────────────────────────────────────────────────────────────

import {
  PLAN_ENTITLEMENTS as CATALOG_ENTITLEMENTS,
  PLANS,
  type Entitlements,
  type Plan,
} from '@lalanda/shared/pricing';

export { PLANS, type Entitlements, type Plan };

/** LA grille, appliquée à toutes les organisations sans exception. */
export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = CATALOG_ENTITLEMENTS;

/**
 * Limites applicables à une organisation.
 *
 * Fonction d'une ligne, conservée comme POINT DE PASSAGE unique : le jour où une
 * grille change à nouveau, la question de l'antériorité se posera ici et nulle
 * part ailleurs. Les appelants n'ont pas à savoir qu'elle a été posée une fois.
 */
export function resolveEntitlements(plan: Plan): Entitlements {
  return PLAN_ENTITLEMENTS[plan];
}
