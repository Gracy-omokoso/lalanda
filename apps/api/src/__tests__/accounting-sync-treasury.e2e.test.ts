// Synchronisation de la trésorerie et des devises (ADR-0049, lot K5) — e2e.
//
// Critère 8 : TVA déclarée sur une dépense — assujettie sans règle validée → charge au
// montant total ; non assujettie avec règle → règle ignorée ; assujettie avec règle →
// ligne de TVA égale au montant déclaré. Critère 9 : tenue en CDF ; facture USD à
// conversion figée → taux de la pièce ; dépense USD sans taux saisi → `awaiting_rate`,
// hors balance, puis `posted` dès le taux saisi ; virement 280 000 CDF → 100 USD → deux
// jambes de 280 000,00 CDF, taux observé 2 800 ; encaissement USD à un autre taux que la
// facture → écart au compte d'attente. Plus : annulation d'une dépense →
// contre-passation ; mois clos → contre-passation au premier jour ouvert, motif
// `SOURCE_CHANGED_IN_CLOSED_PERIOD`, inscrite dans « À comptabiliser ».

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  accountingWorld,
  entriesOf,
  expenseDoc,
  ok,
  prepareOrganization,
  receiptDoc,
  salesInvoiceDoc,
  TEST_RULES,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

type Line = Record<string, string | null | boolean>;

