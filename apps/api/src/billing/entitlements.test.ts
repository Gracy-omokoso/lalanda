// Entitlements appliqués par l'API.
//
// Les VALEURS de la grille sont testées à leur source
// (`packages/shared/src/pricing/pricing.test.ts`). Ici on teste ce que ce module
// garantit à ses appelants (`projects/`, `reports/`, `ai/`) :
//
//   · la grille exposée est bien celle du catalogue partagé, pas une copie;
//   · il n'existe QU'UNE grille — la décision « aucune antériorité » est
//     vérifiable, pas seulement écrite en commentaire.

import { PLAN_CATALOG } from '@lalanda/shared/pricing';
import { describe, expect, it } from 'vitest';

import * as entitlementsModule from './entitlements.js';
import { PLAN_ENTITLEMENTS, PLANS, resolveEntitlements } from './entitlements.js';

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
    // exactement le défaut que le catalogue partagé corrige. On compare donc à
    // la source, sans écrire un seul nombre.
    for (const plan of PLANS) {
      expect(PLAN_ENTITLEMENTS[plan]).toBe(PLAN_CATALOG[plan].entitlements);
    }
  });

  it('rend des limites complètes pour chaque offre', () => {
    // Un champ absent se lirait `undefined`, qu'un `!== null` laisserait passer
    // comme s'il s'agissait d'un nombre : une limite muette est une limite
    // désactivée.
    for (const plan of PLANS) {
      const e = PLAN_ENTITLEMENTS[plan];
      for (const cle of [
        'maxProjects',
        'pdfExportsPerMonth',
        'aiMessagesPerMonth',
        'seats',
      ] as const) {
        expect(e[cle] === null || typeof e[cle] === 'number', `${plan}.${cle}`).toBe(true);
      }
      expect(typeof e.pdfWatermark).toBe('boolean');
      expect(typeof e.actualsEnabled).toBe('boolean');
    }
  });
});

describe('antériorité — arbitrée, et il n’y en a pas', () => {
  it('applique la grille courante à toutes les offres', () => {
    // DÉCISION DU DÉCIDEUR : tous les comptes existants passent aux nouvelles
    // limites. `resolveEntitlements` ne prend donc AUCUN paramètre d'ancienneté.
    for (const plan of PLANS) {
      expect(resolveEntitlements(plan)).toBe(PLAN_ENTITLEMENTS[plan]);
    }
  });

  it('sert 5 projets à un Pro, y compris à un abonné historique', () => {
    // L'ancienne grille promettait « projets illimités » en Pro. La décision est
    // de ne pas conserver cette promesse : le test fixe ce choix pour qu'un
    // retour en arrière soit un changement visible et non un glissement.
    expect(resolveEntitlements('pro').maxProjects).toBe(5);
  });

  it('n’expose aucune seconde grille', () => {
    // Une grille « héritée » conservée au cas où serait une branche que rien
    // n'emprunte et qu'un lecteur croirait active. Ce test la garde absente.
    const exportes = Object.keys(entitlementsModule);
    expect(exportes).not.toContain('LEGACY_PLAN_ENTITLEMENTS');
    expect(exportes).not.toContain('PRICING_VERSION');
  });

  it('resolveEntitlements ignore tout argument supplémentaire', () => {
    // Un appelant resté sur l'ancienne signature `(plan, pricingVersion)` ne doit
    // pas obtenir silencieusement autre chose que la grille courante.
    const resolveLache = resolveEntitlements as unknown as (
      plan: string,
      version?: unknown,
    ) => unknown;
    expect(resolveLache('pro', null)).toBe(PLAN_ENTITLEMENTS.pro);
    expect(resolveLache('pro', 1)).toBe(PLAN_ENTITLEMENTS.pro);
  });
});
