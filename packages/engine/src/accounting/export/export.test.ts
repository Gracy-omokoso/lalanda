// Lignes d'export (ADR-0049 § 9) : colonnes de type FEC, format pratique.

import { describe, expect, it } from 'vitest';

import type { ReportingEntry, ReportingLine } from '../ledger/index.js';
import { computeReserves } from '../statements/index.js';
import { EXPORT_COLUMNS, exportRows, type ExportRowsInput } from './index.js';
import { ACCOUNTING_VERSION } from '../types.js';

const L = (
  account: string,
  side: 'D' | 'C',
  amount: string,
  o: Partial<ReportingLine> = {},
): ReportingLine => ({
  accountNumber: account,
  auxiliaryAccountNumber: null,
  label: 'Vente',
  debit: side === 'D' ? amount : null,
  credit: side === 'C' ? amount : null,
  currency: 'CDF',
  amount,
  ...o,
});
const entries: ReportingEntry[] = [
  {
    id: 'e2',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: 2,
    date: '2026-03-04',
    status: 'posted',
    source: {
      kind: 'sales_invoice',
      id: 'inv2',
      number: 'FV-2',
      date: '2026-03-04',
      partyName: 'Client B',
    },
    sourceKey: 'sales_invoice:inv2:issue',
    lines: [
      L('411', 'D', '2800.00', { auxiliaryAccountNumber: 'C2', currency: 'USD', amount: '1.00' }),
      L('706', 'C', '2800.00', { currency: 'USD', amount: '1.00' }),
    ],
    generation: {
      ruleSetVersion: 3,
      chartPack: { slug: 'p', version: 1 },
      engineVersion: ACCOUNTING_VERSION,
    },
    postedOn: '2026-03-05',
    hash: 'abc',
  },
  {
    id: 'e1',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: 1,
    date: '2026-03-02',
    status: 'posted',
    source: {
      kind: 'sales_invoice',
      id: 'inv1',
      number: 'FV-1',
      date: '2026-03-02',
      partyName: 'Client A',
    },
    sourceKey: 'sales_invoice:inv1:issue',
    lines: [
      L('411', 'D', '116.00', { auxiliaryAccountNumber: 'C1', letteringCode: 'AA' }),
      L('706', 'C', '116.00'),
    ],
    generation: {
      ruleSetVersion: 2,
      chartPack: { slug: 'p', version: 1 },
      engineVersion: ACCOUNTING_VERSION,
    },
    postedOn: '2026-03-02',
    hash: 'def',
  },
  {
    id: 'od',
    journalCode: 'OD',
    fiscalYear: 2026,
    number: null,
    date: '2026-03-09',
    status: 'posted',
    source: null,
    sourceKey: null,
    lines: [L('706', 'D', '1.00'), L('ATT', 'C', '1.00')],
    generation: null,
  },
  {
    id: 'w',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: null,
    date: '2026-03-09',
    status: 'awaiting_rate',
    source: null,
    sourceKey: null,
    lines: [L('411', 'D', '1.00'), L('706', 'C', '1.00')],
  },
  {
    id: 'late',
    journalCode: 'VE',
    fiscalYear: 2026,
    number: 3,
    date: '2026-04-01',
    status: 'posted',
    source: null,
    sourceKey: null,
    lines: [L('411', 'D', '1.00'), L('706', 'C', '1.00')],
  },
];

const reserves = computeReserves({
  mode: 'active',
  chartPackStatus: 'approved',
  ruleSet: { status: 'validated', expertReviewDeclared: true },
  entries,
  to: '2026-03-31',
  suspenseAccountNumbers: ['ATT'],
  opening: { validated: true, balanced: true },
  periods: [],
  stockPosting: 'off',
  depreciationPosting: 'off',
}).reserves;

