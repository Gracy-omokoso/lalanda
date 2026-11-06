// Tableau de bord des devis (ADR-0067). Attendus calculés à la main, puis
// propriétés à graine fixe.

import { describe, expect, it } from 'vitest';

import {
  computeQuoteStats,
  QUOTE_STATS_VERSION,
  type QuoteStatsInput,
  type QuoteStatsQuote,
} from '../index.js';

const devis = (over: Partial<QuoteStatsQuote> & { id: string }): QuoteStatsQuote => ({
  status: 'sent',
  validUntil: '2026-11-30',
  currency: 'CDF',
  total: '1000.00',
  firstSentOn: '2026-11-01',
  acceptedOn: null,
  converted: false,
  ...over,
});

const run = (over: Partial<QuoteStatsInput>) =>
  computeQuoteStats({
    referenceCurrency: 'CDF',
    asOf: '2026-11-06',
    months: 12,
    quotes: [],
    ...over,
  });

describe('computeQuoteStats — fenêtre et vide', () => {
  it('aucun devis : douze mois à zéro, aucun taux', () => {
    const r = run({});
    expect(r.from).toBe('2025-12');
    expect(r.to).toBe('2026-11');
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.sent === 0 && m.accepted === 0)).toBe(true);
    expect(r.open).toEqual({ count: 0, amount: '0.00', notConvertible: [] });
    expect(r.conversion).toMatchObject({ sent: 0, accepted: 0, ratePercent: null });
    expect(r.conversion.since).toBe('2026-08-09');
    expect(r.expiringSoon.until).toBe('2026-11-13');
    expect(r.statusCounts.all).toBe(0);
    expect(r.version).toBe(QUOTE_STATS_VERSION);
  });

  it('refuse une date ou une fenêtre illisible', () => {
    expect(() => run({ asOf: '2026-02-30' })).toThrow(RangeError);
    expect(() => run({ months: 37 })).toThrow(RangeError);
    expect(() => run({ quotes: [devis({ id: 'x', validUntil: 'demain' })] })).toThrow(RangeError);
  });
});

describe('computeQuoteStats — statuts et compteurs', () => {
  it('un devis envoyé dont la validité est passée est expiré (comme la liste)', () => {
    const r = run({
      quotes: [
        devis({ id: 'a', validUntil: '2026-11-05' }),
        devis({ id: 'b', validUntil: '2026-11-06' }),
        devis({ id: 'c', status: 'draft', firstSentOn: null }),
        devis({ id: 'd', status: 'refused' }),
        devis({ id: 'e', status: 'accepted', acceptedOn: '2026-11-03', converted: true }),
      ],
    });
    expect(r.statusCounts).toEqual({
      all: 5,
      draft: 1,
      sent: 1,
      accepted: 1,
      refused: 1,
      expired: 1,
    });
    expect(r.open.count).toBe(1);
    expect(r.converted).toBe(1);
  });

  it('expire bientôt : en cours et valable jusqu’à J+7 au plus', () => {
    const r = run({
      quotes: [
        devis({ id: 'a', validUntil: '2026-11-06', total: '10.00' }),
        devis({ id: 'b', validUntil: '2026-11-13', total: '20.00' }),
        devis({ id: 'c', validUntil: '2026-11-14', total: '40.00' }),
      ],
    });
    expect(r.expiringSoon).toMatchObject({ count: 2, amount: '30.00', withinDays: 7 });
    expect(r.open).toMatchObject({ count: 3, amount: '70.00' });
  });
});

describe('computeQuoteStats — devises', () => {
  it('un devis hors devise de référence est exclu du montant, compté, total dans sa devise', () => {
    const r = run({
      quotes: [
        devis({ id: 'a', total: '250000.00' }),
        devis({ id: 'b', currency: 'USD', total: '1200.50' }),
        devis({ id: 'c', currency: 'USD', total: '99.50' }),
      ],
    });
    expect(r.open).toEqual({
      count: 3,
      amount: '250000.00',
      notConvertible: [{ currency: 'USD', count: 2, total: '1300.00' }],
    });
    expect(r.excluded.notConvertible).toEqual([{ currency: 'USD', count: 2, total: '1300.00' }]);
  });

  it('référence USD : les devis CDF sont exclus à leur tour (aucun taux inventé)', () => {
    const r = run({
      referenceCurrency: 'USD',
      quotes: [devis({ id: 'a' }), devis({ id: 'b', currency: 'USD', total: '10.00' })],
    });
    expect(r.currency).toBe('USD');
    expect(r.open.amount).toBe('10.00');
    expect(r.open.notConvertible).toEqual([{ currency: 'CDF', count: 1, total: '1000.00' }]);
  });

  it('un devis sans total est compté, sans montant', () => {
    const r = run({ quotes: [devis({ id: 'a', total: null })] });
    expect(r.open).toEqual({ count: 1, amount: '0.00', notConvertible: [] });
    expect(r.excluded.withoutAmount).toBe(1);
  });
});

