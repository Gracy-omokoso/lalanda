// Pack SYSCOHADA révisé v2 et jeu de règles par défaut (ADR-0049, amendement du
// 3 nov. 2026) — e2e.
//
// La migration enregistre le pack v2 `approved` (décision de la dirigeante), idempotente ;
// une organisation le choisit, reçoit le jeu de règles par défaut en brouillon, le valide
// par le circuit existant, passe en mode `active` par `POST /accounting/activate` ; une
// facture de vente produit 411 / 706 / 4431, sans compte d'attente. Une clé sans
// correspondance sûre (groupe J) va au compte d'attente 471 désigné par le pack, jamais à
// `ATTENTE`. Les projets d'états restent `draft_unverified`, avec leur bandeau.

import { STATEMENT_DISCLAIMER } from '@lalanda/engine';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  accountingWorld,
  code,
  entriesOf,
  loadPack,
  ok,
  PACK as PACK_V1,
  salesInvoiceDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

interface Migration {
  up: (db: Db) => Promise<{ outcome: string; fingerprint: string }>;
  PACK_REF: { slug: string; version: number };
  DECISION_ACTOR: string;
}

e2eSuite('comptabilité — pack v2 approuvé par décision et règles par défaut', () => {
  let w: AccountingWorld;
  let m: Migration;
  let PACK_REF: Migration['PACK_REF'];

  beforeAll(async () => {
    w = await accountingWorld('pack-v2', ['finance_director'], ['switcher']);
    m = (await import(
      new URL('../../migrations/20261103-0001-pack-syscohada-v2-approuve.mjs', import.meta.url).href
    )) as Migration;
    PACK_REF = m.PACK_REF;
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('la migration enregistre le pack v2 `approved`, avec la trace de la décision ; rejouée, elle ne change rien', async () => {
    const first = await m.up(w.db);
    expect(['inserted', 'approved', 'unchanged']).toContain(first.outcome);
    const again = await m.up(w.db);
    expect(again).toEqual({ outcome: 'unchanged', fingerprint: first.fingerprint });
    const doc = await w.db.collection('accounting_chart_packs').findOne({ ...PACK_REF });
    expect(doc?.['status']).toBe('approved');
    expect(
      (doc?.['history'] as { by: string; to: string }[]).filter((h) => h.by === m.DECISION_ACTOR),
    ).not.toHaveLength(0);
    expect(await w.db.collection('accounting_chart_packs').countDocuments({ ...PACK_REF })).toBe(1);

    const list = ok(await w.get('owner', '/accounting/chart-packs'));
    const v2 = (list['items'] as Record<string, any>[]).find(
      (p) => p['slug'] === PACK_REF.slug && p['version'] === 2,
    );
    expect(v2).toMatchObject({ status: 'approved', activatable: true });
    const detail = ok(await w.get('owner', `/accounting/chart-packs/${PACK_REF.slug}/2`));
    expect(detail['suspenseAccount']).toBe('471');
    expect(detail['fingerprint']).toBe(first.fingerprint);
  });

  it('passer du pack v1 (brouillon) au v2 : le brouillon de règles se reprend et se rattache au v2', async () => {
    await loadPack(w);
    const s0 = ok(await w.get('switcher', '/accounting/settings'));
    const s1 = ok(
      await w.put('switcher', '/accounting/settings', {
        expectedRevision: s0['revision'],
        mode: 'simulation',
        chartPack: PACK_V1,
      }),
    );
    // Le v1 ne propose aucune règle : le brouillon naît vide, rattaché au v1.
    const empty = ok(await w.post('switcher', '/accounting/rule-sets', {}), 201);
    expect(empty['rules']).toEqual([]);
    expect(empty['basedOn']).toEqual({ packSlug: PACK_V1.slug, packVersion: 1 });

    // Hors mode actif, le pack approuvé se choisit à la place du brouillon.
    ok(
      await w.put('switcher', '/accounting/settings', {
        expectedRevision: s1['revision'],
        chartPack: PACK_REF,
      }),
    );
    code(await w.post('switcher', '/accounting/rule-sets', {}), 409, 'RULE_SET_DRAFT_EXISTS');

    // L'écran reprend les règles proposées du v2 dans le brouillon existant.
    const detail = ok(await w.get('switcher', `/accounting/chart-packs/${PACK_REF.slug}/2`));
    const proposed = (detail['proposedRules'] as Record<string, any>[]).map((r) => ({
      key: r['key'],
      debit: r['debit'],
      credit: r['credit'],
      requiresReview: r['requiresReview'] === true || r['confirmation'] === 'to_confirm',
    }));
    const refreshed = ok(
      await w.put('switcher', `/accounting/rule-sets/${empty['version']}`, {
        expectedRevision: empty['revision'],
        rules: proposed,
      }),
    );
    expect(refreshed['basedOn']).toEqual({ packSlug: PACK_REF.slug, packVersion: 2 });
    expect((refreshed['rules'] as unknown[]).length).toBe(proposed.length);
  });

  it('une organisation passe en mode actif par le circuit existant avec le pack v2', async () => {
    const s0 = ok(await w.get('owner', '/accounting/settings'));
    const s1 = ok(
      await w.put('owner', '/accounting/settings', {
        expectedRevision: s0['revision'],
        mode: 'simulation',
        chartPack: PACK_REF,
        bookCurrency: 'CDF',
        cutoverDate: '2026-10-01',
      }),
    );
    ok(await w.post('owner', '/accounting/fiscal-years', { year: 2026 }), 201);
    // Sans règles validées, l'activation reste refusée (circuit inchangé).
    code(
      await w.post('owner', '/accounting/activate', { expectedRevision: s1['revision'] }),
      409,
      'ACCOUNTING_ACTIVATION_PRECONDITION',
    );

    // Le jeu de règles par défaut naît en brouillon depuis le pack.
    const draft = ok(await w.post('owner', '/accounting/rule-sets', {}), 201);
    const rules = draft['rules'] as { key: string; credit: string[]; requiresReview: boolean }[];
    expect(rules.length).toBeGreaterThan(200);
    const byKey = new Map(rules.map((r) => [r.key, r]));
    expect(byKey.get('sale.invoice.revenue.SER.B')).toMatchObject({
      credit: ['706'],
      requiresReview: false,
    });
    expect(byKey.get('sale.deposit.revenue.SER.B')?.credit).toEqual(['4191']);
    expect(byKey.get('purchase.payment.unallocated')?.credit).toEqual(['4091']);
    expect(byKey.get('hr.advance.settled')).toMatchObject({
      credit: ['421'],
      requiresReview: false,
    });
    expect(byKey.get('transfer.internal')?.credit).toEqual(['585']);
    expect(byKey.get('sale.invoice.nonrevenue.J')).toMatchObject({ requiresReview: true });

    ok(
      await w.post('finance_director', `/accounting/rule-sets/${draft['version']}/validate`, {
        expectedRevision: draft['revision'],
        expertReview: { declared: true, name: 'Cabinet Essai', date: '2026-11-03', note: null },
      }),
    );
    const s2 = ok(await w.get('owner', '/accounting/settings'));
    expect(s2['activation']).toEqual({ possible: true, missing: [] });
    const active = ok(
      await w.post('owner', '/accounting/activate', { expectedRevision: s2['revision'] }),
    );
    expect(active['mode']).toBe('active');
  });

  it('une facture de vente produit 411 / 706 / 4431, sans compte d’attente', async () => {
    const invoice = salesInvoiceDoc(w.org, {
      groups: [{ group: 'B', itemType: 'SER', ht: '100000.00', vat: '16000.00' }],
    });
    await w.db.collection('sales_invoices').insertOne(invoice);
    ok(await w.post('owner', '/accounting/sync'));
    const [entry, ...rest] = await entriesOf(w.db, w.org, {
      'source.id': invoice._id.toHexString(),
    });
    expect(rest).toEqual([]);
    expect(entry?.['status']).toBe('posted');
    expect(entry?.['suspense']).toBe(false);
    const lines = (entry?.['lines'] ?? []) as Record<string, any>[];
    expect(lines.map((l) => [l['accountNumber'], l['debit'], l['credit']])).toEqual([
      ['411', '116000.00', '0.00'],
      ['706', '0.00', '100000.00'],
      ['4431', '0.00', '16000.00'],
    ]);
    expect(lines[0]?.['auxiliaryAccountNumber']).toMatch(/^411/);
    expect(lines.every((l) => l['suspenseReason'] === null)).toBe(true);
    expect(lines.some((l) => l['accountNumber'] === 'ATTENTE')).toBe(false);
  });

  it('une clé sans correspondance sûre (débours, groupe J) va au compte d’attente 471, avec son motif', async () => {
    const invoice = salesInvoiceDoc(w.org, {
      groups: [{ group: 'J', itemType: 'SER', ht: '5000.00', vat: '0.00' }],
    });
    await w.db.collection('sales_invoices').insertOne(invoice);
    ok(await w.post('owner', '/accounting/sync'));
    const [entry] = await entriesOf(w.db, w.org, { 'source.id': invoice._id.toHexString() });
    expect(entry?.['suspense']).toBe(true);
    const lines = (entry?.['lines'] ?? []) as Record<string, any>[];
    expect(lines.map((l) => [l['accountNumber'], l['suspenseReason']])).toEqual([
      ['411', null],
      ['471', 'RULE_REQUIRES_REVIEW'],
    ]);
  });

  it('les projets d’états restent `draft_unverified`, avec leur bandeau', async () => {
    const income = ok(await w.get('owner', '/accounting/statements/income-statement?year=2026'));
    expect(income['status']).toBe('draft_unverified');
    expect(income['disclaimer']).toBe(STATEMENT_DISCLAIMER);
    expect(income['available']).toBe(true);
    const balance = ok(await w.get('owner', '/accounting/statements/balance-sheet?year=2026'));
    expect(balance['status']).toBe('draft_unverified');
    expect(balance['disclaimer']).toBe(STATEMENT_DISCLAIMER);
    code(
      await w.get('owner', '/accounting/statements/cash-flow?year=2026'),
      409,
      'STATEMENT_NOT_AVAILABLE',
    );
  });
});
