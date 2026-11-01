// Moteur d'écritures — cas d'acceptation 3 à 9 d'ADR-0049 (calcul), lot K2.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_VERSION,
  applyRate,
  checkEntry,
  checkRuleSet,
  entriesForExpense,
  entriesForReceipt,
  entriesForSalesInvoice,
  entriesForStockMovement,
  entriesForSupplierInvoice,
  entriesForSupplierPayment,
  entriesForTreasuryMovement,
  isOperationKey,
  parseSourceKey,
  resolveRule,
  reversalKey,
  reverseEntry,
  syncSourceEntries,
  type ExpenseView,
  type ProposedEntry,
  type ReceiptView,
  type SupplierInvoiceView,
  type SupplierPaymentView,
  type TreasuryMovementView,
} from '../../index.js';
import {
  SALES_RULES,
  SUSPENSE,
  context,
  invoiceBC,
  netByAccount,
  rule,
  ruleSet,
} from './fixtures.test.js';

const only = (entries: readonly ProposedEntry[]): ProposedEntry => {
  expect(entries).toHaveLength(1);
  return entries[0] as ProposedEntry;
};
const ok = (entry: ProposedEntry): void => {
  const check = checkEntry(entry, { suspenseAccount: SUSPENSE });
  expect(check.issues).toEqual([]);
  expect(check.ok).toBe(true);
};

