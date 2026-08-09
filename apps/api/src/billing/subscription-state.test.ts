// ─────────────────────────────────────────────────────────────────────────────
// MACHINE D'ÉTAT DE L'ABONNEMENT — test EXHAUSTIF (S22b)
//
// Ce test parcourt les 6 × 7 = 42 cases de la matrice `état × événement`, pas
// seulement les cases utiles. C'est la raison d'être du fichier : un test qui
// ne vérifie que les transitions AUTORISÉES ne prouve rien sur les autres, et
// c'est précisément une transition oubliée qui offre un abonnement.
//
// Les cases attendues sont réécrites À LA MAIN ci-dessous plutôt qu'importées
// depuis `TRANSITIONS`. Un test qui lit la table qu'il vérifie est un test qui
// approuve n'importe quelle modification de cette table, y compris
// `suspended → active` sur `trial.started`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  allowedEvents,
  applyEvent,
  canApply,
  grantsPaidAccess,
  InvalidTransitionError,
  INITIAL_STATUS,
  isSubscriptionEvent,
  isSubscriptionStatus,
  nextStatus,
  SUBSCRIPTION_EVENTS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionEvent,
  type SubscriptionStatus,
} from './subscription-state.js';

/**
 * Matrice ATTENDUE, écrite indépendamment de l'implémentation.
 * `null` = transition qui DOIT être refusée.
 */
const ATTENDU: Record<SubscriptionStatus, Record<SubscriptionEvent, SubscriptionStatus | null>> = {
  trialing: {
    'trial.started': null,
    'trial.expired': 'canceled',
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'dunning.exhausted': null,
    'grace.expired': null,
    'subscription.canceled': 'canceled',
  },
  active: {
    'trial.started': null,
    'trial.expired': null,
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'dunning.exhausted': null,
    'grace.expired': null,
    'subscription.canceled': 'canceled',
  },
  past_due: {
    'trial.started': null,
    'trial.expired': null,
    'payment.succeeded': 'active',
    'payment.failed': 'past_due',
    'dunning.exhausted': 'grace',
    'grace.expired': null,
    'subscription.canceled': 'canceled',
  },
  grace: {
    'trial.started': null,
    'trial.expired': null,
    'payment.succeeded': 'active',
    'payment.failed': null,
    'dunning.exhausted': null,
    'grace.expired': 'suspended',
    'subscription.canceled': 'canceled',
  },
  suspended: {
    'trial.started': null,
    'trial.expired': null,
    'payment.succeeded': 'active',
    'payment.failed': null,
    'dunning.exhausted': null,
    'grace.expired': null,
    'subscription.canceled': 'canceled',
  },
  canceled: {
    'trial.started': 'trialing',
    'trial.expired': null,
    'payment.succeeded': 'active',
    'payment.failed': null,
    'dunning.exhausted': null,
    'grace.expired': null,
    'subscription.canceled': null,
  },
};

