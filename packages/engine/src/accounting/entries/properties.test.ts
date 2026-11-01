// Propriétés du moteur d'écritures (ADR-0049 § Plan de validation), graine fixe.
//
// Sur des pièces aléatoires de chaque nature, avec des règles, des monnaies de
// tenue et des taux tirés au hasard :
// 1. toute écriture produite est équilibrée (monnaie de tenue ET devise) ;
// 2. la contre-passation annule exactement, compte par compte ;
// 3. l'idempotence par clé de source tient (rejouer ne crée rien) ;
// 4. la génération est déterministe et les clés sont uniques.

import { describe, expect, it } from 'vitest';

import {
  checkEntry,
  entriesForExpense,
  entriesForReceipt,
  entriesForSalesInvoice,
  entriesForStockMovement,
  entriesForSupplierInvoice,
  entriesForSupplierPayment,
  entriesForTreasuryMovement,
  reverseEntry,
  syncSourceEntries,
  type AccountingCurrency,
  type MappingRule,
  type PostingContext,
  type PostingResult,
  type ProposedEntry,
  type SalesInvoiceView,
} from '../../index.js';
import {
  SALES_RULES,
  SUSPENSE,
  context,
  netByAccount,
  rule,
  ruleSet,
  rng,
} from './fixtures.test.js';

const SEED = 20261101;
const RUNS = 400;
const HEAVY = { timeout: 120_000 };

type Rand = () => number;
const int = (r: Rand, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rand, values: readonly T[]): T => values[int(r, 0, values.length - 1)] as T;
const money = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const CURRENCIES: readonly AccountingCurrency[] = ['CDF', 'USD'];
const DAYS = ['2026-09-30', '2026-10-01', '2026-10-15', '2026-11-03'];
const RATES = ['2800', '2850.5', '0.00035714', '1.23456789', '3000'];

const EXTRA_RULES: MappingRule[] = [
  rule('sale.payment_at_issue.ESPECES', ['5711'], ['5711']),
  rule('sale.payment_at_issue.receivable', ['{customer}'], ['{customer}']),
  rule('expense.vat_declared', ['4452']),
  rule('purchase.invoice.vat_declared', ['4452']),
  rule('exchange.difference', ['6761'], ['7761']),
  rule('stock.purchase_receipt', ['3111'], ['6031']),
  rule('stock.sale_issue', ['6031'], ['3111']),
  rule('receipt.unallocated', [], ['4191']),
];

function randomContext(r: Rand): PostingContext {
  const allRules = [...SALES_RULES, ...EXTRA_RULES];
  const kept = allRules
    .filter(() => r() < 0.7)
    .map((x) => (r() < 0.1 ? { ...x, requiresReview: true } : x));
  const status = pick(r, ['validated', 'validated', 'validated', 'draft'] as const);
  const enteredRates = DAYS.flatMap((date) =>
    CURRENCIES.flatMap((from) =>
      CURRENCIES.filter((to) => to !== from && r() < 0.5).map((to) => ({
        date,
        from,
        to,
        rate: pick(r, RATES),
      })),
    ),
  );
  return context({
    ruleSet: r() < 0.1 ? null : ruleSet(kept, status),
    bookCurrency: pick(r, CURRENCIES),
    enteredRates,
    vatRegistered: r() < 0.5,
    stockPosting: r() < 0.5 ? 'perpetual' : 'off',
  });
}

