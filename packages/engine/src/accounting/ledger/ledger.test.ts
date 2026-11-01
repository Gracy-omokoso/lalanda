// Grand livre, balances et lettrage (ADR-0049 § 6.11, lot K3). Attendus
// calculés à la main. Les numéros de compte ci-dessous sont des DONNÉES DE
// TEST : le code ne les connaît pas, le plan de test les déclare.

import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_REPORTING_VERSION,
  checkLettering,
  computeAuxiliaryBalances,
  computeLedger,
  computeTrialBalance,
  lineRefOf,
  resolveLettering,
  suggestLettering,
  type ReportingChart,
  type ReportingEntry,
  type ReportingLine,
} from './index.js';

type Opt = Partial<ReportingLine>;
const D = (account: string, amount: string, o: Opt = {}): ReportingLine => ({
  accountNumber: account,
  auxiliaryAccountNumber: null,
  label: 'ligne',
  debit: amount,
  credit: null,
  currency: 'CDF',
  amount,
  ...o,
});
const C = (account: string, amount: string, o: Opt = {}): ReportingLine => ({
  ...D(account, amount, o),
  debit: null,
  credit: amount,
});
const entry = (
  id: string,
  date: string,
  lines: ReportingLine[],
  o: Partial<ReportingEntry> = {},
): ReportingEntry => ({
  id,
  journalCode: 'VE',
  fiscalYear: 2026,
  number: null,
  date,
  status: 'posted',
  source: {
    kind: 'sales_invoice',
    id: `src-${id}`,
    number: `N-${id}`,
    date,
    partyName: 'Client A',
  },
  sourceKey: `k:${id}`,
  lines,
  ...o,
});

const chart: ReportingChart = {
  classes: [
    { number: 4, label: 'Tiers', confirmation: 'to_confirm' },
    { number: 5, label: 'Trésorerie', confirmation: 'sourced' },
    { number: 7, label: 'Produits', confirmation: 'to_confirm' },
  ],
  accounts: [
    {
      number: '411',
      label: 'Clients',
      classNumber: 4,
      nature: 'asset',
      confirmation: 'to_confirm',
      collective: true,
      auxiliaryKind: 'customer',
    },
    { number: '521', label: 'Banques', classNumber: 5, nature: 'asset', confirmation: 'sourced' },
    {
      number: '706',
      label: 'Services',
      classNumber: 7,
      nature: 'income',
      confirmation: 'to_confirm',
    },
  ],
};

const sale = entry('e1', '2026-03-05', [
  D('411', '1160.00', { auxiliaryAccountNumber: '411C1', documentRef: 'inv1' }),
  C('706', '1000.00'),
  C('4431', '160.00'),
]);
const receipt = entry(
  'e2',
  '2026-03-20',
  [
    D('5211', '1160.00'),
    C('411', '1160.00', { auxiliaryAccountNumber: '411C1', documentRef: 'inv1' }),
  ],
  { journalCode: 'T01' },
);
const before = entry('e0', '2026-02-10', [D('5211', '50.00'), C('ATTENTE', '50.00')], {
  journalCode: 'OD',
  generation: null,
});
const awaiting = entry('e3', '2026-03-21', [D('601', '10.00'), C('5211', '10.00')], {
  status: 'awaiting_rate',
});
const draft = entry('e4', '2026-03-22', [D('601', '10.00'), C('5211', '10.00')], {
  status: 'draft',
});
const after = entry('e5', '2026-04-01', [D('601', '10.00'), C('5211', '10.00')]);
const all = [before, sale, receipt, awaiting, draft, after];
const period = { bookCurrency: 'CDF' as const, from: '2026-03-01', to: '2026-03-31', chart };

