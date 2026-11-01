// Réserves et projets d'états (ADR-0049 § 6.10, § 10, lot K3). Numéros de
// compte et rubriques : données de test, déclarées par le modèle de test.

import { describe, expect, it } from 'vitest';

import { computeTrialBalance, type ReportingEntry, type ReportingLine } from '../ledger/index.js';
import {
  computeReserves,
  computeStatement,
  findForbiddenWords,
  RESERVE_CODES,
  STATEMENT_DISCLAIMER,
  type ReservesInput,
  type StatementTemplateView,
} from './index.js';

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

const entries = [
  E('s', '2026-03-02', [L('411', 'D', '1160.00'), L('706', 'C', '1000.00'), L('4431', 'C', '160.00')]),
  E('x', '2026-03-03', [L('6011', 'D', '300.00'), L('5211', 'C', '300.00')]),
  E('a', '2026-03-04', [
    L('ATT', 'D', '40.00', { suspenseReason: 'PAYMENT_AT_ISSUE', operationKey: 'sale.payment_at_issue.ESPECES' }),
    L('411', 'C', '40.00'),
  ]),
  E('j', '2026-03-05', [L('411', 'D', '25.00'), L('ATT', 'C', '25.00', { suspenseReason: 'NO_RULE', operationKey: 'sale.invoice.nonrevenue.J' })]),
  E('w', '2026-03-06', [L('6011', 'D', '1.00'), L('5211', 'C', '1.00')], { status: 'awaiting_rate' }),
  E('d', '2026-03-06', [L('6011', 'D', '1.00'), L('5211', 'C', '1.00')], { status: 'draft' }),
];

const baseReserves: ReservesInput = {
  mode: 'simulation',
  chartPackStatus: 'draft',
  ruleSet: null,
  entries,
  to: '2026-03-31',
  suspenseAccountNumbers: ['ATT'],
  pendingSources: [
    { reason: 'NO_TREASURY_ACCOUNT', count: 2 },
    { reason: 'RATE_MISSING', count: 0 },
  ],
  opening: { validated: false, balanced: true },
  periods: [
    { month: '2026-03', status: 'open' },
    { month: '2026-02', status: 'closed' },
  ],
  stockPosting: 'off',
  depreciationPosting: 'off',
};

describe('computeReserves', () => {
  it('toutes les réserves du § 6.10 en simulation, dans l’ordre fixe', () => {
    const r = computeReserves(baseReserves).reserves;
    expect(r.map((x) => x.code)).toEqual([
      'PACK_NOT_REVIEWED',
      'RULES_NOT_VALIDATED',
      'SUSPENSE_BALANCE',
      'AWAITING_RATE',
      'PENDING_SOURCES',
      'OPENING_INCOMPLETE',
      'PERIODS_OPEN',
      'DEPRECIATION_NOT_POSTED',
      'STOCK_NOT_POSTED',
      'PAYMENTS_AT_ISSUE_UNCLASSIFIED',
    ]);
    const suspense = r.find((x) => x.code === 'SUSPENSE_BALANCE');
    expect(suspense?.message).toContain("Compte d'attente non soldé");
    expect(suspense?.details).toMatchObject({
      balance: '15.00',
      lineCount: 2,
      byReason: [
        { reason: 'NO_RULE', balance: '-25.00', lineCount: 1 },
        { reason: 'PAYMENT_AT_ISSUE', balance: '40.00', lineCount: 1 },
      ],
    });
    expect(r.find((x) => x.code === 'AWAITING_RATE')?.details).toEqual({ count: 1 });
    expect(r.find((x) => x.code === 'PENDING_SOURCES')?.details).toEqual({
      count: 2,
      byReason: [{ reason: 'NO_TREASURY_ACCOUNT', count: 2 }],
    });
    expect(r.find((x) => x.code === 'PERIODS_OPEN')?.details).toEqual({ months: ['2026-03'], draftEntries: 1 });
    expect(r.find((x) => x.code === 'PAYMENTS_AT_ISSUE_UNCLASSIFIED')?.details).toEqual({ balance: '40.00', lineCount: 1 });
    expect(r.find((x) => x.code === 'RULES_NOT_VALIDATED')?.message).toContain('non validées');
  });

  it('organisation propre : seules les réserves permanentes restent', () => {
    const clean = computeReserves({
      ...baseReserves,
      mode: 'active',
      chartPackStatus: 'approved',
      ruleSet: { status: 'validated', expertReviewDeclared: true },
      entries: entries.slice(0, 2),
      pendingSources: [],
      opening: { validated: true, balanced: true },
      periods: [{ month: '2026-03', status: 'closed' }],
      stockPosting: 'perpetual',
    }).reserves;
    expect(clean.map((x) => x.code)).toEqual(['DEPRECIATION_NOT_POSTED']);
  });

  it('jeu de règles sans relecture déclarée → réserve ; pack actif en simulation → réserve', () => {
    const r = computeReserves({
      ...baseReserves,
      chartPackStatus: 'active',
      ruleSet: { status: 'validated', expertReviewDeclared: false },
    }).reserves;
    expect(r.map((x) => x.code)).toContain('RULES_NOT_VALIDATED');
    expect(r.map((x) => x.code)).toContain('PACK_NOT_REVIEWED');
  });

  it('solde d’attente accepté : la réserve reste, marquée ; attente soldée : pas de réserve', () => {
    const acc = computeReserves({ ...baseReserves, suspenseAccepted: { reason: 'revu' } }).reserves;
    expect(acc.find((x) => x.code === 'SUSPENSE_BALANCE')?.details.accepted).toEqual({ reason: 'revu' });
    const settled = computeReserves({
      ...baseReserves,
      entries: [
        E('a', '2026-03-01', [L('ATT', 'D', '5.00'), L('5', 'C', '5.00')]),
        E('b', '2026-03-02', [L('5', 'D', '5.00'), L('ATT', 'C', '5.00')]),
      ],
    }).reserves;
    expect(settled.map((x) => x.code)).not.toContain('SUSPENSE_BALANCE');
  });

  it('ignore les écritures postérieures à la fin de période', () => {
    const r = computeReserves({ ...baseReserves, to: '2026-03-01' }).reserves;
    expect(r.map((x) => x.code)).not.toContain('SUSPENSE_BALANCE');
    expect(() => computeReserves({ ...baseReserves, to: '2026-13-01' })).toThrow(RangeError);
  });

  it('chaque message est en français et sans mot interdit', () => {
    for (const code of RESERVE_CODES) expect(code).toMatch(/^[A-Z_]+$/);
    const r = computeReserves(baseReserves).reserves;
    for (const x of r) expect(findForbiddenWords(x.message)).toEqual([]);
  });
});

