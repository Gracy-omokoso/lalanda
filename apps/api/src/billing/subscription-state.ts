// ─────────────────────────────────────────────────────────────────────────────
// MACHINE D'ÉTAT DE L'ABONNEMENT (S22b)
// docs/13-PRICING.md § États d'abonnement
//
// Ce fichier — et lui seul — décide « quel état peut succéder à quel état, et
// sous quel événement ». Aucun service ne réécrit `status` directement : tout
// passe par `applyEvent()`. C'est la même discipline que `authz/permissions.ts`
// pour les droits, et que la machine des invitations (S4) : un état représenté
// par une union fermée, des transitions déclarées en table, et un refus par
// défaut de tout ce qui n'y figure pas.
//
// Pourquoi une table explicite plutôt que des `if` dans le service : une
// transition interdite qui « marche quand même » se paie ici en argent réel.
// `suspended → active` sans paiement vérifié, c'est un abonnement Business
// offert. La table est donc exhaustive, et le test la parcourt EN ENTIER —
// chaque case absente est vérifiée comme refusée, pas seulement les cases
// présentes comme acceptées.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les six états de docs/13.
 *
 * - `trialing`   — essai 14 jours en cours, sans carte (docs/13 § Essai).
 * - `active`     — abonnement payé et à jour.
 * - `past_due`   — un paiement a échoué ; le fournisseur retente. Accès INTACT :
 *                  une carte expirée n'est pas une résiliation.
 * - `grace`      — les tentatives sont épuisées. Accès encore intact, compte à
 *                  rebours affiché. Dernier avertissement avant restriction.
 * - `suspended`  — accès ramené aux entitlements gratuits. AUCUNE suppression de
 *                  données (docs/13 § Essai : « aucune suppression immédiate »).
 * - `canceled`   — abonnement clos (essai expiré, résiliation, échec définitif).
 *                  Plan effectif `free`, données conservées.
 */
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace',
  'suspended',
  'canceled',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * Les événements qui font bouger l'abonnement.
 *
 * Ils sont nommés en termes MÉTIER, jamais en termes de fournisseur :
 * `invoice.payment_failed` (Stripe) et `PAYMENT.SALE.DENIED` (PayPal) se
 * traduisent tous deux en `payment.failed`. C'est ce qui permet d'ajouter un
 * fournisseur sans toucher à la machine — et de la tester sans aucun réseau.
 */
export const SUBSCRIPTION_EVENTS = [
  /** Démarrage de l'essai gratuit (docs/13 : 14 jours, une seule fois par org). */
  'trial.started',
  /** L'essai est arrivé à échéance sans paiement → retour au plan gratuit. */
  'trial.expired',
  /** Paiement vérifié reçu (première souscription, renouvellement, reprise). */
  'payment.succeeded',
  /** Échec de paiement signalé par le fournisseur. */
  'payment.failed',
  /** Le fournisseur a épuisé ses tentatives → période de grâce. */
  'dunning.exhausted',
  /** La période de grâce est écoulée → suspension. */
  'grace.expired',
  /** Résiliation, demandée par le client ou définitive côté fournisseur. */
  'subscription.canceled',
] as const;

export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENTS)[number];

export function isSubscriptionEvent(value: unknown): value is SubscriptionEvent {
  return typeof value === 'string' && (SUBSCRIPTION_EVENTS as readonly string[]).includes(value);
}

/**
 * État de départ conventionnel d'une organisation qui n'a AUCUN document
 * `subscriptions`. Ce n'est pas un état stocké : c'est la valeur passée à
 * `applyEvent` lors du tout premier événement.
 */
export const INITIAL_STATUS = 'canceled' satisfies SubscriptionStatus;

