// Mise en forme des exports comptables (ADR-0049 § 9, § 10, critère 14). ADR-0049 — K6.

import 'reflect-metadata';

import {
  findForbiddenWords,
  PROJECT_BANNER,
  SIMULATION_BANNER,
  STATEMENT_DISCLAIMER,
} from '@lalanda/engine';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { LedgerExportsController } from './ledger-exports.controller.js';
import {
  OrgAccountingExportThrottlerGuard,
  UserAccountingExportThrottlerGuard,
  ACCOUNTING_EXPORT_ORG_THROTTLE,
  ACCOUNTING_EXPORT_USER_THROTTLE,
  accountingExportRateLimitMessage,
} from './export-throttler.guard.js';
import {
  pdfFooterTemplate,
  pdfHeaderTemplate,
  renderCsv,
  renderHtml,
  renderXlsx,
  type ExportDocument,
} from './export-render.js';

const doc: ExportDocument = {
  title: 'Balance générale',
  banner: PROJECT_BANNER,
  preamble: [
    ['Période', 'du 2026-10-01 au 2026-10-31'],
    ['Monnaie de tenue', 'CDF'],
  ],
  reserves: [{ code: 'PACK_NOT_REVIEWED', message: 'Plan comptable non relu.' }],
  tables: [
    {
      title: 'Balance',
      notes: [STATEMENT_DISCLAIMER],
      columns: [
        { key: 'account', label: 'Compte' },
        { key: 'label', label: 'Libellé' },
        { key: 'amount', label: 'Montant', amount: true },
      ],
      rows: [
        { account: '601', label: '=HYPERLINK("x")', amount: '-1250.50' },
        { account: '706', label: 'Ventes; services', amount: '1250.50' },
      ],
    },
  ],
};

describe('exports comptables — mise en forme', () => {
  it('CSV : BOM, « ; », bandeau en tête, réserves, formules neutralisées, montants intacts', () => {
    const text = renderCsv(doc).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(PROJECT_BANNER);
    expect(lines).toContain('Réserve;PACK_NOT_REVIEWED;Plan comptable non relu.');
    expect(text).toContain(`'=HYPERLINK(""x"")`);
    expect(lines).toContain(`601;"'=HYPERLINK(""x"")";-1250.50`);
    expect(lines).toContain('706;"Ventes; services";1250.50');
  });

  it('.xlsx : bandeau en A1 et en en-tête d’impression de chaque feuille, montants en nombres', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await renderXlsx(doc));
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Balance', 'Réserves']);
    for (const ws of wb.worksheets) {
      expect(ws.getCell('A1').value).toBe(PROJECT_BANNER);
      expect(ws.headerFooter.oddHeader).toContain(PROJECT_BANNER);
    }
    const values = wb.worksheets[0]!.getColumn(3).values;
    expect(values).toContain(-1250.5);
  });

  it('PDF : bandeau dans le corps et dans l’en-tête répété de chaque page, texte échappé', () => {
    const html = renderHtml(doc);
    expect(html).toContain(`<div class="bandeau">${PROJECT_BANNER}</div>`);
    expect(html).not.toContain('<script');
    expect(pdfHeaderTemplate(SIMULATION_BANNER)).toContain('SIMULATION');
    expect(pdfHeaderTemplate('<b>')).toContain('&lt;b&gt;');
    expect(pdfFooterTemplate(PROJECT_BANNER)).toContain('pageNumber');
  });

  it('critère 14 : aucun gabarit ni libellé fixe ne porte un mot interdit', () => {
    const texts = [
      renderCsv(doc).toString('utf8'),
      renderHtml(doc),
      pdfHeaderTemplate(PROJECT_BANNER),
      pdfFooterTemplate(PROJECT_BANNER),
      accountingExportRateLimitMessage('user', 120),
      accountingExportRateLimitMessage('organization', 3600),
    ];
    for (const t of texts) expect(findForbiddenWords(t)).toEqual([]);
  });

  it('limite de débit : deux seaux sur la création d’un export, après les droits', () => {
    expect(ACCOUNTING_EXPORT_USER_THROTTLE).toEqual({ ttl: 3_600_000, limit: 20 });
    expect(ACCOUNTING_EXPORT_ORG_THROTTLE).toEqual({ ttl: 3_600_000, limit: 60 });
    const guards = Reflect.getMetadata(
      '__guards__',
      LedgerExportsController.prototype.create,
    ) as unknown[];
    expect(guards).toEqual([UserAccountingExportThrottlerGuard, OrgAccountingExportThrottlerGuard]);
    expect(
      Reflect.getMetadata('__guards__', LedgerExportsController.prototype.list),
    ).toBeUndefined();
  });
});
