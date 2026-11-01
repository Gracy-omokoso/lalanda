// Synchronisation des achats (ADR-0049, lot K5) — e2e.
//
// Critère 7 — pas de double comptage : un paiement fournisseur qui crée deux dépenses
// produit UNE écriture de paiement et AUCUNE écriture pour les deux dépenses (`origin`
// non nulle). Plus : factures fournisseurs validées → journal des achats, compte
// fournisseur auxiliaire ; paiement → journal du compte de trésorerie, lettrage
// automatique avec les factures ; facture annulée après validation → contre-passation ;
// brouillon → rien ; rejouer → rien de plus ; pièces sources intactes.

import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  accountingWorld,
  entriesOf,
  expenseDoc,
  ok,
  prepareOrganization,
  treasuryAccountDoc,
  type AccountingWorld,
} from './accounting-e2e-fixtures.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

type Line = Record<string, string | null | boolean>;

e2eSuite('comptabilité — synchronisation des achats (ADR-0049, K5)', () => {
  let w: AccountingWorld;
  let bank = '';
  const supplierId = new ObjectId();

  const supplierInvoice = (
    number: string,
    total: string,
    status: 'draft' | 'validated' = 'validated',
  ): Record<string, unknown> & { _id: ObjectId } => ({
    _id: new ObjectId(),
    organizationId: w.org,
    internalNumber: number,
    supplierId: supplierId.toHexString(),
    supplierReference: `REF-${number}`,
    supplierReferenceKey: null,
    kind: 'invoice',
    creditedInvoiceId: null,
    invoiceDate: '2026-10-02',
    receivedOn: '2026-10-02',
    dueDate: '2026-11-02',
    currency: 'CDF',
    orderIds: [],
    lines: [],
    subtotal: total,
    taxes: [],
    total,
    deductibleVat: null,
    costAllocations: [{ category: 'achats', workProjectId: null, amount: total }],
    attachment: null,
    status,
    matching: { version: 'test', mode: 'none', status: 'not_applicable', variances: [], lines: [] },
    forcedValidation: null,
    disputed: null,
    validatedAt: status === 'validated' ? new Date() : null,
    validatedBy: status === 'validated' ? 'fixture' : null,
    cancellation: null,
    revision: 2,
    createdBy: 'fixture',
    updatedBy: 'fixture',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    w = await accountingWorld('achats', ['finance_director']);
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    const b = treasuryAccountDoc(w.org, { name: 'Banque', kind: 'bank', currency: 'CDF' });
    await w.db.collection('treasury_accounts').insertOne(b);
    bank = b._id.toHexString();
    ok(
      await w.put('owner', `/accounting/treasury-links/${bank}`, {
        accountNumber: '521',
        expectedRevision: null,
      }),
    );
    await w.db.collection('suppliers').insertOne({
      _id: supplierId,
      organizationId: w.org,
      name: 'Fournisseur Essai',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await w?.app.close();
  }, E2E_HOOK_TIMEOUT_MS);

  it('critère 7 — un paiement qui crée deux dépenses : une écriture de paiement, aucune pour les dépenses', async () => {
    const org = w.org;
    const si1 = supplierInvoice('FF-0001', '1000.00');
    const si2 = supplierInvoice('FF-0002', '500.00');
    const draft = supplierInvoice('FF-0003', '42.00', 'draft');
    await w.db.collection('supplier_invoices').insertMany([si1, si2, draft]);
    const paymentId = new ObjectId();
    const expenses = [si1, si2].map((si, allocationIndex) =>
      expenseDoc(org, {
        spentOn: '2026-10-12',
        amount: si['total'] as string,
        category: 'achats',
        accountId: bank,
        origin: {
          kind: 'supplier_payment',
          paymentId: paymentId.toHexString(),
          paymentNumber: 'PF-0001',
          invoiceId: si._id.toHexString(),
          allocationIndex,
        },
      }),
    );
    await w.db.collection('treasury_expenses').insertMany(expenses);
    await w.db.collection('supplier_payments').insertOne({
      _id: paymentId,
      organizationId: org,
      number: 'PF-0001',
      supplierId: supplierId.toHexString(),
      currency: 'CDF',
      paidOn: '2026-10-12',
      amount: '1500.00',
      accountId: bank,
      method: 'bank_transfer',
      paymentMethodId: null,
      reference: null,
      allocations: [
        { invoiceId: si1._id.toHexString(), amount: '1000.00' },
        { invoiceId: si2._id.toHexString(), amount: '500.00' },
      ],
      expenseIds: expenses.map((e) => e._id.toHexString()),
      origin: 'manual',
      linkedExpense: null,
      status: 'recorded',
      cancellation: null,
      revision: 1,
      createdBy: 'fixture',
      updatedBy: 'fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const before = JSON.stringify(
      await Promise.all(
        ['supplier_invoices', 'supplier_payments', 'treasury_expenses', 'suppliers'].map((c) =>
          w.db.collection(c).find({ organizationId: org }).sort({ _id: 1 }).toArray(),
        ),
      ),
    );

    ok(await w.post('owner', '/accounting/sync'));
    for (const e of expenses) {
      expect(await entriesOf(w.db, org, { 'source.id': e._id.toHexString() })).toEqual([]);
    }
    expect(await entriesOf(w.db, org, { 'source.id': draft._id.toHexString() })).toEqual([]);

    const [e1] = await entriesOf(w.db, org, { 'source.id': si1._id.toHexString() });
    expect(e1).toMatchObject({
      journalCode: 'AC',
      status: 'posted',
      sourceKey: `supplier_invoice:${si1._id.toHexString()}:validate`,
    });
    expect(
      (e1!['lines'] as Line[]).map((l) => [
        l['accountNumber'],
        l['auxiliaryAccountNumber'],
        l['side'],
        l['bookAmount'],
      ]),
    ).toEqual([
      ['601', null, 'debit', '1000.00'],
      ['401', '40100001', 'credit', '1000.00'],
    ]);

    const pay = await entriesOf(w.db, org, { 'source.id': paymentId.toHexString() });
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({
      journalCode: 'T01',
      sourceKey: `supplier_payment:${paymentId.toHexString()}:record`,
    });
    const pl = pay[0]!['lines'] as Line[];
    expect(pl.map((l) => [l['accountNumber'], l['side'], l['bookAmount']])).toEqual([
      ['521', 'credit', '1500.00'],
      ['401', 'debit', '1000.00'],
      ['401', 'debit', '500.00'],
    ]);
    expect(pl[1]!['letteringCode']).toMatch(/^L\d{6}$/);
    expect(pl[2]!['letteringCode']).toMatch(/^L\d{6}$/);

    // Charge comptée une fois : 1 500,00 au débit de 601, pas 3 000,00.
    const all = await entriesOf(w.db, org);
    const charges = all.flatMap((e) =>
      (e['lines'] as Line[]).filter((l) => l['accountNumber'] === '601'),
    );
    expect(charges.map((l) => l['bookAmount'])).toEqual(['1000.00', '500.00']);

    expect(ok(await w.post('owner', '/accounting/sync'))).toMatchObject({ created: 0, posted: 0 });
    const after = JSON.stringify(
      await Promise.all(
        ['supplier_invoices', 'supplier_payments', 'treasury_expenses', 'suppliers'].map((c) =>
          w.db.collection(c).find({ organizationId: org }).sort({ _id: 1 }).toArray(),
        ),
      ),
    );
    expect(after).toBe(before);
  });

  it('facture fournisseur annulée après validation : contre-passation', async () => {
    const org = w.org;
    const si = supplierInvoice('FF-0010', '250.00');
    await w.db.collection('supplier_invoices').insertOne(si);
    ok(await w.post('owner', '/accounting/sync'));
    await w.db
      .collection('supplier_invoices')
      .updateOne(
        { _id: si._id },
        { $set: { status: 'cancelled', updatedAt: new Date(), revision: 3 } },
      );
    ok(await w.post('owner', '/accounting/sync'));
    const [orig, rev] = await entriesOf(w.db, org, { 'source.id': si._id.toHexString() });
    expect(rev).toMatchObject({
      sourceKey: `supplier_invoice:${si._id.toHexString()}:cancel`,
      reversalOf: String(orig!['_id']),
      journalCode: 'AC',
    });
    expect(orig!['reversedBy']).toBe(String(rev!['_id']));
  });
});
