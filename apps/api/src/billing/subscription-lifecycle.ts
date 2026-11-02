// ─────────────────────────────────────────────────────────────────────────────
// RÈGLES DÉRIVÉES DE L'ABONNEMENT (S22b) — fonctions pures, zéro Mongoose.
//
// Séparé de `subscription-state.ts` (qui ne connaît que des états et des
// événements) et de `billing.service.ts` (qui connaît la base). Ici vivent les
// règles qui dépendent de l'état ET du temps :
//
//   - quel plan s'applique RÉELLEMENT compte tenu du statut;
//   - quels événements sont ÉCHUS à une date donnée (essai expiré, grâce
//     écoulée, baisse de gamme à appliquer).
//
// Pourquoi des fonctions pures plutôt qu'une tâche planifiée : l'application n'a
// aucun ordonnanceur (pas de `@nestjs/schedule`, pas de worker — ADR-0009, S16a).
// Un essai qui n'expirerait qu'au passage d'un cron inexistant n'expirerait
// jamais. `dueEvents()` est donc appelée À LA LECTURE de l'abonnement : l'état
// est toujours à jour du point de vue de celui qui le consulte, et le balayage
// administratif (`POST /payments/maintenance/sweep`) n'est qu'une optimisation
// pour les organisations que personne ne consulte.
// ─────────────────────────────────────────────────────────────────────────────

import type { Plan } from './entitlements.js';
import { TRIAL_PLAN, type BillingInterval } from './pricing-catalog.js';
import type { SubscriptionEvent, SubscriptionStatus } from './subscription-state.js';

/**
 * Vue minimale d'un abonnement, indépendante de Mongoose.
 * Tous les champs temporels sont optionnels : un document `_schemaVersion: 1`
 * (S16b) n'en porte aucun.
 */
export interface SubscriptionSnapshot {
  plan: Plan;
  status: SubscriptionStatus;
  billingInterval?: BillingInterval | null;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  graceEndsAt?: Date | null;
  pendingPlan?: Plan | null;
  pendingInterval?: BillingInterval | null;
  pendingPlanEffectiveAt?: Date | null;
}

/**
 * Plan RÉELLEMENT applicable.
 *
 * Le plan souscrit ne suffit pas : un `business` suspendu pour impayé doit être
 * traité comme un `free`, sinon la suspension n'a aucun effet. Symétriquement,
 * un `past_due` conserve son plan — c'est la période de grâce de docs/13.
 *
 * L'essai accorde `TRIAL_PLAN` (Pro) quel que soit `plan`, qui vaut encore
 * `free` tant qu'aucune souscription n'a eu lieu.
 */
export function effectivePlan(sub: SubscriptionSnapshot): Plan {
  switch (sub.status) {
    case 'trialing':
      return TRIAL_PLAN;
    case 'active':
    case 'past_due':
    case 'grace':
      return sub.plan;
    case 'suspended':
    case 'canceled':
      // Aucune suppression de données — seulement le retour aux entitlements
      // gratuits (docs/13 § Essai).
      return 'free';
  }
}

/** Jours entiers restants avant `date`, ou `null` si la date est absente. */
export function daysUntil(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  const ms = date.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(Math.ceil(ms / (24 * 60 * 60 * 1000)), 0);
}

/**
 * Événements ÉCHUS à `now`, dans l'ordre où ils doivent être appliqués.
 *
 * Ne renvoie que des transitions déclenchées par le TEMPS. Tout ce qui dépend
 * d'un paiement vient d'un webhook vérifié, jamais d'une horloge.
 *
 * Un seul événement est renvoyé par appel dans le cas général : appliquer
 * `grace.expired` puis relire produira le suivant s'il y en a un. Enchaîner
 * plusieurs transitions en un seul passage rendrait l'historique illisible
 * (« passé de `past_due` à `suspended` », sans trace du `grace` traversé).
 */
export function dueEvents(sub: SubscriptionSnapshot, now: Date): SubscriptionEvent[] {
  const events: SubscriptionEvent[] = [];

  if (sub.status === 'trialing' && sub.trialEndsAt && sub.trialEndsAt.getTime() <= now.getTime()) {
    events.push('trial.expired');
  }

  if (sub.status === 'grace' && sub.graceEndsAt && sub.graceEndsAt.getTime() <= now.getTime()) {
    events.push('grace.expired');
  }

  return events;
}

/**
 * Un changement de plan différé (baisse de gamme) est-il échu ?
 *
 * Séparé de `dueEvents` parce que ce n'est PAS une transition d'état : le
 * statut reste `active`, seul le plan change. Les mélanger obligerait la machine
 * d'état à connaître les plans, ce qu'elle n'a pas à faire.
 */
