import { describe, expect, it } from 'vitest';

import {
  centsToDecimal,
  computePlatformRevenue,
  defaultRevenuePeriod,
  revenueMonthsBetween,
  platformRevenueCsv,
  type ManualPaymentRecord,
  type PlatformRevenueInput,
  type SubscriptionRecord,
} from './index.js';

const TARIFS = {
  free: { monthCents: 0, yearCents: 0 },
  pro: { monthCents: 1900, yearCents: 19000 },
  cabinet: { monthCents: 3900, yearCents: 39000 },
  business: { monthCents: 7900, yearCents: 79000 },
  expert: { monthCents: null, yearCents: null },
};

const d = (iso: string) => new Date(iso);

function depot(p: Partial<ManualPaymentRecord> & { decidedAt?: Date | null }): ManualPaymentRecord {
  return {
    plan: 'pro',
    interval: 'month',
    amountDueCents: 1900,
    currency: 'USD',
    method: 'mobile_money',
    status: 'confirmed',
    createdAt: d('2026-10-01T00:00:00Z'),
    expiresAt: d('2026-10-15T00:00:00Z'),
    decidedAt: d('2026-10-03T00:00:00Z'),
    ...p,
  };
}

function entree(over: Partial<PlatformRevenueInput> = {}): PlatformRevenueInput {
  return {
    from: '2026-09',
    to: '2026-10',
    now: d('2026-10-20T00:00:00Z'),
    manualPayments: [],
    providerPayments: [],
    subscriptions: [],
    tariffs: TARIFS,
    tariffCurrency: 'USD',
    ...over,
  };
}

describe('platform-revenue — encaissements constatés', () => {
  it('somme au centime les seuls dépôts confirmés de la période (critère 21)', () => {
    const r = computePlatformRevenue(
      entree({
        manualPayments: [
          depot({ amountDueCents: 1900 }),
          depot({ amountDueCents: 3901, plan: 'cabinet', method: 'bank_transfer' }),
          depot({ status: 'rejected', amountDueCents: 7900 }),
          depot({ status: 'confirmed', decidedAt: d('2026-08-31T23:59:59Z') }), // hors période
        ],
        providerPayments: [
          {
            provider: 'stripe',
            mappedEvent: 'payment.succeeded',
            status: 'processed',
            at: d('2026-10-05T00:00:00Z'),
          },
          {
            provider: 'manual',
            mappedEvent: 'payment.succeeded',
            status: 'processed',
            at: d('2026-10-03T00:00:00Z'),
          },
        ],
      }),
    );
    expect(r.receipts.total).toEqual([{ currency: 'USD', totalCents: 5801, count: 2 }]);
    expect(r.receipts.byMonth).toEqual([
      { month: '2026-09', byCurrency: [{ currency: 'USD', totalCents: 0, count: 0 }] },
      { month: '2026-10', byCurrency: [{ currency: 'USD', totalCents: 5801, count: 2 }] },
    ]);
    expect(r.receipts.byPlan.map((p) => [p.plan, p.byCurrency[0]!.totalCents])).toEqual([
      ['cabinet', 3901],
      ['pro', 1900],
    ]);
    expect(r.receipts.byMethod.map((m) => m.method)).toEqual(['bank_transfer', 'mobile_money']);
    // Stripe compté sans montant ; le rappel `manual` n'est pas compté deux fois.
    expect(r.providerEventsWithoutAmount).toEqual([{ provider: 'stripe', count: 1 }]);
    expect(r.manualQueue.rejected).toEqual([{ currency: 'USD', totalCents: 7900, count: 1 }]);
  });

  it('ne convertit jamais : une devise par ligne', () => {
    const r = computePlatformRevenue(
      entree({
        manualPayments: [
          depot({ amountDueCents: 1900, currency: 'USD' }),
          depot({ amountDueCents: 5_000_000, currency: 'CDF' }),
        ],
      }),
    );
    expect(r.receipts.total).toEqual([
      { currency: 'CDF', totalCents: 5_000_000, count: 1 },
      { currency: 'USD', totalCents: 1900, count: 1 },
    ]);
    expect(r.receipts.byMonth[0]!.byCurrency.map((c) => c.currency)).toEqual(['CDF', 'USD']);
  });

  it('borne les mois en UTC, bornes incluses', () => {
    const r = computePlatformRevenue(
      entree({
        from: '2026-10',
        to: '2026-10',
        manualPayments: [
          depot({ decidedAt: d('2026-10-01T00:00:00Z') }),
          depot({ decidedAt: d('2026-10-31T23:59:59.999Z') }),
          depot({ decidedAt: d('2026-11-01T00:00:00Z') }),
          depot({ decidedAt: d('2026-09-30T23:59:59.999Z') }),
        ],
      }),
    );
    expect(r.receipts.total[0]!.count).toBe(2);
  });

  it('range la file : en attente (non échue), expirée, refusée', () => {
    const r = computePlatformRevenue(
      entree({
        manualPayments: [
          depot({ status: 'pending', decidedAt: null, expiresAt: d('2026-10-25T00:00:00Z') }),
          depot({ status: 'pending', decidedAt: null, expiresAt: d('2026-10-10T00:00:00Z') }),
          depot({ status: 'expired', decidedAt: null, expiresAt: d('2026-09-10T00:00:00Z') }),
        ],
      }),
    );
    expect(r.manualQueue.pending).toEqual([{ currency: 'USD', totalCents: 1900, count: 1 }]);
    expect(r.manualQueue.expired).toEqual([{ currency: 'USD', totalCents: 3800, count: 2 }]);
    expect(r.receipts.total).toEqual([]);
  });

  it('refuse un montant non entier ou une période inversée', () => {
    expect(() =>
      computePlatformRevenue(entree({ manualPayments: [depot({ amountDueCents: 19.5 })] })),
    ).toThrow(RangeError);
    expect(() => computePlatformRevenue(entree({ from: '2026-11', to: '2026-10' }))).toThrow(
      RangeError,
    );
    expect(() => computePlatformRevenue(entree({ from: '2026-13' }))).toThrow(RangeError);
  });
});

