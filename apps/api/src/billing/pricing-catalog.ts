// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE TARIFAIRE CÔTÉ API
//
// Les MONTANTS ne sont plus ici : ils vivent dans `@lalanda/shared/pricing`,
// importé aussi par la page tarifs et par le tunnel de souscription. Ce fichier
// n'est plus qu'un point de réexport, conservé pour que les modules qui en
// dépendent (`billing.service.ts`, `payments/`, `subscription.schema.ts`)
// n'aient pas à changer d'import.
//
// Deux règles que le catalogue partagé applique littéralement, rappelées ici
// parce que c'est ce fichier qu'on ouvre en cherchant « où sont les prix » :
//
// 1. AUCUN PRIX INVENTÉ. CLAUDE.md : « ne pas inventer de règle […] commerciale ».
//    L'offre Expert n'a aucun montant publié — elle inclut du temps d'expert
//    humain, chiffré au cas par cas. `priceCents()` répond `null`, `isSellable()`
//    répond `false`, et l'API refuse toute souscription (`PLAN_NOT_SELLABLE`).
//
// 2. TOUT EN CENTIMES ENTIERS. Aucun flottant ne traverse une facture.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BILLING_CURRENCY,
  BILLING_INTERVALS,
  GRACE_DAYS,
  hasAnnualOffer,
  intervalDays,
  isBillingInterval,
  isSelfServePlan,
  isSellable,
  PLAN_PRICES,
  planRank,
  priceCents,
  SELF_SERVE_PLANS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type BillingCurrency,
  type BillingInterval,
  type PlanPrice,
} from '@lalanda/shared/pricing';

export {
  BILLING_CURRENCY,
  BILLING_INTERVALS,
  GRACE_DAYS,
  hasAnnualOffer,
  intervalDays,
  isBillingInterval,
  isSelfServePlan,
  isSellable,
  PLAN_PRICES,
  planRank,
  priceCents,
  TRIAL_DAYS,
  TRIAL_PLAN,
  type BillingCurrency,
  type BillingInterval,
  type PlanPrice,
};

/**
 * Plans réellement souscriptibles EN LIGNE.
 *
 * Ancien nom `PAID_PLANS`, renommé pour dire ce qu'il fait vraiment : Expert est
 * une offre payante qui n'est PAS dans cette liste, parce qu'elle ne se souscrit
 * pas sans accord commercial. « payant » et « vendable en un clic » ne sont pas
 * la même chose, et les confondre est précisément ce qui met un bouton de
 * paiement sous une prestation humaine.
 */
export const SELLABLE_PLANS = SELF_SERVE_PLANS;

/** Rétrocompatibilité de nommage — même liste, même sémantique de vente. */
export const PAID_PLANS = SELF_SERVE_PLANS;

/** Cette offre se souscrit-elle en libre-service ? */
export function isPaidPlan(plan: Parameters<typeof isSelfServePlan>[0]): boolean {
  return isSelfServePlan(plan);
}