e2eSuite('comptabilité — trésorerie et devises (ADR-0049, K5)', () => {
  let w: AccountingWorld;
  let bank = '';
  let cashUsd = '';

  const lines = async (sourceId: ObjectId | string): Promise<Line[][]> =>
    (await entriesOf(w.db, w.org, { 'source.id': String(sourceId) })).map(
      (e) => e['lines'] as Line[],
    );
  const setVat = async (vatRegistered: boolean): Promise<void> => {
    await w.db
      .collection('organization_fiscal_profiles')
      .updateOne({ organizationId: w.org }, { $set: { vatRegistered } }, { upsert: true });
  };

  beforeAll(async () => {
    w = await accountingWorld('tresorerie', ['finance_director']);
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
    ok(
      await w.put('owner', `/accounting/treasury-links/${bank}`, {
        accountNumber: '521',
        expectedRevision: null,
      }),
    );
    ok(
      await w.put('owner', `/accounting/treasury-links/${cashUsd}`, {
        accountNumber: '571',
        expectedRevision: null,
      }),
    );
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('critère 8 — TVA déclarée : jamais récupérée sans règle validée ni hors assujettissement', async () => {
    await setVat(true);
    const a = expenseDoc(w.org, {
      spentOn: '2026-10-03',
      amount: '58000.00',
      deductibleVat: '8000.00',
      accountId: bank,
    });
    await w.db.collection('treasury_expenses').insertOne(a);
    ok(await w.post('owner', '/accounting/sync'));
    const [la] = await lines(a._id);
    expect(la!.map((l) => [l['operationKey'], l['accountNumber'], l['bookAmount']])).toEqual([
      ['expense.loyer', '601', '58000.00'],
      ['expense.payment', '521', '58000.00'],
    ]);

    // Règles v2 : la TVA déclarée peut être séparée (valeur de TEST).
    const draft = ok(await w.post('owner', '/accounting/rule-sets', {}), 201);
    const saved = ok(
      await w.put('owner', `/accounting/rule-sets/${draft['version']}`, {
        expectedRevision: draft['revision'],
        rules: [
          ...TEST_RULES,
          { key: 'expense.vat_declared', debit: ['4452'], credit: [], requiresReview: false },
        ],
      }),
    );
    ok(
      await w.post('finance_director', `/accounting/rule-sets/${draft['version']}/validate`, {
        expectedRevision: saved['revision'],
        expertReview: { declared: true, name: 'Cabinet Essai', date: '2026-10-04', note: null },
      }),
    );

    await setVat(false);
    const b = expenseDoc(w.org, {
      spentOn: '2026-10-04',
      amount: '58000.00',
      deductibleVat: '8000.00',
      accountId: bank,
    });
    await w.db.collection('treasury_expenses').insertOne(b);
    ok(await w.post('owner', '/accounting/sync'));
    const [lb] = await lines(b._id);
    expect(lb!.map((l) => l['operationKey'])).toEqual(['expense.loyer', 'expense.payment']);

    await setVat(true);
    const c = expenseDoc(w.org, {
      spentOn: '2026-10-05',
      amount: '58000.00',
      deductibleVat: '8000.00',
      accountId: bank,
    });
    await w.db.collection('treasury_expenses').insertOne(c);
    ok(await w.post('owner', '/accounting/sync'));
    const [lc] = await lines(c._id);
    expect(lc!.map((l) => [l['operationKey'], l['accountNumber'], l['bookAmount']])).toEqual([
      ['expense.loyer', '601', '50000.00'],
      ['expense.vat_declared', '4452', '8000.00'],
      ['expense.payment', '521', '58000.00'],
    ]);
    // Une règle changée n'altère aucune écriture passée.
    const [laAgain] = await lines(a._id);
    expect(laAgain).toEqual(la);
    const [ea] = await entriesOf(w.db, w.org, { 'source.id': a._id.toHexString() });
    const [ec] = await entriesOf(w.db, w.org, { 'source.id': c._id.toHexString() });
    expect(ea!['generation'].ruleSetVersion).toBe(1);
    expect(ec!['generation'].ruleSetVersion).toBe(2);
  });

  it('critère 9 — devises : taux de la pièce, attente de taux, taux observé, écart de change', async () => {
    const org = w.org;
    // Facture USD à conversion figée : taux de la pièce.
    const inv = salesInvoiceDoc(org, {
      status: 'issued',
      currency: 'USD',
      conversion: { rate: '2800' },
      issuedAt: '2026-10-06',
      groups: [{ group: 'B', itemType: 'SER', ht: '100.00', vat: '0.00' }],
    });
    // Dépense USD sans taux saisi.
    const exp = expenseDoc(org, {
      spentOn: '2026-10-07',
      amount: '50.00',
      currency: 'USD',
      accountId: cashUsd,
    });
    // Virement 280 000 CDF → 100 USD.
    const mvt = {
      _id: new ObjectId(),
      organizationId: org,
      kind: 'transfer',
      date: '2026-10-08',
      label: 'Achat de dollars',
      fromAccountId: bank,
      toAccountId: cashUsd,
      amountOut: '280000.00',
      amountIn: '100.00',
      reference: 'VIR-1',
      status: 'recorded',
      cancelReason: null,
      createdBy: 'fixture',
      updatedBy: 'fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Encaissement USD de la facture, à un autre taux (saisi) que celui de la facture.
    const rec = receiptDoc(org, {
      receivedOn: '2026-10-09',
      amount: '100.00',
      currency: 'USD',
      accountId: cashUsd,
      allocations: [
        {
          invoiceId: inv._id.toHexString(),
          invoiceNumber: inv['number'] as string,
          amount: '100.00',
        },
      ],
    });
    ok(
      await w.put('owner', '/accounting/exchange-rates/2026-10-09/USD/CDF', {
        rate: '2900',
        sourceText: 'BCC, cours indicatif du jour',
        expectedRevision: null,
      }),
      201,
    );
    await w.db.collection('sales_invoices').insertOne(inv);
    await w.db.collection('treasury_expenses').insertOne(exp);
    await w.db.collection('treasury_movements').insertOne(mvt);
    await w.db.collection('sales_receipts').insertOne(rec);
    const res = ok(await w.post('owner', '/accounting/sync'));
    expect(res['awaitingRate']).toBe(1);

    const [ei] = await entriesOf(w.db, org, { 'source.id': inv._id.toHexString() });
    expect(ei!['status']).toBe('posted');
    expect((ei!['lines'] as Line[])[0]).toMatchObject({
      currency: 'USD',
      amount: '100.00',
      bookAmount: '280000.00',
      rate: '2800',
      rateSource: 'document',
    });

    const [ee] = await entriesOf(w.db, org, { 'source.id': exp._id.toHexString() });
    expect(ee).toMatchObject({ status: 'awaiting_rate', number: null, seq: null });
    expect((ee!['lines'] as Line[]).every((l) => l['bookAmount'] === null)).toBe(true);
    const pending = ok(await w.get('owner', '/accounting/pending'));
    expect(pending['items']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'RATE_MISSING',
          source: expect.objectContaining({ id: exp._id.toHexString() }),
        }),
      ]),
    );

    const legs = await entriesOf(w.db, org, { 'source.id': mvt._id.toHexString() });
    expect(legs.map((e) => e['sourceKey'])).toEqual([
      `treasury_movement:${mvt._id.toHexString()}:out`,
      `treasury_movement:${mvt._id.toHexString()}:in`,
    ]);
    for (const leg of legs) {
      const debit = (leg['lines'] as Line[])
        .filter((l) => l['side'] === 'debit')
        .map((l) => l['bookAmount']);
      expect(debit).toEqual(['280000.00']);
    }
    const usdLine = (legs[1]!['lines'] as Line[]).find((l) => l['currency'] === 'USD');
    expect(usdLine).toMatchObject({ rateSource: 'observed', rate: '2800', amount: '100.00' });

    const [er] = await entriesOf(w.db, org, { 'source.id': rec._id.toHexString() });
    const rl = er!['lines'] as Line[];
    expect(rl.find((l) => l['operationKey'] === 'receipt.VIREMENT')).toMatchObject({
      bookAmount: '290000.00',
      rateSource: 'entered',
    });
    expect(rl.find((l) => l['operationKey'] === 'receipt.receivable')).toMatchObject({
      bookAmount: '280000.00',
      rateSource: 'document',
    });
    expect(rl.find((l) => l['exchangeDifference'] === true)).toMatchObject({
      accountNumber: 'ATTENTE',
      side: 'credit',
      bookAmount: '10000.00',
      amount: '0.00',
      suspenseReason: 'EXCHANGE_DIFFERENCE',
    });

    // Taux saisi pour la date de la dépense : elle devient `posted`, numérotée.
    ok(
      await w.put('owner', '/accounting/exchange-rates/2026-10-07/USD/CDF', {
        rate: '2850',
        sourceText: 'BCC',
        expectedRevision: null,
      }),
      201,
    );
    const after = ok(await w.post('owner', '/accounting/sync'));
    expect(after).toMatchObject({ posted: 1, created: 0, awaitingRate: 0 });
    const [ee2] = await entriesOf(w.db, org, { 'source.id': exp._id.toHexString() });
    expect(ee2).toMatchObject({ _id: ee!['_id'], status: 'posted', fiscalYear: 2026 });
    expect(typeof ee2!['number']).toBe('number');
    expect((ee2!['lines'] as Line[])[0]).toMatchObject({
      bookAmount: '142500.00',
      rateSource: 'entered',
      rate: '2850',
    });
    const open = ok(await w.get('owner', '/accounting/pending'))['items'] as {
      reason: string;
      source: { id: string };
    }[];
    expect(open.some((p) => p.source.id === exp._id.toHexString())).toBe(false);
  });

  it('annulation d’une dépense : contre-passation ; mois clos → premier jour ouvert, signalée', async () => {
    const org = w.org;
    const d1 = expenseDoc(org, { spentOn: '2026-10-20', amount: '1000.00', accountId: bank });
    const d2 = expenseDoc(org, { spentOn: '2026-10-21', amount: '2000.00', accountId: bank });
    await w.db.collection('treasury_expenses').insertMany([d1, d2]);
    ok(await w.post('owner', '/accounting/sync'));

    await w.db
      .collection('treasury_expenses')
      .updateOne(
        { _id: d1._id },
        { $set: { status: 'cancelled', revision: 2, updatedAt: new Date() } },
      );
    ok(await w.post('owner', '/accounting/sync'));
    const [o1, r1] = await entriesOf(w.db, org, { 'source.id': d1._id.toHexString() });
    expect(r1).toMatchObject({
      sourceKey: `treasury_expense:${d1._id.toHexString()}:cancel`,
      date: '2026-10-20',
      reversalOf: String(o1!['_id']),
      reversalReason: 'SOURCE_CANCELLED',
    });

    // Octobre clos (le lot K6 le fera par l'API) : la contre-passation va au 1ᵉʳ novembre.
    await w.db
      .collection('accounting_periods')
      .updateOne({ organizationId: org, year: 2026, month: 10 }, { $set: { status: 'closed' } });
    await w.db
      .collection('treasury_expenses')
      .updateOne(
        { _id: d2._id },
        { $set: { status: 'cancelled', revision: 2, updatedAt: new Date() } },
      );
    ok(await w.post('owner', '/accounting/sync'));
    const [o2, r2] = await entriesOf(w.db, org, { 'source.id': d2._id.toHexString() });
    expect(r2).toMatchObject({
      date: '2026-11-01',
      reversalOf: String(o2!['_id']),
      reversalReason: 'SOURCE_CHANGED_IN_CLOSED_PERIOD',
      status: 'posted',
    });
    const pending = ok(await w.get('owner', '/accounting/pending'))['items'] as Record<
      string,
      any
    >[];
    const changed = pending.find((p) => p['reason'] === 'SOURCE_CHANGED_IN_CLOSED_PERIOD');
    expect(changed).toMatchObject({
      entryId: String(r2!['_id']),
      source: { id: d2._id.toHexString() },
    });

    // Une pièce neuve datée d'un mois clos n'est pas passée : « À comptabiliser ».
    const d3 = expenseDoc(org, { spentOn: '2026-10-22', amount: '300.00', accountId: bank });
    await w.db.collection('treasury_expenses').insertOne(d3);
    ok(await w.post('owner', '/accounting/sync'));
    expect(await entriesOf(w.db, org, { 'source.id': d3._id.toHexString() })).toEqual([]);
    const after = ok(await w.get('owner', '/accounting/pending'))['items'] as Record<string, any>[];
    expect(after.find((p) => p['source'].id === d3._id.toHexString())).toMatchObject({
      reason: 'PERIOD_CLOSED',
    });

    // Revue humaine motivée.
    const resolved = ok(
      await w.post('finance_director', `/accounting/pending/${changed!['id']}/resolve`, {
        note: 'Vu avec l’expert',
      }),
    );
    expect(resolved).toMatchObject({
      status: 'resolved',
      resolvedBy: w.userIds['finance_director'],
    });
    await w.db
      .collection('accounting_periods')
      .updateOne({ organizationId: org, year: 2026, month: 10 }, { $set: { status: 'open' } });
  });
});
