// Le réalisé reste intact (ADR-0049 § 7, critère 15 ; docs/08 § Règle cardinale) — e2e K6.
//
// Avec les deux ponts RUN → réalisé déclarés ACTIFS (ventes : `run_actuals_bridges`,
// dépenses : `treasury_settings.bridge`) et un réalisé déjà reporté, la comptabilité est
// activée, synchronisée, lue (grand livre, balance, états), rapprochée, clôturée (mois et
// exercice, à-nouveaux), exportée : `actual_periods`, le plan validé, le projet, les
// réglages des ponts et les pièces du RUN sont ÉGAUX OCTET POUR OCTET avant et après. Le
// rapprochement du mois rend des écarts typés, aucun `UNEXPLAINED`, et n'écrit rien.
//
// Les ponts eux-mêmes ne sont pas déclenchés ici : ils écrivent légitimement le réalisé ;
// ce test prouve que la COMPTABILITÉ, elle, ne l'écrit jamais.

import { BSON, ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import {
  accountingWorld,
  expenseDoc,
  ok,
  prepareOrganization,
  salesInvoiceDoc,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

/** Collections que la comptabilité lit et ne doit JAMAIS écrire. */
const GARDEES = [
  'actual_periods',
  'financial_plans',
  'projects',
  'run_actuals_bridges',
  'treasury_settings',
  'sales_invoices',
  'sales_receipts',
  'treasury_expenses',
  'treasury_accounts',
  'treasury_movements',
] as const;

e2eSuite('comptabilité — réalisé intact (ADR-0049, K6, critère 15)', () => {
  let w: AccountingWorld;
  const projectId = new ObjectId();

  const snapshot = async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const c of GARDEES) {
      const docs = await w.db
        .collection(c)
        .find({ organizationId: w.org })
        .sort({ _id: 1 })
        .toArray();
      out[c] = BSON.EJSON.stringify(docs, { relaxed: false });
    }
    return out;
  };

  beforeAll(async () => {
    w = await accountingWorld('realise', ['finance_director']);
    vi.spyOn(w.app.get(PdfRenderingService), 'render').mockImplementation(async (html) =>
      Buffer.from(`%PDF-FAKE\n${html}`, 'utf8'),
    );
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });

    const now = new Date();
    const bank = treasuryAccountDoc(w.org, { name: 'Banque CDF', kind: 'bank', currency: 'CDF' });
    await w.db.collection('treasury_accounts').insertOne(bank);
    ok(
      await w.put('owner', `/accounting/treasury-links/${bank._id.toHexString()}`, {
        accountNumber: '521',
        expectedRevision: null,
      }),
    );
    await w.db.collection('projects').insertOne({
      _id: projectId,
      organizationId: w.org,
      name: 'Initiative réelle',
      deviseAffichage: 'CDF',
      createdAt: now,
      updatedAt: now,
    });
    await w.db.collection('financial_plans').insertOne({
      organizationId: w.org,
      projectId: projectId.toHexString(),
      version: 1,
      status: 'approved',
      result: { lines: [{ lineId: 'ca', label: 'Chiffre d’affaires' }] },
      createdAt: now,
      updatedAt: now,
    });
    // Pont des ventes et report des dépenses ACTIFS, exercice 1 ouvert en janvier 2026.
    await w.db.collection('run_actuals_bridges').insertOne({
      organizationId: w.org,
      projectId: projectId.toHexString(),
      exerciseStart: '2026-01',
      enabled: true,
      revenueLineId: 'ca',
      lastSync: null,
      _schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await w.db.collection('treasury_settings').insertOne({
      organizationId: w.org,
      bridge: { enabled: true, mapping: { loyer: 'loyer' } },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    // Octobre 2026 = exercice 1, mois 10 : réalisé déjà reporté par les deux ponts.
    const source = (s: string) => ({
      source: s,
      at: now,
      by: null,
      version: 'test',
      calendarMonth: '2026-10',
      documents: 1,
      fingerprint: 'f'.repeat(16),
    });
    await w.db.collection('actual_periods').insertOne({
      organizationId: w.org,
      projectId: projectId.toHexString(),
      year: 1,
      month: 10,
      status: 'open',
      values: { ca: 10000, loyer: 1000 },
      sources: { ca: source('run.sales'), loyer: source('run.expenses') },
      reopenedLog: [],
      _schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    await w.db.collection('sales_invoices').insertOne(
      salesInvoiceDoc(w.org, {
        number: 'IN2610-R1',
        issuedAt: '2026-10-05',
        groups: [{ group: 'B', itemType: 'SER', ht: '10000.00', vat: '1600.00' }],
      }),
    );
    await w.db.collection('treasury_expenses').insertOne(
      expenseDoc(w.org, {
        spentOn: '2026-10-10',
        amount: '1000.00',
        accountId: bank._id.toHexString(),
      }),
    );
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    vi.restoreAllMocks();
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('synchroniser, lire, rapprocher, clôturer, exporter : le réalisé et le plan sont inchangés', async () => {
    const before = await snapshot();
    expect(JSON.parse(before['actual_periods']!)).toHaveLength(1);

    ok(await w.post('owner', '/accounting/sync'));

    const rec = ok(await w.get('owner', '/accounting/reconciliation/actuals?month=2026-10'));
    expect(rec).toMatchObject({
      displayOnly: true,
      available: true,
      exercise: { year: 1, month: 10 },
      project: { id: projectId.toHexString(), currency: 'CDF' },
      alertCount: 0,
    });
    const metrics = rec['metrics'] as Record<string, any>[];
    expect(metrics.map((m) => m['key']).sort()).toEqual(['expense.loyer', 'revenue']);
    for (const m of metrics) {
      expect(m).toMatchObject({ comparable: true, difference: '0.00', alert: false });
      expect(m['actual']).toBe(m['accounting']);
      expect(
        (m['causes'] as { cause: string; amount: string }[]).filter(
          (c) => c.cause === 'UNEXPLAINED' && c.amount !== '0.00',
        ),
      ).toEqual([]);
    }
    expect(metrics.find((m) => m['key'] === 'revenue')).toMatchObject({
      actual: '10000.00',
      actualSource: 'run.sales',
    });
    expect(metrics.find((m) => m['key'] === 'expense.loyer')).toMatchObject({
      actual: '1000.00',
      actualSource: 'run.expenses',
    });

    ok(await w.post('owner', '/accounting/ledger', { from: '2026-10-01', to: '2026-10-31' }));
    ok(
      await w.post('owner', '/accounting/trial-balance', { from: '2026-10-01', to: '2026-10-31' }),
    );
    ok(await w.get('owner', '/accounting/statements/income-statement?year=2026'));
    for (const [kind, format] of [
      ['entries', 'csv'],
      ['statements', 'pdf'],
      ['trial-balance', 'xlsx'],
    ] as const) {
      ok(
        await w.post('owner', '/accounting/exports', {
          kind,
          format,
          from: '2026-10-01',
          to: '2026-10-31',
        }),
        201,
      );
    }
    for (let m = 1; m <= 12; m += 1)
      ok(await w.post('owner', `/accounting/periods/2026/${m}/close`));
    ok(
      await w.post('owner', '/accounting/fiscal-years/2026/close', {
        suspenseAcceptance: { reason: 'Rien à classer, acceptation de principe' },
      }),
    );
    ok(await w.get('owner', '/accounting/reconciliation/actuals?month=2026-10'));

    const after = await snapshot();
    for (const c of GARDEES) expect(after[c], c).toBe(before[c]);
  });

  it('sans projet relié : rapprochement non disponible, dit comme tel', async () => {
    await w.db
      .collection('run_actuals_bridges')
      .updateOne({ organizationId: w.org }, { $set: { projectId: null } });
    const rec = ok(await w.get('owner', '/accounting/reconciliation/actuals?month=2026-10'));
    expect(rec).toMatchObject({
      available: false,
      unavailableReason: 'NO_LINKED_PROJECT',
      metrics: [],
      displayOnly: true,
    });
    const bad = await w.get('owner', '/accounting/reconciliation/actuals?month=octobre');
    expect(bad.status).toBe(400);
  });
});
