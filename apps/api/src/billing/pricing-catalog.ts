// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE TARIFAIRE (S22b)
//
// Source de vérité des MONTANTS. Comme pour `entitlements.ts`, la promesse
// publique fait foi : `apps/web/src/app/(marketing)/pricing/page.tsx` annonce
// Free 0, Pro 9 USD/mois ou 90 USD/an, Business 49 USD/mois.
//
// Deux règles que ce fichier applique littéralement :
//
// 1. AUCUN PRIX INVENTÉ. CLAUDE.md : « ne pas inventer de règle […] commerciale ».
//    La page publique ne donne PAS de tarif annuel pour Business : le champ vaut
//    donc `null`, l'API refuse un abonnement annuel Business, et l'interface ne
//    propose pas la bascule. Un « 490 USD/an » plausible serait un engagement
//    commercial pris par un développeur. La divergence est remontée au décideur
//    dans docs/13 § Rentabilité, pas comblée ici.
//
// 2. TOUT EN CENTIMES ENTIERS. Aucun flottant ne traverse une facture : 9.99 * 100
//    vaut 998.9999999999999 en IEEE-754. Le moteur financier a la même règle
//    (docs/21) ; il n'y a pas de raison qu'une facture soit moins rigoureuse
//    qu'une projection.
// ─────────────────────────────────────────────────────────────────────────────

import { PLANS, type Plan } from './entitlements.js';

/** Périodicités de facturation proposées (docs/13 : « mensuel ou annuel »). */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);
}

/**
 * Devise de facturation. USD uniquement à ce stade — la page publique annonce
 * « Facturation en USD ». Le CDF impliquerait un taux de change daté et une
 * politique de conversion : c'est une décision commerciale, pas un paramètre.
 */
export const BILLING_CURRENCY = 'USD' as const;
export type BillingCurrency = typeof BILLING_CURRENCY;

export interface PlanPrice {
  /** Prix mensuel en centimes USD. */
  readonly monthCents: number;
  /** Prix annuel en centimes USD, ou `null` si l'offre annuelle n'existe pas. */
  readonly yearCents: number | null;
}

export const PLAN_PRICES: Readonly<Record<Plan, PlanPrice>> = {
  free: { monthCents: 0, yearCents: 0 },
  // « 9 USD / mois », « ou 90 USD / an » — page /pricing.
  pro: { monthCents: 900, yearCents: 9000 },
  // « 49 USD / mois ». Pas d'annuel publié → pas d'annuel vendu.
  business: { monthCents: 4900, yearCents: null },
};

/** Plans réellement souscriptibles (`free` n'est pas un achat). */
export const PAID_PLANS: readonly Plan[] = PLANS.filter((p) => p !== 'free');

export function isPaidPlan(plan: Plan): boolean {
  return PAID_PLANS.includes(plan);
}

/**
 * Prix d'un couple (plan, périodicité), ou `null` si ce couple n'est pas
 * commercialisé. `null` doit être traité comme un refus, jamais comme 0.
 */
export function priceCents(plan: Plan, interval: BillingInterval): number | null {
  const price = PLAN_PRICES[plan];
  return interval === 'month' ? price.monthCents : price.yearCents;
}

/** Ce couple (plan, périodicité) est-il vendable ? */
export function isSellable(plan: Plan, interval: BillingInterval): boolean {
  return isPaidPlan(plan) && priceCents(plan, interval) !== null;
}

/** Durée d'une période de facturation, en jours. */
export function intervalDays(interval: BillingInterval): number {
  return interval === 'month' ? 30 : 365;
}

/**
 * Rang commercial des plans — sert à distinguer une MONTÉE en gamme (prorata
 * immédiat) d'une BAISSE (effet à l'échéance), docs/13 § Changements de plan.
 *
 * Volontairement dérivé du prix mensuel et non écrit à la main : deux sources de
 * vérité pour « lequel est le plus cher » finiraient par diverger.
 */
export function planRank(plan: Plan): number {
  return PLAN_PRICES[plan].monthCents;
}

/**
 * Plan accordé pendant l'essai de 14 jours.
 *
 * `pro` et non `business` : docs/13 § Essai demande un « accès fonctionnel
 * généreux mais quotas raisonnables ». Pro lève la limite de projets et le
 * filigrane — c'est-à-dire tout ce qui fait la valeur perçue — sans offrir les
 * 20 sièges de Business, qui transformeraient l'essai en licence d'équipe
 * gratuite pendant deux semaines.
 */
export const TRIAL_PLAN: Plan = 'pro';

/** Durée de l'essai en jours (docs/13 : « 14 jours calendaires »). */
export const TRIAL_DAYS = 14;

/**
 * Durée de la période de grâce après épuisement des tentatives de paiement.
 *
 * 7 jours : assez pour qu'un client en déplacement remplace une carte, assez
 * court pour que l'impayé ne devienne pas un abonnement gratuit. docs/13 laisse
 * la durée « à définir » — cette valeur est donc un DÉFAUT d'implémentation,
 * explicitement remonté au décideur dans docs/13 § Implémenté (S22b).
 */
export const GRACE_DAYS = 7;
