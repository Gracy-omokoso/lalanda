// Règles dérivées de l'abonnement (S22b) — plan effectif, échéances, messages.
//
// Toutes fonctions pures : ce fichier n'ouvre ni base ni réseau et fixe
// l'horloge, condition pour que « l'essai expire » soit un test et non un pari.

import { describe, expect, it } from 'vitest';

import { TRIAL_PLAN } from './pricing-catalog.js';
import { addDays } from './proration.js';
import {
  daysUntil,
  dueEvents,
  effectivePlan,
  hasUsedTrial,
  isPendingPlanDue,
  statusNotice,
  type SubscriptionSnapshot,
} from './subscription-lifecycle.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');

function snapshot(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return { plan: 'pro', status: 'active', ...over };
}

describe('plan effectif', () => {
  it("l'essai accorde le plan d'essai, quel que soit le plan souscrit", () => {
    expect(effectivePlan(snapshot({ plan: 'free', status: 'trialing' }))).toBe(TRIAL_PLAN);
  });

  it("l'impayé et la grâce conservent le plan payé", () => {
    expect(effectivePlan(snapshot({ plan: 'business', status: 'past_due' }))).toBe('business');
    expect(effectivePlan(snapshot({ plan: 'business', status: 'grace' }))).toBe('business');
  });

  it('la suspension et la résiliation ramènent au gratuit, sans rien supprimer', () => {
    // docs/13 § Essai : « aucune suppression immédiate ». Seuls les
    // entitlements changent — c'est tout ce que cette fonction décide.
    expect(effectivePlan(snapshot({ plan: 'business', status: 'suspended' }))).toBe('free');
    expect(effectivePlan(snapshot({ plan: 'business', status: 'canceled' }))).toBe('free');
  });

  it("un business suspendu n'a plus de plan payant effectif", () => {
    const sub = snapshot({ plan: 'business', status: 'suspended' });
    expect(effectivePlan(sub)).not.toBe('business');
  });
});

describe('événements échus', () => {
  it('un essai arrivé à terme produit `trial.expired`', () => {
    const sub = snapshot({ status: 'trialing', trialEndsAt: addDays(NOW, -1) });
    expect(dueEvents(sub, NOW)).toEqual(['trial.expired']);
  });

  it('un essai encore en cours ne produit rien', () => {
    const sub = snapshot({ status: 'trialing', trialEndsAt: addDays(NOW, 3) });
    expect(dueEvents(sub, NOW)).toEqual([]);
  });

  it("l'essai expire à la seconde exacte de l'échéance, pas après", () => {
    // `<=` et non `<` : à l'instant pile, l'essai est terminé. Un `<` laisserait
    // une fenêtre d'une milliseconde, sans conséquence pratique mais qui rend le
    // test dépendant de l'ordonnancement.
    const sub = snapshot({ status: 'trialing', trialEndsAt: NOW });
    expect(dueEvents(sub, NOW)).toEqual(['trial.expired']);
  });

  it('une grâce écoulée produit `grace.expired`', () => {
    const sub = snapshot({ status: 'grace', graceEndsAt: addDays(NOW, -1) });
    expect(dueEvents(sub, NOW)).toEqual(['grace.expired']);
  });

  it('un abonnement actif ne produit aucun événement temporel', () => {
    // Le renouvellement vient d'un webhook vérifié, jamais d'une horloge : une
    // horloge qui prolongerait la période créerait des abonnements gratuits.
    expect(
      dueEvents(snapshot({ status: 'active', currentPeriodEnd: addDays(NOW, -5) }), NOW),
    ).toEqual([]);
  });

  it("un essai sans date d'échéance ne se termine pas tout seul", () => {
    expect(dueEvents(snapshot({ status: 'trialing', trialEndsAt: null }), NOW)).toEqual([]);
  });
});

describe('changement de plan différé', () => {
  it('est échu quand la date est atteinte', () => {
    const sub = snapshot({ pendingPlan: 'free', pendingPlanEffectiveAt: addDays(NOW, -1) });
    expect(isPendingPlanDue(sub, NOW)).toBe(true);
  });

  it("n'est pas échu avant la date", () => {
    const sub = snapshot({ pendingPlan: 'free', pendingPlanEffectiveAt: addDays(NOW, 2) });
    expect(isPendingPlanDue(sub, NOW)).toBe(false);
  });

  it('une date sans plan en attente ne déclenche rien', () => {
    const sub = snapshot({ pendingPlan: null, pendingPlanEffectiveAt: addDays(NOW, -5) });
    expect(isPendingPlanDue(sub, NOW)).toBe(false);
  });
});

describe('essai déjà consommé', () => {
  it('dépend de `trialStartedAt`, qui ne redevient jamais nul', () => {
    expect(hasUsedTrial(null)).toBe(false);
    expect(hasUsedTrial(snapshot({ trialStartedAt: null }))).toBe(false);
    // Résilié APRÈS un essai : l'essai reste consommé (docs/13 § Essai).
    expect(hasUsedTrial(snapshot({ status: 'canceled', trialStartedAt: addDays(NOW, -30) }))).toBe(
      true,
    );
  });
});

describe('jours restants', () => {
  it('arrondit vers le haut et ne descend jamais sous zéro', () => {
    expect(daysUntil(addDays(NOW, 3), NOW)).toBe(3);
    expect(daysUntil(new Date(NOW.getTime() + 90_000), NOW)).toBe(1);
    expect(daysUntil(addDays(NOW, -5), NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe("message d'état", () => {
  it("passe en avertissement dans les trois derniers jours d'essai", () => {
    const large = statusNotice(
      snapshot({ status: 'trialing', trialEndsAt: addDays(NOW, 10) }),
      NOW,
    );
    expect(large?.level).toBe('info');
    const serre = statusNotice(snapshot({ status: 'trialing', trialEndsAt: addDays(NOW, 2) }), NOW);
    expect(serre?.level).toBe('warning');
  });

  it("un impayé dit que l'accès est MAINTENU", () => {
    const notice = statusNotice(snapshot({ status: 'past_due' }), NOW);
    expect(notice?.level).toBe('warning');
    expect(notice?.message).toMatch(/maintenu/i);
  });

  it('une suspension dit que les données sont intactes', () => {
    // Le client n'a rien perdu : le message doit le dire, sinon le support
    // reçoit des appels paniqués et l'entreprise perd un client réparable.
    const notice = statusNotice(snapshot({ status: 'suspended' }), NOW);
    expect(notice?.level).toBe('critical');
    expect(notice?.message).toMatch(/intactes/i);
  });

  it("un abonnement actif n'affiche aucun message", () => {
    expect(statusNotice(snapshot({ status: 'active' }), NOW)).toBeNull();
    expect(statusNotice(snapshot({ status: 'canceled' }), NOW)).toBeNull();
  });
});
