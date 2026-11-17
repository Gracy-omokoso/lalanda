import { describe, expect, it } from 'vitest';

import { consultantTimeRecap } from './consultant-recap.js';

const rates = [
  { userId: 'c1', currency: 'USD' as const, hourlyCost: '40.00', effectiveFrom: '2026-01-01' },
  { userId: 'c1', currency: 'USD' as const, hourlyCost: '50.00', effectiveFrom: '2026-03-01' },
];

describe('consultantTimeRecap (ADR-0078 § 2.4)', () => {
  it('valorise par mois et par projet au taux en vigueur au jour travaillé', () => {
    const r = consultantTimeRecap({
      entries: [
        { userId: 'c1', projectId: 'p1', workedOn: '2026-02-10', minutes: 90 },
        { userId: 'c1', projectId: 'p1', workedOn: '2026-02-11', minutes: 30 },
        { userId: 'c1', projectId: 'p1', workedOn: '2026-03-02', minutes: 60 },
        { userId: 'c1', projectId: 'p2', workedOn: '2026-03-03', minutes: 20 },
      ],
      rates,
      from: null,
      to: null,
    });
    expect(r.rows).toEqual([
      { period: '2026-02', projectId: 'p1', currency: 'USD', minutes: 120, amount: '80.00' },
      { period: '2026-03', projectId: 'p1', currency: 'USD', minutes: 60, amount: '50.00' },
      { period: '2026-03', projectId: 'p2', currency: 'USD', minutes: 20, amount: '16.67' },
    ]);
    expect(r.totals).toEqual([{ currency: 'USD', minutes: 200, amount: '146.67' }]);
    expect(r.minutesWithoutRate).toBe(0);
  });

  it('ne valorise jamais à zéro une saisie sans taux et respecte la période', () => {
    const r = consultantTimeRecap({
      entries: [
        { userId: 'c1', projectId: 'p1', workedOn: '2025-12-31', minutes: 45 },
        { userId: 'c1', projectId: 'p1', workedOn: '2026-04-01', minutes: 60 },
      ],
      rates,
      from: '2025-12-01',
      to: '2026-03-31',
    });
    expect(r.rows).toEqual([
      { period: '2025-12', projectId: 'p1', currency: null, minutes: 45, amount: null },
    ]);
    expect(r.minutesWithoutRate).toBe(45);
    expect(r.totals).toEqual([]);
  });

  it('refuse une période inversée', () => {
    expect(() =>
      consultantTimeRecap({ entries: [], rates: [], from: '2026-02-01', to: '2026-01-01' }),
    ).toThrow(RangeError);
  });
});
