// À-nouveaux et reprise (ADR-0049 § 3.2, § 4, lot K3). Numéros : données de test.

import { describe, expect, it } from 'vitest';

import {
  computeTrialBalance,
  type ReportingChart,
  type ReportingEntry,
  type ReportingLine,
} from '../ledger/index.js';
import { computeOpeningEntries, proposeCutoverOpening, type CutoverOpeningInput } from './index.js';

const L = (account: string, side: 'D' | 'C', amount: string, o: Partial<ReportingLine> = {}): ReportingLine => ({
  accountNumber: account,
  auxiliaryAccountNumber: null,
  label: 'l',
  debit: side === 'D' ? amount : null,
  credit: side === 'C' ? amount : null,
  currency: 'CDF',
  amount,
  ...o,
});
const E = (id: string, date: string, lines: ReportingLine[], o: Partial<ReportingEntry> = {}): ReportingEntry => ({
  id,
  journalCode: 'VE',
  fiscalYear: 2026,
  number: 1,
  date,
  status: 'posted',
  source: null,
  sourceKey: null,
  lines,
  ...o,
});

const chart: ReportingChart = {
  classes: [
    { number: '1', label: 'c1', confirmation: 'to_confirm' },
    { number: '4', label: 'c4', confirmation: 'to_confirm' },
    { number: '5', label: 'c5', confirmation: 'to_confirm' },
    { number: '6', label: 'c6', confirmation: 'to_confirm' },
    { number: '7', label: 'c7', confirmation: 'to_confirm' },
    { number: '9', label: 'c9', confirmation: 'to_confirm' },
  ],
  accounts: [
    { number: '13', label: 'Résultat', classNumber: '1', nature: 'equity', confirmation: 'to_confirm' },
    { number: '411', label: 'Clients', classNumber: '4', nature: 'asset', confirmation: 'to_confirm' },
    { number: '44', label: 'État', classNumber: '4', nature: 'mixed', confirmation: 'to_confirm' },
    { number: '52', label: 'Banques', classNumber: '5', nature: 'asset', confirmation: 'sourced' },
    { number: '60', label: 'Achats', classNumber: '6', nature: 'expense', confirmation: 'to_confirm' },
    { number: '70', label: 'Ventes', classNumber: '7', nature: 'income', confirmation: 'to_confirm' },
    { number: '90', label: 'Hors bilan', classNumber: '9', nature: 'off_balance', confirmation: 'to_confirm' },
  ],
};

const year = [
  E('s1', '2026-02-01', [
    L('411', 'D', '1160.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f1' }),
    L('706', 'C', '1000.00'),
    L('4431', 'C', '160.00'),
  ]),
  E('s2', '2026-03-01', [
    L('411', 'D', '2800.00', { auxiliaryAccountNumber: 'C2', documentRef: 'f2', currency: 'USD', amount: '1.00' }),
    L('706', 'C', '2800.00', { currency: 'USD', amount: '1.00' }),
  ]),
  E('r1', '2026-04-01', [
    L('521', 'D', '500.00'),
    L('411', 'C', '500.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f1' }),
  ]),
  E('x1', '2026-05-01', [L('601', 'D', '300.00'), L('521', 'C', '300.00')]),
  E('h1', '2026-05-02', [L('901', 'D', '9.00'), L('902', 'C', '9.00')]),
  E('h2', '2026-05-03', [L('ATT', 'D', '9.00'), L('521', 'C', '9.00')]),
  E('late', '2027-01-02', [L('601', 'D', '1.00'), L('521', 'C', '1.00')]),
  E('w', '2026-06-01', [L('601', 'D', '1.00'), L('521', 'C', '1.00')], { status: 'awaiting_rate' }),
];

const base = {
  entries: year,
  bookCurrency: 'CDF' as const,
  fiscalYearEnd: '2026-12-31',
  openingDate: '2027-01-01',
  journalCode: 'AN',
  chart,
  resultAccountNumber: '131',
  suspenseAccountNumber: 'ATT',
};