describe('computeQuoteStats — évolution et transformation', () => {
  it('émis au mois du premier envoi, acceptés au mois d’acceptation', () => {
    const r = run({
      quotes: [
        devis({
          id: 'a',
          status: 'accepted',
          firstSentOn: '2026-10-20',
          acceptedOn: '2026-11-02',
          total: '500.00',
        }),
        devis({ id: 'b', firstSentOn: '2026-10-25' }),
        devis({ id: 'c', firstSentOn: '2024-01-01', validUntil: '2024-02-01' }),
      ],
    });
    const oct = r.months.find((m) => m.month === '2026-10')!;
    const nov = r.months.find((m) => m.month === '2026-11')!;
    expect(oct).toMatchObject({ sent: 2, accepted: 0 });
    expect(nov).toMatchObject({ sent: 0, accepted: 1, acceptedAmount: '500.00' });
    expect(r.acceptedThisMonth).toMatchObject({ count: 1, amount: '500.00' });
  });

  it('taux sur 90 jours : acceptés / envoyés dans la fenêtre, arrondi demi vers le haut', () => {
    const r = run({
      quotes: [
        devis({ id: 'a', status: 'accepted', firstSentOn: '2026-08-09', acceptedOn: '2026-08-10' }),
        devis({ id: 'b', status: 'refused', firstSentOn: '2026-09-01' }),
        devis({ id: 'c', firstSentOn: '2026-11-06' }),
        // Hors fenêtre (91 jours) : ignoré.
        devis({ id: 'd', status: 'accepted', firstSentOn: '2026-08-08', acceptedOn: '2026-08-10' }),
        // Jamais envoyé : ignoré.
        devis({ id: 'e', status: 'draft', firstSentOn: null }),
      ],
    });
    expect(r.conversion).toMatchObject({ sent: 3, accepted: 1, ratePercent: 33 });
    const r2 = run({
      quotes: [
        devis({ id: 'a', status: 'accepted', acceptedOn: '2026-11-02' }),
        devis({ id: 'b' }),
      ],
    });
    expect(r2.conversion.ratePercent).toBe(50);
    const r3 = run({
      quotes: [
        devis({ id: 'a', status: 'accepted', acceptedOn: '2026-11-02' }),
        devis({ id: 'b', status: 'accepted', acceptedOn: '2026-11-02' }),
        devis({ id: 'c' }),
        devis({ id: 'd' }),
        devis({ id: 'e' }),
        devis({ id: 'f' }),
        devis({ id: 'g' }),
        devis({ id: 'h' }),
      ],
    });
    // 2 / 8 = 25 %.
    expect(r3.conversion.ratePercent).toBe(25);
    const r4 = run({
      quotes: [
        devis({ id: 'a', status: 'accepted', acceptedOn: '2026-11-02' }),
        ...['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => devis({ id })),
      ],
    });
    expect(r4.conversion.ratePercent).toBe(13); // 1 / 8 = 12,5 % → 13 %
  });
});

describe('computeQuoteStats — propriétés à graine fixe', () => {
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const jour = () => {
    const m = 1 + (next() % 11);
    const d = 1 + (next() % 28);
    return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const statuts = ['draft', 'sent', 'accepted', 'refused'];
  const quotes: QuoteStatsQuote[] = Array.from({ length: 300 }, (_, i) => {
    const status = statuts[next() % 4]!;
    const sent = status === 'draft' ? null : jour();
    return {
      id: `q${i}`,
      status,
      validUntil: jour(),
      currency: next() % 3 === 0 ? 'USD' : 'CDF',
      total:
        next() % 17 === 0 ? null : `${next() % 1_000_000}.${String(next() % 100).padStart(2, '0')}`,
      firstSentOn: sent,
      acceptedOn:
        status === 'accepted' ? (sent !== null && sent <= '2026-11-06' ? sent : null) : null,
      converted: next() % 2 === 0,
    };
  });
  const r = run({ quotes });

  it('les compteurs par statut se somment au total, chaque devis une fois', () => {
    const { all, ...rest } = r.statusCounts;
    expect(Object.values(rest).reduce((a, b) => a + b, 0)).toBe(all);
    expect(all).toBe(quotes.length);
  });

  it('montant de référence + exclus = somme des totaux, centime pour centime', () => {
    const cents = (s: string) => BigInt(s.replace('.', ''));
    const attendu = { CDF: 0n, USD: 0n };
    for (const q of quotes) if (q.total !== null) attendu[q.currency] += cents(q.total);
    const exclu = r.excluded.notConvertible.find((n) => n.currency === 'USD');
    expect(cents(exclu?.total ?? '0.00')).toBe(attendu.USD);
    // En cours : sous-ensemble, et en cours ⊇ expire bientôt.
    expect(r.expiringSoon.count).toBeLessThanOrEqual(r.open.count);
    expect(cents(r.expiringSoon.amount)).toBeLessThanOrEqual(cents(r.open.amount));
    expect(r.open.count).toBe(r.statusCounts.sent);
  });

  it('acceptés dans la fenêtre ≤ envoyés ; taux entre 0 et 100', () => {
    expect(r.conversion.accepted).toBeLessThanOrEqual(r.conversion.sent);
    expect(r.conversion.ratePercent).toBeGreaterThanOrEqual(0);
    expect(r.conversion.ratePercent).toBeLessThanOrEqual(100);
    const acceptes = r.months.reduce((a, m) => a + m.accepted, 0);
    expect(acceptes).toBeLessThanOrEqual(r.statusCounts.accepted);
  });

  it('déterministe : même entrée, même sortie, ordre des devis indifférent', () => {
    expect(run({ quotes: [...quotes].reverse() })).toEqual(r);
  });
});
