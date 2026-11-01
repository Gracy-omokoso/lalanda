// Garde-fous du lot K3 (ADR-0049 § 10, critères 14 et 17) :
// - aucune sortie ne contient « conforme », « certifié », « définitif », « liasse » ;
// - aucun numéro de compte écrit dans le code (hors fichiers de test) ;
// - module pur : ni horloge, ni hasard, ni réseau, ni base ; sorties déterministes.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeOpeningEntries, proposeCutoverOpening } from '../closing/index.js';
import { exportRows } from '../export/index.js';
import {
  checkLettering,
  computeAuxiliaryBalances,
  computeLedger,
  computeTrialBalance,
  resolveLettering,
  suggestLettering,
  type ReportingChart,
  type ReportingEntry,
  type ReportingLine,
} from '../ledger/index.js';
import { reconcileWithActuals } from '../reconciliation/index.js';
import {
  computeReserves,
  computeStatement,
  EXPORT_FORMAT_NOTE,
  findForbiddenWords,
  PROJECT_BANNER,
  RESERVE_CODES,
  SIMULATION_BANNER,
  STATEMENT_DISCLAIMER,
  TO_CONFIRM_NOTE,
  type StatementTemplateView,
} from './index.js';
import { reserveOf } from './reserves.js';

const ACCOUNTING_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const K3_DIRS = ['ledger', 'statements', 'closing', 'reconciliation', 'export'];

function k3Sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const d of K3_DIRS) {
    const dir = join(ACCOUNTING_DIR, d);
    for (const f of readdirSync(dir)) {
      const path = join(dir, f);
      if (statSync(path).isFile() && f.endsWith('.ts') && !f.endsWith('.test.ts')) {
        out.push({ path, text: readFileSync(path, 'utf8') });
      }
    }
  }
  return out;
}

const L = (
  account: string,
  side: 'D' | 'C',
  amount: string,
  o: Partial<ReportingLine> = {},
): ReportingLine => ({
  accountNumber: account,
  auxiliaryAccountNumber: null,
  label: 'Opération',
  debit: side === 'D' ? amount : null,
  credit: side === 'C' ? amount : null,
  currency: 'CDF',
  amount,
  ...o,
});
const gen = { ruleSetVersion: 1, chartPack: { slug: 'p', version: 1 }, engineVersion: '1.0.0' };
const entries: ReportingEntry[] = [
  {
    id: 'a',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: 1,
    date: '2026-03-02',
    status: 'posted',
    source: {
      kind: 'sales_invoice',
      id: 'f',
      number: 'FV-1',
      date: '2026-03-02',
      partyName: 'Client',
    },
    sourceKey: 'sales_invoice:f:issue',
    generation: gen,
    lines: [
      L('411', 'D', '1160.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f' }),
      L('706', 'C', '1000.00', { operationKey: 'sale.invoice.revenue.SER.B' }),
      L('ATT', 'C', '160.00', { suspenseReason: 'NO_RULE', operationKey: 'sale.invoice.vat.B' }),
    ],
  },
  {
    id: 'b',
    journalCode: 'T01',
    fiscalYear: 2026,
    number: 1,
    date: '2026-03-09',
    status: 'posted',
    source: null,
    sourceKey: 'sales_receipt:r:r1',
    generation: gen,
    lines: [
      L('521', 'D', '1160.00'),
      L('411', 'C', '1160.00', { auxiliaryAccountNumber: 'C1', documentRef: 'f' }),
    ],
  },
  {
    id: 'c',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: null,
    date: '2026-03-10',
    status: 'awaiting_rate',
    source: null,
    sourceKey: null,
    lines: [L('411', 'D', '1.00'), L('706', 'C', '1.00')],
  },
];
const chart: ReportingChart = {
  classes: [{ number: '7', label: 'Produits', confirmation: 'to_confirm' }],
  accounts: [
    {
      number: '70',
      label: 'Ventes',
      classNumber: '7',
      nature: 'income',
      confirmation: 'to_confirm',
    },
  ],
};
const template = (kind: StatementTemplateView['kind']): StatementTemplateView => ({
  kind,
  label: 'Projet',
  confirmation: 'to_confirm',
  sections: [
    {
      code: 'S',
      label: 'Section',
      confirmation: 'to_confirm',
      rubrics: [
        {
          code: 'R',
          label: 'Rubrique',
          confirmation: 'to_confirm',
          normalBalance: 'credit',
          accounts: [{ from: '7' }],
        },
      ],
    },
  ],
  coverage: [{ from: '5' }],
});

