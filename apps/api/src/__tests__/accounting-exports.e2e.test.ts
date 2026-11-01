// Restitution et exports de la comptabilité (ADR-0049 §§ 6.11, 9, 10, lot K6) — e2e.
//
// Critère 14 : chaque réponse `GET /accounting/statements/*` porte
// `status: "draft_unverified"`, le `disclaimer` et les réserves ; le PDF porte le bandeau
// sur chaque page (en-tête répété du gabarit Chromium) ; aucune sortie ne contient
// « conforme », « certifié », « définitif », « liasse » ; `cash-flow` →
// `409 STATEMENT_NOT_AVAILABLE`. Critère 16 : l'export CSV d'un mois contient une ligne
// par ligne d'écriture, l'en-tête « Projet », les réserves, une empreinte enregistrée ;
// audit `accounting.export.created` ; en simulation, « SIMULATION » dans le nom et
// l'en-tête. Plus : `.xlsx` (bandeau sur chaque feuille), droits (l'Expert-comptable lit
// et exporte, l'Administrateur lit sans exporter, le Commercial ne voit rien), isolation.
//
// Le rendu Chromium est remplacé par un double qui renvoie `%PDF-FAKE` suivi du HTML et
// des gabarits d'en-tête et de pied, comme les autres e2e PDF : la CI n'a pas Chromium
// (PUPPETEER_SKIP_DOWNLOAD), et le HTML est exactement ce que Chromium imprimerait.

import { createHash } from 'node:crypto';

