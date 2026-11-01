// Clôtures, réouvertures et à-nouveaux de la comptabilité (ADR-0049 § 4, lot K6) — e2e.
//
// Critère 12 : mois clos PAR L'API → une dépense datée du mois et annulée ensuite produit
// une contre-passation au premier jour ouvert, motif `SOURCE_CHANGED_IN_CLOSED_PERIOD` ;
// clôture d'exercice refusée avec une écriture `awaiting_rate` ou un solde d'attente non
// accepté (`details.reasons`) ; réouverture par un Directeur financier →
// `403 REOPEN_OWNER_ONLY`. Plus : brouillon → `409 PERIOD_HAS_DRAFTS` ; motif exigé ;
// à-nouveaux générés par le moteur, validés et chaînés dans le journal d'à-nouveaux de
// l'exercice suivant ; réouverture de l'exercice → à-nouveaux contre-passés ; lecture et
// exports seulement pour l'Expert-comptable ; isolation par organisation.

import { afterAll, beforeAll, expect, it } from 'vitest';

import { AccountingEntryStore } from '../accounting/entries/accounting-entry-store.service.js';
import {
  accountingWorld,
  code,
  entriesOf,
  expenseDoc,
  ok,
  prepareOrganization,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

e2eSuite('comptabilité — clôtures et à-nouveaux (ADR-0049, K6)', () => {
  let w: AccountingWorld;
  let bank = '';
  let cashUsd = '';

  beforeAll(async () => {
    w = await accountingWorld(
      'clotures',
      ['finance_director', 'accountant', 'external_accountant'],
      ['intrus'],
    );
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    const b = treasuryAccountDoc(w.org, { name: 'Banque CDF', kind: 'bank', currency: 'CDF' });
    const c = treasuryAccountDoc(w.org, { name: 'Caisse USD', kind: 'cash', currency: 'USD' });
    await w.db.collection('treasury_accounts').insertMany([b, c]);
    bank = b._id.toHexString();
    cashUsd = c._id.toHexString();
    for (const [id, accountNumber] of [
      [bank, '521'],
      [cashUsd, '571'],
    ] as const) {
      ok(
        await w.put('owner', `/accounting/treasury-links/${id}`, {
          accountNumber,
          expectedRevision: null,
        }),
      );
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('mois : brouillon → 409 PERIOD_HAS_DRAFTS ; clôture ; pièce annulée après → premier jour ouvert', async () => {
    const d1 = expenseDoc(w.org, { spentOn: '2026-10-10', amount: '1000.00', accountId: bank });
    await w.db.collection('treasury_expenses').insertOne(d1);
    ok(await w.post('owner', '/accounting/sync'));

    const draft = ok(
      await w.post('accountant', '/accounting/entries', {
        journalCode: 'OD',
        date: '2026-10-15',
        reason: 'Régularisation',
        lines: [
          { accountNumber: '601', debit: '10.00' },
          { accountNumber: '521', credit: '10.00' },
        ],
      }),
      201,
    );
    code(await w.post('accountant', '/accounting/periods/2026/10/close'), 409, 'PERIOD_HAS_DRAFTS');
    expect(
      (await w.del('accountant', `/accounting/entries/${String(draft['id'])}`)).status,
    ).toBeLessThan(300);

    // L'Expert-comptable lit et exporte seulement : il ne clôt pas.
    expect((await w.post('external_accountant', '/accounting/periods/2026/10/close')).status).toBe(
      403,
    );
    const fy = ok(await w.post('accountant', '/accounting/periods/2026/10/close'));
    const oct = (fy['periods'] as Record<string, unknown>[]).find((p) => p['month'] === 10)!;
    expect(oct).toMatchObject({ status: 'closed' });
    expect(oct['closedAt']).toEqual(expect.any(String));
    code(
      await w.post('accountant', '/accounting/periods/2026/10/close'),
      409,
      'PERIOD_ALREADY_CLOSED',
    );

    // Une opération diverse datée d'un mois clos ne se valide pas (K5).
    await w.db
      .collection('treasury_expenses')
      .updateOne(
        { _id: d1._id },
        { $set: { status: 'cancelled', revision: 2, updatedAt: new Date() } },
      );
    ok(await w.post('owner', '/accounting/sync'));
    const [o1, r1] = await entriesOf(w.db, w.org, { 'source.id': d1._id.toHexString() });
    expect(r1).toMatchObject({
      date: '2026-11-01',
      reversalOf: String(o1!['_id']),
      reversalReason: 'SOURCE_CHANGED_IN_CLOSED_PERIOD',
      status: 'posted',
    });
    const audit = await w.db
      .collection('audit_events')
      .findOne({ organizationId: w.org, action: 'accounting.period_closed' });
    expect(audit).not.toBeNull();
  });

  it('réouverture : Propriétaire seul, motif obligatoire, journal en ajout seul', async () => {
    code(
      await w.post('finance_director', '/accounting/periods/2026/10/reopen', { reason: 'Erreur' }),
      403,
      'REOPEN_OWNER_ONLY',
    );
    code(
      await w.post('accountant', '/accounting/periods/2026/10/reopen', { reason: 'Erreur' }),
      403,
      'REOPEN_OWNER_ONLY',
    );
    code(
      await w.post('owner', '/accounting/periods/2026/10/reopen', {}),
      400,
      'REOPEN_REASON_REQUIRED',
    );
    code(
      await w.post('owner', '/accounting/periods/2026/10/reopen', { reason: '   ' }),
      400,
      'REOPEN_REASON_REQUIRED',
    );
    const fy = ok(
      await w.post('owner', '/accounting/periods/2026/10/reopen', {
        reason: 'Facture fournisseur oubliée',
      }),
    );
    expect(
      (fy['periods'] as Record<string, unknown>[]).find((p) => p['month'] === 10),
    ).toMatchObject({ status: 'open', closedAt: null });
    const doc = await w.db
      .collection('accounting_periods')
      .findOne({ organizationId: w.org, year: 2026, month: 10 });
    expect(doc!['reopenLog']).toHaveLength(1);
    expect(doc!['reopenLog'][0]).toMatchObject({ reason: 'Facture fournisseur oubliée' });
    code(
      await w.post('owner', '/accounting/periods/2026/10/reopen', { reason: 'x' }),
      409,
      'PERIOD_NOT_CLOSED',
    );
  });

  it('exercice : refus motivé (mois ouverts, attente de taux, attente non acceptée), puis à-nouveaux', async () => {
    // Une dépense USD sans taux saisi : écriture `awaiting_rate`.
    const usd = expenseDoc(w.org, {
      spentOn: '2026-11-03',
      amount: '50.00',
      currency: 'USD',
      accountId: cashUsd,
    });
    // Une dépense sans règle validée : compte d'attente.
    const transport = expenseDoc(w.org, {
      spentOn: '2026-11-04',
      amount: '700.00',
      category: 'transport',
      accountId: bank,
    });
    await w.db.collection('treasury_expenses').insertMany([usd, transport]);
    ok(await w.post('owner', '/accounting/sync'));
    const [pending] = await entriesOf(w.db, w.org, { 'source.id': usd._id.toHexString() });
    expect(pending).toMatchObject({ status: 'awaiting_rate' });

    const refused = await w.post('accountant', '/accounting/fiscal-years/2026/close', {});
    code(refused, 409, 'FISCAL_YEAR_NOT_CLOSABLE');
    const reasons = (refused.body.details.reasons as { code: string }[]).map((r) => r.code);
    expect(reasons).toEqual(
      expect.arrayContaining(['PERIODS_OPEN', 'AWAITING_RATE', 'SUSPENSE_NOT_ACCEPTED']),
    );

    // Taux saisi : l'écriture devient `posted` à la synchronisation suivante.
    ok(
      await w.put('accountant', '/accounting/exchange-rates/2026-11-03/USD/CDF', {
        rate: '2800',
        sourceText: 'Taux de test',
        expectedRevision: null,
      }),
      201,
    );
    ok(await w.post('owner', '/accounting/sync'));
    const [posted] = await entriesOf(w.db, w.org, { 'source.id': usd._id.toHexString() });
    expect(posted).toMatchObject({ status: 'posted' });

    for (let m = 1; m <= 12; m += 1) {
      ok(await w.post('accountant', `/accounting/periods/2026/${m}/close`));
    }
    const still = await w.post('accountant', '/accounting/fiscal-years/2026/close', {});
    code(still, 409, 'FISCAL_YEAR_NOT_CLOSABLE');
    expect((still.body.details.reasons as { code: string }[]).map((r) => r.code)).toEqual([
      'SUSPENSE_NOT_ACCEPTED',
    ]);

    const closed = ok(
      await w.post('accountant', '/accounting/fiscal-years/2026/close', {
        suspenseAcceptance: { reason: 'Transport à classer par l’expert' },
      }),
    );
    expect(closed['fiscalYear']).toMatchObject({ year: 2026, status: 'closed' });
    expect(closed['suspenseAccepted']).toMatchObject({
      reason: 'Transport à classer par l’expert',
    });
    expect(closed['opening']).toMatchObject({
      nextFiscalYear: 2027,
      date: '2027-01-01',
      balanced: true,
    });
    const openingId = String(closed['opening']['entryId']);
    const [opening] = await entriesOf(w.db, w.org, { journalCode: 'AN', date: '2027-01-01' });
    expect(String(opening!['_id'])).toBe(openingId);
    expect(opening).toMatchObject({ status: 'posted', fiscalYear: 2027, number: 1 });
    expect(opening!['hash']).toMatch(/^[0-9a-f]{64}$/);
    const store = w.app.get(AccountingEntryStore);
    expect((await store.verifyChain(w.org)).ok).toBe(true);
    // L'exercice suivant existe, ouvert.
    const years = ok(await w.get('owner', '/accounting/fiscal-years'))['items'] as {
      year: number;
      status: string;
    }[];
    expect(years.find((y) => y.year === 2027)).toMatchObject({ status: 'open' });

    // La balance de janvier 2027 s'ouvre sur les à-nouveaux, sans doubler l'historique.
    const tb = ok(
      await w.post('owner', '/accounting/trial-balance', { from: '2027-01-01', to: '2027-01-31' }),
    );
    expect(tb['balanced']).toBe(true);
    const bankRow = (tb['rows'] as Record<string, string>[]).find(
      (r) => r['accountNumber'] === '521',
    );
    const decBalance = ok(
      await w.post('owner', '/accounting/trial-balance', { from: '2026-12-01', to: '2026-12-31' }),
    );
    const decBank = (decBalance['rows'] as Record<string, string>[]).find(
      (r) => r['accountNumber'] === '521',
    );
    expect(bankRow!['closingBalance']).toBe(decBank!['closingBalance']);

    code(
      await w.post('accountant', '/accounting/fiscal-years/2026/close', {}),
      409,
      'FISCAL_YEAR_CLOSED',
    );
    // Un mois d'un exercice clos ne se rouvre pas seul.
    code(
      await w.post('owner', '/accounting/periods/2026/12/reopen', { reason: 'x' }),
      409,
      'FISCAL_YEAR_CLOSED',
    );
  });

  it('réouverture de l’exercice : Propriétaire seul ; à-nouveaux contre-passés', async () => {
    code(
      await w.post('finance_director', '/accounting/fiscal-years/2026/reopen', { reason: 'x' }),
      403,
      'REOPEN_OWNER_ONLY',
    );
    const fy = ok(
      await w.post('owner', '/accounting/fiscal-years/2026/reopen', { reason: 'Écriture oubliée' }),
    );
    expect(fy).toMatchObject({ year: 2026, status: 'open', closedAt: null });
    const an = await entriesOf(w.db, w.org, { journalCode: 'AN' });
    expect(an).toHaveLength(2);
    const [original, reversal] = an;
    expect(original!['reversedBy']).toBe(String(reversal!['_id']));
    expect(reversal).toMatchObject({
      reversalOf: String(original!['_id']),
      reversalReason: 'FISCAL_YEAR_REOPENED',
      date: '2027-01-01',
      status: 'posted',
    });
    const doc = await w.db
      .collection('accounting_fiscal_years')
      .findOne({ organizationId: w.org, year: 2026 });
    expect(doc!['reopenLog']).toHaveLength(1);
    expect((await w.app.get(AccountingEntryStore).verifyChain(w.org)).ok).toBe(true);

    // Reclôture : à-nouveaux nouveaux, clé de source nouvelle.
    const again = ok(
      await w.post('owner', '/accounting/fiscal-years/2026/close', {
        suspenseAcceptance: { reason: 'Toujours à classer' },
      }),
    );
    expect(again['opening']['entryId']).toEqual(expect.any(String));
    const keys = (await entriesOf(w.db, w.org, { journalCode: 'AN' })).map((e) => e['sourceKey']);
    expect(keys).toEqual([
      'fiscal_year:2026:opening:c1',
      'fiscal_year:2026:opening:c1:reversal',
      'fiscal_year:2026:opening:c2',
    ]);
  });

  it('isolation : une autre organisation ne voit ni ne clôt rien', async () => {
    code(await w.post('intrus', '/accounting/periods/2026/10/close'), 409, 'ACCOUNTING_NOT_ACTIVE');
    code(
      await w.post('intrus', '/accounting/trial-balance', { from: '2026-10-01', to: '2026-10-31' }),
      409,
      'ACCOUNTING_OFF',
    );
    const after = await w.db
      .collection('accounting_periods')
      .countDocuments({ organizationId: w.orgOf['intrus'] });
    expect(after).toBe(0);
  });
});
