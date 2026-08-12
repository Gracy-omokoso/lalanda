// Tests des entitlements appliqués par l'API.
//
// Les VALEURS de la grille sont testées à leur source
// (`packages/shared/src/pricing/pricing.test.ts`). Ici on teste ce que ce module
// ajoute et qui n'appartient qu'à l'API : l'ANTÉRIORITÉ des abonnements
// antérieurs à la nouvelle grille.

import { describe, expect, it } from 'vitest';

import {
  LEGACY_PLAN_ENTITLEMENTS,
  PLAN_ENTITLEMENTS,
  PLANS,
  PRICING_VERSION,
  resolveEntitlements,
} from './entitlements.js';

describe('catalogue exposé par l’API', () => {
  it('couvre exactement les cinq offres de la grille', () => {
    expect(PLANS).toEqual(['free', 'pro', 'cabinet', 'business', 'expert']);
    expect(Object.keys(PLAN_ENTITLEMENTS).sort()).toEqual([
      'business',
      'cabinet',
      'expert',
      'free',
      'pro',
    ]);
  });

  it('reprend la grille partagée sans la recopier', () => {
    // Une valeur recopiée ici finirait par diverger de la page tarifs — c'est
    // exactement le défaut que le catalogue partagé corrige.
    expect(PLAN_ENTITLEMENTS.pro.maxProjects).toBe(5);
    expect(PLAN_ENTITLEMENTS.cabinet.aiMessagesPerMonth).toBe(1500);
    expect(PLAN_ENTITLEMENTS.business.maxProjects).toBeNull();
  });
});

describe('antériorité des abonnements existants', () => {
  it('sert la grille courante à un abonnement créé sous cette grille', () => {
    expect(resolveEntitlements('pro', PRICING_VERSION)).toBe(PLAN_ENTITLEMENTS.pro);
    expect(resolveEntitlements('pro', PRICING_VERSION).maxProjects).toBe(5);
  });

  it('préserve les projets illimités promis à un Pro antérieur', () => {
    // C'est LA promesse que l'ancienne page vendait : « Projets illimités ».
    // La retirer à un abonné payant serait la seule vraie régression de ce lot.
    expect(resolveEntitlements('pro', null).maxProjects).toBeNull();
    expect(resolveEntitlements('pro', undefined).maxProjects).toBeNull();
    expect(resolveEntitlements('pro', 1).maxProjects).toBeNull();
  });

  it("n'accorde PAS de quotas illimités sur les axes jamais vendus", () => {
    // Messages IA et exports PDF n'étaient ni promis, ni comptés. Les servir
    // illimités à vie donnerait plus que ce qui a été acheté, et laisserait un
    // trou de coût ouvert pour toujours.
    const ancien = resolveEntitlements('pro', null);
    expect(ancien.aiMessagesPerMonth).toBe(PLAN_ENTITLEMENTS.pro.aiMessagesPerMonth);
    expect(ancien.pdfExportsPerMonth).toBe(PLAN_ENTITLEMENTS.pro.pdfExportsPerMonth);
  });

  it('ne change rien pour Free, Cabinet, Business et Expert', () => {
    // Free et Business ont la même limite de projets dans les deux grilles ;
    // Cabinet et Expert n'existaient pas avant, personne ne peut y avoir droit
    // à titre antérieur.
    for (const plan of ['free', 'cabinet', 'business', 'expert'] as const) {
      expect(LEGACY_PLAN_ENTITLEMENTS[plan]).toBe(PLAN_ENTITLEMENTS[plan]);
      expect(resolveEntitlements(plan, null)).toEqual(PLAN_ENTITLEMENTS[plan]);
    }
  });

  it("l'antériorité n'est jamais moins généreuse que la grille courante", () => {
    // Une antériorité qui RETIRERAIT quelque chose serait un contresens : elle
    // existe pour ne rien retirer.
    for (const plan of PLANS) {
      const courant = PLAN_ENTITLEMENTS[plan];
      const ancien = LEGACY_PLAN_ENTITLEMENTS[plan];
      for (const cle of ['maxProjects', 'pdfExportsPerMonth', 'aiMessagesPerMonth'] as const) {
        if (courant[cle] === null) {
          expect(ancien[cle], `${plan}.${cle}`).toBeNull();
        } else if (ancien[cle] !== null) {
          expect(ancien[cle]!, `${plan}.${cle}`).toBeGreaterThanOrEqual(courant[cle]!);
        }
      }
      expect(ancien.actualsEnabled || !courant.actualsEnabled).toBe(true);
    }
  });
});