const income: StatementTemplateView = {
  kind: 'income_statement',
  label: 'Compte de résultat (projet)',
  confirmation: 'to_confirm',
  sections: [
    {
      code: 'P',
      label: 'Produits',
      confirmation: 'to_confirm',
      rubrics: [{ code: 'P1', label: 'Services vendus', confirmation: 'to_confirm', normalBalance: 'credit', accounts: [{ from: '70', to: '71' }] }],
    },
    {
      code: 'C',
      label: 'Charges',
      confirmation: 'to_confirm',
      rubrics: [{ code: 'C1', label: 'Achats', confirmation: 'sourced', normalBalance: 'debit', accounts: [{ from: '60' }] }],
    },
  ],
  coverage: [{ from: '6', to: '7' }],
};

describe('computeStatement', () => {
  const tb = computeTrialBalance({ entries, bookCurrency: 'CDF', from: '2026-03-01', to: '2026-03-31' });
  const reserves = computeReserves(baseReserves).reserves;

  it('projet de compte de résultat : statut, bandeau, réserves, rubriques marquées', () => {
    const s = computeStatement(tb, income, 'income_statement', { reserves });
    expect(s.status).toBe('draft_unverified');
    expect(s.disclaimer).toBe(STATEMENT_DISCLAIMER);
    expect(s.available).toBe(true);
    expect(s.sections.map((x) => [x.code, x.total])).toEqual([
      ['P', '1000.00'],
      ['C', '300.00'],
    ]);
    expect(s.sections[1]?.rubrics[0]).toMatchObject({
      code: 'C1',
      toConfirm: true, // la section et le modèle le sont
      note: "À confirmer par l'expert-comptable",
      accounts: [{ accountNumber: '6011', amount: '300.00' }],
    });
    expect(s.result).toBe('700.00');
    expect(s.reserves.map((r) => r.code)).toContain('STATEMENT_TEMPLATE_TO_CONFIRM');
    expect(s.reserves.map((r) => r.code)).toContain('SUSPENSE_BALANCE');
    expect(s.reserves[0]?.code).toBe('PACK_NOT_REVIEWED');
  });

  it('comptes soldés hors rubrique et comptes dans deux rubriques : signalés', () => {
    const t: StatementTemplateView = {
      ...income,
      sections: [
        {
          code: 'P',
          label: 'Produits',
          confirmation: 'sourced',
          rubrics: [
            { code: 'A', label: 'a', confirmation: 'sourced', normalBalance: 'credit', accounts: [{ from: '706' }] },
            { code: 'B', label: 'b', confirmation: 'sourced', normalBalance: 'credit', accounts: [{ from: '7' }] },
          ],
        },
      ],
    };
    const s = computeStatement(tb, t, 'income_statement', { reserves: [] });
    expect(s.unmappedAccounts).toEqual([{ accountNumber: '6011', closingBalance: '300.00' }]);
    const codes = s.reserves.map((r) => r.code);
    expect(codes).toEqual(['STATEMENT_TEMPLATE_TO_CONFIRM', 'UNMAPPED_ACCOUNTS', 'ACCOUNT_IN_SEVERAL_RUBRICS']);
  });

  it('bilan : montant net des comptes repris, pas de résultat', () => {
    const bs: StatementTemplateView = {
      kind: 'balance_sheet',
      label: 'Bilan (projet)',
      confirmation: 'to_confirm',
      sections: [
        {
          code: 'ACT',
          label: 'Actif',
          confirmation: 'to_confirm',
          rubrics: [{ code: 'CL', label: 'Clients', confirmation: 'to_confirm', normalBalance: 'debit', accounts: [{ from: '41' }] }],
        },
      ],
    };
    const s = computeStatement(tb, bs, 'balance_sheet', { reserves });
    expect(s.sections[0]?.total).toBe('1145.00');
    expect(s.matchedNetBalance).toBe('1145.00');
    expect(s.result).toBeNull();
  });

  it('tableau des flux non disponible tant que son modèle n’est pas relu (E8)', () => {
    const none = computeStatement(tb, null, 'cash_flow', { reserves });
    expect(none).toMatchObject({ available: false, unavailableReason: 'STATEMENT_NOT_AVAILABLE', status: 'draft_unverified', sections: [] });
    expect(none.reserves.length).toBeGreaterThan(0);
    const cf: StatementTemplateView = { ...income, kind: 'cash_flow' };
    expect(computeStatement(tb, cf, 'cash_flow', { reserves }).available).toBe(false);
    const sourced: StatementTemplateView = {
      kind: 'cash_flow',
      label: 'Flux',
      confirmation: 'sourced',
      sections: [{ code: 'T', label: 'Trésorerie', confirmation: 'sourced', rubrics: [{ code: 'T1', label: 't', confirmation: 'sourced', normalBalance: 'debit', accounts: [{ from: '5' }] }] }],
    };
    const ok = computeStatement(tb, sourced, 'cash_flow', { reserves: [] });
    expect(ok.available).toBe(true);
    expect(ok.status).toBe('draft_unverified');
    expect(ok.sections[0]?.total).toBe('-300.00');
  });

  it('balance déséquilibrée → réserve ; modèle d’un autre type ou plage illisible → refus', () => {
    const bad = computeTrialBalance({
      entries: [E('b', '2026-03-01', [L('706', 'C', '2.00'), L('5', 'D', '1.00')])],
      bookCurrency: 'CDF',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(computeStatement(bad, income, 'income_statement', { reserves: [] }).reserves.map((r) => r.code)).toContain(
      'TRIAL_BALANCE_UNBALANCED',
    );
    expect(() => computeStatement(tb, income, 'balance_sheet', { reserves })).toThrow(RangeError);
    const broken: StatementTemplateView = {
      ...income,
      sections: [{ code: 'P', label: 'p', confirmation: 'sourced', rubrics: [{ code: 'X', label: 'x', confirmation: 'sourced', normalBalance: 'credit', accounts: [{ from: '7', to: '60' }] }] }],
    };
    expect(() => computeStatement(tb, broken, 'income_statement', { reserves })).toThrow('plage');
  });
});

describe('findForbiddenWords', () => {
  it('repère les mots interdits sans accents ni casse, mot entier', () => {
    expect(findForbiddenWords('État CERTIFIÉ conforme, définitif ; liasse fiscale')).toEqual([
      'conforme',
      'certifié',
      'définitif',
      'liasse',
    ]);
    expect(findForbiddenWords('Certification ; conformément ; définitive')).toEqual(['conforme', 'certifié', 'définitif']);
    expect(findForbiddenWords('Projet — définition des comptes ; non vérifié')).toEqual([]);
    expect(findForbiddenWords(STATEMENT_DISCLAIMER)).toEqual([]);
  });
});
