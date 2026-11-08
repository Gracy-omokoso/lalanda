// Tableaux de bord de la trésorerie (ADR-0071) : dépenses et comptes réels, par
// devise, jamais convertis.

import { describe, expect, it } from 'vitest';

import { computeAccountStats, computeExpenseStats, type ExpenseStatsExpense } from './stats.js';

const ASOF = '2026-11-08';

const dep = (over: Partial<ExpenseStatsExpense> = {}): ExpenseStatsExpense => ({
  id: 'e',
  status: 'recorded',
  spentOn: '2026-11-03',
  amount: '10.00',
  currency: 'USD',
  category: 'loyer',
  hasAttachment: true,
  ...over,
});

describe('computeExpenseStats', () => {
  it('mois en cours, mois précédent, catégories, sans pièce, compteurs du mois affiché', () => {
    const s = computeExpenseStats({
      asOf: ASOF,
      months: 12,
      listMonth: '2026-11',
      expenses: [
        dep({ amount: '30.00' }),
        dep({ category: 'marketing', amount: '30.00', hasAttachment: false }),
        dep({ category: 'achats', amount: '5.00' }),
        dep({ status: 'cancelled', amount: '999.00' }),
        dep({ spentOn: '2026-10-10', amount: '50.00' }),
        dep({ spentOn: '2026-11-30', amount: '7.00' }),
        dep({ currency: 'CDF', amount: '1000.00' }),
      ],
    });
    expect(s.statusCounts).toEqual({ recorded: 5, cancelled: 1, all: 6 });
    const usd = s.byCurrency.find((c) => c.currency === 'USD')!;
    expect(s.byCurrency[0]!.currency).toBe('USD');
    expect(usd.thisMonth).toEqual({ amount: '65.00', count: 3 });
    expect(usd.previousMonth).toEqual({ month: '2026-10', amount: '50.00', count: 1 });
    expect(usd.changePercent).toBe(30);
    // Égalité de montant : ordre d'ADR-0034 (loyer avant marketing).
    expect(usd.byCategoryThisMonth.map((c) => c.category)).toEqual([
      'loyer',
      'marketing',
      'achats',
    ]);
    expect(usd.withoutAttachmentThisMonth).toEqual({ amount: '30.00', count: 1 });
    // 50 sur 11 mois complets → 4,545… → 4.55
    expect(usd.monthlyAverage).toBe('4.55');
  });

  it('refuse un mois de liste illisible', () => {
    expect(() =>
      computeExpenseStats({ asOf: ASOF, months: 12, listMonth: '2026-13', expenses: [] }),
    ).toThrow(RangeError);
  });
});

describe('computeAccountStats', () => {
  it('solde au jour, entrées et sorties du mois, solde de fin de mois, découverts', () => {
    const s = computeAccountStats({
      asOf: ASOF,
      months: 3,
      accounts: [
        { id: 'caisse', currency: 'USD', openingBalance: '100.00', openingDate: '2026-09-01' },
        { id: 'banque', currency: 'USD', openingBalance: '0.00', openingDate: '2026-10-01' },
        {
          id: 'vieux',
          currency: 'USD',
          openingBalance: '500.00',
          openingDate: '2026-01-01',
          active: false,
        },
      ],
      movements: [
        { accountId: 'caisse', date: '2026-10-05', direction: 'in', amount: '50.00' },
        { accountId: 'banque', date: '2026-11-02', direction: 'out', amount: '20.00' },
        { accountId: 'caisse', date: '2026-11-03', direction: 'in', amount: '5.00' },
        { accountId: 'caisse', date: '2026-11-20', direction: 'out', amount: '1000.00' },
      ],
    });
    const usd = s.byCurrency[0]!;
    expect(usd.balance).toBe('135.00');
    expect(usd.activeAccounts).toBe(2);
    expect(usd.overdrawn).toBe(1);
    expect(usd.thisMonth).toEqual({ inflows: '5.00', outflows: '20.00', net: '-15.00' });
    expect(usd.months.map((m) => m.closingBalance)).toEqual(['100.00', '150.00', '135.00']);
    expect(usd.accounts).toEqual([
      { accountId: 'caisse', balance: '155.00' },
      { accountId: 'banque', balance: '-20.00' },
    ]);
  });
});
