// Jeux d'essai des tests du moteur d'écritures (ADR-0049 — K2). Les numéros de
// compte ci-dessous sont des valeurs de TEST, pas des règles : le moteur n'en
// connaît aucun.

import { describe, expect, it } from 'vitest';

import type {
  MappingRule,
  MappingRuleSet,
  PostingContext,
  ProposedEntry,
  SalesInvoiceView,
} from '../types.js';

export const SUSPENSE = '4709';

export function rule(
  key: string,
  debit: string[],
  credit: string[] = [],
  requiresReview = false,
): MappingRule {
  return { key, debit, credit, requiresReview };
}

export function ruleSet(
  rules: MappingRule[],
  status: MappingRuleSet['status'] = 'validated',
): MappingRuleSet {
  return { version: 3, status, rules };
}

/** Règles complètes pour une vente B et C en services. */
export const SALES_RULES: MappingRule[] = [
  rule('sale.invoice.receivable', ['{customer}']),
  rule('sale.invoice.revenue.SER.B', [], ['7061']),
  rule('sale.invoice.revenue.SER.C', [], ['7062']),
  rule('sale.invoice.revenue.BIE.B', [], ['7011']),
  rule('sale.invoice.vat.B', [], ['4431']),
  rule('sale.invoice.vat.C', [], ['4432']),
  rule('sale.credit_note.receivable', [], ['{customer}']),
  rule('sale.credit_note.revenue.SER.B', ['7069']),
  rule('sale.credit_note.vat.B', ['4431']),
  rule('receipt.VIREMENT', ['{treasuryAccount}']),
  rule('receipt.ESPECES', ['{treasuryAccount}']),
  rule('receipt.receivable', [], ['{customer}']),
  rule('expense.loyer', ['6221']),
  rule('expense.payment', [], ['{treasuryAccount}']),
  rule('purchase.invoice.achats', ['6011']),
  rule('purchase.invoice.payable', [], ['{supplier}']),
  rule('purchase.payment.payable', ['{supplier}']),
  rule('purchase.payment.bank_transfer', [], ['{treasuryAccount}']),
  rule('transfer.treasury', ['{treasuryAccount}'], ['{treasuryAccount}']),
  rule('transfer.internal', ['5851'], ['5851']),
];

export function context(overrides: Partial<PostingContext> = {}): PostingContext {
  return {
    ruleSet: ruleSet(SALES_RULES),
    suspenseAccount: SUSPENSE,
    bookCurrency: 'CDF',
    cutoverDate: '2026-10-01',
    enteredRates: [],
    chartPack: { slug: 'syscohada-revise-2017-cd', version: 1 },
    customerAccounts: { c1: { collectiveNumber: '4111', auxiliaryNumber: '4111C1' } },
    supplierAccounts: { s1: { collectiveNumber: '4011', auxiliaryNumber: '4011S1' } },
    treasuryAccounts: { bank: '5211', cash: '5711', usd: '5212' },
    vatRegistered: true,
    stockPosting: 'off',
    ...overrides,
  };
}

/** Facture FV en CDF, groupes B (16 %) et C (5 %), services, à crédit. */
export function invoiceBC(overrides: Partial<SalesInvoiceView> = {}): SalesInvoiceView {
  return {
    id: 'inv1',
    number: 'FV-2026-0001',
    status: 'normalized',
    type: 'FV',
    series: 'real',
    date: '2026-10-15',
    currency: 'CDF',
    customerId: 'c1',
    customerName: 'Client Un',
    groups: [
      { group: 'B', ht: '100000.00', vat: '16000.00', total: '116000.00', specificTax: '0.00' },
      { group: 'C', ht: '20000.00', vat: '1000.00', total: '21000.00', specificTax: '0.00' },
    ],
    lines: [
      { taxGroup: 'B', itemType: 'SER', amount: '100000.00' },
      { taxGroup: 'C', itemType: 'SER', amount: '20000.00' },
    ],
    total: '137000.00',
    payments: [{ method: 'CREDIT', amount: '137000.00' }],
    conversion: null,
    ...overrides,
  };
}

/** Somme signée (débit +, crédit −) par compte, en monnaie de tenue et en devise de pièce. */
export function netByAccount(
  entries: readonly ProposedEntry[],
): Map<string, { book: bigint; amount: bigint }> {
  const cents = (v: string | null): bigint => {
    if (v === null) return 0n;
    const [i, d = ''] = v.split('.');
    return BigInt(i ?? '0') * 100n + BigInt(d.padEnd(2, '0'));
  };
  const out = new Map<string, { book: bigint; amount: bigint }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const k = `${l.accountNumber}|${l.auxiliaryAccountNumber ?? ''}|${l.currency}`;
      const t = out.get(k) ?? { book: 0n, amount: 0n };
      const sign = l.side === 'debit' ? 1n : -1n;
      t.book += sign * cents(l.bookAmount);
      t.amount += sign * cents(l.amount);
      out.set(k, t);
    }
  }
  return out;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Ce fichier est exclu du build (`*.test.ts`) ; vitest exige au moins un test.

describe('jeux d’essai ADR-0049 — K2', () => {
  it('la facture B et C est cohérente avec ses groupes', () => {
    const inv = invoiceBC();
    expect(inv.groups.map((g) => g.total)).toEqual(['116000.00', '21000.00']);
    expect(rng(1)()).toBe(rng(1)());
  });
});