function randomInvoice(r: Rand, i: number): SalesInvoiceView {
  const letters = ['A', 'B', 'C', 'E', 'H', 'J', 'K', 'L', 'N', 'O'].filter(() => r() < 0.35);
  const used = letters.length === 0 ? ['B'] : letters;
  const lines: SalesInvoiceView['lines'][number][] = [];
  const groups = used.map((g) => {
    const vatOnly = g === 'N';
    const taxOnly = g === 'L' || g === 'N';
    const ht = vatOnly ? 0 : int(r, 1, 5_000_000);
    const vat = vatOnly
      ? int(r, 1, 100_000)
      : r() < 0.6
        ? Math.floor((ht * int(r, 0, 16)) / 100)
        : 0;
    const specific = !vatOnly && r() < 0.2 ? Math.min(ht - 1, int(r, 0, 5000)) : 0;
    const n = int(r, 1, 3);
    for (let k = 0; k < n; k += 1) {
      lines.push({
        taxGroup: g,
        itemType: taxOnly ? 'TAX' : pick(r, ['BIE', 'SER'] as const),
        amount: money(int(r, 1, 900_000)),
      });
    }
    return {
      group: g,
      ht: money(ht),
      vat: money(vat),
      total: money(ht + vat),
      specificTax: money(Math.max(specific, 0)),
    };
  });
  const total = groups.reduce((s, g) => s + Math.round(Number(g.total) * 100), 0);
  const currency = pick(r, CURRENCIES);
  const paidCash = r() < 0.4 ? int(r, 0, total) : 0;
  return {
    id: `inv${i}`,
    number: `FV-${i}`,
    status: pick(r, ['issued', 'normalized', 'normalized', 'draft'] as const),
    type: pick(r, ['FV', 'FV', 'EV', 'FT', 'FA', 'EA'] as const),
    series: pick(r, ['real', 'real', 'real', 'test'] as const),
    date: pick(r, DAYS),
    currency,
    customerId: pick(r, ['c1', 'c1', 'c9']),
    customerName: 'Client',
    groups,
    lines,
    total: money(total),
    payments: [
      { method: 'CREDIT', amount: money(total - paidCash) },
      ...(paidCash > 0
        ? [{ method: pick(r, ['ESPECES', 'MOBILEMONEY'] as const), amount: money(paidCash) }]
        : []),
    ],
    conversion:
      currency === 'USD' && r() < 0.6
        ? { from: 'USD', to: 'CDF', rate: pick(r, RATES), reference: 'BCC' }
        : null,
  };
}

const allocations = (r: Rand, total: number, kind: 'inv' | 'si') => {
  const n = int(r, 1, 4);
  const out = [];
  let rest = total;
  for (let k = 0; k < n && rest > 0; k += 1) {
    const amount = k === n - 1 ? rest : int(r, 1, rest);
    rest -= amount;
    out.push({
      invoiceId: `${kind}${k}`,
      invoiceNumber: null,
      amount: money(amount),
      invoiceBookRate:
        r() < 0.5 ? { rate: pick(r, RATES), rateSource: 'document' as const, rateRef: null } : null,
    });
  }
  return out;
};

