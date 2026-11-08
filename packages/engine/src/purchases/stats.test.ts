// Tableaux de bord des achats (ADR-0071) : définitions des cartes, des courbes et
// des compteurs, par devise et jamais converties.

import { describe, expect, it } from 'vitest';

import {
  computePayablesStats,
  computePurchaseOrderStats,
  computeSupplierInvoiceStats,
  type SupplierInvoiceStatsInvoice,
} from './stats.js';

const ASOF = '2026-11-08';

const facture = (over: Partial<SupplierInvoiceStatsInvoice> = {}): SupplierInvoiceStatsInvoice => ({
  id: 'f1',
  kind: 'invoice',
  status: 'validated',
  currency: 'USD',
  invoiceDate: '2026-11-02',
  dueDate: '2026-12-02',
  total: '100.00',
  matchingStatus: 'matched',
  disputed: false,
  remaining: '100.00',
  costAllocations: [{ category: 'achats', amount: '100.00' }],
  ...over,
});

describe('computeSupplierInvoiceStats', () => {
  it('compte comme les filtres de la liste et calcule les montants par devise', () => {
    const s = computeSupplierInvoiceStats({
      asOf: ASOF,
      months: 12,
      invoices: [
        facture(),
        facture({
          id: 'f2',
          invoiceDate: '2026-10-05',
          dueDate: '2026-11-01',
          total: '50.00',
          remaining: '20.00',
        }),
        facture({
          id: 'f3',
          status: 'draft',
          matchingStatus: 'variance',
          total: '30.00',
          remaining: '0.00',
        }),
        facture({ id: 'f4', status: 'draft', total: '10.00', remaining: '0.00' }),
        facture({ id: 'f5', status: 'cancelled', disputed: true, remaining: '0.00' }),
        facture({ id: 'f6', currency: 'CDF', total: '1000.00', remaining: '0.00' }),
        facture({ id: 'f7', kind: 'credit_note', total: '5.00', remaining: '0.00' }),
      ],
    });
    expect(s.statusCounts).toEqual({
      all: 7,
      draft: 2,
      variance: 1,
      validated: 4,
      overdue: 1,
      disputed: 1,
    });
    expect(s.byCurrency.map((c) => c.currency)).toEqual(['USD', 'CDF']);
    const usd = s.byCurrency[0]!;
    expect(usd.thisMonth).toEqual({ amount: '100.00', count: 1 });
    expect(usd.previousMonth).toEqual({ month: '2026-10', amount: '50.00', count: 1 });
    expect(usd.changePercent).toBe(100);
    expect(usd.outstanding).toEqual({ amount: '120.00', count: 2 });
    expect(usd.overdue).toEqual({ amount: '20.00', count: 1 });
    expect(usd.drafts).toEqual({ amount: '40.00', count: 2 });
    expect(usd.variances).toEqual({ amount: '30.00', count: 1 });
    expect(usd.byCategory).toEqual([{ category: 'achats', amount: '200.00', count: 2 }]);
    expect(usd.months).toHaveLength(12);
    expect(s.from).toBe('2025-12');
    expect(s.byCurrency[1]!.thisMonth.amount).toBe('1000.00');
  });

  it('variation nulle sans mois précédent, négative arrondie demi vers le haut', () => {
    const vide = computeSupplierInvoiceStats({ asOf: ASOF, months: 12, invoices: [facture()] });
    expect(vide.byCurrency[0]!.changePercent).toBeNull();
    const baisse = computeSupplierInvoiceStats({
      asOf: ASOF,
      months: 12,
      invoices: [
        facture({ total: '1.00', remaining: '0.00' }),
        facture({ id: 'p', invoiceDate: '2026-10-01', total: '8.00', remaining: '0.00' }),
      ],
    });
    // (1 − 8) / 8 = −87,5 % → −88 %
    expect(baisse.byCurrency[0]!.changePercent).toBe(-88);
  });

  it('refuse une fenêtre de mois invalide', () => {
    expect(() => computeSupplierInvoiceStats({ asOf: ASOF, months: 0, invoices: [] })).toThrow(
      RangeError,
    );
  });
});

