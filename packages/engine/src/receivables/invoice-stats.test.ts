// Tableau de bord des factures (ADR-0056). Attendus calculés à la main.

import { describe, expect, it } from 'vitest';

import {
  computeInvoiceStats,
  INVOICE_STATS_VERSION,
  type InvoiceStatsDocument,
  type InvoiceStatsInput,
} from '../index.js';

const doc = (over: Partial<InvoiceStatsDocument> & { id: string }): InvoiceStatsDocument => ({
  status: 'issued',
  type: 'FV',
  series: 'real',
  issuedOn: '2026-10-10',
  currency: 'CDF',
  total: '1000.00',
  customerKey: 'c1',
  customerName: 'Hôtel Lisanga',
  normalizedTotalCdf: null,
  conversion: null,
  usdCounterValue: null,
  amountOnCredit: '1000.00',
  dueDate: null,
  originInvoiceId: null,
  ...over,
});

const run = (over: Partial<InvoiceStatsInput>) =>
  computeInvoiceStats({
    referenceCurrency: 'CDF',
    asOf: '2026-11-03',
    months: 12,
    documents: [],
    allocations: [],
    ...over,
  });

const cat = (r: ReturnType<typeof run>, c: string) =>
  r.categories.find((x) => x.category === c)?.count;

describe('computeInvoiceStats — fenêtre et vide', () => {
  it('aucun document : douze mois à zéro, aucun ratio', () => {
    const r = run({});
    expect(r.from).toBe('2025-12');
    expect(r.to).toBe('2026-11');
    expect(r.months).toHaveLength(12);
    expect(r.months.every((m) => m.billed === '0.00' && m.outstanding === '0.00')).toBe(true);
    expect(r.totals).toEqual({
      billed: '0.00',
      collected: '0.00',
      collectedRatePercent: null,
      invoiceCount: 0,
      creditNoteCount: 0,
    });
    expect(r.statusCounts.all).toBe(0);
    expect(r.topCustomers).toEqual([]);
    expect(r.version).toBe(INVOICE_STATS_VERSION);
  });

  it('refuse une date ou une fenêtre illisible', () => {
    expect(() => run({ asOf: '2026-13-01' })).toThrow(RangeError);
    expect(() => run({ months: 0 })).toThrow(RangeError);
  });
});

describe('computeInvoiceStats — facturé, encaissé, reste', () => {
  it('pro forma et brouillons exclus du facturé, comptés dans les filtres', () => {
    const r = run({
      documents: [
        doc({ id: 'd', status: 'draft', issuedOn: null }),
        doc({ id: 'p', status: 'pending_normalization', issuedOn: null }),
        doc({ id: 'x', status: 'normalization_failed', issuedOn: null }),
        doc({ id: 'f' }),
      ],
    });
    expect(r.totals.billed).toBe('1000.00');
    expect(r.statusCounts).toMatchObject({
      all: 4,
      draft: 1,
      pending_normalization: 1,
      normalization_failed: 1,
      final: 1,
    });
    expect(cat(r, 'draft')).toBe(1);
    expect(cat(r, 'pending_normalization')).toBe(1);
    expect(cat(r, 'normalization_failed')).toBe(1);
    expect(cat(r, 'to_collect')).toBe(1);
  });

  it('un avoir vient en déduction du facturé et du reste de son origine', () => {
    const r = run({
      documents: [
        doc({ id: 'f' }),
        doc({
          id: 'a',
          type: 'FA',
          total: '300.00',
          amountOnCredit: '300.00',
          issuedOn: '2026-11-02',
          originInvoiceId: 'f',
          customerKey: null,
          customerName: null,
        }),
      ],
    });
    expect(r.totals.billed).toBe('700.00');
    expect(r.months.at(-1)?.billed).toBe('-300.00');
    expect(r.outstanding).toEqual({ amount: '700.00', count: 1 });
    expect(r.months.at(-2)?.outstanding).toBe('1000.00');
    expect(r.totals.creditNoteCount).toBe(1);
    expect(cat(r, 'credit_note')).toBe(1);
    // L'avoir sans client se rattache au client de l'origine.
    expect(r.topCustomers).toEqual([{ key: 'c1', name: 'Hôtel Lisanga', billed: '700.00' }]);
  });

  it('encaissé = part réglée à l’émission + lettrages à leur date', () => {
    const r = run({
      documents: [doc({ id: 'f', total: '1000.00', amountOnCredit: '600.00' })],
      allocations: [{ invoiceId: 'f', amount: '250.00', receivedOn: '2026-11-01' }],
    });
    expect(r.months.at(-2)?.collected).toBe('400.00');
    expect(r.months.at(-1)?.collected).toBe('250.00');
    expect(r.totals.collected).toBe('650.00');
    expect(r.totals.collectedRatePercent).toBe(65);
    expect(r.outstanding).toEqual({ amount: '350.00', count: 1 });
    expect(r.months.at(-2)?.outstanding).toBe('600.00');
  });

  it('« en retard » = échéance dépassée et non soldée ; soldée = payée', () => {
    const r = run({
      documents: [
        doc({ id: 'late', dueDate: '2026-10-20' }),
        doc({ id: 'ok', dueDate: '2026-10-20' }),
        doc({ id: 'future', dueDate: '2026-12-01' }),
      ],
      allocations: [{ invoiceId: 'ok', amount: '1000.00', receivedOn: '2026-10-15' }],
    });
    expect(r.overdue).toEqual({ amount: '1000.00', count: 1 });
    expect(r.outstanding).toEqual({ amount: '2000.00', count: 2 });
    expect(cat(r, 'overdue')).toBe(1);
    expect(cat(r, 'paid')).toBe(1);
    expect(cat(r, 'to_collect')).toBe(1);
    // Au 31 octobre, « late » était déjà en retard.
    expect(r.months.at(-2)?.overdue).toBe('1000.00');
  });

  it('acomptes et série d’essai exclus et comptés', () => {
    const r = run({
      documents: [doc({ id: 'a', type: 'FT' }), doc({ id: 't', series: 'test' })],
    });
    expect(r.totals.billed).toBe('0.00');
    expect(r.excluded).toMatchObject({ deposits: 1, testSeries: 1 });
    expect(cat(r, 'other_final')).toBe(2);
  });

  it('documents hors fenêtre : ni facturé ni encaissé, mais reste à encaisser', () => {
    const r = run({ documents: [doc({ id: 'old', issuedOn: '2024-01-05' })] });
    expect(r.totals.billed).toBe('0.00');
    expect(r.outstanding.amount).toBe('1000.00');
  });
});