describe("machine d'état de l'abonnement (S22b)", () => {
  it('couvre les 6 états et les 7 événements de docs/13', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual([
      'trialing',
      'active',
      'past_due',
      'grace',
      'suspended',
      'canceled',
    ]);
    expect(SUBSCRIPTION_EVENTS).toHaveLength(7);
  });

  it('les 42 cases de la matrice se comportent comme déclaré', () => {
    let acceptees = 0;
    let refusees = 0;

    for (const from of SUBSCRIPTION_STATUSES) {
      for (const event of SUBSCRIPTION_EVENTS) {
        const attendu = ATTENDU[from][event];
        const obtenu = nextStatus(from, event) ?? null;
        expect(obtenu, `${from} × ${event}`).toBe(attendu);

        if (attendu === null) {
          refusees += 1;
          expect(canApply(from, event), `${from} × ${event} devrait être refusé`).toBe(false);
          expect(() => applyEvent(from, event)).toThrow(InvalidTransitionError);
        } else {
          acceptees += 1;
          expect(canApply(from, event)).toBe(true);
          expect(applyEvent(from, event)).toBe(attendu);
        }
      }
    }

    // Garde anti-test-vide : si l'introspection cassait, les compteurs le diraient.
    expect(acceptees + refusees).toBe(42);
    expect(acceptees).toBe(18);
  });

  // ── Les refus qui protègent de l'argent ─────────────────────────────────────

  it('un abonnement suspendu ne se réactive JAMAIS sans paiement vérifié', () => {
    for (const event of SUBSCRIPTION_EVENTS) {
      if (event === 'payment.succeeded' || event === 'subscription.canceled') continue;
      expect(canApply('suspended', event), `suspended × ${event}`).toBe(false);
    }
    expect(applyEvent('suspended', 'payment.succeeded')).toBe('active');
  });

  it('une organisation résiliée ne peut pas relancer un second essai', () => {
    // docs/13 § Essai : « une seule période d'essai par organisation ». La
    // machine autorise `canceled → trialing` pour le PREMIER essai ; l'unicité
    // est garantie par `trialStartedAt` côté service (cf. billing.service.ts).
    // Ce test fige l'intention : aucun autre état ne rouvre un essai.
    for (const from of SUBSCRIPTION_STATUSES) {
      if (from === 'canceled') continue;
      expect(canApply(from, 'trial.started'), `${from} × trial.started`).toBe(false);
    }
  });

  it('la grâce ne se réenclenche pas depuis une suspension', () => {
    // La grâce PRÉCÈDE la suspension ; s'y ramener depuis `suspended` offrirait
    // sept jours d'accès payant supplémentaires à chaque impayé.
    expect(canApply('suspended', 'dunning.exhausted')).toBe(false);
    expect(canApply('suspended', 'grace.expired')).toBe(false);
  });

  it('un échec de paiement pendant la grâce ne prolonge rien', () => {
    expect(canApply('grace', 'payment.failed')).toBe(false);
  });

  it('le renouvellement mensuel est une transition vers soi-même', () => {
    expect(applyEvent('active', 'payment.succeeded')).toBe('active');
  });

  // ── Accès payant ────────────────────────────────────────────────────────────

  it("l'accès payant est maintenu pendant l'impayé et coupé après suspension", () => {
    // docs/13 : période de grâce sur échec. Couper au premier échec de carte
    // punirait surtout les clients qui paient — une carte expirée est le motif
    // d'échec numéro un.
    expect(grantsPaidAccess('trialing')).toBe(true);
    expect(grantsPaidAccess('active')).toBe(true);
    expect(grantsPaidAccess('past_due')).toBe(true);
    expect(grantsPaidAccess('grace')).toBe(true);
    expect(grantsPaidAccess('suspended')).toBe(false);
    expect(grantsPaidAccess('canceled')).toBe(false);
  });

  it('tout état est couvert par la décision d’accès payant', () => {
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(typeof grantsPaidAccess(status)).toBe('boolean');
    }
  });

  // ── Utilitaires ─────────────────────────────────────────────────────────────

  it('`allowedEvents` ne propose que des transitions réellement applicables', () => {
    for (const from of SUBSCRIPTION_STATUSES) {
      const proposes = allowedEvents(from);
      for (const event of proposes) {
        expect(canApply(from, event)).toBe(true);
      }
      const attendus = SUBSCRIPTION_EVENTS.filter((e) => ATTENDU[from][e] !== null);
      expect(proposes.sort()).toEqual([...attendus].sort());
    }
  });

  it("l'erreur de transition porte l'état et l'événement fautifs", () => {
    try {
      applyEvent('active', 'trial.started');
      expect.unreachable('la transition aurait dû être refusée');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const typed = error as InvalidTransitionError;
      expect(typed.code).toBe('SUBSCRIPTION_INVALID_TRANSITION');
      expect(typed.from).toBe('active');
      expect(typed.event).toBe('trial.started');
    }
  });

  it("l'état initial conventionnel accepte le démarrage d'essai", () => {
    expect(INITIAL_STATUS).toBe('canceled');
    expect(canApply(INITIAL_STATUS, 'trial.started')).toBe(true);
  });

  it('les gardes de type refusent les valeurs étrangères', () => {
    expect(isSubscriptionStatus('active')).toBe(true);
    expect(isSubscriptionStatus('ACTIVE')).toBe(false);
    expect(isSubscriptionStatus('paid')).toBe(false);
    expect(isSubscriptionStatus(null)).toBe(false);
    expect(isSubscriptionEvent('payment.succeeded')).toBe(true);
    expect(isSubscriptionEvent('invoice.paid')).toBe(false);
  });
});