/** Toutes les pièces d'une itération, de chaque nature. */
function randomResults(
  r: Rand,
  i: number,
  ctx: PostingContext,
): { result: PostingResult; cancelled: () => PostingResult | null }[] {
  const invoice = randomInvoice(r, i);
  const receiptTotal = int(r, 1, 9_000_000);
  const receipt = {
    id: `rc${i}`,
    number: null,
    status: 'recorded' as const,
    revision: int(r, 1, 3),
    receivedOn: pick(r, DAYS),
    amount: money(receiptTotal + (r() < 0.2 ? int(r, 1, 500) : 0)),
    currency: pick(r, CURRENCIES),
    method: pick(r, ['VIREMENT', 'ESPECES', 'MOBILEMONEY']),
    accountId: pick(r, ['bank', 'usd', null, 'inconnu']),
    customerId: pick(r, ['c1', 'c9']),
    customerName: null,
    allocations: allocations(r, receiptTotal, 'inv'),
  };
  const expenseAmount = int(r, 1, 9_000_000);
  const expense = {
    id: `ex${i}`,
    status: 'recorded' as const,
    revision: int(r, 1, 3),
    spentOn: pick(r, DAYS),
    amount: money(expenseAmount),
    currency: pick(r, CURRENCIES),
    category: pick(r, ['loyer', 'achats', 'personnel', 'investissement']),
    label: 'Dépense',
    supplierName: null,
    accountId: pick(r, ['bank', 'cash', null]),
    deductibleVat: r() < 0.5 ? money(int(r, 0, expenseAmount + 10)) : null,
    reference: null,
    origin: r() < 0.15 ? { kind: 'supplier_payment', id: 'pf' } : null,
  };
  const siTotal = int(r, 1, 9_000_000);
  const parts = int(r, 1, 3);
  const costAllocations = [];
  let rest = siTotal;
  for (let k = 0; k < parts; k += 1) {
    const amount = k === parts - 1 ? rest : int(r, 0, rest);
    rest -= amount;
    costAllocations.push({
      category: pick(r, ['achats', 'transport', 'services_exterieurs']),
      amount: money(amount),
    });
  }
  const supplierInvoice = {
    id: `si${i}`,
    number: null,
    kind: pick(r, ['invoice', 'invoice', 'credit_note'] as const),
    status: 'validated' as const,
    wasValidated: true,
    invoiceDate: pick(r, DAYS),
    currency: pick(r, CURRENCIES),
    supplierId: pick(r, ['s1', 's9']),
    supplierName: null,
    total: money(siTotal),
    deductibleVat: r() < 0.6 ? money(int(r, 0, siTotal)) : null,
    costAllocations,
  };
  const payTotal = int(r, 1, 9_000_000);
  const payment = {
    id: `pf${i}`,
    number: null,
    status: 'recorded' as const,
    paidOn: pick(r, DAYS),
    amount: money(payTotal),
    currency: pick(r, CURRENCIES),
    method: pick(r, ['bank_transfer', 'cash']),
    accountId: pick(r, ['bank', null]),
    supplierId: 's1',
    supplierName: null,
    allocations: allocations(r, payTotal, 'si'),
  };
  const fromCurrency = pick(r, CURRENCIES);
  const toCurrency = r() < 0.5 ? fromCurrency : pick(r, CURRENCIES);
  const out = int(r, 1, 9_000_000);
  const kind = pick(r, ['transfer', 'transfer', 'other_in', 'other_out'] as const);
  const movement = {
    id: `mv${i}`,
    kind,
    status: 'recorded' as const,
    date: pick(r, DAYS),
    label: 'Mouvement',
    fromAccountId: 'bank',
    fromCurrency,
    toAccountId: pick(r, ['usd', 'cash']),
    toCurrency,
    amountOut: money(out),
    amountIn: money(fromCurrency === toCurrency ? out : int(r, 1, 9_000_000)),
    reference: null,
  };
  const stock = {
    id: `sm${i}`,
    kind: pick(r, ['purchase_receipt', 'sale_issue', 'adjustment', 'transfer_in']),
    occurredOn: pick(r, DAYS),
    costStatus: pick(r, ['valued', 'valued', 'pending_cost', 'not_applicable'] as const),
    value: r() < 0.9 ? money(int(r, 0, 9_000_000)) : null,
    currency: pick(r, CURRENCIES),
    label: null,
  };
  return [
    { result: entriesForSalesInvoice(invoice, ctx), cancelled: () => null },
    {
      result: entriesForReceipt(receipt, ctx),
      cancelled: () => entriesForReceipt({ ...receipt, status: 'cancelled' }, ctx),
    },
    {
      result: entriesForExpense(expense, ctx),
      cancelled: () => entriesForExpense({ ...expense, status: 'cancelled' }, ctx),
    },
    {
      result: entriesForSupplierInvoice(supplierInvoice, ctx),
      cancelled: () => entriesForSupplierInvoice({ ...supplierInvoice, status: 'cancelled' }, ctx),
    },
    {
      result: entriesForSupplierPayment(payment, ctx),
      cancelled: () => entriesForSupplierPayment({ ...payment, status: 'cancelled' }, ctx),
    },
    {
      result: entriesForTreasuryMovement(movement, ctx),
      cancelled: () => entriesForTreasuryMovement({ ...movement, status: 'cancelled' }, ctx),
    },
    { result: entriesForStockMovement(stock, ctx), cancelled: () => null },
  ];
}