describe('computeInvoiceStats — devise de référence', () => {
  it('USD normalisé : total CDF figé de la normalisation, parts au prorata', () => {
    const r = run({
      documents: [
        doc({
          id: 'u',
          currency: 'USD',
          total: '100.00',
          amountOnCredit: '100.00',
          status: 'normalized',
          normalizedTotalCdf: '280000.00',
          conversion: { from: 'USD', to: 'CDF', rate: '2800' },
        }),
      ],
      allocations: [{ invoiceId: 'u', amount: '25.00', receivedOn: '2026-11-01' }],
    });
    expect(r.totals.billed).toBe('280000.00');
    expect(r.totals.collected).toBe('70000.00');
    expect(r.outstanding.amount).toBe('210000.00');
  });

  it('USD avec seulement un taux de conversion : montant × taux, arrondi au centime', () => {
    const r = run({
      documents: [
        doc({
          id: 'u',
          currency: 'USD',
          total: '10.01',
          amountOnCredit: '0.00',
          conversion: { from: 'USD', to: 'CDF', rate: '2843.5' },
        }),
      ],
    });
    // 10,01 × 2843,5 = 28463,435 → 28463,44
    expect(r.totals.billed).toBe('28463.44');
    expect(r.totals.collected).toBe('28463.44');
    expect(cat(r, 'paid')).toBe(1);
  });

  it('sans taux sur la facture : exclu des montants, compté, catégorie gardée', () => {
    const r = run({
      documents: [
        doc({
          id: 'u',
          currency: 'USD',
          total: '92.80',
          amountOnCredit: '92.80',
          dueDate: '2026-10-01',
        }),
        doc({ id: 'c' }),
      ],
    });
    expect(r.totals.billed).toBe('1000.00');
    expect(r.excluded.notConvertible).toEqual([{ currency: 'USD', count: 1, total: '92.80' }]);
    expect(cat(r, 'overdue')).toBe(1);
    expect(r.overdue).toEqual({ amount: '0.00', count: 0 });
  });

  it('référence USD : contre-valeur USD figée d’un document CDF', () => {
    const r = run({
      referenceCurrency: 'USD',
      documents: [
        doc({ id: 'c', total: '285000.00', amountOnCredit: '0.00', usdCounterValue: '100.00' }),
      ],
    });
    expect(r.currency).toBe('USD');
    expect(r.totals.billed).toBe('100.00');
  });
});

describe('computeInvoiceStats — classement des clients', () => {
  it('cinq meilleurs clients par facturé net, à égalité par nom', () => {
    const docs = ['E', 'B', 'A', 'D', 'C', 'F'].map((n, i) =>
      doc({
        id: n,
        customerKey: n,
        customerName: `Client ${n}`,
        total: i < 2 ? '500.00' : '100.00',
      }),
    );
    const r = run({ documents: docs });
    expect(r.topCustomers.map((c) => c.key)).toEqual(['B', 'E', 'A', 'C', 'D']);
  });

  it('un client entièrement crédité n’apparaît pas', () => {
    const r = run({
      documents: [
        doc({ id: 'f' }),
        doc({ id: 'a', type: 'FA', originInvoiceId: 'f', issuedOn: '2026-10-11' }),
      ],
    });
    expect(r.topCustomers).toEqual([]);
    expect(r.totals.billed).toBe('0.00');
  });
});
