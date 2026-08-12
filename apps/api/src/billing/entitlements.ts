// ─────────────────────────────────────────────────────────────────────────────
// ENTITLEMENTS — ce que l'API applique réellement
//
// Les VALEURS ne sont plus ici : elles vivent dans `@lalanda/shared/pricing`,
// importé aussi par la page tarifs. Ce module reste le point d'entrée des
// consommateurs de l'API (`projects/`, `reports/`, `billing.service.ts`), dont
// aucun n'a besoin de changer d'import.
//
// Ce qui est PROPRE à l'API et vit donc ici : l'antériorité des organisations
// déjà inscrites sous l'ancienne grille (voir plus bas).
//
// Règle de docs/13 rappelée une fois de plus parce qu'elle est le fond du
// sujet : « l'interface peut expliquer une limite, mais l'API l'impose ». Un
// quota contourné en appelant l'API directement n'est pas un quota.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PLAN_ENTITLEMENTS as CATALOG_ENTITLEMENTS,
  PLANS,
  type Entitlements,
  type Plan,
} from '@lalanda/shared/pricing';

export { PLANS, type Entitlements, type Plan };

/** Grille courante — celle de `@lalanda/shared/pricing`. */
export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = CATALOG_ENTITLEMENTS;

/**
 * Version de la grille tarifaire portée par un abonnement.
 *
 * Un abonnement créé AVANT cette version n'a jamais accepté la nouvelle grille :
 * il est servi par `LEGACY_PLAN_ENTITLEMENTS`. Voir `resolveEntitlements`.
 */
export const PRICING_VERSION = 2;

/**
 * ANTÉRIORITÉ — décision ouverte, défaut le moins destructeur.
 *
 * ── Le problème ────────────────────────────────────────────────────────────
 *
 * L'ancienne grille promettait à Pro des « projets illimités ». La nouvelle en
 * accorde 5. Appliquer la nouvelle grille aux abonnés existants retirerait donc
 * une promesse déjà vendue et déjà payée — sur un produit en ligne, à des
 * comptes réels. Le décideur n'a pas tranché entre bascule et antériorité.
 *
 * ── Le défaut implémenté ───────────────────────────────────────────────────
 *
 * Antériorité, parce que c'est le seul des deux choix qui est RÉVERSIBLE : un
 * abonné conservé peut être basculé plus tard par une migration d'une ligne
 * (poser `pricingVersion: PRICING_VERSION`), alors qu'un abonné basculé par
 * erreur a déjà perdu son accès entre-temps.
 *
 * ── Ce que l'antériorité couvre, et ce qu'elle ne couvre pas ───────────────
 *
 * Elle préserve UNIQUEMENT ce qui a été promis : la limite de projets (et le
 * filigrane, et les sièges, identiques par ailleurs). Elle NE crée PAS de droits
 * illimités sur les axes que l'ancienne grille ne mentionnait pas — messages IA
 * et exports PDF n'étaient ni promis, ni comptés, ni facturés. Les servir
 * « illimités » à vie sous couvert d'antériorité serait accorder plus que ce
 * qui a été vendu, et laisser un trou de coût ouvert pour toujours.
 *
 * L'antériorité ne s'applique donc qu'aux organisations qui possèdent DÉJÀ un
 * document d'abonnement. Une organisation sans document (jamais souscrit, jamais
 * essayé) n'a rien à conserver : elle est servie par la grille courante.
 */
export const LEGACY_PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = Object.freeze({
  free: PLAN_ENTITLEMENTS.free,
  // La seule divergence réelle : « projets illimités » était la promesse Pro.
  pro: Object.freeze({ ...PLAN_ENTITLEMENTS.pro, maxProjects: null }),
  cabinet: PLAN_ENTITLEMENTS.cabinet,
  business: PLAN_ENTITLEMENTS.business,
  expert: PLAN_ENTITLEMENTS.expert,
});

/**
 * Limites applicables à une organisation.
 *
 * `pricingVersion` vient du document d'abonnement. `null` ou `undefined` =
 * document antérieur à la nouvelle grille (aucune migration n'a été appliquée,
 * volontairement — voir docs/13).
 */
export function resolveEntitlements(
  plan: Plan,
  pricingVersion: number | null | undefined,
): Entitlements {
  return (pricingVersion ?? 0) >= PRICING_VERSION
    ? PLAN_ENTITLEMENTS[plan]
    : LEGACY_PLAN_ENTITLEMENTS[plan];
}
