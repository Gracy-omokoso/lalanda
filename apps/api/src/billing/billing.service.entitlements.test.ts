// Ce que `BillingService` sert aux consommateurs d'entitlements.
//
// Deux garanties vérifiées ici, toutes deux issues de l'état RÉEL de la
// production au moment de la bascule de grille (7 organisations, 9 projets, un
// seul document d'abonnement — six organisations n'en ont aucun) :
//
//   1. une organisation SANS document d'abonnement est servie en `free`, pas en
//      erreur ni en `undefined`;
//   2. aucune antériorité : la grille courante s'applique à tout le monde.
//
// Seul le modèle Mongoose est doublé — le service est le vrai.

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';
import type { Model } from 'mongoose';
import { describe, expect, it } from 'vitest';

import { BillingService } from './billing.service.js';
import type { SubscriptionDocument } from './subscription.schema.js';

/** Modèle qui ne trouve jamais de document — les six organisations sans abonnement. */
function modelSansDocument(): Model<SubscriptionDocument> {
  return {
    findOne: () => ({ exec: async () => null }),
  } as unknown as Model<SubscriptionDocument>;
}

/** Modèle qui rend un document d'abonnement minimal mais réaliste. */
function modelAvecDocument(doc: Record<string, unknown>): Model<SubscriptionDocument> {
  const complet = {
    organizationId: 'org-1',
    plan: 'free',
    status: 'active',
    billingInterval: 'month',
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    canceledAt: null,
    pendingPlan: null,
    pendingInterval: null,
    pendingPlanEffectiveAt: null,
    provider: null,
    lastFailureCode: null,
    statusHistory: [],
    // Les transitions temporelles échues sont appliquées À LA LECTURE (ADR-0009 :
    // aucun ordonnanceur). Un essai expiré déclenche donc une écriture pendant
    // `getState`, et le double doit savoir l'encaisser.
    save: async () => undefined,
    ...doc,
  };
  return {
    findOne: () => ({ exec: async () => complet }),
  } as unknown as Model<SubscriptionDocument>;
}

describe('organisation sans document d’abonnement', () => {
  it('est servie en `free`, pas en erreur', async () => {
    // Six organisations de production sont dans ce cas : elles n'ont jamais
    // souscrit ni essayé. Lever ici casserait la création de projet, la lecture
    // du quota IA et le tableau de bord pour la majorité des comptes.
    const service = new BillingService(modelSansDocument());
    const { plan, entitlements } = await service.getPlanEntitlements('org-sans-doc');
    expect(plan).toBe('free');
    expect(entitlements).toEqual(PLAN_ENTITLEMENTS.free);
  });

  it('rend des limites complètes, jamais `undefined`', async () => {
    // Un `undefined` passerait le test `!== null` des appelants et désactiverait
    // silencieusement la limite — c'est-à-dire ouvrirait tout à tout le monde.
    const service = new BillingService(modelSansDocument());
    const { entitlements } = await service.getPlanEntitlements('org-sans-doc');
    expect(entitlements.maxProjects).toBe(1);
    expect(entitlements.aiMessagesPerMonth).toBe(20);
    expect(entitlements.pdfExportsPerMonth).toBe(3);
    expect(entitlements.pdfWatermark).toBe(true);
    expect(entitlements.actualsEnabled).toBe(false);
    expect(entitlements.seats).toBe(1);
  });

  it('n’écrit rien en base pour répondre', async () => {
    // Créer un document à la première lecture remplirait la collection
    // d'abonnements vides pour toutes les organisations qui ne paieront jamais.
    let ecritures = 0;
    const model = {
      findOne: () => ({ exec: async () => null }),
      create: () => {
        ecritures += 1;
      },
      findOneAndUpdate: () => {
        ecritures += 1;
        return { exec: async () => null };
      },
    } as unknown as Model<SubscriptionDocument>;

    await new BillingService(model).getPlanEntitlements('org-sans-doc');
    expect(ecritures).toBe(0);
  });
});

describe('aucune antériorité', () => {
  it('sert la grille COURANTE à un abonnement antérieur à cette grille', async () => {
    // Un document écrit sous l'ancienne grille ne porte aucun marqueur de
    // version — et n'en a plus besoin : la décision est qu'il bascule.
    const service = new BillingService(modelAvecDocument({ plan: 'pro', status: 'active' }));
    const { plan, entitlements } = await service.getPlanEntitlements('org-1');
    expect(plan).toBe('pro');
    // L'ancienne grille promettait « projets illimités » en Pro. La nouvelle en
    // accorde 5, et c'est elle qui s'applique.
    expect(entitlements.maxProjects).toBe(5);
    expect(entitlements).toEqual(PLAN_ENTITLEMENTS.pro);
  });

  it('sert `free` à un essai en cours dont l’essai a expiré', async () => {
    // Le seul abonnement de production est `free` / `trialing`. Une fois l'essai
    // échu, `effectivePlan()` répond `free` sans qu'aucune donnée ne soit
    // touchée — les projets restent, la limite s'applique aux créations futures.
    const service = new BillingService(
      modelAvecDocument({
        plan: 'free',
        status: 'trialing',
        trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
        trialEndsAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
    );
    const { entitlements } = await service.getPlanEntitlements('org-1');
    expect(entitlements.maxProjects).toBe(1);
  });
});
