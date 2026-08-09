// Tests du catalogue entitlements (S16b).
// Garde-fou : le catalogue doit rester aligné sur la promesse publique de la
// page /pricing (apps/web) — « 1 projet en Free », « filigrane PDF », etc.

import { describe, expect, it } from 'vitest';

import { PLAN_ENTITLEMENTS, PLANS } from './entitlements.js';

describe('PLAN_ENTITLEMENTS (promesse /pricing)', () => {
  it('couvre exactement les trois plans publics', () => {
    expect(PLANS).toEqual(['free', 'pro', 'business']);
    expect(Object.keys(PLAN_ENTITLEMENTS).sort()).toEqual(['business', 'free', 'pro']);
  });

  it('Free : 1 projet, PDF avec filigrane', () => {
    expect(PLAN_ENTITLEMENTS.free.maxProjects).toBe(1);
    expect(PLAN_ENTITLEMENTS.free.pdfWatermark).toBe(true);
  });

  it('Pro : projets illimités, PDF sans filigrane', () => {
    expect(PLAN_ENTITLEMENTS.pro.maxProjects).toBeNull();
    expect(PLAN_ENTITLEMENTS.pro.pdfWatermark).toBe(false);
  });

  it('Business : tout Pro + 20 sièges inclus', () => {
    expect(PLAN_ENTITLEMENTS.business.maxProjects).toBeNull();
    expect(PLAN_ENTITLEMENTS.business.pdfWatermark).toBe(false);
    expect(PLAN_ENTITLEMENTS.business.seats).toBe(20);
  });

  // ── Scénarios par projet (ADR-0015 §3.4) ───────────────────────────────────
  // La page tarifs vend « 1 scénario » en Free et « Jusqu'à 3 scénarios par
  // projet » en Pro comme en Business. Ces trois assertions sont le garde-fou
  // contre une dérive silencieuse entre la promesse publiée et la limite
  // appliquée.

  it('Free : 1 seul scénario par projet', () => {
    expect(PLAN_ENTITLEMENTS.free.maxScenariosPerProject).toBe(1);
  });

  it('Pro et Business : 3 scénarios par projet', () => {
    expect(PLAN_ENTITLEMENTS.pro.maxScenariosPerProject).toBe(3);
    expect(PLAN_ENTITLEMENTS.business.maxScenariosPerProject).toBe(3);
  });

  it('aucun plan ne laisse le plafond de scénarios indéfini', () => {
    // `undefined` ne serait pas « illimité » mais « oublié » : `assertUnderLimit`
    // ne distingue que `null` (illimité) d'un nombre. Un plan sans valeur
    // laisserait passer une création qu'aucune décision commerciale n'autorise.
    for (const plan of PLANS) {
      const limite = PLAN_ENTITLEMENTS[plan].maxScenariosPerProject;
      expect(limite === null || typeof limite === 'number', plan).toBe(true);
    }
  });
});