function allOutputs(): unknown[] {
  const period = {
    entries,
    bookCurrency: 'CDF' as const,
    from: '2026-03-01',
    to: '2026-03-31',
    chart,
  };
  const tb = computeTrialBalance(period);
  const reserves = computeReserves({
    mode: 'simulation',
    chartPackStatus: 'draft',
    ruleSet: null,
    entries,
    to: '2026-03-31',
    suspenseAccountNumbers: ['ATT'],
    pendingSources: [{ reason: 'RATE_MISSING', count: 1 }],
    opening: { validated: false, balanced: false },
    periods: [{ month: '2026-03', status: 'open' }],
    stockPosting: 'off',
    depreciationPosting: 'off',
  });
  return [
    STATEMENT_DISCLAIMER,
    PROJECT_BANNER,
    SIMULATION_BANNER,
    EXPORT_FORMAT_NOTE,
    TO_CONFIRM_NOTE,
    RESERVE_CODES.map((c) => reserveOf(c)),
    tb,
    computeLedger(period),
    computeAuxiliaryBalances(period),
    checkLettering({ entries, lineRefs: ['a#0', 'b#1'] }),
    suggestLettering(entries),
    resolveLettering([{ code: 'A', action: 'letter', lineRefs: ['a#0', 'b#1'], at: '2026-03-10' }]),
    reserves,
    computeStatement(tb, template('balance_sheet'), 'balance_sheet', reserves),
    computeStatement(tb, template('income_statement'), 'income_statement', reserves),
    computeStatement(tb, null, 'cash_flow', reserves),
    computeOpeningEntries({
      entries,
      bookCurrency: 'CDF',
      fiscalYearEnd: '2026-12-31',
      openingDate: '2027-01-01',
      journalCode: 'AN',
      chart,
      resultAccountNumber: null,
      suspenseAccountNumber: 'ATT',
      detailThirdPartiesByDocument: true,
    }),
    proposeCutoverOpening({
      cutoverDate: '2026-03-01',
      bookCurrency: 'CDF',
      journalCode: 'AN',
      suspenseAccountNumber: 'ATT',
      treasury: {
        balances: [{ accountId: 'b', currency: 'USD', balance: '3.00' }],
        accountNumbers: {},
      },
      receivables: [
        {
          documentId: 'f',
          documentNumber: 'FV-1',
          partyName: 'Client',
          auxiliaryAccountNumber: 'C1',
          currency: 'CDF',
          outstanding: '5.00',
        },
      ],
      payables: [
        {
          documentId: 'p',
          documentNumber: null,
          partyName: null,
          auxiliaryAccountNumber: null,
          currency: 'CDF',
          outstanding: '2.00',
        },
      ],
      collectiveAccounts: { customer: null, supplier: null },
    }),
    reconcileWithActuals({
      month: '2026-03',
      projectCurrency: 'CDF',
      entries,
      suspenseAccountNumbers: ['ATT'],
      revenue: { value: '999.00', source: 'run.sales' },
      expenses: [{ category: 'loyer', actual: { value: null, source: null } }],
    }),
    exportRows({
      entries,
      mode: 'simulation',
      bookCurrency: 'CDF',
      from: '2026-03-01',
      to: '2026-03-31',
      chartPack: { slug: 'p', version: 1 },
      reserves: reserves.reserves,
    }),
    exportRows({
      entries,
      mode: 'active',
      bookCurrency: 'CDF',
      from: '2026-03-01',
      to: '2026-03-31',
      chartPack: { slug: 'p', version: 1 },
      reserves: reserves.reserves,
    }),
  ];
}

describe('garde-fous K3', () => {
  it('aucune sortie ne contient « conforme », « certifié », « définitif » ni « liasse »', () => {
    const outputs = allOutputs();
    for (const o of outputs) {
      const text = typeof o === 'string' ? o : JSON.stringify(o);
      expect(findForbiddenWords(text), text.slice(0, 200)).toEqual([]);
    }
  });

  it('chaque projet d’état porte draft_unverified, le bandeau et ses réserves', () => {
    const statements = allOutputs().filter(
      (o): o is { status: string; disclaimer: string; reserves: unknown[] } =>
        typeof o === 'object' && o !== null && 'disclaimer' in o,
    );
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.status).toBe('draft_unverified');
      expect(s.disclaimer).toBe(STATEMENT_DISCLAIMER);
      expect(s.reserves.length).toBeGreaterThan(0);
    }
  });

  it('aucun numéro de compte écrit dans le code du lot (chaîne de deux chiffres ou plus)', () => {
    const offenders: string[] = [];
    for (const { path, text } of k3Sources()) {
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of code.matchAll(/(['"`])(\d{2,})\1/g)) offenders.push(`${path}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('module pur : ni horloge, ni hasard, ni réseau, ni base, ni système de fichiers', () => {
    const banned = [
      /Date\.now\(/,
      /new Date\(\)/,
      /Math\.random\(/,
      /\bfetch\(/,
      /from 'node:/,
      /mongoose|mongodb/,
      /process\.env/,
    ];
    for (const { path, text } of k3Sources()) {
      for (const b of banned) expect(b.test(text), `${path} : ${b}`).toBe(false);
    }
  });

  it('sorties déterministes : deux appels identiques rendent le même résultat', () => {
    expect(JSON.stringify(allOutputs())).toBe(JSON.stringify(allOutputs()));
  });

  it('chaque fichier source cite l’ADR-0049', () => {
    for (const { path, text } of k3Sources()) expect(text.includes('ADR-0049'), path).toBe(true);
  });
});