const input: ExportRowsInput = {
  entries,
  mode: 'active',
  bookCurrency: 'CDF',
  from: '2026-03-01',
  to: '2026-03-31',
  chartPack: { slug: 'syscohada-test', version: 1 },
  journalLabels: { VE: 'Ventes', OD: 'Opérations diverses' },
  accountLabels: { '411': 'Clients', '706': 'Services vendus' },
  auxiliaryLabels: { C1: 'Client A (fiche)' },
  lettering: { 'e1#0': { code: 'AB', date: '2026-03-15' } },
  reserves,
};

describe('exportRows', () => {
  it('une ligne par ligne d’écriture validée de la période, colonnes de type FEC + Lalanda', () => {
    const x = exportRows(input);
    expect(x.columns).toEqual(EXPORT_COLUMNS);
    expect(EXPORT_COLUMNS).toHaveLength(22);
    expect(x.rows).toHaveLength(6);
    expect(x.rows[0]).toEqual({
      JournalCode: 'VE',
      JournalLib: 'Ventes',
      EcritureNum: '1',
      EcritureDate: '2026-03-02',
      CompteNum: '411',
      CompteLib: 'Clients',
      CompAuxNum: 'C1',
      CompAuxLib: 'Client A (fiche)',
      PieceRef: 'FV-1',
      PieceDate: '2026-03-02',
      EcritureLib: 'Vente',
      Debit: '116.00',
      Credit: '0.00',
      EcritureLet: 'AB',
      DateLet: '2026-03-15',
      ValidDate: '2026-03-02',
      Montantdevise: '116.00',
      Idevise: 'CDF',
      CleSource: 'sales_invoice:inv1:issue',
      VersionRegles: '2',
      VersionMoteur: ACCOUNTING_VERSION,
      EmpreinteEcriture: 'def',
    });
    expect(x.rows[2]).toMatchObject({
      CompAuxLib: 'Client B',
      Montantdevise: '1.00',
      Idevise: 'USD',
      Debit: '2800.00',
    });
    expect(x.rows[5]).toMatchObject({
      JournalCode: 'OD',
      EcritureNum: '',
      CleSource: '',
      VersionRegles: '',
      CompAuxLib: '',
    });
    expect(x.totals).toEqual({ debit: '2917.00', credit: '2917.00', lineCount: 6, entryCount: 3 });
  });

  it('en-tête : bandeau projet, période, monnaie, pack, règles, réserves, note de format', () => {
    const x = exportRows(input);
    expect(x.header).toMatchObject({
      banner: 'Projet — à valider par un expert-comptable',
      simulation: false,
      bookCurrency: 'CDF',
      chartPack: { slug: 'syscohada-test', version: 1 },
      ruleSetVersions: [2, 3],
    });
    expect(x.header.formatNote).toContain('de type FEC');
    expect(x.header.formatNote).toContain("n'est pas une obligation en RDC");
    expect(x.header.reserves.map((r) => r.code)).toEqual([
      'SUSPENSE_BALANCE',
      'AWAITING_RATE',
      'DEPRECIATION_NOT_POSTED',
      'STOCK_NOT_POSTED',
    ]);
    expect(x.fileStem).toBe('comptabilite-projet_2026-03-01_2026-03-31');
  });

  it('simulation : « SIMULATION » dans l’en-tête et le nom de fichier', () => {
    const x = exportRows({ ...input, mode: 'simulation' });
    expect(x.header.banner.startsWith('SIMULATION')).toBe(true);
    expect(x.header.simulation).toBe(true);
    expect(x.fileStem.startsWith('SIMULATION_')).toBe(true);
  });

  it('sans état de lettrage : code porté par la ligne, date vide ; refus d’une période inversée', () => {
    const x = exportRows({ ...input, lettering: undefined });
    expect(x.rows[0]).toMatchObject({ EcritureLet: 'AA', DateLet: '' });
    expect(() => exportRows({ ...input, from: '2026-04-01' })).toThrow(RangeError);
  });
});