describe('computeOpeningEntries', () => {
  it('reporte exactement les comptes de bilan, résultat au compte désigné', () => {
    const o = computeOpeningEntries(base);
    expect(o.proposal).toBe(true);
    expect(o.balanced).toBe(true);
    expect(o.date).toBe('2027-01-01');
    expect(o.lines.map((l) => [l.accountNumber, l.auxiliaryAccountNumber, l.debit, l.credit, l.currency, l.amount])).toEqual([
      ['411', 'C1', '660.00', null, 'CDF', '660.00'],
      ['411', 'C2', '2800.00', null, 'USD', '1.00'],
      ['4431', null, null, '160.00', 'CDF', '-160.00'],
      ['521', null, '191.00', null, 'CDF', '191.00'],
      ['ATT', null, '9.00', null, 'CDF', '9.00'],
      ['131', null, null, '3500.00', 'CDF', '-3500.00'],
    ]);
    expect(o.result).toEqual({ amount: '3500.00', accountNumber: '131', treatment: 'result_account', note: "À confirmer par l'expert-comptable" });
    expect(o.lines.at(-1)?.confirmation).toBe('to_confirm');
    expect(o.totals).toEqual({ debit: '3660.00', credit: '3660.00' });
    expect(o.notCarried.map((n) => [n.accountNumber, n.nature, n.balance])).toEqual([
      ['601', 'expense', '300.00'],
      ['706', 'income', '-3800.00'],
      ['901', 'off_balance', '9.00'],
      ['902', 'off_balance', '-9.00'],
    ]);
    expect(o.warnings.map((w) => [w.code, w.accountNumber])).toEqual([
      ['UNCLASSIFIED_ACCOUNT_CARRIED', 'ATT'],
      ['OFF_BALANCE_NOT_CARRIED', '901'],
      ['OFF_BALANCE_NOT_CARRIED', '902'],
    ]);
  });

  it('les à-nouveaux rendent une balance d’ouverture égale aux soldes de bilan', () => {
    const o = computeOpeningEntries(base);
    const an: ReportingEntry = E('an', '2027-01-01', o.lines.map((l) => ({
      accountNumber: l.accountNumber,
      auxiliaryAccountNumber: l.auxiliaryAccountNumber,
      label: l.label,
      debit: l.debit,
      credit: l.credit,
      currency: l.currency,
      amount: l.amount.replace('-', ''),
    })));
    const closing = computeTrialBalance({ entries: year, bookCurrency: 'CDF', from: '2026-01-01', to: '2026-12-31' });
    const next = computeTrialBalance({ entries: [an], bookCurrency: 'CDF', from: '2027-01-01', to: '2027-12-31', openingJournalCodes: ['VE'] });
    for (const n of ['411', '4431', '521', 'ATT']) {
      expect(next.rows.find((r) => r.accountNumber === n)?.closingBalance).toBe(
        closing.rows.find((r) => r.accountNumber === n)?.closingBalance,
      );
    }
    expect(next.balanced).toBe(true);
  });

  it('sans compte de résultat : compte d’attente, motif à confirmer', () => {
    const o = computeOpeningEntries({ ...base, resultAccountNumber: null });
    expect(o.result.treatment).toBe('suspense');
    expect(o.lines.at(-1)).toMatchObject({ accountNumber: 'ATT', suspenseReason: 'RESULT_TREATMENT_TO_CONFIRM' });
    expect(o.balanced).toBe(true);
  });

  it('tiers détaillés par pièce ouverte ; lignes lettrées non détaillées', () => {
    const extra = E('r2', '2026-06-01', [
      L('521', 'D', '100.00'),
      L('411', 'C', '100.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f3', letteringCode: 'A' }),
    ]);
    const f3 = E('s3', '2026-06-01', [
      L('411', 'D', '100.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f3', letteringCode: 'A' }),
      L('706', 'C', '100.00'),
    ]);
    const o = computeOpeningEntries({ ...base, entries: [...year, extra, f3], detailThirdPartiesByDocument: true });
    const c1 = o.lines.filter((l) => l.auxiliaryAccountNumber === 'C1');
    expect(c1.map((l) => [l.documentRef, l.debit, l.label])).toEqual([['f1', '660.00', 'À-nouveau — pièce f1']]);
    expect(o.balanced).toBe(true);
  });

  it('écart de change sur un tiers : solde en devise nul mais solde de tenue non nul, signalé', () => {
    const inv = E('i', '2026-02-01', [
      L('411', 'D', '2800.00', { auxiliaryAccountNumber: 'U', currency: 'USD', amount: '1.00' }),
      L('706', 'C', '2800.00', { currency: 'USD', amount: '1.00' }),
    ]);
    const rec = E('r', '2026-03-01', [
      L('521', 'D', '2900.00', { currency: 'USD', amount: '1.00' }),
      L('411', 'C', '2900.00', { auxiliaryAccountNumber: 'U', currency: 'USD', amount: '1.00' }),
    ]);
    const o = computeOpeningEntries({ ...base, entries: [inv, rec] });
    const w = o.warnings.find((x) => x.code === 'DOCUMENT_SIGN_DIFFERS' || x.code === 'DOCUMENT_BALANCE_WITHOUT_BOOK_BALANCE');
    expect(o.lines.find((l) => l.auxiliaryAccountNumber === 'U')).toMatchObject({ credit: '100.00', amount: '0.00' });
    expect(w).toBeUndefined();
    const usdOnly = E('z', '2026-03-02', [
      L('521', 'D', '0.01', { currency: 'USD', amount: '1.00' }),
      L('411', 'C', '0.01', { auxiliaryAccountNumber: 'V', currency: 'USD', amount: '1.00' }),
    ]);
    const back = E('y', '2026-03-03', [
      L('411', 'D', '0.01', { auxiliaryAccountNumber: 'V', currency: 'USD', amount: '2.00' }),
      L('521', 'C', '0.01', { currency: 'USD', amount: '2.00' }),
    ]);
    const o2 = computeOpeningEntries({ ...base, entries: [usdOnly, back] });
    expect(o2.warnings.map((x) => x.code)).toContain('DOCUMENT_BALANCE_WITHOUT_BOOK_BALANCE');
  });

  it('source déséquilibrée signalée ; dates incohérentes refusées', () => {
    const o = computeOpeningEntries({ ...base, entries: [E('b', '2026-01-01', [L('521', 'D', '2.00'), L('706', 'C', '1.00')])] });
    expect(o.warnings[0]?.code).toBe('SOURCE_UNBALANCED');
    expect(o.balanced).toBe(false);
    expect(() => computeOpeningEntries({ ...base, openingDate: '2026-12-31' })).toThrow(RangeError);
    expect(() => computeOpeningEntries({ ...base, suspenseAccountNumber: '' })).toThrow(RangeError);
  });
});

