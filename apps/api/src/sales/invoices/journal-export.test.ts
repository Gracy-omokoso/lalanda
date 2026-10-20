// Export du journal pour les vérificateurs (ADR-0026 § 6.3) — fonctions pures.

import { describe, expect, it } from 'vitest';

import { draftUsd, issuedStandard, normalizedTest } from '../documents/testing/invoice-fixtures.js';
import { contentSha256Of } from './canonical.js';
import type { SalesJournalExport } from './invoice.contract.js';
import {
  EXCHANGES_CSV_COLUMNS,
  SALES_CSV_COLUMNS,
  csvCell,
  dgiExchangesCsv,
  exportedInvoiceOf,
  periodBounds,
  salesJournalCsv,
} from './journal-export.js';

const JOURNAL = [
  { seq: 7, event: 'submitted' as const, at: new Date('2026-10-20T09:15:00Z'), hash: 'h7' },
  { seq: 9, event: 'normalized' as const, at: new Date('2026-10-20T09:15:31Z'), hash: 'h9' },
];

describe('période (jours de Kinshasa)', () => {
  it('bornes incluses, UTC+1', () => {
    const p = periodBounds('2026-10-01', '2026-10-31');
    expect(p.start.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(p.days).toBe(31);
    expect(periodBounds('2026-10-20', '2026-10-20').days).toBe(1);
  });
});

describe('facture exportée — contenu figé, aucun recalcul', () => {
  it('facture normalisée : montants CDF qui font foi, éléments DGI, journal', () => {
    const doc = normalizedTest();
    const e = exportedInvoiceOf(doc, JOURNAL)!;
    expect(e).toMatchObject({
      number: 'TEST-2026-000001',
      type: 'FV',
      status: 'normalized',
      currency: 'CDF',
      amountsSource: 'normalized_cdf',
      documentCurrency: 'USD',
      customer: { type: 'PM', name: 'Client Exemple SARL', nif: 'T0000000X' },
      totals: { total: '209943.30', vatTotal: '28957.70', specificTax: '0.00' },
      payments: [{ method: 'VIREMENT', amount: '209943.30' }],
      dgi: {
        codeDefDgi: 'ABCD-1234-EFGH-5678-IJKL-9012',
        nim: 'XX01000001-1',
        counters: '7/8 FV',
        dateTime: '20/10/2026 10:15:30',
      },
      journal: [
        { seq: 7, event: 'submitted', hash: 'h7' },
        { seq: 9, event: 'normalized', hash: 'h9' },
      ],
    });
    expect(e.lines).toEqual([
      {
        index: 0,
        code: 'CONSEIL-H',
        name: 'Conseil (heure)',
        itemType: 'SER',
        group: 'B',
        unit: 'heure',
        quantity: '2',
        unitPrice: '90492.80',
        originalPrice: null,
        priceModification: null,
        amount: '180985.60',
        specificTaxAmount: '0.00',
      },
    ]);
    expect(e.groups).toEqual([
      {
        group: 'B',
        ratePercent: '16',
        ht: '180985.60',
        vat: '28957.70',
        specificTax: '0.00',
        total: '209943.30',
      },
    ]);
  });

  it('état de vérification : empreinte recalculée à l’identique, ou non', () => {
    const doc = normalizedTest();
    expect(exportedInvoiceOf(doc, [])!.contentIntact).toBe(false); // empreinte fictive « aaaa… »
    const intact = { ...doc, contentSha256: contentSha256Of(doc as never) };
    expect(exportedInvoiceOf(intact, [])!.contentIntact).toBe(true);
    const altere = { ...intact, customer: { ...intact.customer, name: 'Autre' } };
    expect(exportedInvoiceOf(altere, [])!.contentIntact).toBe(false);
  });

  it('facture ordinaire : devise du document, pas de bloc DGI ; brouillon non exporté', () => {
    const e = exportedInvoiceOf(issuedStandard(), [])!;
    expect(e).toMatchObject({ currency: 'USD', amountsSource: 'document', dgi: null });
    expect(e.lines[0]!.unitPrice).toBe('40.00');
    expect(exportedInvoiceOf(draftUsd(), [])).toBeNull();
  });

  it('opération hors champ : le code exporté est celui envoyé à la DGI', () => {
    const doc = normalizedTest();
    const hc = { ...doc, lines: [{ ...doc.lines[0]!, code: 'INTERNE-1', edefCode: 'HORS CHAMP' }] };
    expect(exportedInvoiceOf(hc, [])!.lines[0]!.code).toBe('HORS CHAMP');
  });
});

function exportDe(): SalesJournalExport {
  return {
    format: 'lalanda.sales-journal',
    formatVersion: 1,
    generatedAt: '2026-10-20T10:00:00.000Z',
    softwareVersion: '0.9.3',
    organization: { id: 'org', legalName: 'Exemple SARL', nif: 'A0000000X' },
    period: { from: '2026-10-20', to: '2026-10-20', timeZone: 'Africa/Kinshasa' },
    chain: {
      valid: true,
      algorithm: 'x',
      genesisHash: '0'.repeat(64),
      entriesInPeriod: 2,
      firstSeq: 7,
      lastSeq: 9,
      anchorPrevHash: 'h6',
      lastHash: 'h9',
    },
    invoices: [exportedInvoiceOf(normalizedTest(), JOURNAL)!],
    journal: [],
    dgiExchanges: [],
  };
}

describe('CSV', () => {
  it('cellules : guillemets, séparateur, formules neutralisées, montants intacts', () => {
    expect(csvCell('RDCDEF01;XX;"a"')).toBe('"RDCDEF01;XX;""a"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-remise')).toBe("'-remise");
    expect(csvCell('209943.30', false)).toBe('209943.30');
    expect(csvCell(null)).toBe('');
  });

  it('journal des ventes : une ligne par ligne de facture et par groupe, colonnes alignées', () => {
    const csv = salesJournalCsv(exportDe());
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows[0]).toBe(SALES_CSV_COLUMNS.join(';'));
    expect(rows).toHaveLength(3);
    const col = (row: string, name: (typeof SALES_CSV_COLUMNS)[number]) =>
      row.split(';')[SALES_CSV_COLUMNS.indexOf(name)];
    for (const r of rows.slice(1)) expect(r.split(';')).toHaveLength(SALES_CSV_COLUMNS.length);
    expect(col(rows[1]!, 'enregistrement')).toBe('ligne');
    expect(col(rows[1]!, 'designation')).toBe('Conseil (heure)');
    expect(col(rows[1]!, 'montant')).toBe('180985.60');
    expect(col(rows[1]!, 'code_def_dgi')).toBe('ABCD-1234-EFGH-5678-IJKL-9012');
    expect(col(rows[1]!, 'journal_seq')).toBe('7:submitted|9:normalized');
    expect(col(rows[1]!, 'chaine_valide')).toBe('oui');
    expect(col(rows[2]!, 'enregistrement')).toBe('groupe');
    expect(col(rows[2]!, 'tva_groupe')).toBe('28957.70');
    expect(col(rows[2]!, 'total_ttc')).toBe('209943.30');
  });

  it('échanges e-MCF : une ligne par entrée, corps entre guillemets', () => {
    const csv = dgiExchangesCsv([
      {
        at: '2026-10-20T09:15:00.000Z',
        exchangeId: 'e1',
        entry: 'request',
        invoiceId: 'i1',
        rn: 'TEST-2026-000001',
        uid: null,
        environment: 'test',
        method: 'POST',
        path: '/api/invoice',
        httpStatus: null,
        durationMs: null,
        outcome: null,
        dgiErrorCode: null,
        requestBody: '{"rn":"TEST-2026-000001","items":[1;2]}',
        responseBody: null,
      },
    ]);
    const rows = csv.slice(1).trimEnd().split('\r\n');
    expect(rows[0]).toBe(EXCHANGES_CSV_COLUMNS.join(';'));
    expect(rows[1]).toContain('"{""rn"":""TEST-2026-000001"",""items"":[1;2]}"');
  });
});