export function isPendingPlanDue(sub: SubscriptionSnapshot, now: Date): boolean {
  return Boolean(
    sub.pendingPlan &&
    sub.pendingPlanEffectiveAt &&
    sub.pendingPlanEffectiveAt.getTime() <= now.getTime(),
  );
}

/**
 * Cette organisation a-t-elle déjà consommé son essai ?
 * docs/13 § Essai : « une seule période d'essai par organisation ».
 */
export function hasUsedTrial(sub: SubscriptionSnapshot | null): boolean {
  return Boolean(sub?.trialStartedAt);
}

/**
 * Message d'état destiné à l'interface — calculé côté API, jamais recomposé par
 * un composant (docs/26 : aucune règle métier dans l'UI).
 *
 * Les libellés restent volontairement factuels : « votre abonnement est
 * suspendu » et non « votre compte a été bloqué ». Le client n'a rien perdu.
 */
export function statusNotice(
  sub: SubscriptionSnapshot,
  now: Date,
): { level: 'info' | 'warning' | 'critical'; message: string } | null {
  switch (sub.status) {
    case 'trialing': {
      const days = daysUntil(sub.trialEndsAt, now);
      if (days === null) return null;
      return {
        level: days <= 3 ? 'warning' : 'info',
        message:
          days === 0
            ? "Votre essai gratuit se termine aujourd'hui."
            : `Essai gratuit : ${days} jour${days > 1 ? 's' : ''} restant${days > 1 ? 's' : ''}.`,
      };
    }
    case 'past_due':
      return {
        level: 'warning',
        message:
          'Le dernier paiement a échoué. Votre accès est maintenu pendant que nous ' +
          'retentons le prélèvement — vous pouvez mettre à jour votre moyen de paiement.',
      };
    case 'grace': {
      const days = daysUntil(sub.graceEndsAt, now);
      return {
        level: 'critical',
        message:
          days === null
            ? "Paiement en échec : votre accès sera restreint à l'issue de la période de grâce."
            : `Paiement en échec : votre accès sera restreint dans ${days} jour${days > 1 ? 's' : ''}.`,
      };
    }
    case 'suspended':
      return {
        level: 'critical',
        message:
          'Votre abonnement est suspendu faute de paiement. Vos données sont intactes et ' +
          'restent exportables ; les fonctions payantes sont désactivées jusqu’au règlement.',
      };
    case 'canceled':
      return null;
    case 'active':
      return null;
  }
}

// ── ADR-0053 — P3 : octrois manuels (`platform_plan_grants`) ─────────────────────
//
// Un octroi est une offre ACCORDÉE sans paiement, par un opérateur, pour une durée
// facultative. Il ne passe PAS par la machine d'état : il ne simule aucun paiement
// (jamais de `payment.succeeded` sans argent reçu, F4) et ne touche ni au plan souscrit
// ni au statut. Il SE SUPERPOSE à l'abonnement le temps de sa validité, puis s'efface
// seul à son échéance — lu à la lecture, comme l'essai (aucun ordonnanceur, ADR-0009).

/** Événements d'octroi inscrits dans `statusHistory` (statut inchangé, `from === to`). */
export const SUBSCRIPTION_GRANT_EVENTS = ['plan.granted', 'plan.grant_revoked'] as const;
export type SubscriptionGrantEvent = (typeof SUBSCRIPTION_GRANT_EVENTS)[number];

/** Octroi porté par l'abonnement (copie du document `platform_plan_grants` actif). */
export interface SubscriptionGrantSnapshot {
  grantId?: string | null;
  grantPlan?: Plan | null;
  grantStartsAt?: Date | null;
  grantEndsAt?: Date | null;
}

/** Offre accordée et en vigueur à `now`, ou `null` (aucun octroi, pas commencé, échu). */
export function activeGrantPlan(sub: SubscriptionGrantSnapshot, now: Date): Plan | null {
  if (!sub.grantPlan) return null;
  if (sub.grantStartsAt && sub.grantStartsAt.getTime() > now.getTime()) return null;
  if (sub.grantEndsAt && sub.grantEndsAt.getTime() <= now.getTime()) return null;
  return sub.grantPlan;
}

/**
 * Plan applicable à `now`, octroi compris : un octroi en vigueur l'emporte sur l'état
 * de l'abonnement (il est accordé SANS paiement, un impayé ne le suspend donc pas) ; à
 * son échéance, `effectivePlan()` reprend la main sans aucune écriture.
 */
export function effectivePlanAt(
  sub: SubscriptionSnapshot & SubscriptionGrantSnapshot,
  now: Date,
): Plan {
  return activeGrantPlan(sub, now) ?? effectivePlan(sub);
}