/**
 * Table des transitions : `from → event → to`.
 *
 * Exhaustive par construction (`Record<SubscriptionStatus, …>` : oublier un état
 * ne compile pas). Un événement absent de la ligne d'un état est REFUSÉ — c'est
 * le refus par défaut.
 *
 * Les choix qui méritent une justification :
 *
 * - `trialing → past_due` EXISTE. L'essai est sans carte (docs/13), mais rien
 *   n'interdit à un client d'enregistrer un moyen de paiement pendant l'essai ;
 *   le fournisseur émet alors un échec à l'échéance. L'ignorer laisserait un
 *   abonnement bloqué en `trialing` indéfiniment.
 * - `canceled → active` EXISTE (docs/13 § Changements de plan : « annulation et
 *   reprise documentées »). Mais uniquement sur `payment.succeeded` : on ne
 *   ressuscite jamais un abonnement sans paiement vérifié.
 * - `canceled → trialing` N'EXISTE PAS. docs/13 § Essai : « une seule période
 *   d'essai par organisation ». Un second essai s'obtiendrait sinon en
 *   résiliant, ce qui est exactement la fraude que la règle vise.
 * - `suspended → grace` N'EXISTE PAS : la grâce précède la suspension, elle ne
 *   la répare pas. Seul un paiement sort de `suspended`.
 * - `active → active` sur `payment.succeeded` EXISTE : c'est le renouvellement
 *   mensuel normal. Une transition vers soi-même reste une transition — elle
 *   met à jour la période courante.
 */
export const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, Partial<Record<SubscriptionEvent, SubscriptionStatus>>>
> = {
  trialing: {
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'trial.expired': 'canceled',
    'subscription.canceled': 'canceled',
  },
  active: {
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'subscription.canceled': 'canceled',
  },
  past_due: {
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'dunning.exhausted': 'grace',
    'subscription.canceled': 'canceled',
  },
  grace: {
    'payment.succeeded': 'active',
    'grace.expired': 'suspended',
    'subscription.canceled': 'canceled',
  },
  suspended: {
    'payment.succeeded': 'active',
    'subscription.canceled': 'canceled',
  },
  canceled: {
    // Reprise après résiliation — paiement vérifié exigé, jamais un simple clic.
    'payment.succeeded': 'active',
    // Premier essai d'une organisation : `canceled` est l'état conventionnel de
    // départ (INITIAL_STATUS). L'unicité de l'essai n'est PAS garantie ici — la
    // machine ne connaît pas l'historique ; elle l'est par `trialStartedAt`
    // côté service (voir `BillingService.startTrial`).
    'trial.started': 'trialing',
  },
};

/** Erreur levée par `applyEvent` sur une transition non déclarée. */
export class InvalidTransitionError extends Error {
  readonly code = 'SUBSCRIPTION_INVALID_TRANSITION';

  constructor(
    readonly from: SubscriptionStatus,
    readonly event: SubscriptionEvent,
  ) {
    super(`Transition interdite : « ${from} » ne réagit pas à « ${event} ».`);
    this.name = 'InvalidTransitionError';
  }
}

/** L'événement est-il accepté depuis cet état ? */
export function canApply(from: SubscriptionStatus, event: SubscriptionEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/**
 * État résultant, ou `undefined` si la transition n'est pas déclarée.
 * Forme non levante, utile aux vues et aux tests exhaustifs.
 */
export function nextStatus(
  from: SubscriptionStatus,
  event: SubscriptionEvent,
): SubscriptionStatus | undefined {
  return TRANSITIONS[from][event];
}

/**
 * Applique un événement. Lève `InvalidTransitionError` si la transition n'est
 * pas déclarée — jamais de repli silencieux sur l'état courant : un webhook qui
 * arrive dans le mauvais ordre doit être visible, pas absorbé.
 */
export function applyEvent(from: SubscriptionStatus, event: SubscriptionEvent): SubscriptionStatus {
  const to = nextStatus(from, event);
  if (to === undefined) throw new InvalidTransitionError(from, event);
  return to;
}

/**
 * Événements acceptés depuis un état — utilisé par la vue d'abonnement pour ne
 * proposer que des actions réalisables (l'UI explique, l'API impose).
 */
export function allowedEvents(from: SubscriptionStatus): SubscriptionEvent[] {
  return SUBSCRIPTION_EVENTS.filter((e) => canApply(from, e));
}

/**
 * L'abonnement donne-t-il accès aux fonctions payantes ?
 *
 * `past_due` et `grace` répondent OUI : c'est la « période de grâce sur échec de
 * paiement » de docs/13. Couper l'accès au premier échec de carte punit surtout
 * les clients qui paient — et une carte expirée est le motif d'échec n°1.
 */
export function grantsPaidAccess(status: SubscriptionStatus): boolean {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'grace':
      return true;
    case 'suspended':
    case 'canceled':
      return false;
  }
}