describe('proposeCutoverOpening', () => {
  const input: CutoverOpeningInput = {
    cutoverDate: '2026-11-01',
    bookCurrency: 'CDF',
    journalCode: 'AN',
    suspenseAccountNumber: 'ATT',
    treasury: {
      balances: [
        { accountId: 'bank', currency: 'CDF', balance: '1500.50' },
        { accountId: 'cash', currency: 'USD', balance: '10.00' },
        { accountId: 'mm', currency: 'CDF', balance: '-20.00' },
        { accountId: 'zero', currency: 'CDF', balance: '0.00' },
      ],
      accountNumbers: { bank: '521', cash: '571', mm: null },
    },
    receivables: [
      { documentId: 'f1', documentNumber: 'FV-1', partyName: 'Client A', auxiliaryAccountNumber: 'C1', currency: 'CDF', outstanding: '300.00' },
      { documentId: 'f2', documentNumber: null, partyName: null, auxiliaryAccountNumber: 'C2', currency: 'USD', outstanding: '5.00' },
      { documentId: 'f0', documentNumber: 'FV-0', partyName: null, auxiliaryAccountNumber: 'C3', currency: 'CDF', outstanding: '0.00' },
    ],
    payables: [{ documentId: 'p1', documentNumber: 'FF-1', partyName: 'Fournisseur', auxiliaryAccountNumber: 'S1', currency: 'CDF', outstanding: '80.00' }],
    collectiveAccounts: { customer: '411', supplier: null },
    rates: [
      { date: '2026-11-01', from: 'USD', to: 'CDF', rate: '2800.123' },
      { date: '2026-10-31', from: 'USD', to: 'CDF', rate: '9999' },
    ],
  };

  it('propose trésorerie, restes à encaisser et à payer ; jamais d’équilibre inventé', () => {
    const p = proposeCutoverOpening(input);
    expect(p.proposal).toBe(true);
    expect(p.counterpartRequired).toBe(true);
    expect(p.notProposed).toContain('capitaux_propres');
    expect(p.lines.map((l) => [l.kind, l.accountNumber, l.auxiliaryAccountNumber, l.side, l.currency, l.amount, l.bookAmount, l.rateSource, l.suspenseReason])).toEqual([
      ['treasury', '521', null, 'debit', 'CDF', '1500.50', '1500.50', 'same_currency', null],
      ['treasury', '571', null, 'debit', 'USD', '10.00', '28001.23', 'entered', null],
      ['treasury', 'ATT', null, 'credit', 'CDF', '20.00', '20.00', 'same_currency', 'NO_TREASURY_ACCOUNT'],
      ['receivable', '411', 'C1', 'debit', 'CDF', '300.00', '300.00', 'same_currency', null],
      ['receivable', '411', 'C2', 'debit', 'USD', '5.00', '14000.62', 'entered', null],
      ['payable', 'ATT', null, 'credit', 'CDF', '80.00', '80.00', 'same_currency', 'NO_COLLECTIVE_ACCOUNT'],
    ]);
    expect(p.lines[3]).toMatchObject({ documentRef: 'f1', label: 'Reprise — reste à encaisser, facture FV-1, Client A' });
    expect(p.bookImbalance).toBe('43702.35');
    expect(p.awaitingRateCount).toBe(0);
  });

  it('sans taux du jour de bascule exactement : la ligne attend (jamais la veille)', () => {
    const p = proposeCutoverOpening({ ...input, rates: [{ date: '2026-10-31', from: 'USD', to: 'CDF', rate: '2800' }] });
    const usd = p.lines.filter((l) => l.currency === 'USD');
    expect(usd.every((l) => l.status === 'awaiting_rate' && l.bookAmount === null && l.rate === null)).toBe(true);
    expect(p.awaitingRateCount).toBe(2);
    expect(p.bookImbalance).toBe('1700.50');
  });

  it('refuse un taux ou une devise illisible', () => {
    expect(() => proposeCutoverOpening({ ...input, rates: [{ date: '2026-11-01', from: 'USD', to: 'CDF', rate: '0' }] })).toThrow('Taux');
    expect(() =>
      proposeCutoverOpening({ ...input, treasury: { ...input.treasury, balances: [{ accountId: 'x', currency: 'EUR', balance: '1.00' }] } }),
    ).toThrow('devise');
  });
});
