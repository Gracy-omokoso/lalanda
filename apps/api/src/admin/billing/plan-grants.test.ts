import { describe, expect, it } from 'vitest';

import { isPlanGrantOpen, planGrantPeriod, planGrantPhase } from './plan-grants.js';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const jour = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('ADR-0053 — P3 : phase d’un octroi', () => {
  it('statut écrit d’abord, puis le temps', () => {
    expect(planGrantPhase({ status: 'revoked', startsAt: jour(-1), endsAt: null }, NOW)).toBe(
      'revoked',
    );
    expect(
      planGrantPhase({ status: 'pending_approval', startsAt: jour(-1), endsAt: jour(-1) }, NOW),
    ).toBe('pending_approval');
    expect(planGrantPhase({ status: 'active', startsAt: jour(-1), endsAt: null }, NOW)).toBe(
      'active',
    );
    expect(planGrantPhase({ status: 'active', startsAt: jour(1), endsAt: jour(5) }, NOW)).toBe(
      'scheduled',
    );
    // L'échéance est exclusive : à l'instant de fin, l'octroi ne vaut plus.
    expect(planGrantPhase({ status: 'active', startsAt: jour(-5), endsAt: NOW }, NOW)).toBe(
      'expired',
    );
  });

  it('ouvert = en attente, programmé ou en vigueur', () => {
    expect(isPlanGrantOpen({ status: 'pending_approval', startsAt: NOW, endsAt: null }, NOW)).toBe(
      true,
    );
    expect(isPlanGrantOpen({ status: 'active', startsAt: jour(2), endsAt: null }, NOW)).toBe(true);
    expect(isPlanGrantOpen({ status: 'active', startsAt: jour(-9), endsAt: jour(-1) }, NOW)).toBe(
      false,
    );
    expect(isPlanGrantOpen({ status: 'revoked', startsAt: NOW, endsAt: null }, NOW)).toBe(false);
  });
});

describe('ADR-0053 — P3 : offre et période d’un octroi', () => {
  it('`free` n’est pas un octroi', () => {
    expect(planGrantPeriod({ plan: 'free', now: NOW })).toEqual({
      ok: false,
      code: 'GRANT_PLAN_INVALID',
    });
  });

  it('début par défaut maintenant, fin facultative', () => {
    expect(planGrantPeriod({ plan: 'pro', now: NOW })).toEqual({
      ok: true,
      startsAt: NOW,
      endsAt: null,
    });
  });

  it('fin passée ou antérieure au début : refusée', () => {
    expect(planGrantPeriod({ plan: 'pro', endsAt: jour(-1).toISOString(), now: NOW }).ok).toBe(
      false,
    );
    expect(
      planGrantPeriod({
        plan: 'pro',
        startsAt: jour(10).toISOString(),
        endsAt: jour(5).toISOString(),
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(planGrantPeriod({ plan: 'business', endsAt: jour(30).toISOString(), now: NOW })).toEqual(
      { ok: true, startsAt: NOW, endsAt: jour(30) },
    );
  });
});