describe('computePayablesStats', () => {
  it('dû, échu, sous 7 et 30 jours, litiges à part, groupes de l’écran', () => {
    const s = computePayablesStats({
      asOf: ASOF,
      months: 12,
      dueSoonDays: 7,
      invoices: [
        {
          id: 'a',
          supplierId: 's1',
          currency: 'USD',
          invoiceDate: '2026-09-01',
          dueDate: '2026-10-01',
          remaining: '40.00',
          disputed: false,
        },
        {
          id: 'b',
          supplierId: 's1',
          currency: 'USD',
          invoiceDate: '2026-11-01',
          dueDate: '2026-11-15',
          remaining: '10.00',
          disputed: false,
        },
        {
          id: 'c',
          supplierId: 's2',
          currency: 'USD',
          invoiceDate: '2026-11-01',
          dueDate: '2026-12-01',
          remaining: '25.00',
          disputed: false,
        },
        {
          id: 'd',
          supplierId: 's2',
          currency: 'USD',
          invoiceDate: '2026-11-01',
          dueDate: '2026-12-31',
          remaining: '5.00',
          disputed: false,
        },
        {
          id: 'e',
          supplierId: 's3',
          currency: 'USD',
          invoiceDate: '2026-11-01',
          dueDate: '2026-11-01',
          remaining: '7.00',
          disputed: true,
        },
      ],
      payments: [
        {
          id: 'p1',
          status: 'recorded',
          currency: 'USD',
          paidOn: '2026-11-03',
          amount: '30.00',
          allocations: [{ invoiceId: 'x', invoiceDate: '2026-10-24' }],
        },
        {
          id: 'p2',
          status: 'recorded',
          currency: 'USD',
          paidOn: '2026-10-10',
          amount: '20.00',
          allocations: [{ invoiceId: 'y', invoiceDate: '2026-10-15' }],
        },
        {
          id: 'p3',
          status: 'cancelled',
          currency: 'USD',
          paidOn: '2026-11-03',
          amount: '99.00',
          allocations: [{ invoiceId: 'z', invoiceDate: '2026-01-01' }],
        },
      ],
    });
    expect(s.groupCounts).toEqual({ overdue: 1, soon: 1, later: 2, disputed: 1 });
    const usd = s.byCurrency[0]!;
    expect(usd.due).toEqual({ amount: '80.00', count: 4 });
    expect(usd.overdue).toEqual({ amount: '40.00', count: 1 });
    expect(usd.dueWithin7).toEqual({ amount: '10.00', count: 1 });
    expect(usd.dueWithin30).toEqual({ amount: '35.00', count: 2 });
    expect(usd.disputed).toEqual({ amount: '7.00', count: 1 });
    expect(usd.thisMonth).toEqual({ amount: '30.00', count: 1 });
    expect(usd.changePercent).toBe(50);
    // 10 jours et 0 (payé avant la date de facture) → 5
    expect(usd.averageDelay.days).toBe(5);
    expect(usd.averageDelay.allocations).toBe(2);
    expect(usd.aging.days31To60).toEqual({ amount: '40.00', count: 1 });
    expect(usd.topSuppliers[0]).toEqual({ supplierId: 's1', amount: '50.00', count: 2 });
  });

  it('sans paiement, le délai moyen est inconnu', () => {
    const s = computePayablesStats({
      asOf: ASOF,
      months: 12,
      dueSoonDays: 7,
      invoices: [
        {
          id: 'a',
          supplierId: 's1',
          currency: 'CDF',
          invoiceDate: '2026-11-01',
          dueDate: '2026-11-30',
          remaining: '1.00',
          disputed: false,
        },
      ],
      payments: [],
    });
    expect(s.byCurrency[0]!.averageDelay.days).toBeNull();
  });
});

describe('computePurchaseOrderStats', () => {
  it('compteurs des filtres, commandes ouvertes, à approuver, délai d’approbation', () => {
    const base = {
      phase: 'request' as const,
      currency: 'USD' as const,
      requestedBy: 'moi',
      total: '10.00',
      submittedOn: null,
      approvedOn: null,
    };
    const s = computePurchaseOrderStats({
      asOf: ASOF,
      months: 12,
      me: 'moi',
      orders: [
        { ...base, id: '1', status: 'draft' },
        { ...base, id: '2', status: 'submitted', submittedOn: '2026-11-01', requestedBy: 'autre' },
        {
          ...base,
          id: '3',
          phase: 'order',
          status: 'sent',
          total: '200.00',
          submittedOn: '2026-11-01',
          approvedOn: '2026-11-04',
        },
        {
          ...base,
          id: '4',
          phase: 'order',
          status: 'closed',
          total: '50.00',
          submittedOn: '2026-10-01',
          approvedOn: '2026-10-03',
        },
      ],
    });
    expect(s.statusCounts).toEqual({ all: 4, mine: 3, draft: 1, submitted: 1, order: 2 });
    const usd = s.byCurrency[0]!;
    expect(usd.thisMonth).toEqual({ amount: '200.00', count: 1 });
    expect(usd.open).toEqual({ amount: '200.00', count: 1 });
    expect(usd.pendingApproval).toEqual({ amount: '10.00', count: 1 });
    // 3 j et 2 j → 2,5 → 3
    expect(usd.averageApprovalDelay.days).toBe(3);
    expect(s.byStatus.reduce((n, x) => n + x.count, 0)).toBe(4);
  });
});