describe('computeTrialBalance', () => {
  const tb = computeTrialBalance({ ...period, entries: all });

  it('balance équilibrée, ouverture = lignes antérieures, période seule en mouvements', () => {
    expect(tb.version).toBe(ACCOUNTING_REPORTING_VERSION);
    expect(tb.balanced).toBe(true);
    expect(tb.totals).toEqual({
      openingDebit: '50.00',
      openingCredit: '50.00',
      periodDebit: '2320.00',
      periodCredit: '2320.00',
      closingDebit: '1210.00',
      closingCredit: '1210.00',
    });
    const bank = tb.rows.find((r) => r.accountNumber === '5211');
    expect(bank).toMatchObject({
      openingDebit: '50.00',
      periodDebit: '1160.00',
      periodCredit: '0.00',
      closingDebit: '1210.00',
      closingBalance: '1210.00',
      classNumber: '5',
      confirmation: 'sourced',
    });
    expect(tb.rows.find((r) => r.accountNumber === '411')?.closingBalance).toBe('0.00');
  });

  it('écarte brouillons, attente de taux et lignes postérieures, et les compte', () => {
    expect(tb.excluded).toEqual({ draft: 1, awaitingRate: 1, afterPeriod: 2 });
    expect(tb.rows.some((r) => r.accountNumber === '601')).toBe(false);
  });

  it('classes issues du pack ; compte non rattaché → non classé, à confirmer', () => {
    expect(tb.classes.map((c) => c.classNumber)).toEqual(['4', '5', '7', null]);
    const none = tb.classes.find((c) => c.classNumber === null);
    expect(none?.confirmation).toBe('to_confirm');
    expect(none?.accountCount).toBe(1); // ATTENTE
    // 4431 rattaché à la classe 4 par le préfixe de classe du pack (aucun compte du pack ne le préfixe).
    expect(tb.rows.find((r) => r.accountNumber === '4431')).toMatchObject({
      classNumber: '4',
      confirmation: 'to_confirm',
      label: null,
    });
    expect(tb.rows.find((r) => r.accountNumber === '411')?.label).toBe('Clients');
  });

  it('sans plan : tout est non classé', () => {
    const t = computeTrialBalance({ ...period, chart: null, entries: all });
    expect(t.classes).toHaveLength(1);
    expect(t.classes[0]?.classNumber).toBeNull();
  });

  it('signale une écriture déséquilibrée', () => {
    const bad = entry('bad', '2026-03-10', [D('5211', '10.00'), C('706', '9.99')]);
    const t = computeTrialBalance({ ...period, entries: [bad] });
    expect(t.balanced).toBe(false);
    expect(t.unbalancedEntries).toEqual([{ entryId: 'bad', difference: '0.01' }]);
  });

  it('journal d’à-nouveaux compté en ouverture même daté dans la période', () => {
    const an = entry('an', '2026-03-01', [D('5211', '5.00'), C('ATTENTE', '5.00')], {
      journalCode: 'AN',
    });
    const t = computeTrialBalance({ ...period, entries: [an], openingJournalCodes: ['AN'] });
    expect(t.totals.openingDebit).toBe('5.00');
    expect(t.totals.periodDebit).toBe('0.00');
  });

  it('refuse les entrées illisibles', () => {
    expect(() => computeTrialBalance({ ...period, from: '2026-02-30', entries: [] })).toThrow(
      RangeError,
    );
    expect(() => computeTrialBalance({ ...period, from: '2026-04-01', entries: [] })).toThrow(
      'inversée',
    );
    expect(() =>
      computeTrialBalance({
        ...period,
        entries: [entry('x', '2026-03-01', [{ ...D('1', '1'), credit: '1' }])],
      }),
    ).toThrow('soit un débit');
    expect(() =>
      computeTrialBalance({ ...period, entries: [entry('x', '2026-03-01', [D('1', '1.001')])] }),
    ).toThrow('illisible');
    expect(() =>
      computeTrialBalance({ ...period, entries: [entry('x', '2026-03-01', [D('1', '0.00')])] }),
    ).toThrow('strictement positif');
    expect(() =>
      computeTrialBalance({
        ...period,
        entries: [entry('x', '2026-03-01', [D('1', '1.00', { currency: 'EUR' as never })])],
      }),
    ).toThrow('devise');
    expect(() => computeTrialBalance({ ...period, entries: [sale, sale] })).toThrow('double');
  });
});

