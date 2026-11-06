// Tableau de bord des encaissements (ADR-0067). Attendus calculés à la main, puis
// propriétés à graine fixe.

import { describe, expect, it } from 'vitest';

import {
  computeInvoiceStats,
  computeReceiptStats,
  RECEIPT_STATS_VERSION,
  type InvoiceStatsDocument,
  type ReceiptStatsInput,
  type ReceiptStatsReceipt,
} from '../index.js';

const facture = (over: Partial<InvoiceStatsDocument> & { id: string }): InvoiceStatsDocument => ({
  status: 'issued',
  type: 'FV',
  series: 'real',
  issuedOn: '2026-10-01',
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

const recu = (
  over: Partial<ReceiptStatsReceipt> & { id: string; invoiceId?: string; amount?: string },
): ReceiptStatsReceipt => {
  const { invoiceId = 'f1', amount = '100.00', ...rest } = over;
  return {
    status: 'recorded',
    receivedOn: '2026-11-03',
    currency: 'CDF',
    method: 'MOBILEMONEY',
    allocations: [{ invoiceId, amount }],
    ...rest,
  };
};

const run = (over: Partial<ReceiptStatsInput>) =>
  computeReceiptStats({
    referenceCurrency: 'CDF',
    asOf: '2026-11-06',
    months: 12,
    documents: [facture({ id: 'f1' })],
    receipts: [],
    ...over,
  });

describe('computeReceiptStats — vide et fenêtre', () => {
  it('aucun encaissement : douze mois à zéro, restant dû de la facture', () => {
    const r = run({});
    expect(r.months).toHaveLength(12);
    expect(r.totals).toEqual({ collected: '0.00', count: 0 });
    expect(r.thisMonth).toEqual({ amount: '0.00', count: 0 });
    expect(r.previousMonth).toEqual({ month: '2026-10', amount: '0.00', count: 0 });
    expect(r.changePercent).toBeNull();
    expect(r.averageDelay).toMatchObject({ days: null, allocations: 0, since: '2026-08-09' });
    expect(r.outstanding).toEqual({ amount: '1000.00', count: 1 });
    expect(r.byMethod.map((m) => m.method)).toEqual([
      'ESPECES',
      'VIREMENT',
      'CARTEBANCAIRE',
      'MOBILEMONEY',
      'CHEQUES',
      'AUTRE',
    ]);
    expect(r.version).toBe(RECEIPT_STATS_VERSION);
  });

  it('refuse une date illisible', () => {
    expect(() => run({ asOf: '2026-11-31' })).toThrow(RangeError);
    expect(() => run({ receipts: [recu({ id: 'r', receivedOn: '03/11/2026' })] })).toThrow(
      RangeError,
    );
  });
});

describe('computeReceiptStats — montants', () => {
  it('mois en cours, mois précédent, variation ; annulés hors montants mais comptés', () => {
    const r = run({
      documents: [facture({ id: 'f1', total: '10000.00', amountOnCredit: '10000.00' })],
      receipts: [
        recu({ id: 'a', amount: '300.00', receivedOn: '2026-11-02' }),
        recu({ id: 'b', amount: '200.00', receivedOn: '2026-10-15', method: 'ESPECES' }),
        recu({ id: 'c', amount: '999.00', status: 'cancelled' }),
      ],
    });
    expect(r.thisMonth).toEqual({ amount: '300.00', count: 1 });
    expect(r.previousMonth).toMatchObject({ amount: '200.00', count: 1 });
    expect(r.changePercent).toBe(50);
    expect(r.totals).toEqual({ collected: '500.00', count: 2 });
    expect(r.statusCounts).toEqual({ all: 3, recorded: 2, cancelled: 1 });
    expect(r.outstanding).toEqual({ amount: '9500.00', count: 1 });
    expect(r.byMethod.find((m) => m.method === 'MOBILEMONEY')).toEqual({
      method: 'MOBILEMONEY',
      amount: '300.00',
      count: 1,
    });
    expect(r.byMethod.find((m) => m.method === 'ESPECES')?.amount).toBe('200.00');
  });

  it('variation négative arrondie demi vers le haut', () => {
    const r = run({
      documents: [facture({ id: 'f1', total: '10000.00', amountOnCredit: '10000.00' })],
      receipts: [
        recu({ id: 'a', amount: '100.00', receivedOn: '2026-11-02' }),
        recu({ id: 'b', amount: '300.00', receivedOn: '2026-10-15' }),
      ],
    });
    expect(r.changePercent).toBe(-67); // −66,67 %
  });

  it('lettrage au taux figé de sa facture ; sans taux : exclu et compté', () => {
    const r = run({
      documents: [
        facture({
          id: 'u1',
          currency: 'USD',
          total: '100.00',
          amountOnCredit: '100.00',
          conversion: { from: 'USD', to: 'CDF', rate: '2800' },
        }),
        facture({ id: 'u2', currency: 'USD', total: '50.00', amountOnCredit: '50.00' }),
      ],
      receipts: [
        recu({ id: 'a', currency: 'USD', invoiceId: 'u1', amount: '10.00' }),
        recu({ id: 'b', currency: 'USD', invoiceId: 'u2', amount: '20.00', method: 'VIREMENT' }),
      ],
    });
    expect(r.thisMonth).toEqual({ amount: '28000.00', count: 2 });
    expect(r.excluded.notConvertible).toEqual([{ currency: 'USD', count: 1, total: '20.00' }]);
    expect(r.byMethod.find((m) => m.method === 'VIREMENT')).toMatchObject({
      amount: '0.00',
      count: 1,
    });
    // Restant dû : celui de l'écran Factures (u1 converti, u2 sans taux écarté).
    expect(r.outstanding).toEqual({ amount: '252000.00', count: 1 });
  });

  it('encaissement après asOf ou hors fenêtre : ignoré', () => {
    const r = run({
      receipts: [
        recu({ id: 'a', receivedOn: '2026-11-07' }),
        recu({ id: 'b', receivedOn: '2025-11-30' }),
      ],
    });
    expect(r.totals.count).toBe(0);
  });
});

describe('computeReceiptStats — délai moyen', () => {
  it('jours entre émission et réception, moyenne simple, fenêtre de 90 jours', () => {
    const r = run({
      documents: [
        facture({ id: 'f1', issuedOn: '2026-10-01', total: '5000.00', amountOnCredit: '5000.00' }),
        facture({ id: 'f2', issuedOn: '2026-11-05', total: '5000.00', amountOnCredit: '5000.00' }),
      ],
      receipts: [
        recu({ id: 'a', invoiceId: 'f1', receivedOn: '2026-11-01' }), // 31 j
        recu({ id: 'b', invoiceId: 'f2', receivedOn: '2026-11-04' }), // daté avant : 0 j
        recu({ id: 'c', invoiceId: 'f1', receivedOn: '2026-10-11' }), // 10 j
        recu({ id: 'd', invoiceId: 'f1', receivedOn: '2026-08-08' }), // hors fenêtre
      ],
    });
    // (31 + 0 + 10) / 3 = 13,67 → 14.
    expect(r.averageDelay).toMatchObject({ days: 14, allocations: 3 });
  });
});

describe('computeReceiptStats — propriétés à graine fixe', () => {
  let seed = 2026;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const jour = () => {
    const m = 1 + (next() % 11);
    const d = 1 + (next() % 28);
    return `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  const documents: InvoiceStatsDocument[] = Array.from({ length: 40 }, (_, i) =>
    facture({
      id: `f${i}`,
      issuedOn: jour(),
      total: '100000000.00',
      amountOnCredit: '100000000.00',
      currency: i % 4 === 0 ? 'USD' : 'CDF',
      conversion: i % 8 === 0 ? { from: 'USD', to: 'CDF', rate: '2750.5' } : null,
    }),
  );
  const methodes = ['ESPECES', 'VIREMENT', 'CARTEBANCAIRE', 'MOBILEMONEY', 'CHEQUES', 'AUTRE'];
  const receipts: ReceiptStatsReceipt[] = Array.from({ length: 250 }, (_, i) => {
    const f = documents[next() % documents.length]!;
    return recu({
      id: `r${i}`,
      status: next() % 9 === 0 ? 'cancelled' : 'recorded',
      receivedOn: jour(),
      currency: f.currency,
      method: methodes[next() % methodes.length]!,
      invoiceId: f.id,
      amount: `${1 + (next() % 50_000)}.${String(next() % 100).padStart(2, '0')}`,
    });
  });
  const r = run({ documents, receipts });
  const cents = (s: string) => BigInt(s.replace('.', ''));

  it('la somme des mois égale le total, et celle des moyens aussi', () => {
    const mois = r.months.reduce((a, m) => a + cents(m.collected), 0n);
    expect(mois).toBe(cents(r.totals.collected));
    const moyens = r.byMethod.reduce((a, m) => a + cents(m.amount), 0n);
    expect(moyens).toBe(cents(r.totals.collected));
    expect(r.byMethod.reduce((a, m) => a + m.count, 0)).toBe(r.totals.count);
    expect(r.months.reduce((a, m) => a + m.count, 0)).toBe(r.totals.count);
  });

  it('restant dû identique à celui du tableau des factures', () => {
    const f = computeInvoiceStats({
      referenceCurrency: 'CDF',
      asOf: '2026-11-06',
      months: 12,
      documents,
      allocations: receipts
        .filter((x) => x.status === 'recorded')
        .flatMap((x) => x.allocations.map((a) => ({ ...a, receivedOn: x.receivedOn }))),
    });
    expect(r.outstanding).toEqual(f.outstanding);
    expect(r.overdue).toEqual(f.overdue);
  });

  it('compteurs de statut cohérents ; délai positif ou nul ; déterministe', () => {
    expect(r.statusCounts.recorded + r.statusCounts.cancelled).toBe(r.statusCounts.all);
    expect(r.averageDelay.days ?? 0).toBeGreaterThanOrEqual(0);
    expect(run({ documents, receipts: [...receipts].reverse() })).toEqual(r);
  });
});
