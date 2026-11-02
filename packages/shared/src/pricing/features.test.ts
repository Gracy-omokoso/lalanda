// Catalogue des fonctionnalités par offre (ADR-0053 § 6.3 — lot P4).
//
// La propriété capitale : la grille du catalogue est ENTIÈREMENT OUVERTE. Une case
// fermée par mégarde retirerait une fonctionnalité à des organisations payantes —
// docs/13 en fait un arbitrage de la dirigeante, pas une ligne de code.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEATURE_GRID,
  FEATURE_KEYS,
  FEATURE_PLAN_ORDER,
  FEATURES,
  featureAccessDecision,
  featureUnavailableLabel,
  isFeatureGatedMethod,
  isFeatureKey,
  isFeatureOpenEverywhere,
  minimalPlanFor,
  PLANS,
  type FeatureGrid,
} from './index.js';

const NOW = new Date('2026-11-02T12:00:00Z');

function closing(key: (typeof FEATURE_KEYS)[number], ...closed: string[]): FeatureGrid {
  return {
    ...DEFAULT_FEATURE_GRID,
    [key]: Object.fromEntries(PLANS.map((p) => [p, !closed.includes(p)])),
  } as FeatureGrid;
}

describe('catalogue des fonctionnalités', () => {
  it('suit l’ordre des offres de `PLANS` (copie vérifiée)', () => {
    expect(FEATURE_PLAN_ORDER).toEqual(PLANS);
  });

  it('couvre les fonctionnalités nommées par ADR-0053 § 6.3', () => {
    for (const k of [
      'crm',
      'quotes',
      'normalized_invoicing',
      'treasury',
      'morning_brief',
      'idea_lab',
      'business_plan',
      'run_work',
      'purchases',
      'hr',
      'stock',
      'accounting',
      'sales_contracts',
      'lala_vocal',
    ]) {
      expect(isFeatureKey(k), k).toBe(true);
    }
  });

  it('chaque définition porte sa clé, un libellé et au moins un préfixe de route', () => {
    for (const k of FEATURE_KEYS) {
      expect(FEATURES[k].key).toBe(k);
      expect(FEATURES[k].label.length).toBeGreaterThan(2);
      expect(FEATURES[k].apiPrefixes.length).toBeGreaterThan(0);
      for (const p of FEATURES[k].apiPrefixes) expect(p.startsWith('/')).toBe(true);
    }
  });

  it('la grille par défaut est ENTIÈREMENT OUVERTE : rien n’est retiré à personne', () => {
    for (const k of FEATURE_KEYS) {
      expect(isFeatureOpenEverywhere(DEFAULT_FEATURE_GRID, k), k).toBe(true);
      expect(minimalPlanFor(DEFAULT_FEATURE_GRID, k)).toBe('free');
      for (const plan of PLANS) {
        expect(
          featureAccessDecision({
            grid: DEFAULT_FEATURE_GRID,
            feature: k,
            plan,
            overrideEndsAt: null,
            now: NOW,
          }),
        ).toEqual({ allowed: true, source: 'plan' });
      }
    }
  });
});

describe('décision d’accès', () => {
  const grid = closing('crm', 'free');

  it('case fermée → FEATURE_NOT_IN_PLAN avec l’offre minimale', () => {
    expect(
      featureAccessDecision({ grid, feature: 'crm', plan: 'free', overrideEndsAt: null, now: NOW }),
    ).toEqual({ allowed: false, code: 'FEATURE_NOT_IN_PLAN', minimalPlan: 'pro' });
  });

  it('une dérogation non échue rouvre ; échue, elle ne rouvre plus', () => {
    const futur = new Date(NOW.getTime() + 1000);
    expect(
      featureAccessDecision({
        grid,
        feature: 'crm',
        plan: 'free',
        overrideEndsAt: futur,
        now: NOW,
      }),
    ).toEqual({ allowed: true, source: 'override' });
    expect(
      featureAccessDecision({ grid, feature: 'crm', plan: 'free', overrideEndsAt: NOW, now: NOW })
        .allowed,
    ).toBe(false);
  });

  it('les autres offres gardent l’accès', () => {
    for (const plan of ['pro', 'cabinet', 'business', 'expert'] as const) {
      expect(
        featureAccessDecision({ grid, feature: 'crm', plan, overrideEndsAt: null, now: NOW })
          .allowed,
      ).toBe(true);
    }
  });

  it('aucune offre → offre minimale `null`', () => {
    const fermee = closing('crm', ...PLANS);
    expect(minimalPlanFor(fermee, 'crm')).toBeNull();
  });

  it('seuls les gestes sont gardés : lecture et export de l’existant restent permis', () => {
    expect(isFeatureGatedMethod('GET')).toBe(false);
    expect(isFeatureGatedMethod('head')).toBe(false);
    expect(isFeatureGatedMethod('OPTIONS')).toBe(false);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isFeatureGatedMethod(m)).toBe(true);
  });

  it('explique plutôt que de cacher', () => {
    expect(featureUnavailableLabel('Pro')).toBe('Disponible avec l’offre Pro');
    expect(featureUnavailableLabel(null)).toBe('Non comprise dans votre offre');
  });
});
