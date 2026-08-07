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
});