describe('computeLedger', () => {
  it('solde progressif en monnaie de tenue, devise de la pièce à part', () => {
    const usd = entry('u', '2026-03-25', [
      D('5211', '2800.00', { currency: 'USD', amount: '1.00' }),
      C('ATTENTE', '2800.00', { currency: 'USD', amount: '1.00' }),
    ]);
    const l = computeLedger({ ...period, entries: [...all, usd] });
    const bank = l.accounts.find((a) => a.accountNumber === '5211');
    expect(bank?.openingBalance).toBe('50.00');
    expect(bank?.lines.map((x) => x.balance)).toEqual(['1210.00', '4010.00']);
    expect(bank?.lines.map((x) => [x.currency, x.amount])).toEqual([
      ['CDF', '1160.00'],
      ['USD', '1.00'],
    ]);
    expect(bank?.byCurrency).toEqual([
      { currency: 'CDF', debit: '1160.00', credit: '0.00', balance: '1160.00' },
      { currency: 'USD', debit: '1.00', credit: '0.00', balance: '1.00' },
    ]);
    expect(bank?.closingBalance).toBe('4010.00');
    expect(l.excluded).toEqual({ draft: 1, awaitingRate: 1, afterPeriod: 2 });
  });

  it('niveau auxiliaire et filtre par préfixe', () => {
    const l = computeLedger({ ...period, entries: all, level: 'auxiliary' });
    expect(l.accounts.map((a) => a.accountNumber)).toEqual(['411C1']);
    expect(l.accounts[0]?.generalAccountNumber).toBe('411');
    expect(l.accounts[0]?.lines.map((x) => x.balance)).toEqual(['1160.00', '0.00']);
    const f = computeLedger({ ...period, entries: all, accountPrefixes: ['70'] });
    expect(f.accounts.map((a) => a.accountNumber)).toEqual(['706']);
  });

  it('ordre des lignes : date, journal, numéro, identifiant', () => {
    const a = entry('b', '2026-03-02', [D('5', '1.00'), C('7', '1.00')], {
      journalCode: 'OD',
      number: 2,
    });
    const b = entry('a', '2026-03-02', [D('5', '1.00'), C('7', '1.00')], {
      journalCode: 'OD',
      number: 1,
    });
    const c = entry('c', '2026-03-01', [D('5', '1.00'), C('7', '1.00')], {
      journalCode: 'VE',
      number: 9,
    });
    const l = computeLedger({ ...period, entries: [a, b, c] });
    expect(l.accounts.find((x) => x.accountNumber === '5')?.lines.map((x) => x.entryId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('computeAuxiliaryBalances', () => {
  it('par collectif et auxiliaire, soldes par devise, écart de centralisation', () => {
    const second = entry('e6', '2026-03-06', [
      D('411', '100.00', { auxiliaryAccountNumber: '411C2', currency: 'USD', amount: '0.05' }),
      D('411', '7.00'),
      C('706', '107.00'),
    ]);
    const aux = computeAuxiliaryBalances({ ...period, entries: [...all, second] });
    expect(aux.groups).toHaveLength(1);
    const g = aux.groups[0];
    expect(g?.auxiliaryKind).toBe('customer');
    expect(
      g?.rows.map((r) => [r.auxiliaryAccountNumber, r.closingBalance, r.unletteredLineCount]),
    ).toEqual([
      ['411C1', '0.00', 2],
      ['411C2', '100.00', 1],
    ]);
    expect(g?.rows[1]?.byCurrency).toEqual([{ currency: 'USD', balance: '0.05' }]);
    expect(g?.rows[0]?.partyName).toBe('Client A');
    expect(g?.closingBalance).toBe('100.00');
    expect(g?.withoutAuxiliaryBalance).toBe('7.00');
    expect(aux.conflicts).toEqual([]);
  });

  it('signale un auxiliaire porté sous deux collectifs', () => {
    const e = entry('x', '2026-03-03', [
      D('411', '1.00', { auxiliaryAccountNumber: 'T1' }),
      C('401', '1.00', { auxiliaryAccountNumber: 'T1' }),
    ]);
    const aux = computeAuxiliaryBalances({ ...period, entries: [e] });
    expect(aux.conflicts).toEqual([
      { auxiliaryAccountNumber: 'T1', collectiveAccountNumbers: ['401', '411'] },
    ]);
  });
});

describe('lettrage', () => {
  const ref = (id: string, i: number) => lineRefOf(id, i);

  it('checkLettering : somme nulle en devise, même compte et auxiliaire', () => {
    const r = checkLettering({ entries: all, lineRefs: [ref('e2', 1), ref('e1', 0)] });
    expect(r).toEqual({
      ok: true,
      accountNumber: '411',
      auxiliaryAccountNumber: '411C1',
      currency: 'CDF',
      documentTotal: '0.00',
      bookDifference: '0.00',
      lineRefs: ['e1#0', 'e2#1'],
    });
  });

  it('écart de change rendu, jamais corrigé', () => {
    const inv = entry('i', '2026-03-01', [
      D('411', '2800.00', { auxiliaryAccountNumber: 'C', currency: 'USD', amount: '1.00' }),
      C('706', '2800.00', { currency: 'USD', amount: '1.00' }),
    ]);
    const rec = entry('r', '2026-03-09', [
      D('5211', '2900.00', { currency: 'USD', amount: '1.00' }),
      C('411', '2900.00', { auxiliaryAccountNumber: 'C', currency: 'USD', amount: '1.00' }),
    ]);
    const r = checkLettering({ entries: [inv, rec], lineRefs: ['i#0', 'r#1'] });
    expect(r.ok && r.bookDifference).toBe('-100.00');
  });

  it('refus typés', () => {
    const base = {
      entries: [
        ...all,
        entry('z', '2026-03-03', [
          D('411', '5.00', { auxiliaryAccountNumber: '411C1', currency: 'USD' }),
          C('706', '5.00'),
        ]),
      ],
    };
    const code = (lineRefs: string[], extra: object = {}) => {
      const r = checkLettering({ ...base, lineRefs, ...extra });
      return r.ok ? 'OK' : r.code;
    };
    expect(code(['e1#0'])).toBe('LETTERING_TOO_FEW_LINES');
    expect(code(['e1#0', 'e1#0'])).toBe('LETTERING_DUPLICATE_LINE');
    expect(code(['e1#0', 'nope#0'])).toBe('LETTERING_UNKNOWN_LINE');
    expect(code(['e1#0', 'e3#0'])).toBe('LETTERING_LINE_NOT_POSTED');
    expect(code(['e1#0', 'e1#1'])).toBe('LETTERING_LINE_WITHOUT_AUXILIARY');
    expect(code(['e1#1', 'e1#2'], { requireAuxiliary: false })).toBe('LETTERING_MIXED_ACCOUNTS');
    expect(code(['e1#0', 'z#0'])).toBe('LETTERING_MIXED_CURRENCIES');
    expect(code(['e1#0', 'e2#1'], { alreadyLettered: ['e2#1'] })).toBe(
      'LETTERING_ALREADY_LETTERED',
    );
    expect(code(['e1#0', 'e2#1'], { alreadyLettered: new Set(['e1#0']) })).toBe(
      'LETTERING_ALREADY_LETTERED',
    );
    const partial = entry('p', '2026-03-10', [
      D('5211', '100.00'),
      C('411', '100.00', { auxiliaryAccountNumber: '411C1' }),
    ]);
    const r = checkLettering({ entries: [sale, partial], lineRefs: ['e1#0', 'p#1'] });
    expect(r).toEqual({
      ok: false,
      code: 'LETTERING_NOT_BALANCED',
      lineRefs: ['e1#0', 'p#1'],
      documentTotal: '1060.00',
    });
  });

  it('suggestLettering : par pièce citée seulement, complet ou partiel', () => {
    const partial = entry('p', '2026-03-10', [
      D('5211', '100.00'),
      C('411', '100.00', { auxiliaryAccountNumber: 'X', documentRef: 'inv9' }),
    ]);
    const inv9 = entry('i9', '2026-03-09', [
      D('411', '300.00', { auxiliaryAccountNumber: 'X', documentRef: 'inv9' }),
      C('706', '300.00'),
    ]);
    const noRef = entry('n', '2026-03-10', [
      D('5211', '300.00'),
      C('411', '300.00', { auxiliaryAccountNumber: 'X' }),
    ]);
    const s = suggestLettering([...all, partial, inv9, noRef]);
    expect(s.suggestions).toEqual([
      {
        accountNumber: '411',
        auxiliaryAccountNumber: '411C1',
        currency: 'CDF',
        documentRef: 'inv1',
        lineRefs: ['e1#0', 'e2#1'],
        status: 'full',
        remaining: '0.00',
        bookDifference: '0.00',
      },
      {
        accountNumber: '411',
        auxiliaryAccountNumber: 'X',
        currency: 'CDF',
        documentRef: 'inv9',
        lineRefs: ['i9#0', 'p#1'],
        status: 'partial',
        remaining: '200.00',
        bookDifference: '200.00',
      },
    ]);
    expect(suggestLettering(all, ['e1#0']).suggestions).toEqual([]);
    const lettered = entry('L', '2026-03-01', [
      D('411', '1.00', { auxiliaryAccountNumber: 'Y', documentRef: 'd', letteringCode: 'AA' }),
      C('411', '1.00', { auxiliaryAccountNumber: 'Y', documentRef: 'd' }),
    ]);
    expect(suggestLettering([lettered]).suggestions).toEqual([]);
  });

  it('resolveLettering : rejoue les événements, rejette les incohérents', () => {
    const s = resolveLettering([
      { code: 'A', action: 'letter', lineRefs: ['x#0', 'y#1'], at: '2026-03-01' },
      { code: 'B', action: 'letter', lineRefs: ['x#0', 'z#0'], at: '2026-03-02' },
      { code: 'A', action: 'letter', lineRefs: ['w#0'], at: '2026-03-02' },
      { code: 'C', action: 'unletter', at: '2026-03-03' },
      { code: 'D', action: 'letter', lineRefs: [], at: '2026-03-03' },
      { code: 'A', action: 'unletter', at: '2026-03-04' },
      { code: 'B', action: 'letter', lineRefs: ['x#0', 'z#0'], at: '2026-03-05' },
    ]);
    expect(s.active).toEqual([{ code: 'B', lineRefs: ['x#0', 'z#0'], letteredAt: '2026-03-05' }]);
    expect(s.byLine).toEqual({ 'x#0': 'B', 'z#0': 'B' });
    expect(s.rejected).toEqual([
      { position: 1, code: 'B', reason: 'LINE_ALREADY_LETTERED' },
      { position: 2, code: 'A', reason: 'CODE_ALREADY_ACTIVE' },
      { position: 3, code: 'C', reason: 'CODE_NOT_ACTIVE' },
      { position: 4, code: 'D', reason: 'EMPTY' },
    ]);
  });
});
