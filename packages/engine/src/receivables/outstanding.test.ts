// Solde dû par devise (ADR-0040 § 3.1.2, lot C8). Attendus calculés à la main.

import { describe, expect, it } from 'vitest';

import {
  computeSettlement,
  RECEIVABLES_VERSION,
  sumOutstandingByCurrency,
  type OutstandingInput,
} from '../index.js';

const reglement = (
  amountOnCredit: string,
  allocations: string[],
  dueDate: string | null = null,
  creditNoteCredits: string[] = [],
) =>
  computeSettlement({
    amountOnCredit,
    creditNoteCredits,
    allocations,
    dueDate,
    asOf: '2026-10-29',
  });

describe('sumOutstandingByCurrency', () => {
  it('aucune facture : aucune devise', () => {
    expect(sumOutstandingByCurrency([])).toEqual({ version: RECEIVABLES_VERSION, byCurrency: [] });
  });

  it('une facture USD réglée à moitié et une facture CDF non réglée : deux devises, jamais une somme', () => {
    const items: OutstandingInput[] = [
      { currency: 'USD', settlement: reglement('92.80', ['46.40']) },
      { currency: 'CDF', settlement: reglement('250000.00', []) },
    ];
    expect(sumOutstandingByCurrency(items)).toEqual({
      version: RECEIVABLES_VERSION,
      byCurrency: [
        {
          currency: 'CDF',
          outstanding: '250000.00',
          openCount: 1,
          overdueOutstanding: '0.00',
          overdueCount: 0,
          creditBalance: '0.00',
          invoiceCount: 1,
        },
        {
          currency: 'USD',
          outstanding: '46.40',
          openCount: 1,
          overdueOutstanding: '0.00',
          overdueCount: 0,
          creditBalance: '0.00',
          invoiceCount: 1,
        },
      ],
    });
  });

  it('additionne au centime près, sépare l’échu, ignore les factures soldées dans les compteurs ouverts', () => {
    const items: OutstandingInput[] = [
      { currency: 'USD', settlement: reglement('0.10', []) },
      { currency: 'USD', settlement: reglement('0.20', [], '2026-10-01') },
      { currency: 'USD', settlement: reglement('100.00', ['100.00']) },
    ];
    const [usd] = sumOutstandingByCurrency(items).byCurrency;
    expect(usd).toEqual({
      currency: 'USD',
      outstanding: '0.30',
      openCount: 2,
      overdueOutstanding: '0.20',
      overdueCount: 1,
      creditBalance: '0.00',
      invoiceCount: 3,
    });
  });

  it('le crédit client est rendu à part, jamais déduit du reste dû', () => {
    const items: OutstandingInput[] = [
      { currency: 'USD', settlement: reglement('50.00', ['60.00']) },
      { currency: 'USD', settlement: reglement('30.00', []) },
    ];
    expect(sumOutstandingByCurrency(items).byCurrency[0]).toMatchObject({
      outstanding: '30.00',
      creditBalance: '10.00',
      openCount: 1,
    });
  });

  it('grands montants CDF exacts (aucun flottant)', () => {
    const items: OutstandingInput[] = [
      { currency: 'CDF', settlement: reglement('9007199254740993.01', []) },
      { currency: 'CDF', settlement: reglement('0.02', []) },
    ];
    expect(sumOutstandingByCurrency(items).byCurrency[0]!.outstanding).toBe('9007199254740993.03');
  });

  it('montant illisible ou devise manquante : erreur', () => {
    const ok = reglement('1.00', []);
    expect(() =>
      sumOutstandingByCurrency([{ currency: 'USD', settlement: { ...ok, outstanding: '1.001' } }]),
    ).toThrow(RangeError);
    expect(() => sumOutstandingByCurrency([{ currency: '', settlement: ok }])).toThrow(RangeError);
  });

  it('propriété à graine fixe : la somme des devises égale la somme facture par facture', () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const items: OutstandingInput[] = [];
    const attendu: Record<string, bigint> = { CDF: 0n, USD: 0n };
    for (let i = 0; i < 200; i++) {
      const currency = next() % 2 === 0 ? 'CDF' : 'USD';
      const due = BigInt(next() % 1_000_000);
      const paid = BigInt(next() % 1_200_000);
      const s = reglement((Number(due) / 100).toFixed(2), [(Number(paid) / 100).toFixed(2)]);
      items.push({ currency, settlement: s });
      attendu[currency]! += due > paid ? due - paid : 0n;
    }
    const out = sumOutstandingByCurrency(items).byCurrency;
    for (const c of out) {
      const cents = attendu[c.currency]!;
      expect(c.outstanding).toBe(`${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`);
    }
  });
});
