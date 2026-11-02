// Synchronisation des dépenses possédées par les RH (ADR-0051, lot H13 ; amende
// ADR-0049 § 6.3) — e2e.
//
// Critère 10 d'ADR-0051 :
//  - une dépense de remboursement de note de frais (`origin.kind = 'expense_report'`)
//    produit une écriture `expense.<catégorie>`, crédit du compte de trésorerie ;
//  - une dépense SOLDÉE PAR UNE AVANCE (sans compte) crédite le compte d'attente, motif
//    `SETTLED_BY_EMPLOYEE_ADVANCE`, sans être « À comptabiliser » ;
//  - une dépense de paiement fournisseur reste ignorée : le paiement est compté UNE fois ;
//  - un versement d'avance (`other_out` possédé) va en attente ;
//  - pas de double comptage : une écriture par pièce, rejouer n'écrit rien de plus ;
//    l'annulation par les RH contre-passe ;
//  - mode simulation : mêmes écritures proposées, rien d'enregistré.
// Aucune règle n'est inventée : seules les règles de TEST d'ADR-0049 servent ; une
// catégorie sans règle va au compte d'attente (`NO_RULE`).

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

/** Origine d'une dépense de note de frais, forme exacte d'H11 (`HrExpenseOrigin`). */
const reportOrigin = (
  reportId: string,
  lineIndex: number,
  settledByAdvanceId: string | null = null,
): Record<string, unknown> => ({
  kind: 'expense_report',
  reportId,
  reportNumber: 'NF2610-000001',
  lineIndex,
  settledByAdvanceId,
});