import { findForbiddenWords } from '@lalanda/engine';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import {
  accountingWorld,
  code,
  entriesOf,
  expenseDoc,
  ok,
  prepareOrganization,
  salesInvoiceDoc,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const BANNER = 'Projet — à valider par un expert-comptable';

/** Téléchargement binaire (supertest n'accumule pas les octets d'un type inconnu). */
function download(w: AccountingWorld, who: string, id: string): request.Test {
  return w
    .get(who, `/accounting/exports/${id}/file`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

function csvLines(buf: Buffer): string[] {
  return buf.toString('utf8').replace(/^﻿/, '').split('\r\n');
}

e2eSuite('comptabilité — restitution et exports (ADR-0049, K6)', () => {
  let w: AccountingWorld;
  let bank = '';

  beforeAll(async () => {
    w = await accountingWorld(
      'exports',
      ['finance_director', 'admin', 'external_accountant', 'sales_rep'],
      ['simu', 'intrus'],
    );
    vi.spyOn(w.app.get(PdfRenderingService), 'render').mockImplementation(async (html, opts) =>
      Buffer.from(
        `%PDF-FAKE\n${html}\n<!--header-->${opts?.headerTemplate ?? ''}\n<!--footer-->${opts?.footerTemplate ?? ''}`,
        'utf8',
      ),
    );
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    await prepareOrganization(w, { who: 'simu', mode: 'simulation' });

    const b = treasuryAccountDoc(w.org, { name: 'Banque CDF', kind: 'bank', currency: 'CDF' });
    await w.db.collection('treasury_accounts').insertOne(b);
    bank = b._id.toHexString();
    ok(
      await w.put('owner', `/accounting/treasury-links/${bank}`, {
        accountNumber: '521',
        expectedRevision: null,
      }),
    );
    await w.db.collection('sales_invoices').insertMany([
      salesInvoiceDoc(w.org, {
        number: 'IN2610-E1',
        groups: [{ group: 'B', itemType: 'SER', ht: '10000.00', vat: '1600.00' }],
      }),
      salesInvoiceDoc(w.orgOf['simu']!, {
        number: 'IN2610-S1',
        groups: [{ group: 'B', itemType: 'SER', ht: '5000.00', vat: '800.00' }],
      }),
    ]);
    await w.db
      .collection('treasury_expenses')
      .insertOne(expenseDoc(w.org, { spentOn: '2026-10-12', amount: '2500.00', accountId: bank }));
    ok(await w.post('owner', '/accounting/sync'));
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    vi.restoreAllMocks();
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('grand livre, balance, auxiliaires : calculés par le moteur, bandeau et réserves', async () => {
    const tb = ok(await w.post('external_accountant', '/accounting/trial-balance', october));
    expect(tb).toMatchObject({ mode: 'active', simulation: false, banner: BANNER, balanced: true });
    expect(tb['totals']['periodDebit']).toBe(tb['totals']['periodCredit']);
    const accounts = (tb['rows'] as { accountNumber: string }[]).map((r) => r.accountNumber);
    expect(accounts).toEqual(expect.arrayContaining(['521', '601', '706', '4431']));
    expect((tb['reserves'] as { code: string }[]).map((r) => r.code)).toEqual(
      expect.arrayContaining(['PACK_NOT_REVIEWED', 'PERIODS_OPEN']),
    );

    const ledger = ok(
      await w.post('owner', '/accounting/ledger', { ...october, accountNumber: '601' }),
    );
    expect(ledger['accounts']).toHaveLength(1);
    expect(ledger['accounts'][0]).toMatchObject({
      accountNumber: '601',
      closingBalance: '2500.00',
    });
    expect(ledger['accounts'][0]['lines'][0]).toMatchObject({ debit: '2500.00', currency: 'CDF' });

    const aux = ok(
      await w.post('owner', '/accounting/auxiliary-balance', {
        ...october,
        auxiliaryKind: 'customer',
      }),
    );
    const rows = (aux['groups'] as { rows: { closingBalance: string }[] }[]).flatMap((g) => g.rows);
    expect(rows.map((r) => r.closingBalance)).toContain('11600.00');

    code(
      await w.post('owner', '/accounting/trial-balance', { from: '2026-10-31', to: '2026-10-01' }),
      400,
      'INVALID_REQUEST',
    );
    expect((await w.post('sales_rep', '/accounting/trial-balance', october)).status).toBe(403);
  });

  it('critère 14 — projets d’états : toujours draft_unverified, bandeau, réserves ; flux non disponibles', async () => {
    for (const kind of ['balance-sheet', 'income-statement']) {
      const s = ok(await w.get('external_accountant', `/accounting/statements/${kind}?year=2026`));
      expect(s).toMatchObject({ status: 'draft_unverified', kind, fiscalYear: 2026 });
      expect(s['disclaimer']).toMatch(/^Projet — à valider par un expert-comptable\./);
      expect(Array.isArray(s['reserves'])).toBe(true);
      expect((s['reserves'] as unknown[]).length).toBeGreaterThan(0);
      // Le pack v1 ne fournit aucun modèle d'état : « non disponible », jamais deviné.
      expect(s['available']).toBe(false);
      expect(findForbiddenWords(JSON.stringify(s))).toEqual([]);
    }
    const monthly = ok(
      await w.get('owner', '/accounting/statements/income-statement?year=2026&month=10'),
    );
    expect(monthly).toMatchObject({ from: '2026-01-01', to: '2026-10-31' });

    const cf = await w.get('owner', '/accounting/statements/cash-flow?year=2026');
    code(cf, 409, 'STATEMENT_NOT_AVAILABLE');
    expect(cf.body.details).toMatchObject({ status: 'draft_unverified' });
    expect(cf.body.details.disclaimer).toEqual(expect.any(String));
    expect(Array.isArray(cf.body.details.reserves)).toBe(true);
    expect(findForbiddenWords(JSON.stringify(cf.body))).toEqual([]);

    code(await w.get('owner', '/accounting/statements/liasse?year=2026'), 400, 'INVALID_REQUEST');
  });

  it('critère 16 — export CSV des écritures : une ligne par ligne, en-tête Projet, réserves, empreinte, audit', async () => {
    const created = ok(
      await w.post('external_accountant', '/accounting/exports', {
        kind: 'entries',
        format: 'csv',
        ...october,
      }),
      201,
    );
    expect(created).toMatchObject({ kind: 'entries', format: 'csv', simulation: false });
    expect(created['fileName']).toBe('comptabilite-projet_entries_2026-10-01_2026-10-31.csv');

    const file = await download(w, 'external_accountant', String(created['id']));
    expect(file.status).toBe(200);
    const buf = file.body as Buffer;
    expect(createHash('sha256').update(buf).digest('hex')).toBe(created['sha256']);
    expect(file.headers['x-content-sha256']).toBe(created['sha256']);
    const lines = csvLines(buf);
    expect(lines[0]).toBe(BANNER);
    expect(lines.some((l) => l.startsWith('Réserve;PACK_NOT_REVIEWED;'))).toBe(true);
    const header = lines.findIndex((l) => l.startsWith('JournalCode;'));
    expect(header).toBeGreaterThan(0);
    const data = lines.slice(header + 1).filter((l) => l !== '');
    const posted = (
      await entriesOf(w.db, w.org, {
        status: 'posted',
        date: { $gte: october.from, $lte: october.to },
      })
    ).flatMap((e) => e['lines'] as unknown[]);
    expect(data).toHaveLength(posted.length);
    expect(findForbiddenWords(buf.toString('utf8'))).toEqual([]);

    const journal = await w.db
      .collection('accounting_exports')
      .findOne({ organizationId: w.org, sha256: created['sha256'] });
    expect(journal).toMatchObject({
      kind: 'entries',
      simulation: false,
      createdBy: w.userIds['external_accountant'],
    });
    const audit = await w.db.collection('audit_events').findOne({
      organizationId: w.org,
      action: 'accounting.export.created',
      targetId: String(created['id']),
    });
    expect(audit).not.toBeNull();

    const list = ok(await w.get('admin', '/accounting/exports'));
    expect((list['items'] as { id: string }[]).map((i) => i.id)).toContain(created['id']);
  });

  it('critère 16 — simulation : « SIMULATION » dans le nom et l’en-tête, rien d’enregistré', async () => {
    const created = ok(
      await w.post('simu', '/accounting/exports', { kind: 'entries', format: 'csv', ...october }),
      201,
    );
    expect(created['simulation']).toBe(true);
    expect(created['fileName']).toMatch(/^SIMULATION_/);
    const file = await download(w, 'simu', String(created['id']));
    const lines = csvLines(file.body as Buffer);
    expect(lines[0]).toMatch(/^"?SIMULATION — /);
    const header = lines.findIndex((l) => l.startsWith('JournalCode;'));
    expect(lines.slice(header + 1).filter((l) => l !== '').length).toBe(3);
    expect(
      await w.db
        .collection('accounting_entries')
        .countDocuments({ organizationId: w.orgOf['simu'] }),
    ).toBe(0);
  });

  it('.xlsx et PDF : bandeau sur chaque feuille et chaque page', async () => {
    const x = ok(
      await w.post('owner', '/accounting/exports', {
        kind: 'trial-balance',
        format: 'xlsx',
        ...october,
      }),
      201,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await download(w, 'owner', String(x['id']))).body as Buffer);
    expect(wb.worksheets.length).toBeGreaterThanOrEqual(2);
    for (const ws of wb.worksheets) {
      expect(ws.getCell('A1').value).toBe(BANNER);
      expect(ws.headerFooter.oddHeader).toContain(BANNER);
    }

    const s = ok(
      await w.post('finance_director', '/accounting/exports', {
        kind: 'statements',
        format: 'pdf',
        ...october,
      }),
      201,
    );
    const pdf = ((await download(w, 'finance_director', String(s['id']))).body as Buffer).toString(
      'utf8',
    );
    expect(pdf.startsWith('%PDF-FAKE')).toBe(true);
    const header = pdf.slice(pdf.indexOf('<!--header-->'));
    expect(header).toContain(BANNER);
    expect(pdf).toContain('draft_unverified');
    expect(pdf).toContain('Projet — à valider par un expert-comptable. Établi automatiquement');
    expect(findForbiddenWords(pdf)).toEqual([]);

    const sx = ok(
      await w.post('owner', '/accounting/exports', {
        kind: 'statements',
        format: 'xlsx',
        ...october,
      }),
      201,
    );
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load((await download(w, 'owner', String(sx['id']))).body as Buffer);
    expect(wb2.worksheets.length).toBe(4);
    for (const ws of wb2.worksheets) expect(ws.getCell('A1').value).toBe(BANNER);

    for (const kind of ['ledger', 'auxiliary-balance', 'reserves'] as const) {
      ok(await w.post('owner', '/accounting/exports', { kind, format: 'csv', ...october }), 201);
    }
    code(
      await w.post('owner', '/accounting/exports', { kind: 'entries', format: 'pdf', ...october }),
      400,
      'INVALID_REQUEST',
    );
  });

  it('droits et isolation : l’Administrateur lit sans exporter ; une autre organisation ne voit rien', async () => {
    expect(
      (await w.post('admin', '/accounting/exports', { kind: 'entries', format: 'csv', ...october }))
        .status,
    ).toBe(403);
    expect((await w.post('external_accountant', '/accounting/entries', {})).status).toBe(403);
    expect((await w.post('external_accountant', '/accounting/periods/2026/10/close')).status).toBe(
      403,
    );
    const mine = ok(await w.get('owner', '/accounting/exports'))['items'] as { id: string }[];
    const id = mine[0]!.id;
    expect((await download(w, 'admin', id)).status).toBe(403);
    code(
      await w.get('intrus', `/accounting/exports/${id}/file`),
      404,
      'ACCOUNTING_EXPORT_NOT_FOUND',
    );
    const theirs = ok(await w.get('intrus', '/accounting/exports'))['items'] as unknown[];
    expect(theirs).toHaveLength(0);
    expect((await w.get('sales_rep', '/accounting/exports')).status).toBe(403);
  });
});