function receipt(overrides: Partial<ReceiptView> = {}): ReceiptView {
  return {
    id: 'rc1',
    number: 'ENC-0001',
    status: 'recorded',
    revision: 1,
    receivedOn: '2026-10-20',
    amount: '150000.00',
    currency: 'CDF',
    method: 'VIREMENT',
    accountId: 'bank',
    customerId: 'c1',
    customerName: 'Client Un',
    allocations: [
      { invoiceId: 'inv1', invoiceNumber: 'FV-1', amount: '100000.00', invoiceBookRate: null },
      { invoiceId: 'inv2', invoiceNumber: 'FV-2', amount: '50000.00', invoiceBookRate: null },
    ],
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseView> = {}): ExpenseView {
  return {
    id: 'ex1',
    status: 'recorded',
    revision: 1,
    spentOn: '2026-10-05',
    amount: '116000.00',
    currency: 'CDF',
    category: 'loyer',
    label: 'Loyer octobre',
    supplierName: null,
    accountId: 'bank',
    deductibleVat: null,
    reference: null,
    origin: null,
    ...overrides,
  };
}

describe('ADR-0049 K2 — factures de vente (§ 6.1, critère 3)', () => {
  it('FV normalisée CDF, groupes B et C, à crédit : une écriture VE équilibrée aux totaux figés', () => {
    const r = entriesForSalesInvoice(invoiceBC(), context());
    expect(r.version).toBe(ACCOUNTING_VERSION);
    const e = only(r.entries);
    ok(e);
    expect(e.sourceKey).toBe('sales_invoice:inv1:issue');
    expect(e.journal).toEqual({ kind: 'sales', treasuryAccountId: null });
    expect(e.status).toBe('ready');
    expect(e.suspense).toBe(false);
    expect(e.generation).toEqual({
      ruleSetVersion: 3,
      chartPack: { slug: 'syscohada-revise-2017-cd', version: 1 },
      engineVersion: ACCOUNTING_VERSION,
    });
    expect(
      e.lines.map((l) => [
        l.operationKey,
        l.side,
        l.accountNumber,
        l.auxiliaryAccountNumber,
        l.amount,
      ]),
    ).toEqual([
      ['sale.invoice.receivable', 'debit', '4111', '4111C1', '137000.00'],
      ['sale.invoice.revenue.SER.B', 'credit', '7061', null, '100000.00'],
      ['sale.invoice.vat.B', 'credit', '4431', null, '16000.00'],
      ['sale.invoice.revenue.SER.C', 'credit', '7062', null, '20000.00'],
      ['sale.invoice.vat.C', 'credit', '4432', null, '1000.00'],
    ]);
    expect(e.lines[0]?.matchRef).toBe('sales_invoice:inv1');
    expect(
      e.lines.every((l) => l.rateSource === 'same_currency' && l.bookAmount === l.amount),
    ).toBe(true);
    expect(r.notes).toEqual([]);
  });

  it('rejouer donne le même résultat et n’écrit rien de plus', () => {
    const ctx = context();
    const a = entriesForSalesInvoice(invoiceBC(), ctx);
    expect(entriesForSalesInvoice(invoiceBC(), ctx)).toEqual(a);
    const first = syncSourceEntries(a, []);
    expect(first.create).toHaveLength(1);
    expect(syncSourceEntries(a, first.create)).toEqual({
      create: [],
      unchanged: ['sales_invoice:inv1:issue'],
    });
  });

  it.each([
    ['brouillon', { status: 'draft' }, 'NOT_FINAL'],
    ['normalisation échouée', { status: 'normalization_failed' }, 'NOT_FINAL'],
    ['en attente de normalisation', { status: 'pending_normalization' }, 'NOT_FINAL'],
    ['pro forma', { series: 'proforma' as const }, 'NOT_FINAL'],
    ['série d’essai', { series: 'test' as const }, 'TEST_SERIES'],
    ['avant la bascule', { date: '2026-09-30' }, 'BEFORE_CUTOVER'],
  ])('%s → aucune écriture', (_label, overrides, reason) => {
    const r = entriesForSalesInvoice(invoiceBC(overrides), context());
    expect(r.entries).toEqual([]);
    expect(r.skipped).toBe(reason);
  });

  it('ne modifie pas la vue reçue', () => {
    const view = invoiceBC();
    const copy = structuredClone(view);
    entriesForSalesInvoice(view, context());
    expect(view).toEqual(copy);
  });

  it('répartit la base d’un groupe entre biens et services au prorata des lignes', () => {
    const view = invoiceBC({
      groups: [{ group: 'B', ht: '100.00', vat: '16.00', total: '116.00', specificTax: '0.00' }],
      lines: [
        { taxGroup: 'B', itemType: 'BIE', amount: '33.33' },
        { taxGroup: 'B', itemType: 'SER', amount: '66.67' },
      ],
      total: '116.00',
    });
    const e = only(entriesForSalesInvoice(view, context()).entries);
    ok(e);
    const byKey = Object.fromEntries(e.lines.map((l) => [l.operationKey, l.amount]));
    expect(byKey['sale.invoice.revenue.BIE.B']).toBe('33.33');
    expect(byKey['sale.invoice.revenue.SER.B']).toBe('66.67');
  });

  it('taxe spécifique : jamais un produit, toujours `nonrevenue`', () => {
    const view = invoiceBC({
      groups: [{ group: 'B', ht: '110.00', vat: '17.60', total: '127.60', specificTax: '10.00' }],
      lines: [{ taxGroup: 'B', itemType: 'SER', amount: '100.00' }],
      total: '127.60',
    });
    const e = only(entriesForSalesInvoice(view, context()).entries);
    ok(e);
    const spec = e.lines.find((l) => l.operationKey === 'sale.invoice.nonrevenue.B');
    expect(spec).toMatchObject({
      amount: '10.00',
      accountNumber: SUSPENSE,
      suspenseReason: 'NO_RULE',
    });
    expect(e.lines.find((l) => l.operationKey === 'sale.invoice.revenue.SER.B')?.amount).toBe(
      '100.00',
    );
  });

  it('totaux incohérents → « À comptabiliser », jamais une écriture fausse', () => {
    const bad = invoiceBC({ total: '137000.01' });
    const r = entriesForSalesInvoice(bad, context());
    expect(r.entries).toEqual([]);
    expect(r.pending).toEqual(['UNSUPPORTED_SOURCE']);
    const badGroup = invoiceBC({
      groups: [{ group: 'B', ht: '100.00', vat: '16.00', total: '117.00', specificTax: '0.00' }],
      total: '117.00',
    });
    expect(entriesForSalesInvoice(badGroup, context()).pending).toEqual(['UNSUPPORTED_SOURCE']);
    expect(entriesForSalesInvoice(invoiceBC({ type: 'XX' }), context()).pending).toEqual([
      'UNSUPPORTED_SOURCE',
    ]);
  });

  it('avoir FA : écriture inverse par groupe sur `sale.credit_note.*`', () => {
    const view = invoiceBC({
      id: 'av1',
      type: 'FA',
      groups: [{ group: 'B', ht: '1000.00', vat: '160.00', total: '1160.00', specificTax: '0.00' }],
      lines: [{ taxGroup: 'B', itemType: 'SER', amount: '1000.00' }],
      total: '1160.00',
      payments: [{ method: 'CREDIT', amount: '1160.00' }],
    });
    const e = only(entriesForSalesInvoice(view, context()).entries);
    ok(e);
    expect(e.lines.map((l) => [l.operationKey, l.side, l.accountNumber])).toEqual([
      ['sale.credit_note.receivable', 'credit', '4111'],
      ['sale.credit_note.revenue.SER.B', 'debit', '7069'],
      ['sale.credit_note.vat.B', 'debit', '4431'],
    ]);
  });

  it('acompte FT sans règle : tout au compte d’attente, écriture équilibrée', () => {
    const e = only(entriesForSalesInvoice(invoiceBC({ type: 'FT' }), context()).entries);
    ok(e);
    expect(
      e.lines.every(
        (l) => l.accountNumber === SUSPENSE && l.operationKey.startsWith('sale.deposit.'),
      ),
    ).toBe(true);
    expect(e.suspense).toBe(true);
  });
});

describe('ADR-0049 K2 — groupes non produits (critère 4)', () => {
  it('débours J sans règle → compte d’attente, jamais un compte de produit', () => {
    const view = invoiceBC({
      groups: [
        { group: 'B', ht: '100.00', vat: '16.00', total: '116.00', specificTax: '0.00' },
        { group: 'J', ht: '50.00', vat: '0.00', total: '50.00', specificTax: '0.00' },
      ],
      lines: [
        { taxGroup: 'B', itemType: 'SER', amount: '100.00' },
        { taxGroup: 'J', itemType: 'SER', amount: '50.00' },
      ],
      total: '166.00',
    });
    // Même une règle de produit pour J (refusée par le catalogue) ne serait jamais lue.
    const ctx = context({
      ruleSet: ruleSet([...SALES_RULES, rule('sale.invoice.revenue.SER.J', [], ['7063'])]),
    });
    expect(isOperationKey('sale.invoice.revenue.SER.J')).toBe(false);
    const e = only(entriesForSalesInvoice(view, ctx).entries);
    ok(e);
    const j = e.lines.filter((l) => l.operationKey.endsWith('.J'));
    expect(j).toEqual([
      expect.objectContaining({
        operationKey: 'sale.invoice.nonrevenue.J',
        accountNumber: SUSPENSE,
        amount: '50.00',
        suspenseReason: 'NO_RULE',
      }),
    ]);
    expect(e.suspense).toBe(true);
  });

  it.each(['H', 'I', 'L', 'N'])('groupe %s → `nonrevenue` pour son total', (g) => {
    const vatOnly = g === 'N';
    const view = invoiceBC({
      groups: [
        {
          group: g,
          ht: vatOnly ? '0.00' : '40.00',
          vat: vatOnly ? '40.00' : '0.00',
          total: '40.00',
          specificTax: '0.00',
        },
      ],
      lines: [{ taxGroup: g, itemType: g === 'L' || g === 'N' ? 'TAX' : 'BIE', amount: '40.00' }],
      total: '40.00',
    });
    const e = only(entriesForSalesInvoice(view, context()).entries);
    ok(e);
    expect(e.lines.map((l) => l.operationKey)).toEqual([
      'sale.invoice.receivable',
      `sale.invoice.nonrevenue.${g}`,
    ]);
  });
});

describe('ADR-0049 K2 — paiements déclarés à l’émission (critère 5)', () => {
  it('réglée en ESPECES sans règle de moyen → deux écritures, la seconde en attente', () => {
    const r = entriesForSalesInvoice(
      invoiceBC({ payments: [{ method: 'ESPECES', amount: '137000.00' }] }),
      context(),
    );
    expect(r.entries.map((e) => e.sourceKey)).toEqual([
      'sales_invoice:inv1:issue',
      'sales_invoice:inv1:paid_at_issue',
    ]);
    r.entries.forEach(ok);
    const paid = r.entries[1] as ProposedEntry;
    expect(
      paid.lines.map((l) => [l.operationKey, l.side, l.accountNumber, l.suspenseReason]),
    ).toEqual([
      ['sale.payment_at_issue.ESPECES', 'debit', SUSPENSE, 'NO_RULE'],
      ['sale.payment_at_issue.receivable', 'credit', SUSPENSE, 'NO_RULE'],
    ]);
    expect(r.notes).toEqual(['PAYMENTS_AT_ISSUE_NOT_IN_TREASURY']);
  });

  it('part mixte : seule la part non CREDIT est réglée ; une règle de moyen vise sa trésorerie', () => {
    const ctx = context({
      ruleSet: ruleSet([
        ...SALES_RULES,
        rule('sale.payment_at_issue.MOBILEMONEY', ['5731'], ['5731']),
        rule('sale.payment_at_issue.receivable', ['{customer}'], ['{customer}']),
      ]),
    });
    const r = entriesForSalesInvoice(
      invoiceBC({
        payments: [
          { method: 'CREDIT', amount: '37000.00' },
          { method: 'MOBILEMONEY', amount: '60000.00' },
          { method: 'MOBILEMONEY', amount: '40000.00' },
        ],
      }),
      ctx,
    );
    const paid = r.entries[1] as ProposedEntry;
    ok(paid);
    expect(paid.lines.map((l) => [l.accountNumber, l.side, l.amount])).toEqual([
      ['5731', 'debit', '100000.00'],
      ['4111', 'credit', '100000.00'],
    ]);
    expect(paid.suspense).toBe(false);
  });

  it('paiements supérieurs au total → « À comptabiliser »', () => {
    const r = entriesForSalesInvoice(
      invoiceBC({ payments: [{ method: 'ESPECES', amount: '999999.00' }] }),
      context(),
    );
    expect(r.entries).toEqual([]);
    expect(r.pending).toEqual(['UNSUPPORTED_SOURCE']);
  });
});

describe('ADR-0049 K2 — encaissements (§ 6.2, critère 6)', () => {
  it('lettré à deux factures, compte renseigné → journal du compte, deux lignes client reliées', () => {
    const r = entriesForReceipt(receipt(), context());
    const e = only(r.entries);
    ok(e);
    expect(e.sourceKey).toBe('sales_receipt:rc1:r1');
    expect(e.journal).toEqual({ kind: 'treasury', treasuryAccountId: 'bank' });
    expect(
      e.lines.map((l) => [l.operationKey, l.side, l.accountNumber, l.amount, l.matchRef]),
    ).toEqual([
      ['receipt.VIREMENT', 'debit', '5211', '150000.00', null],
      ['receipt.receivable', 'credit', '4111', '100000.00', 'sales_invoice:inv1'],
      ['receipt.receivable', 'credit', '4111', '50000.00', 'sales_invoice:inv2'],
    ]);
    expect(r.pending).toEqual([]);
  });

  it('annulation → contre-passation `sales_receipt:<id>:cancel`, exacte', () => {
    const ctx = context();
    const created = syncSourceEntries(entriesForReceipt(receipt(), ctx), []).create;
    const cancelled = entriesForReceipt(receipt({ status: 'cancelled', revision: 2 }), ctx);
    expect(cancelled.cancelled).toBe(true);
    const plan = syncSourceEntries(cancelled, created, { reversalDate: '2026-10-25' });
    const rev = only(plan.create);
    expect(rev).toMatchObject({
      sourceKey: 'sales_receipt:rc1:cancel',
      reversalOf: 'sales_receipt:rc1:r1',
      date: '2026-10-25',
      reversalReason: 'SOURCE_CANCELLED',
    });
    ok(rev);
    for (const t of netByAccount([...created, rev]).values())
      expect(t).toEqual({ book: 0n, amount: 0n });
    expect(syncSourceEntries(cancelled, [...created, rev]).create).toEqual([]);
  });

  it('révision → contre-passation de la précédente puis écriture nouvelle', () => {
    const ctx = context();
    const r1 = syncSourceEntries(entriesForReceipt(receipt(), ctx), []).create;
    const v2 = receipt({
      revision: 2,
      amount: '100000.00',
      allocations: [
        { invoiceId: 'inv1', invoiceNumber: 'FV-1', amount: '100000.00', invoiceBookRate: null },
      ],
    });
    const plan = syncSourceEntries(entriesForReceipt(v2, ctx), r1);
    expect(plan.create.map((e) => [e.sourceKey, e.reversalOf])).toEqual([
      ['sales_receipt:rc1:r1:superseded', 'sales_receipt:rc1:r1'],
      ['sales_receipt:rc1:r2', null],
    ]);
    expect(syncSourceEntries(entriesForReceipt(v2, ctx), [...r1, ...plan.create]).create).toEqual(
      [],
    );
  });

  it('sans compte de trésorerie → attente et `NO_TREASURY_ACCOUNT`', () => {
    const r = entriesForReceipt(receipt({ accountId: null }), context());
    const e = only(r.entries);
    ok(e);
    expect(e.journal.kind).toBe('misc');
    expect(e.lines[0]).toMatchObject({
      accountNumber: SUSPENSE,
      suspenseReason: 'NO_TREASURY_ACCOUNT',
    });
    expect(r.pending).toEqual(['NO_TREASURY_ACCOUNT']);
    // Compte de trésorerie sans correspondance comptable : même traitement.
    expect(entriesForReceipt(receipt({ accountId: 'inconnu' }), context()).pending).toEqual([
      'NO_TREASURY_ACCOUNT',
    ]);
  });

  it('client sans compte auxiliaire → attente `PARTY_ACCOUNT_UNKNOWN`', () => {
    const e = only(entriesForReceipt(receipt({ customerId: 'c9' }), context()).entries);
    ok(e);
    expect(e.lines[1]).toMatchObject({
      accountNumber: SUSPENSE,
      suspenseReason: 'PARTY_ACCOUNT_UNKNOWN',
    });
  });

  it('part non imputée → ligne `receipt.unallocated` ; imputations au-delà du montant refusées', () => {
    const e = only(entriesForReceipt(receipt({ amount: '160000.00' }), context()).entries);
    ok(e);
    expect(e.lines.at(-1)).toMatchObject({
      operationKey: 'receipt.unallocated',
      amount: '10000.00',
    });
    expect(entriesForReceipt(receipt({ amount: '1.00' }), context()).pending).toEqual([
      'UNSUPPORTED_SOURCE',
    ]);
  });
});

describe('ADR-0049 K2 — dépenses et achats (§ 6.3 à 6.5, critères 7 et 8)', () => {
  it('un paiement fournisseur qui crée deux dépenses : une écriture de paiement, aucune pour les dépenses', () => {
    const ctx = context();
    const payment: SupplierPaymentView = {
      id: 'pf1',
      number: 'PF-0001',
      status: 'recorded',
      paidOn: '2026-10-10',
      amount: '300.00',
      currency: 'CDF',
      method: 'bank_transfer',
      accountId: 'bank',
      supplierId: 's1',
      supplierName: 'Fournisseur',
      allocations: [
        { invoiceId: 'si1', invoiceNumber: 'FF-1', amount: '100.00', invoiceBookRate: null },
        { invoiceId: 'si2', invoiceNumber: 'FF-2', amount: '200.00', invoiceBookRate: null },
      ],
    };
    const pay = entriesForSupplierPayment(payment, ctx);
    const e = only(pay.entries);
    ok(e);
    expect(
      e.lines.map((l) => [
        l.operationKey,
        l.side,
        l.accountNumber,
        l.auxiliaryAccountNumber,
        l.matchRef,
      ]),
    ).toEqual([
      ['purchase.payment.bank_transfer', 'credit', '5211', null, null],
      ['purchase.payment.payable', 'debit', '4011', '4011S1', 'supplier_invoice:si1'],
      ['purchase.payment.payable', 'debit', '4011', '4011S1', 'supplier_invoice:si2'],
    ]);
    for (const id of ['ex-a', 'ex-b']) {
      const r = entriesForExpense(
        expense({ id, origin: { kind: 'supplier_payment', id: 'pf1' } }),
        ctx,
      );
      expect(r.entries).toEqual([]);
      expect(r.skipped).toBe('CREATED_BY_SUPPLIER_PAYMENT');
    }
  });

  it('dépense directe : charge par catégorie, trésorerie au crédit', () => {
    const e = only(entriesForExpense(expense(), context()).entries);
    ok(e);
    expect(e.sourceKey).toBe('treasury_expense:ex1:r1');
    expect(e.lines.map((l) => [l.operationKey, l.side, l.accountNumber, l.amount])).toEqual([
      ['expense.loyer', 'debit', '6221', '116000.00'],
      ['expense.payment', 'credit', '5211', '116000.00'],
    ]);
  });

  it('TVA déclarée, assujettie, sans règle → charge au montant total', () => {
    const r = entriesForExpense(expense({ deductibleVat: '16000.00' }), context());
    expect(only(r.entries).lines.map((l) => l.operationKey)).toEqual([
      'expense.loyer',
      'expense.payment',
    ]);
    expect(r.notes).toEqual([]);
  });

  it('TVA déclarée, assujettie, règle validée → ligne de TVA = montant déclaré', () => {
    const ctx = context({
      ruleSet: ruleSet([...SALES_RULES, rule('expense.vat_declared', ['4452'])]),
    });
    const e = only(entriesForExpense(expense({ deductibleVat: '16000.00' }), ctx).entries);
    ok(e);
    expect(e.lines.map((l) => [l.operationKey, l.amount])).toEqual([
      ['expense.loyer', '100000.00'],
      ['expense.vat_declared', '16000.00'],
      ['expense.payment', '116000.00'],
    ]);
  });

  it('organisation non assujettie avec règle → règle ignorée, constat', () => {
    const ctx = context({
      vatRegistered: false,
      ruleSet: ruleSet([...SALES_RULES, rule('expense.vat_declared', ['4452'])]),
    });
    const r = entriesForExpense(expense({ deductibleVat: '16000.00' }), ctx);
    expect(only(r.entries).lines.map((l) => l.operationKey)).toEqual([
      'expense.loyer',
      'expense.payment',
    ]);
    expect(r.notes).toEqual(['VAT_RULE_IGNORED_NOT_REGISTERED']);
  });

  it('TVA déclarée ≥ montant → laissée dans la charge, constat', () => {
    const ctx = context({
      ruleSet: ruleSet([...SALES_RULES, rule('expense.vat_declared', ['4452'])]),
    });
    const r = entriesForExpense(expense({ deductibleVat: '116000.00' }), ctx);
    expect(r.notes).toEqual(['VAT_DECLARED_IGNORED']);
  });

  it('dépense annulée → aucune écriture voulue ; avant bascule → ignorée', () => {
    expect(entriesForExpense(expense({ status: 'cancelled' }), context())).toMatchObject({
      cancelled: true,
      entries: [],
    });
    expect(entriesForExpense(expense({ spentOn: '2026-09-01' }), context()).skipped).toBe(
      'BEFORE_CUTOVER',
    );
  });

  const supplierInvoice = (o: Partial<SupplierInvoiceView> = {}): SupplierInvoiceView => ({
    id: 'si1',
    number: 'FF-0001',
    kind: 'invoice',
    status: 'validated',
    wasValidated: true,
    invoiceDate: '2026-10-08',
    currency: 'CDF',
    supplierId: 's1',
    supplierName: 'Fournisseur',
    total: '1160.00',
    deductibleVat: '160.00',
    costAllocations: [
      { category: 'achats', amount: '580.00' },
      { category: 'transport', amount: '580.00' },
    ],
    ...o,
  });

  it('facture fournisseur : imputations au débit, fournisseur au crédit, TVA non séparée par défaut', () => {
    const e = only(entriesForSupplierInvoice(supplierInvoice(), context()).entries);
    ok(e);
    expect(e.journal.kind).toBe('purchases');
    expect(e.lines.map((l) => [l.operationKey, l.side, l.accountNumber, l.amount])).toEqual([
      ['purchase.invoice.achats', 'debit', '6011', '580.00'],
      ['purchase.invoice.transport', 'debit', SUSPENSE, '580.00'],
      ['purchase.invoice.payable', 'credit', '4011', '1160.00'],
    ]);
  });

  it('TVA séparée sur règle validée : en diminution des imputations au prorata', () => {
    const ctx = context({
      ruleSet: ruleSet([...SALES_RULES, rule('purchase.invoice.vat_declared', ['4452'])]),
    });
    const e = only(
      entriesForSupplierInvoice(supplierInvoice({ deductibleVat: '160.01' }), ctx).entries,
    );
    ok(e);
    expect(e.lines.map((l) => l.amount)).toEqual(['500.00', '499.99', '160.01', '1160.00']);
  });

  it('avoir fournisseur : écriture inverse ; brouillon ou annulé avant validation → rien ; annulé après → contre-passation', () => {
    const avoir = only(
      entriesForSupplierInvoice(
        supplierInvoice({ kind: 'credit_note', deductibleVat: null }),
        context(),
      ).entries,
    );
    ok(avoir);
    expect(avoir.lines.map((l) => [l.operationKey, l.side])).toEqual([
      ['purchase.credit_note.achats', 'credit'],
      ['purchase.credit_note.transport', 'credit'],
      ['purchase.credit_note.payable', 'debit'],
    ]);
    expect(entriesForSupplierInvoice(supplierInvoice({ status: 'draft' }), context()).skipped).toBe(
      'NOT_VALIDATED',
    );
    expect(
      entriesForSupplierInvoice(
        supplierInvoice({ status: 'cancelled', wasValidated: false }),
        context(),
      ).skipped,
    ).toBe('NOT_VALIDATED');
    const created = syncSourceEntries(
      entriesForSupplierInvoice(supplierInvoice(), context()),
      [],
    ).create;
    const plan = syncSourceEntries(
      entriesForSupplierInvoice(supplierInvoice({ status: 'cancelled' }), context()),
      created,
    );
    expect(only(plan.create).sourceKey).toBe('supplier_invoice:si1:cancel');
  });

  it('imputations ≠ total → « À comptabiliser »', () => {
    expect(
      entriesForSupplierInvoice(supplierInvoice({ total: '1000.00' }), context()).pending,
    ).toEqual(['UNSUPPORTED_SOURCE']);
  });
});

describe('ADR-0049 K2 — devises (§ 5, critère 9)', () => {
  it('tenue CDF, facture USD à conversion figée → taux de la pièce', () => {
    const view = invoiceBC({
      currency: 'USD',
      groups: [{ group: 'B', ht: '100.00', vat: '16.00', total: '116.00', specificTax: '0.00' }],
      lines: [{ taxGroup: 'B', itemType: 'SER', amount: '100.00' }],
      total: '116.00',
      conversion: { from: 'USD', to: 'CDF', rate: '2800.5', reference: 'BCC 2026-10-15' },
    });
    const e = only(entriesForSalesInvoice(view, context()).entries);
    ok(e);
    expect(e.lines.map((l) => [l.amount, l.bookAmount, l.rate, l.rateSource, l.rateRef])).toEqual([
      ['116.00', '324858.00', '2800.5', 'document', 'BCC 2026-10-15'],
      ['100.00', '280050.00', '2800.5', 'document', 'BCC 2026-10-15'],
      ['16.00', '44808.00', '2800.5', 'document', 'BCC 2026-10-15'],
    ]);
  });

  it('dépense USD sans taux saisi → `awaiting_rate`, puis `ready` dès qu’un taux est saisi pour sa date', () => {
    const view = expense({ currency: 'USD', amount: '50.00', accountId: 'usd' });
    const waiting = entriesForExpense(view, context());
    const e = only(waiting.entries);
    expect(e.status).toBe('awaiting_rate');
    expect(e.lines.every((l) => l.bookAmount === null && l.debit === null && l.rate === null)).toBe(
      true,
    );
    expect(waiting.pending).toEqual(['RATE_MISSING']);
    ok(e);
    // Taux d'une autre date ou inverse : jamais employé.
    const other = context({
      enteredRates: [
        { date: '2026-10-04', from: 'USD', to: 'CDF', rate: '2800' },
        { date: '2026-10-05', from: 'CDF', to: 'USD', rate: '0.00035714' },
      ],
    });
    expect(only(entriesForExpense(view, other).entries).status).toBe('awaiting_rate');
    const rated = only(
      entriesForExpense(
        view,
        context({
          enteredRates: [
            { date: '2026-10-05', from: 'USD', to: 'CDF', rate: '2810', ref: 'saisie-7' },
          ],
        }),
      ).entries,
    );
    ok(rated);
    expect(rated.lines.map((l) => [l.bookAmount, l.rateSource, l.rateRef])).toEqual([
      ['140500.00', 'entered', 'saisie-7'],
      ['140500.00', 'entered', 'saisie-7'],
    ]);
  });

  it('virement 280 000 CDF → 100 USD : deux jambes de 280 000,00 CDF, taux observé 2 800', () => {
    const view: TreasuryMovementView = {
      id: 'mv1',
      kind: 'transfer',
      status: 'recorded',
      date: '2026-10-12',
      label: 'Achat de dollars',
      fromAccountId: 'bank',
      fromCurrency: 'CDF',
      toAccountId: 'usd',
      toCurrency: 'USD',
      amountOut: '280000.00',
      amountIn: '100.00',
      reference: null,
    };
    const r = entriesForTreasuryMovement(view, context());
    expect(r.entries.map((e) => e.sourceKey)).toEqual([
      'treasury_movement:mv1:out',
      'treasury_movement:mv1:in',
    ]);
    r.entries.forEach(ok);
    const [out, inn] = r.entries as [ProposedEntry, ProposedEntry];
    expect(out.lines.map((l) => [l.accountNumber, l.side, l.bookAmount, l.rateSource])).toEqual([
      ['5211', 'credit', '280000.00', 'same_currency'],
      ['5851', 'debit', '280000.00', 'same_currency'],
    ]);
    expect(
      inn.lines.map((l) => [l.accountNumber, l.side, l.amount, l.bookAmount, l.rate, l.rateSource]),
    ).toEqual([
      ['5212', 'debit', '100.00', '280000.00', '2800', 'observed'],
      ['5851', 'credit', '100.00', '280000.00', '2800', 'observed'],
    ]);
    // Tenue en USD : c'est la jambe CDF qui prend le montant observé.
    const usd = entriesForTreasuryMovement(view, context({ bookCurrency: 'USD' }));
    expect(usd.entries.map((e) => e.lines.map((l) => l.bookAmount))).toEqual([
      ['100.00', '100.00'],
      ['100.00', '100.00'],
    ]);
    // Le compte de virements internes est soldé en monnaie de tenue.
    const net = netByAccount(r.entries);
    expect(
      [...net.entries()].filter(([k]) => k.startsWith('5851')).reduce((s, [, t]) => s + t.book, 0n),
    ).toBe(0n);
  });

  it('encaissement USD à un autre taux que la facture → écart au compte d’attente « change »', () => {
    const view = receipt({
      currency: 'USD',
      amount: '100.00',
      accountId: 'usd',
      allocations: [
        {
          invoiceId: 'inv-usd',
          invoiceNumber: 'FV-9',
          amount: '100.00',
          invoiceBookRate: { rate: '2800', rateSource: 'document', rateRef: 'BCC' },
        },
      ],
    });
    const ctx = context({
      enteredRates: [{ date: '2026-10-20', from: 'USD', to: 'CDF', rate: '2850' }],
    });
    const e = only(entriesForReceipt(view, ctx).entries);
    ok(e);
    expect(
      e.lines.map((l) => [
        l.operationKey,
        l.side,
        l.amount,
        l.bookAmount,
        l.rateSource,
        l.suspenseReason,
      ]),
    ).toEqual([
      ['receipt.VIREMENT', 'debit', '100.00', '285000.00', 'entered', null],
      ['receipt.receivable', 'credit', '100.00', '280000.00', 'document', null],
      ['exchange.difference', 'credit', '0.00', '5000.00', null, 'EXCHANGE_DIFFERENCE'],
    ]);
    expect(e.lines[2]?.exchangeDifference).toBe(true);
    // Perte de change : l'écart passe au débit.
    const loss = only(
      entriesForReceipt(
        view,
        context({ enteredRates: [{ date: '2026-10-20', from: 'USD', to: 'CDF', rate: '2750' }] }),
      ).entries,
    );
    ok(loss);
    expect(loss.lines.at(-1)).toMatchObject({ side: 'debit', bookAmount: '5000.00' });
    // Règle validée de change : le compte vient de la règle, côté par côté.
    const withRule = context({
      enteredRates: [{ date: '2026-10-20', from: 'USD', to: 'CDF', rate: '2850' }],
      ruleSet: ruleSet([...SALES_RULES, rule('exchange.difference', ['6761'], ['7761'])]),
    });
    expect(only(entriesForReceipt(view, withRule).entries).lines.at(-1)).toMatchObject({
      accountNumber: '7761',
      suspenseReason: null,
    });
  });

  it('applyRate répartit sans écart : chaque côté reçoit le même total converti', () => {
    const e = applyRate(
      {
        sourceKey: 't:1',
        journal: { kind: 'misc', treasuryAccountId: null },
        date: '2026-10-01',
        label: 'x',
        source: {
          kind: 'sales_invoice',
          id: '1',
          event: 'issue',
          number: null,
          date: '2026-10-01',
          partyName: null,
        },
        lines: [
          {
            operationKey: 'a',
            side: 'debit',
            accountNumber: '1',
            auxiliaryAccountNumber: null,
            label: '',
            currency: 'USD',
            amount: '0.03',
            matchRef: null,
            suspenseReason: null,
          },
          {
            operationKey: 'b',
            side: 'credit',
            accountNumber: '2',
            auxiliaryAccountNumber: null,
            label: '',
            currency: 'USD',
            amount: '0.01',
            matchRef: null,
            suspenseReason: null,
          },
          {
            operationKey: 'b',
            side: 'credit',
            accountNumber: '2',
            auxiliaryAccountNumber: null,
            label: '',
            currency: 'USD',
            amount: '0.01',
            matchRef: null,
            suspenseReason: null,
          },
          {
            operationKey: 'b',
            side: 'credit',
            accountNumber: '2',
            auxiliaryAccountNumber: null,
            label: '',
            currency: 'USD',
            amount: '0.01',
            matchRef: null,
            suspenseReason: null,
          },
        ],
        reversalOf: null,
        reversalReason: null,
        generation: { ruleSetVersion: null, chartPack: null, engineVersion: ACCOUNTING_VERSION },
      },
      {
        bookCurrency: 'CDF',
        enteredRates: [{ date: '2026-10-01', from: 'USD', to: 'CDF', rate: '33.33333333' }],
        ruleSet: null,
        suspenseAccount: SUSPENSE,
      },
    );
    expect(e.lines.map((l) => l.bookAmount)).toEqual(['1.00', '0.34', '0.33', '0.33']);
    expect(checkEntry(e).ok).toBe(true);
  });
});

describe('ADR-0049 K2 — autres mouvements et stock (§ 6.6, § 6.7)', () => {
  it('apport `other_in` : contrepartie toujours au compte d’attente, même avec une règle', () => {
    const ctx = context({
      ruleSet: ruleSet([
        ...SALES_RULES,
        rule('other_in.treasury', ['{treasuryAccount}']),
        rule('other_in.counterpart', [], ['1011']),
      ]),
    });
    const view: TreasuryMovementView = {
      id: 'mv2',
      kind: 'other_in',
      status: 'recorded',
      date: '2026-10-03',
      label: 'Apport',
      fromAccountId: null,
      fromCurrency: null,
      toAccountId: 'cash',
      toCurrency: 'CDF',
      amountOut: null,
      amountIn: '5000.00',
      reference: null,
    };
    const e = only(entriesForTreasuryMovement(view, ctx).entries);
    ok(e);
    expect(e.sourceKey).toBe('treasury_movement:mv2:record');
    expect(e.lines.map((l) => [l.accountNumber, l.side, l.suspenseReason])).toEqual([
      ['5711', 'debit', null],
      [SUSPENSE, 'credit', 'NATURE_UNKNOWN'],
    ]);
  });

  it('virement annulé → contre-passation des deux jambes, clés distinctes', () => {
    const view: TreasuryMovementView = {
      id: 'mv3',
      kind: 'transfer',
      status: 'recorded',
      date: '2026-10-03',
      label: 'Caisse vers banque',
      fromAccountId: 'cash',
      fromCurrency: 'CDF',
      toAccountId: 'bank',
      toCurrency: 'CDF',
      amountOut: '1000.00',
      amountIn: '1000.00',
      reference: null,
    };
    const created = syncSourceEntries(entriesForTreasuryMovement(view, context()), []).create;
    const plan = syncSourceEntries(
      entriesForTreasuryMovement({ ...view, status: 'cancelled' }, context()),
      created,
    );
    expect(plan.create.map((e) => e.sourceKey).sort()).toEqual([
      'treasury_movement:mv3:cancel:in',
      'treasury_movement:mv3:cancel:out',
    ]);
    for (const t of netByAccount([...created, ...plan.create]).values())
      expect(t).toEqual({ book: 0n, amount: 0n });
  });

  it('virement même devise à montants différents → « À comptabiliser »', () => {
    const view: TreasuryMovementView = {
      id: 'mv4',
      kind: 'transfer',
      status: 'recorded',
      date: '2026-10-03',
      label: 'x',
      fromAccountId: 'cash',
      fromCurrency: 'CDF',
      toAccountId: 'bank',
      toCurrency: 'CDF',
      amountOut: '1000.00',
      amountIn: '999.00',
      reference: null,
    };
    expect(entriesForTreasuryMovement(view, context()).pending).toEqual(['UNSUPPORTED_SOURCE']);
  });

  it('stock : rien tant que l’option est éteinte ; en inventaire permanent, une écriture par mouvement valorisé', () => {
    const view = {
      id: 'sm1',
      kind: 'purchase_receipt',
      occurredOn: '2026-10-09',
      costStatus: 'valued' as const,
      value: '250.00',
      currency: 'CDF' as const,
      label: 'Riz',
    };
    expect(entriesForStockMovement(view, context()).skipped).toBe('STOCK_POSTING_OFF');
    const ctx = context({
      stockPosting: 'perpetual',
      ruleSet: ruleSet([rule('stock.purchase_receipt', ['3111'], ['6031'])]),
    });
    const e = only(entriesForStockMovement(view, ctx).entries);
    ok(e);
    expect(e.sourceKey).toBe('stock_movement:sm1');
    expect(e.lines.map((l) => [l.accountNumber, l.side])).toEqual([
      ['3111', 'debit'],
      ['6031', 'credit'],
    ]);
    expect(
      entriesForStockMovement({ ...view, costStatus: 'pending_cost', value: null }, ctx).pending,
    ).toEqual(['STOCK_COST_PENDING']);
    expect(entriesForStockMovement({ ...view, kind: 'transfer_out' }, ctx).skipped).toBe(
      'NO_VALUE',
    );
  });
});

describe('ADR-0049 K2 — règles de correspondance (§ 2.4, § 6.0)', () => {
  it('jeu absent, brouillon ou remplacé → compte d’attente', () => {
    expect(resolveRule(null, 'expense.loyer')).toEqual({
      status: 'suspense',
      reason: 'NO_VALIDATED_RULE_SET',
    });
    for (const status of ['draft', 'superseded'] as const) {
      expect(resolveRule(ruleSet(SALES_RULES, status), 'expense.loyer')).toEqual({
        status: 'suspense',
        reason: 'NO_VALIDATED_RULE_SET',
      });
    }
    const e = only(
      entriesForExpense(expense(), context({ ruleSet: ruleSet(SALES_RULES, 'draft') })).entries,
    );
    expect(e.generation.ruleSetVersion).toBeNull();
    expect(e.lines.every((l) => l.accountNumber === SUSPENSE)).toBe(true);
    ok(e);
  });

  it('règle « à confirmer » jamais appliquée ; côté manquant, ambigu ou illisible → attente motivée', () => {
    const rs = ruleSet([
      rule('expense.loyer', ['6221'], [], true),
      rule('expense.transport', [], ['6241']),
      rule('expense.marketing', ['6271', '6272']),
      rule('expense.energie_telecom', ['abc']),
      rule('expense.payment', [], ['{treasuryAccount}']),
    ]);
    const reasons = ['loyer', 'transport', 'marketing', 'energie_telecom'].map(
      (c) =>
        only(entriesForExpense(expense({ category: c }), context({ ruleSet: rs })).entries).lines[0]
          ?.suspenseReason,
    );
    expect(reasons).toEqual([
      'RULE_REQUIRES_REVIEW',
      'RULE_SIDE_MISSING',
      'RULE_SIDE_AMBIGUOUS',
      'RULE_ACCOUNT_INVALID',
    ]);
    expect(resolveRule(rs, 'expense.payment')).toMatchObject({ status: 'rule', ruleSetVersion: 3 });
  });

  it('checkRuleSet signale clés inconnues, doublons, comptes illisibles', () => {
    const issues = checkRuleSet(
      ruleSet([
        rule('expense.loyer', ['6221']),
        rule('expense.loyer', ['6222']),
        rule('vente.inventee', ['7']),
        rule('expense.transport', ['x']),
        rule('expense.marketing', []),
      ]),
    );
    expect(issues.map((i) => i.code)).toEqual([
      'DUPLICATE_OPERATION_KEY',
      'UNKNOWN_OPERATION_KEY',
      'RULE_ACCOUNT_INVALID',
      'RULE_WITHOUT_ACCOUNT',
    ]);
    expect(checkRuleSet(ruleSet(SALES_RULES))).toEqual([]);
  });

  it('catalogue des clés : familles du § 6 reconnues, rien d’autre', () => {
    for (const key of [
      'sale.invoice.receivable',
      'sale.deposit.vat.C',
      'sale.credit_note.nonrevenue.N',
      'receipt.MOBILEMONEY',
      'expense.investissement',
      'purchase.credit_note.vat_declared',
      'purchase.payment.cash',
      'transfer.internal',
      'stock.sale_issue',
      'exchange.difference',
    ]) {
      expect(isOperationKey(key)).toBe(true);
    }
    for (const key of [
      'sale.invoice.revenue.BIE.H',
      'sale.invoice.revenue.TAX.B',
      'receipt.CREDIT',
      'expense.inconnue',
      'stock.vol',
      '',
      'sale.invoice.vat.Q',
    ]) {
      expect(isOperationKey(key)).toBe(false);
    }
  });
});

describe('ADR-0049 K2 — checkEntry, reverseEntry, clés de source', () => {
  const base = (): ProposedEntry => only(entriesForSalesInvoice(invoiceBC(), context()).entries);

  it('détecte déséquilibre, côté discordant, compte hors plan, période close', () => {
    const e = base();
    const broken: ProposedEntry = {
      ...e,
      lines: e.lines.map((l, i) =>
        i === 1 ? { ...l, amount: '99999.00', bookAmount: '99999.00', credit: '99999.00' } : l,
      ),
    };
    const codes = checkEntry(broken).issues.map((i) => i.code);
    expect(codes).toContain('ENTRY_UNBALANCED');
    expect(codes).toContain('ENTRY_UNBALANCED_IN_CURRENCY');
    const sideBug: ProposedEntry = {
      ...e,
      lines: e.lines.map((l, i) => (i === 0 ? { ...l, credit: l.debit } : l)),
    };
    expect(checkEntry(sideBug).issues.map((i) => i.code)).toContain('LINE_DEBIT_CREDIT_MISMATCH');
    expect(
      checkEntry(e, { chartAccounts: ['4111', '7061'], openPeriods: ['2026-11'] }).issues.map(
        (i) => i.code,
      ),
    ).toEqual([
      'ACCOUNTING_PERIOD_CLOSED',
      'ACCOUNT_NOT_IN_CHART',
      'ACCOUNT_NOT_IN_CHART',
      'ACCOUNT_NOT_IN_CHART',
    ]);
    expect(
      checkEntry(e, {
        chartAccounts: ['4111', '7061', '7062', '4431', '4432'],
        openPeriods: ['2026-10'],
      }).ok,
    ).toBe(true);
    expect(checkEntry({ ...e, lines: e.lines.slice(0, 1) }).issues.map((i) => i.code)).toContain(
      'ENTRY_NO_LINES',
    );
    expect(checkEntry({ ...e, suspense: true }).issues.map((i) => i.code)).toEqual([
      'SUSPENSE_FLAG_MISMATCH',
    ]);
    expect(checkEntry({ ...e, date: '2026-02-30' }).issues.map((i) => i.code)).toEqual([
      'ENTRY_DATE_INVALID',
    ]);
  });

  it('contre-passation exacte, liée, et involutive', () => {
    const e = base();
    const rev = reverseEntry(e, {
      sourceKey: 'sales_invoice:inv1:manual',
      reason: 'MANUAL',
      date: '2026-10-31',
    });
    expect(rev).toMatchObject({
      reversalOf: e.sourceKey,
      reversalReason: 'MANUAL',
      date: '2026-10-31',
    });
    ok(rev);
    for (const t of netByAccount([e, rev]).values()) expect(t).toEqual({ book: 0n, amount: 0n });
    expect(reverseEntry(rev, { sourceKey: 'x', reason: 'MANUAL' }).lines).toEqual(e.lines);
  });

  it('clés de source lisibles et contre-passations déterministes', () => {
    expect(parseSourceKey('sales_receipt:abc:r3')).toEqual({
      kind: 'sales_receipt',
      id: 'abc',
      event: 'r3',
    });
    expect(parseSourceKey('stock_movement:sm1')).toEqual({
      kind: 'stock_movement',
      id: 'sm1',
      event: '',
    });
    expect(parseSourceKey('autre:1:x')).toBeNull();
    expect(reversalKey('treasury_expense:e:r2', 'cancel', 1)).toBe('treasury_expense:e:cancel');
    expect(reversalKey('treasury_movement:m:out', 'cancel', 2)).toBe(
      'treasury_movement:m:cancel:out',
    );
    expect(reversalKey('sales_receipt:r:r1', 'superseded', 1)).toBe(
      'sales_receipt:r:r1:superseded',
    );
  });
});

describe('ADR-0049 K2 — aucun numéro de compte en dur (critère 17, analyse statique)', () => {
  it('aucune chaîne numérique de deux chiffres ou plus dans le code du lot hors tests', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'types.ts',
      ...['entries', 'rules'].flatMap((d) => readdirSync(join(root, d)).map((f) => join(d, f))),
    ].filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const source = readFileSync(join(root, f), 'utf8');
      expect(source.match(/['"`]\d{2,}['"`]/g), f).toBeNull();
    }
  });
});
