// Synchronisation des ventes (ADR-0049, lot K5) — e2e.
//
// Critères 3 à 6 et 13 (part K5) : facture B et C → une écriture VE équilibrée égale aux
// totaux figés ; rejouer n'écrit rien ; brouillon, échec de normalisation, série d'essai
// et pièce antérieure à la bascule ne produisent rien ; les documents de vente sont égaux
// octet pour octet avant et après ; groupe J sans règle → compte d'attente, jamais un
// produit ; paiement à l'émission sans règle de moyen → seconde écriture vers l'attente ;
// encaissement lettré à deux factures → journal du compte de trésorerie, lettrage
// automatique, contre-passation et délettrage à l'annulation ; sans compte → attente et
// « À comptabiliser ». Plus : mode `off` = rien ; simulation = calculé, rien d'enregistré ;
// égalité des écritures de vente avec les factures ; isolation ; droits.

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  accountingWorld,
  add,
  code,
  entriesOf,
  ok,
  prepareOrganization,
  receiptDoc,
  salesInvoiceDoc,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const SOURCE_COLLECTIONS = ['sales_invoices', 'sales_receipts', 'treasury_accounts'] as const;

e2eSuite('comptabilité — synchronisation des ventes (ADR-0049, K5)', () => {
  let w: AccountingWorld;
  let orgB = '';
  const ids: Record<string, ObjectId> = {};
  let bankId = '';

  const snapshot = async (org: string): Promise<string> => {
    const out: Record<string, unknown[]> = {};
    for (const c of SOURCE_COLLECTIONS) {
      out[c] = await w.db.collection(c).find({ organizationId: org }).sort({ _id: 1 }).toArray();
    }
    return JSON.stringify(out);
  };

  beforeAll(async () => {
    w = await accountingWorld('ventes', ['finance_director', 'external_accountant'], ['ownerB']);
    orgB = w.orgOf['ownerB']!;
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('mode off : rien n’est lu, rien n’est généré', async () => {
    await w.db.collection('sales_invoices').insertOne(
      salesInvoiceDoc(orgB, { groups: [{ group: 'B', itemType: 'SER', ht: '100.00', vat: '16.00' }] }),
    );
    const res = ok(await w.post('ownerB', '/accounting/sync'));
    expect(res).toMatchObject({ mode: 'off', created: 0, posted: 0, sourcesRead: 0 });
    expect(ok(await w.get('ownerB', '/accounting/entries'))['items']).toEqual([]);
    expect(await w.db.collection('accounting_entries').countDocuments({ organizationId: orgB })).toBe(0);
  });

  it('simulation : écritures calculées à la volée, au compte d’attente sans règle validée ; rien d’enregistré', async () => {
    await prepareOrganization(w, { who: 'ownerB', mode: 'simulation', rules: null });
    const sync = ok(await w.post('ownerB', '/accounting/sync'));
    expect(sync).toMatchObject({ mode: 'simulation', created: 1, posted: 1 });
    const page = ok(await w.get('ownerB', '/accounting/entries'));
    expect(page['simulation']).toBe(true);
    expect(page['items']).toHaveLength(1);
    const e = page['items'][0];
    expect(e).toMatchObject({ simulation: true, number: null, fiscalYear: null, journalCode: 'VE', suspense: true });
    expect(e.lines.every((l: { accountNumber: string }) => l.accountNumber === 'ATTENTE')).toBe(true);
    expect(e.lines[0].suspenseReason).toBe('NO_VALIDATED_RULE_SET');
    const detail = ok(await w.get('ownerB', `/accounting/entries/${encodeURIComponent(e.id)}`));
    expect(detail['sourceKey']).toBe(e.sourceKey);
    for (const c of ['accounting_entries', 'accounting_pending', 'accounting_counters', 'accounting_journal_heads']) {
      expect(await w.db.collection(c).countDocuments({ organizationId: orgB }), c).toBe(0);
    }
    code(await w.post('ownerB', '/accounting/periods/2026/10/regenerate'), 409, 'ACCOUNTING_NOT_ACTIVE');
  });

  it('préparation du mode actif : compte de trésorerie rattaché au plan, règles validées', async () => {
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    const bank = treasuryAccountDoc(w.org, { name: 'Banque essai', kind: 'bank', currency: 'CDF' });
    await w.db.collection('treasury_accounts').insertOne(bank);
    bankId = bank._id.toHexString();
    const links = ok(await w.get('external_accountant', '/accounting/treasury-links'));
    expect(links['items']).toEqual([
      expect.objectContaining({ treasuryAccountId: bankId, accountNumber: null, revision: null }),
    ]);
    code(
      await w.put('owner', `/accounting/treasury-links/${bankId}`, { accountNumber: '99999', expectedRevision: null }),
      409,
      'ACCOUNT_NOT_IN_PLAN',
    );
    expect(
      (await w.put('external_accountant', `/accounting/treasury-links/${bankId}`, { accountNumber: '521', expectedRevision: null }))
        .status,
    ).toBe(403);
    ok(await w.put('owner', `/accounting/treasury-links/${bankId}`, { accountNumber: '521', expectedRevision: null }));
  });

  it('critères 3 à 6 : factures, groupes non produits, paiement à l’émission, encaissements', async () => {
    const org = w.org;
    // Un encaissement règle les factures d'UN client (ADR-0031).
    const client = { customerId: new ObjectId().toHexString(), customerName: 'Client Kinshasa' };
    const inv1 = salesInvoiceDoc(org, {
      ...client,
      groups: [
        { group: 'B', itemType: 'SER', ht: '1000.00', vat: '160.00' },
        { group: 'C', itemType: 'BIE', ht: '500.00', vat: '40.00' },
      ],
    });
    const inv2 = salesInvoiceDoc(org, {
      ...client,
      groups: [
        { group: 'B', itemType: 'SER', ht: '2000.00', vat: '320.00' },
        { group: 'J', itemType: 'SER', ht: '300.00', vat: '0.00' },
      ],
    });
    const inv3 = salesInvoiceDoc(org, {
      status: 'issued',
      groups: [{ group: 'B', itemType: 'SER', ht: '500.00', vat: '80.00' }],
      payments: [{ method: 'ESPECES', amount: '580.00' }],
    });
    const inv4 = salesInvoiceDoc(org, { groups: [{ group: 'B', itemType: 'SER', ht: '1000.00', vat: '160.00' }] });
    const brouillon = salesInvoiceDoc(org, {
      status: 'draft',
      series: null,
      groups: [{ group: 'B', itemType: 'SER', ht: '10.00', vat: '1.60' }],
    });
    const echec = salesInvoiceDoc(org, {
      status: 'normalization_failed',
      groups: [{ group: 'B', itemType: 'SER', ht: '10.00', vat: '1.60' }],
    });
    const essai = salesInvoiceDoc(org, {
      series: 'test',
      groups: [{ group: 'B', itemType: 'SER', ht: '10.00', vat: '1.60' }],
    });
    const veille = salesInvoiceDoc(org, {
      issuedAt: '2026-09-30',
      groups: [{ group: 'B', itemType: 'SER', ht: '10.00', vat: '1.60' }],
    });
    await w.db
      .collection('sales_invoices')
      .insertMany([inv1, inv2, inv3, inv4, brouillon, echec, essai, veille]);
    Object.assign(ids, { inv1: inv1._id, inv2: inv2._id, inv3: inv3._id, inv4: inv4._id });
    const r1 = receiptDoc(org, {
      receivedOn: '2026-10-10',
      amount: '4320.00',
      accountId: bankId,
      allocations: [
        { invoiceId: inv1._id.toHexString(), invoiceNumber: inv1['number'] as string, amount: '1700.00' },
        { invoiceId: inv2._id.toHexString(), invoiceNumber: inv2['number'] as string, amount: '2620.00' },
      ],
    });
    const r2 = receiptDoc(org, {
      receivedOn: '2026-10-11',
      amount: '1160.00',
      accountId: null,
      allocations: [{ invoiceId: inv4._id.toHexString(), invoiceNumber: inv4['number'] as string, amount: '1160.00' }],
    });
    await w.db.collection('sales_receipts').insertMany([r1, r2]);
    Object.assign(ids, { r1: r1._id, r2: r2._id });

    const before = await snapshot(org);
    const first = ok(await w.post('owner', '/accounting/sync'));
    expect(first).toMatchObject({ mode: 'active', awaitingRate: 0, reversed: 0 });
    expect(first['posted']).toBe(7); // 4 factures + 1 paiement à l'émission + 2 encaissements

    // Critère 3 — écriture VE de la facture B et C, égale aux totaux figés.
    const [e1] = await entriesOf(w.db, org, { sourceKey: `sales_invoice:${inv1._id.toHexString()}:issue` });
    expect(e1).toMatchObject({ journalCode: 'VE', status: 'posted', fiscalYear: 2026, suspense: false });
    expect(typeof e1!['number']).toBe('number');
    const amounts = (e1!['lines'] as { accountNumber: string; side: string; bookAmount: string; auxiliaryAccountNumber: string | null }[]).map(
      (l) => [l.accountNumber, l.side, l.bookAmount, l.auxiliaryAccountNumber],
    );
    expect(amounts).toEqual([
      ['411', 'debit', '1700.00', '41100001'],
      ['706', 'credit', '1000.00', null],
      ['4431', 'credit', '160.00', null],
      ['701', 'credit', '500.00', null],
      ['4431', 'credit', '40.00', null],
    ]);
    const auxiliaire = await w.db
      .collection('accounting_accounts')
      .findOne({ organizationId: org, number: '41100001' });
    expect(auxiliaire).toMatchObject({ collectiveNumber: '411', auxiliary: { kind: 'customer' } });

    // Rien pour le brouillon, l'échec de normalisation, la série d'essai, la veille de la bascule.
    for (const doc of [brouillon, echec, essai, veille]) {
      expect(await entriesOf(w.db, org, { 'source.id': doc._id.toHexString() })).toEqual([]);
    }

    // Critère 4 — groupe J sans règle : compte d'attente, jamais un produit.
    const [e2] = await entriesOf(w.db, org, { sourceKey: `sales_invoice:${inv2._id.toHexString()}:issue` });
    expect(e2!['suspense']).toBe(true);
    const j = (e2!['lines'] as Record<string, string>[]).find((l) => l['operationKey'] === 'sale.invoice.nonrevenue.J');
    expect(j).toMatchObject({ accountNumber: 'ATTENTE', bookAmount: '300.00', suspenseReason: 'NO_RULE' });
    const produits = (e2!['lines'] as Record<string, string>[]).filter((l) => l['accountNumber']!.startsWith('7'));
    expect(produits.map((l) => l['bookAmount'])).toEqual(['2000.00']);

    // Critère 5 — paiement à l'émission en espèces sans règle de moyen : seconde écriture vers l'attente.
    const e3 = await entriesOf(w.db, org, { 'source.id': inv3._id.toHexString() });
    expect(e3.map((e) => e['sourceKey'])).toEqual([
      `sales_invoice:${inv3._id.toHexString()}:issue`,
      `sales_invoice:${inv3._id.toHexString()}:paid_at_issue`,
    ]);
    const especes = (e3[1]!['lines'] as Record<string, string>[]).find(
      (l) => l['operationKey'] === 'sale.payment_at_issue.ESPECES',
    );
    expect(especes).toMatchObject({ accountNumber: 'ATTENTE', side: 'debit', bookAmount: '580.00' });

    // Critère 6 — encaissement lettré à deux factures, compte renseigné.
    const [er1] = await entriesOf(w.db, org, { sourceKey: `sales_receipt:${r1._id.toHexString()}:r1` });
    expect(er1).toMatchObject({ journalCode: 'T01', journalKind: 'treasury', status: 'posted', suspense: false });
    const r1Lines = er1!['lines'] as Record<string, string | null>[];
    expect(r1Lines.map((l) => [l['accountNumber'], l['side'], l['bookAmount']])).toEqual([
      ['521', 'debit', '4320.00'],
      ['411', 'credit', '1700.00'],
      ['411', 'credit', '2620.00'],
    ]);
    expect(r1Lines[1]!['letteringCode']).toMatch(/^L\d{6}$/);
    expect(r1Lines[2]!['letteringCode']).toMatch(/^L\d{6}$/);
    const [e1After] = await entriesOf(w.db, org, { _id: e1!['_id'] });
    expect((e1After!['lines'] as Record<string, string | null>[])[0]!['letteringCode']).toBe(
      r1Lines[1]!['letteringCode'],
    );
    expect(
      await w.db.collection('accounting_lettering').countDocuments({ organizationId: org, action: 'letter' }),
    ).toBe(4); // inv1, inv2 (r1) ; inv3 (payée à l'émission) ; inv4 (r2)

    // Sans compte de trésorerie : attente et « À comptabiliser » `NO_TREASURY_ACCOUNT`.
    const [er2] = await entriesOf(w.db, org, { 'source.id': r2._id.toHexString() });
    expect((er2!['lines'] as Record<string, string>[])[0]).toMatchObject({
      accountNumber: 'ATTENTE',
      suspenseReason: 'NO_TREASURY_ACCOUNT',
    });
    const pending = ok(await w.get('external_accountant', '/accounting/pending'));
    expect(pending['items']).toEqual([
      expect.objectContaining({
        reason: 'NO_TREASURY_ACCOUNT',
        status: 'open',
        source: expect.objectContaining({ kind: 'sales_receipt', id: r2._id.toHexString() }),
      }),
    ]);

    // Égalité avec les factures : les totaux des écritures de vente égalent les totaux des factures.
    const ve = await entriesOf(w.db, org, { journalCode: 'VE', sourceKey: { $regex: ':issue$' } });
    const posted = [inv1, inv2, inv3, inv4];
    const invoiceTotal = add(...posted.map((d) => (d['documentAmounts'] as any).calculation.totals.total));
    const debitTotal = add(...ve.flatMap((e) => (e['lines'] as Record<string, string>[]).map((l) => l['debit']!)));
    const creditTotal = add(...ve.flatMap((e) => (e['lines'] as Record<string, string>[]).map((l) => l['credit']!)));
    expect(ve).toHaveLength(4);
    expect(debitTotal).toBe(invoiceTotal);
    expect(creditTotal).toBe(invoiceTotal);

    // Rejouer n'écrit rien ; les pièces sources sont égales octet pour octet.
    const count = await w.db.collection('accounting_entries').countDocuments({ organizationId: org });
    const again = ok(await w.post('owner', '/accounting/sync'));
    expect(again).toMatchObject({ created: 0, posted: 0, reversed: 0 });
    // Point de lecture dépassé : relecture forcée de tout, toujours rien de plus.
    await w.db.collection('accounting_sync_checkpoints').deleteMany({ organizationId: org });
    expect(ok(await w.post('finance_director', '/accounting/sync'))).toMatchObject({ created: 0, posted: 0 });
    expect(await w.db.collection('accounting_entries').countDocuments({ organizationId: org })).toBe(count);
    expect(await snapshot(org)).toBe(before);

    // Lecture par l'API : filtres en corps, pièce, numéro.
    const search = ok(
      await w.post('external_accountant', '/accounting/entries/search', {
        journalCode: 'VE',
        sourceNumber: (inv1['number'] as string).toLowerCase(),
      }),
    );
    expect(search['items']).toHaveLength(1);
    expect(search['items'][0]).toMatchObject({
      journalCode: 'VE',
      simulation: false,
      source: { kind: 'sales_invoice', id: inv1._id.toHexString() },
    });
    expect(search['items'][0].lines[0]).toMatchObject({ accountNumber: '411', debit: '1700.00', credit: null });
    const parCompte = ok(await w.post('owner', '/accounting/entries/search', { accountNumber: '41100001' }));
    expect(parCompte['items'].length).toBeGreaterThanOrEqual(2);
  });

  it('annulation d’un encaissement : contre-passation liée, délettrage', async () => {
    const org = w.org;
    const r1 = ids['r1']!.toHexString();
    await w.db
      .collection('sales_receipts')
      .updateOne(
        { _id: ids['r1'] },
        { $set: { status: 'cancelled', revision: 2, updatedAt: new Date(), cancellation: { at: new Date(), by: 'x', reason: 'erreur' } } },
      );
    const res = ok(await w.post('owner', '/accounting/sync'));
    expect(res).toMatchObject({ reversed: 1, created: 1 });
    const [orig, rev] = await entriesOf(w.db, org, { 'source.id': r1 });
    expect(rev).toMatchObject({
      sourceKey: `sales_receipt:${r1}:cancel`,
      journalCode: 'T01',
      reversalOf: String(orig!['_id']),
      reversalReason: 'SOURCE_CANCELLED',
      status: 'posted',
    });
    expect(orig!['reversedBy']).toBe(String(rev!['_id']));
    expect((orig!['lines'] as Record<string, unknown>[]).every((l) => l['letteringCode'] === null)).toBe(true);
    expect(
      await w.db.collection('accounting_lettering').countDocuments({ organizationId: org, action: 'unletter' }),
    ).toBe(2);
    expect(ok(await w.post('owner', '/accounting/sync'))).toMatchObject({ created: 0, reversed: 0 });
  });

  it('droits et isolation', async () => {
    expect((await w.post('external_accountant', '/accounting/sync')).status).toBe(403);
    expect((await w.post('external_accountant', '/accounting/entries', {})).status).toBe(403);
    const page = ok(await w.get('external_accountant', '/accounting/entries'));
    const any = page['items'][0] as { id: string };
    ok(await w.get('external_accountant', `/accounting/entries/${any.id}`));
    code(await w.get('ownerB', `/accounting/entries/${any.id}`), 404, 'ENTRY_NOT_FOUND');
    code(await w.get('owner', `/accounting/entries/${new ObjectId().toHexString()}`), 404, 'ENTRY_NOT_FOUND');
    code(await w.post('ownerB', `/accounting/pending/${new ObjectId().toHexString()}/resolve`, { note: 'x' }), 409, 'ACCOUNTING_NOT_ACTIVE');
  });
});