describe('platform-revenue — revenu récurrent déclaré', () => {
  const sub = (s: Partial<SubscriptionRecord>): SubscriptionRecord => ({
    plan: 'pro',
    status: 'active',
    billingInterval: 'month',
    lastPaymentAt: d('2026-10-01T00:00:00Z'),
    ...s,
  });

  it('ramène les annuels au mois, exclut octrois, essais, gratuits et offres sans tarif', () => {
    const r = computePlatformRevenue(
      entree({
        subscriptions: [
          sub({}),
          sub({ plan: 'cabinet', billingInterval: 'year' }),
          sub({ plan: 'business', lastPaymentAt: null }), // octroi ou ancien setPlan
          sub({ plan: 'expert' }),
          sub({ plan: 'free' }),
          sub({ status: 'trialing', lastPaymentAt: null }),
          sub({ status: 'past_due' }),
          sub({ status: 'grace' }),
          sub({ status: 'grace' }),
        ],
      }),
    );
    expect(r.declaredRecurring).toEqual([
      {
        currency: 'USD',
        monthlySubscriptionsCents: 1900,
        yearlySubscriptionsCents: 39000,
        monthlyEquivalentCents: 1900 + 3250,
        subscriptions: 2,
      },
    ]);
    expect(r.recurringExclusions).toEqual({ neverPaid: 1, withoutPublishedTariff: 1 });
    expect(r.subscriptionsAtRisk).toEqual({ pastDue: 1, grace: 2 });
  });

  it('arrondit une seule fois, sur le total annuel', () => {
    const r = computePlatformRevenue(
      entree({
        subscriptions: [sub({ billingInterval: 'year' }), sub({ billingInterval: 'year' })],
      }),
    );
    // 2 × 19000 / 12 = 3166,67 → 3167 (et non 2 × 1583).
    expect(r.declaredRecurring[0]!.monthlyEquivalentCents).toBe(3167);
  });

  it('ne déclare rien sans abonnement payé', () => {
    expect(computePlatformRevenue(entree()).declaredRecurring).toEqual([]);
  });
});

describe('platform-revenue — propriétés à graine fixe', () => {
  function graine(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('total = somme des mois = somme des offres = somme des moyens, par devise', () => {
    const rnd = graine(53);
    const plans = ['pro', 'cabinet', 'business'];
    const statuts = ['confirmed', 'rejected', 'pending', 'expired'] as const;
    const depots: ManualPaymentRecord[] = Array.from({ length: 400 }, () => {
      const decided = new Date(Date.UTC(2026, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)));
      const status = statuts[Math.floor(rnd() * statuts.length)]!;
      return depot({
        plan: plans[Math.floor(rnd() * plans.length)]!,
        amountDueCents: Math.floor(rnd() * 100_000),
        currency: rnd() < 0.8 ? 'USD' : 'CDF',
        method: rnd() < 0.5 ? 'mobile_money' : 'bank_transfer',
        status,
        decidedAt: status === 'confirmed' || status === 'rejected' ? decided : null,
        expiresAt: decided,
      });
    });
    const r = computePlatformRevenue(
      entree({ from: '2026-01', to: '2026-12', manualPayments: depots }),
    );
    for (const { currency, totalCents, count } of r.receipts.total) {
      const somme = (
        rows: { byCurrency: { currency: string; totalCents: number; count: number }[] }[],
      ) =>
        rows
          .flatMap((x) => x.byCurrency.filter((c) => c.currency === currency))
          .reduce((a, c) => [a[0]! + c.totalCents, a[1]! + c.count], [0, 0]);
      expect(somme(r.receipts.byMonth)).toEqual([totalCents, count]);
      expect(somme(r.receipts.byPlan)).toEqual([totalCents, count]);
      expect(somme(r.receipts.byMethod)).toEqual([totalCents, count]);
      const attendu = depots
        .filter((p) => p.status === 'confirmed' && p.currency === currency)
        .reduce((a, p) => a + p.amountDueCents, 0);
      expect(totalCents).toBe(attendu);
    }
  });
});

describe('platform-revenue — présentation', () => {
  it('formate les centimes sans flottant', () => {
    expect(centsToDecimal(0)).toBe('0.00');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(1900)).toBe('19.00');
    expect(centsToDecimal(123_456_789)).toBe('1234567.89');
  });

  it('liste les mois et la période par défaut', () => {
    expect(revenueMonthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(defaultRevenuePeriod(d('2026-11-02T10:00:00Z'))).toEqual({
      from: '2025-12',
      to: '2026-11',
    });
  });

  it('exporte des agrégats seulement, sans mot réservé aux pièces fiscales', () => {
    const r = computePlatformRevenue(entree({ manualPayments: [depot({})] }));
    const csv = platformRevenueCsv(r);
    expect(csv.split('\r\n')[0]).toBe('section;cle;devise;nombre;montant');
    expect(csv).toContain('encaissements_constates;periode;USD;1;19.00');
    const bas = csv.toLowerCase();
    for (const mot of ["chiffre d'affaires", 'chiffre d’affaires', 'facturé', 'tva']) {
      expect(bas).not.toContain(mot);
    }
  });
});