function each(
  run: (ctx: PostingContext, items: ReturnType<typeof randomResults>, i: number) => void,
): number {
  const r = rng(SEED);
  let produced = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const ctx = randomContext(r);
    const items = randomResults(r, i, ctx);
    produced += items.reduce((s, it) => s + it.result.entries.length, 0);
    run(ctx, items, i);
  }
  return produced;
}

const expectBalanced = (e: ProposedEntry): void => {
  const check = checkEntry(e, { suspenseAccount: SUSPENSE });
  expect(check.issues, e.sourceKey).toEqual([]);
  if (check.bookTotals !== null) expect(check.bookTotals.debit).toBe(check.bookTotals.credit);
  for (const t of check.currencyTotals)
    expect(t.debit, `${e.sourceKey} ${t.currency}`).toBe(t.credit);
};

describe('ADR-0049 K2 — propriétés à graine fixe', () => {
  it('toute écriture produite est équilibrée, en monnaie de tenue et par devise', HEAVY, () => {
    let awaiting = 0;
    let suspense = 0;
    let fx = 0;
    const produced = each((_ctx, items) => {
      for (const { result } of items) {
        for (const e of result.entries) {
          expectBalanced(e);
          if (e.status === 'awaiting_rate') awaiting += 1;
          if (e.suspense) suspense += 1;
          if (e.lines.some((l) => l.exchangeDifference)) fx += 1;
          // Une ligne en attente vise toujours le compte d'attente, et réciproquement le motif.
          for (const l of e.lines)
            if (l.suspenseReason !== null) expect(l.accountNumber).toBe(SUSPENSE);
        }
      }
    });
    // Le générateur couvre bien les cas difficiles.
    expect(produced).toBeGreaterThan(RUNS * 3);
    expect(awaiting).toBeGreaterThan(20);
    expect(suspense).toBeGreaterThan(50);
    expect(fx).toBeGreaterThan(5);
  });

  it('la contre-passation annule exactement chaque compte et est involutive', HEAVY, () => {
    each((_ctx, items) => {
      for (const { result } of items) {
        for (const e of result.entries) {
          const rev = reverseEntry(e, { sourceKey: `${e.sourceKey}:test`, reason: 'MANUAL' });
          expectBalanced(rev);
          for (const t of netByAccount([e, rev]).values())
            expect(t).toEqual({ book: 0n, amount: 0n });
          expect(reverseEntry(rev, { sourceKey: e.sourceKey, reason: 'MANUAL' }).lines).toEqual(
            e.lines,
          );
        }
      }
    });
  });

  it(
    'idempotence par clé de source : rejouer ne crée rien ; l’annulation contre-passe une fois',
    HEAVY,
    () => {
      each((_ctx, items) => {
        for (const { result, cancelled } of items) {
          const first = syncSourceEntries(result, []);
          expect(first.create.map((e) => e.sourceKey)).toEqual(
            result.entries.map((e) => e.sourceKey),
          );
          const again = syncSourceEntries(result, first.create);
          expect(again.create).toEqual([]);
          expect(again.unchanged.sort()).toEqual(result.entries.map((e) => e.sourceKey).sort());
          const cancel = cancelled();
          if (cancel === null) continue;
          const plan = syncSourceEntries(cancel, first.create);
          expect(plan.create).toHaveLength(cancel.skipped === null ? first.create.length : 0);
          const books = [...first.create, ...plan.create];
          if (cancel.skipped === null)
            for (const t of netByAccount(books).values())
              expect(t).toEqual({ book: 0n, amount: 0n });
          expect(syncSourceEntries(cancel, books).create).toEqual([]);
        }
      });
    },
  );

  it('génération déterministe, clés de source uniques', HEAVY, () => {
    const keys = new Set<string>();
    const a: unknown[] = [];
    each((_ctx, items) => {
      for (const { result } of items) {
        a.push(result);
        for (const e of result.entries) {
          expect(keys.has(e.sourceKey), e.sourceKey).toBe(false);
          keys.add(e.sourceKey);
        }
      }
    });
    const b: unknown[] = [];
    each((_ctx, items) => {
      for (const { result } of items) b.push(result);
    });
    expect(b).toEqual(a);
  });
});