e2eSuite('comptabilité — dépenses possédées par les RH (ADR-0051, H13)', () => {
  let w: AccountingWorld;
  let bank = '';
  let simBank = '';
  const supplierId = new ObjectId();

  const linesOf = (e: Record<string, unknown>): Line[] => e['lines'] as Line[];
  const shape = (e: Record<string, unknown>): (string | null | boolean | undefined)[][] =>
    linesOf(e).map((l) => [
      l['operationKey'],
      l['accountNumber'],
      l['side'],
      l['bookAmount'],
      l['suspenseReason'],
    ]);

  beforeAll(async () => {
    w = await accountingWorld('rh', ['finance_director'], ['sim']);
    await prepareOrganization(w, {
      mode: 'active',
      author: 'owner',
      validator: 'finance_director',
    });
    await prepareOrganization(w, { who: 'sim', mode: 'simulation' });
    const b = treasuryAccountDoc(w.org, { name: 'Banque', kind: 'bank', currency: 'CDF' });
    const s = treasuryAccountDoc(w.orgOf['sim']!, {
      name: 'Banque',
      kind: 'bank',
      currency: 'CDF',
    });
    await w.db.collection('treasury_accounts').insertMany([b, s]);
    bank = b._id.toHexString();
    simBank = s._id.toHexString();
    for (const [who, id] of [
      ['owner', bank],
      ['sim', simBank],
    ] as const) {
      ok(
        await w.put(who, `/accounting/treasury-links/${id}`, {
          accountNumber: '521',
          expectedRevision: null,
        }),
      );
    }
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

  it('critère 10 — note de frais comptée une fois, avance en attente, paiement fournisseur compté une fois', async () => {
    const org = w.org;
    const reportId = new ObjectId().toHexString();
    const linkedReportId = new ObjectId().toHexString();
    const advanceId = new ObjectId().toHexString();

    // Remboursement d'une note de deux lignes (compte de trésorerie renseigné).
    const achats = expenseDoc(org, {
      spentOn: '2026-10-14',
      amount: '15000.00',
      category: 'achats',
      accountId: bank,
      origin: reportOrigin(reportId, 0),
    });
    const transport = expenseDoc(org, {
      spentOn: '2026-10-14',
      amount: '7500.00',
      category: 'transport',
      accountId: bank,
      origin: reportOrigin(reportId, 1),
    });
    // Note liée à une avance : dépense SANS compte, l'argent est sorti au versement.
    const settled = expenseDoc(org, {
      spentOn: '2026-10-16',
      amount: '80000.00',
      category: 'achats',
      accountId: null,
      origin: reportOrigin(linkedReportId, 0, advanceId),
    });
    // Versement de l'avance : `other_out` possédé par les RH.
    const disbursement = {
      _id: new ObjectId(),
      organizationId: org,
      kind: 'other_out',
      date: '2026-10-13',
      label: 'Avance au personnel AV2610-000001',
      fromAccountId: bank,
      toAccountId: null,
      amountOut: '100000.00',
      amountIn: null,
      reference: null,
      origin: {
        kind: 'employee_advance',
        advanceId,
        advanceNumber: 'AV2610-000001',
        settlementId: null,
      },
      status: 'recorded',
      cancelReason: null,
      createdBy: 'fixture',
      updatedBy: 'fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Paiement fournisseur : facture validée + dépense possédée par les achats.
    const invoiceId = new ObjectId();
    const paymentId = new ObjectId();
    await w.db.collection('supplier_invoices').insertOne({
      _id: invoiceId,
      organizationId: org,
      internalNumber: 'FF-0001',
      supplierId: supplierId.toHexString(),
      supplierReference: 'REF-FF-0001',
      supplierReferenceKey: null,
      kind: 'invoice',
      creditedInvoiceId: null,
      invoiceDate: '2026-10-02',
      receivedOn: '2026-10-02',
      dueDate: '2026-11-02',
      currency: 'CDF',
      orderIds: [],
      lines: [],
      subtotal: '1000.00',
      taxes: [],
      total: '1000.00',
      deductibleVat: null,
      costAllocations: [{ category: 'achats', workProjectId: null, amount: '1000.00' }],
      attachment: null,
      status: 'validated',
      matching: {
        version: 'test',
        mode: 'none',
        status: 'not_applicable',
        variances: [],
        lines: [],
      },
      forcedValidation: null,
      disputed: null,
      validatedAt: new Date(),
      validatedBy: 'fixture',
      cancellation: null,
      revision: 2,
      createdBy: 'fixture',
      updatedBy: 'fixture',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const purchase = expenseDoc(org, {
      spentOn: '2026-10-12',
      amount: '1000.00',
      category: 'achats',
      accountId: bank,
      origin: {
        kind: 'supplier_payment',
        paymentId: paymentId.toHexString(),
        paymentNumber: 'PF-0001',
        invoiceId: invoiceId.toHexString(),
        allocationIndex: 0,
      },
    });
    await w.db.collection('supplier_payments').insertOne({
      _id: paymentId,
      organizationId: org,
      number: 'PF-0001',
      supplierId: supplierId.toHexString(),
      currency: 'CDF',
      paidOn: '2026-10-12',
      amount: '1000.00',
      accountId: bank,
      method: 'bank_transfer',
      paymentMethodId: null,
      reference: null,
      allocations: [{ invoiceId: invoiceId.toHexString(), amount: '1000.00' }],
      expenseIds: [purchase._id.toHexString()],
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
    await w.db.collection('treasury_expenses').insertMany([achats, transport, settled, purchase]);
    await w.db.collection('treasury_movements').insertOne(disbursement);

    ok(await w.post('owner', '/accounting/sync'));

    // Remboursement : charge par catégorie, crédit de la banque, journal du compte.
    const [ea] = await entriesOf(w.db, org, { 'source.id': achats._id.toHexString() });
    expect(ea).toMatchObject({
      journalCode: 'T01',
      status: 'posted',
      sourceKey: `treasury_expense:${achats._id.toHexString()}:r1`,
    });
    expect(shape(ea!)).toEqual([
      ['expense.achats', '601', 'debit', '15000.00', null],
      ['expense.payment', '521', 'credit', '15000.00', null],
    ]);
    // Catégorie sans règle : compte d'attente, jamais un compte inventé.
    const [et] = await entriesOf(w.db, org, { 'source.id': transport._id.toHexString() });
    expect(shape(et!)).toEqual([
      ['expense.transport', 'ATTENTE', 'debit', '7500.00', 'NO_RULE'],
      ['expense.payment', '521', 'credit', '7500.00', null],
    ]);
    // Soldée par l'avance : contrepartie en attente, motif propre.
    const [es] = await entriesOf(w.db, org, { 'source.id': settled._id.toHexString() });
    expect(es).toMatchObject({ status: 'posted', suspense: true });
    expect(shape(es!)).toEqual([
      ['expense.achats', '601', 'debit', '80000.00', null],
      ['hr.advance.settled', 'ATTENTE', 'credit', '80000.00', 'SETTLED_BY_EMPLOYEE_ADVANCE'],
    ]);
    // Versement de l'avance : nature inconnue de la pièce → attente (ADR-0049 § 6.6).
    const [ed] = await entriesOf(w.db, org, { 'source.id': disbursement._id.toHexString() });
    expect(linesOf(ed!).find((l) => l['side'] === 'debit')).toMatchObject({
      operationKey: 'other_out.counterpart',
      accountNumber: 'ATTENTE',
      bookAmount: '100000.00',
      suspenseReason: 'NATURE_UNKNOWN',
    });

    // Paiement fournisseur : sa dépense ignorée, le paiement écrit une fois.
    expect(await entriesOf(w.db, org, { 'source.id': purchase._id.toHexString() })).toEqual([]);
    expect(await entriesOf(w.db, org, { 'source.id': paymentId.toHexString() })).toHaveLength(1);

    // Pas de double comptage : chaque charge une seule fois au débit de 601.
    const debits601 = (await entriesOf(w.db, org))
      .flatMap((e) => linesOf(e))
      .filter((l) => l['accountNumber'] === '601' && l['side'] === 'debit')
      .map((l) => l['bookAmount'])
      .sort();
    expect(debits601).toEqual(['1000.00', '15000.00', '80000.00']);

    // Une dépense soldée par avance n'est pas « À comptabiliser » ; aucune autre non plus.
    const pending = ok(await w.get('owner', '/accounting/pending'))['items'] as {
      reason: string;
      source: { id: string };
    }[];
    const hrIds = [achats, transport, settled].map((d) => d._id.toHexString());
    expect(pending.filter((p) => hrIds.includes(p.source.id))).toEqual([]);

    // Rejouer n'écrit rien de plus.
    expect(ok(await w.post('owner', '/accounting/sync'))).toMatchObject({ created: 0, posted: 0 });
  });

  it('annulation du remboursement par les RH : contre-passation, charge nette nulle', async () => {
    const org = w.org;
    const exp = expenseDoc(org, {
      spentOn: '2026-10-20',
      amount: '4000.00',
      category: 'achats',
      accountId: bank,
      origin: reportOrigin(new ObjectId().toHexString(), 0),
    });
    await w.db.collection('treasury_expenses').insertOne(exp);
    ok(await w.post('owner', '/accounting/sync'));
    await w.db
      .collection('treasury_expenses')
      .updateOne(
        { _id: exp._id },
        { $set: { status: 'cancelled', revision: 2, updatedAt: new Date() } },
      );
    ok(await w.post('owner', '/accounting/sync'));
    const [orig, rev] = await entriesOf(w.db, org, { 'source.id': exp._id.toHexString() });
    expect(rev).toMatchObject({
      sourceKey: `treasury_expense:${exp._id.toHexString()}:cancel`,
      reversalOf: String(orig!['_id']),
      reversalReason: 'SOURCE_CANCELLED',
    });
    expect(shape(rev!)).toEqual([
      ['expense.achats', '601', 'credit', '4000.00', null],
      ['expense.payment', '521', 'debit', '4000.00', null],
    ]);
  });

  it('mode simulation : écritures proposées, motif d’attente porté, rien d’enregistré', async () => {
    const org = w.orgOf['sim']!;
    const settled = expenseDoc(org, {
      spentOn: '2026-10-16',
      amount: '80000.00',
      category: 'achats',
      accountId: null,
      origin: reportOrigin(new ObjectId().toHexString(), 0, new ObjectId().toHexString()),
    });
    const repaid = expenseDoc(org, {
      spentOn: '2026-10-14',
      amount: '15000.00',
      category: 'achats',
      accountId: simBank,
      origin: reportOrigin(new ObjectId().toHexString(), 0),
    });
    await w.db.collection('treasury_expenses').insertMany([settled, repaid]);

    const page = ok(await w.get('sim', '/accounting/entries'));
    expect(page['simulation']).toBe(true);
    const items = page['items'] as Record<string, any>[];
    const bySource = (id: ObjectId): Record<string, any>[] =>
      items.filter((e) => e['source']?.['id'] === id.toHexString());
    const [s] = bySource(settled._id);
    expect(bySource(settled._id)).toHaveLength(1);
    expect(
      (s!['lines'] as Line[]).map((l) => [
        l['operationKey'],
        l['accountNumber'],
        l['suspenseReason'],
      ]),
    ).toEqual([
      ['expense.achats', '601', null],
      ['hr.advance.settled', 'ATTENTE', 'SETTLED_BY_EMPLOYEE_ADVANCE'],
    ]);
    const [r] = bySource(repaid._id);
    expect(bySource(repaid._id)).toHaveLength(1);
    expect(
      (r!['lines'] as Line[]).map((l) => [l['accountNumber'], l['debit'], l['credit']]),
    ).toEqual([
      ['601', '15000.00', null],
      ['521', null, '15000.00'],
    ]);
    expect(await entriesOf(w.db, org)).toEqual([]);
  });
});
