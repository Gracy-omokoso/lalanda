// Raccord K2/K3 (ADR-0049, note du 1er novembre 2026) : des pièces générées
// passent par le moteur d'écritures (`entriesFor…`, K2), puis `toReportingEntry`,
// puis la restitution (`computeTrialBalance`, `computeLedger`, `computeStatement`,
// `exportRows`, K3). Générateur à GRAINE FIXE, délai explicite.
//
// Les pièces sont choisies pour produire les cas limites du raccord : lignes
// converties arrondies à 0,00 en monnaie de tenue (petits montants en CDF tenus
// en USD) et lignes d'écart de change (règlements épinglés au taux de la facture).

import { describe, expect, it } from 'vitest';

import {
  computeLedger,
  computeStatement,
  computeTrialBalance,
  entriesForExpense,
  entriesForReceipt,
  entriesForSalesInvoice,
  entriesForSupplierInvoice,
  entriesForSupplierPayment,
  entriesForTreasuryMovement,
  exportRows,
  reverseEntry,
  toReportingEntry,
  type AccountingCurrency,
  type MappingRule,
  type PostingContext,
  type ProposedEntry,
  type ReportingEntry,
  type ReportingPersistence,
  type SalesInvoiceView,
  type SettlementAllocationView,
  type StatementTemplateView,
} from './index.js';
import { parseLine } from './ledger/money.js';
import { SALES_RULES, context, rule, ruleSet, rng } from './entries/fixtures.test.js';

const SEED = 20261101;
const RUNS = 150;
const HEAVY = { timeout: 180_000 };
const FROM = '2026-01-01';
const TO = '2026-12-31';

type Rand = () => number;
const int = (r: Rand, min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rand, values: readonly T[]): T => values[int(r, 0, values.length - 1)] as T;
const money = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const cents = (s: string): bigint => {
  const neg = s.startsWith('-');
  const [i = '0', f = '0'] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0'));
  return neg ? -v : v;
};
const DAYS = ['2026-10-01', '2026-10-15', '2026-11-03'];
/** Taux par sens : 1 `from` = rate `to`. */
const RATES: Record<string, readonly string[]> = {
  'USD>CDF': ['2800', '2850.5', '3000'],
  'CDF>USD': ['0.00035714', '0.00036', '0.0003333'],
};
const CURRENCIES: readonly AccountingCurrency[] = ['CDF', 'USD'];
const other = (c: AccountingCurrency): AccountingCurrency => (c === 'CDF' ? 'USD' : 'CDF');

const RULES: MappingRule[] = [
  ...SALES_RULES,
  rule('sale.invoice.revenue.BIE.C', [], ['7012']),
  rule('sale.payment_at_issue.ESPECES', ['5711'], ['5711']),
  rule('sale.payment_at_issue.receivable', ['{customer}'], ['{customer}']),
  rule('expense.vat_declared', ['4452']),
  rule('purchase.invoice.vat_declared', ['4452']),
  rule('exchange.difference', ['6761'], ['7761']),
  rule('receipt.unallocated', [], ['4191']),
];

function randomContext(r: Rand): PostingContext {
  const bookCurrency = pick(r, CURRENCIES);
  const from = other(bookCurrency);
  return context({
    ruleSet: r() < 0.15 ? null : ruleSet(RULES.filter(() => r() < 0.9)),
    bookCurrency,
    // Un taux saisi presque chaque jour ; parfois aucun (écriture en attente de taux).
    enteredRates: DAYS.filter(() => r() < 0.9).map((date) => ({
      date,
      from,
      to: bookCurrency,
      rate: pick(r, RATES[`${from}>${bookCurrency}`] ?? []),
    })),
    vatRegistered: r() < 0.7,
  });
}

/** Petit montant (centimes) : de quoi produire des lignes arrondies à 0,00 une fois converties. */
const amount = (r: Rand): number => (r() < 0.4 ? int(r, 1, 2_000) : int(r, 2_001, 5_000_000));

function randomInvoice(r: Rand, i: number, ctx: PostingContext): SalesInvoiceView {
  const groups = (['B', 'C'] as const).filter((_, k) => k === 0 || r() < 0.6);
  const lines: SalesInvoiceView['lines'][number][] = [];
  const views = groups.map((g) => {
    const ht = amount(r);
    const vat = r() < 0.7 ? int(r, 1, Math.max(1, Math.floor(ht / 6))) : 0;
    lines.push({ taxGroup: g, itemType: pick(r, ['SER', 'BIE'] as const), amount: money(ht) });
    return {
      group: g,
      ht: money(ht),
      vat: money(vat),
      total: money(ht + vat),
      specificTax: '0.00',
    };
  });
  const total = views.reduce((s, g) => s + Number(cents(g.total)), 0);
  const currency = pick(r, CURRENCIES);
  const paid = r() < 0.3 ? int(r, 0, total) : 0;
  return {
    id: `inv${i}`,
    number: `FV-${i}`,
    status: 'normalized',
    type: pick(r, ['FV', 'FV', 'FA'] as const),
    series: 'real',
    date: pick(r, DAYS),
    currency,
    customerId: 'c1',
    customerName: 'Client',
    groups: views,
    lines,
    total: money(total),
    payments: [
      { method: 'CREDIT', amount: money(total - paid) },
      ...(paid > 0 ? [{ method: 'ESPECES', amount: money(paid) }] : []),
    ],
    conversion:
      currency !== ctx.bookCurrency && r() < 0.5
        ? {
            from: currency,
            to: ctx.bookCurrency,
            rate: pick(r, RATES[`${currency}>${ctx.bookCurrency}`] ?? []),
            reference: 'BCC',
          }
        : null,
  };
}

/** Imputations épinglées à un taux de facture différent du taux du jour → écart de change. */
function allocations(
  r: Rand,
  total: number,
  kind: string,
  currency: AccountingCurrency,
  ctx: PostingContext,
): SettlementAllocationView[] {
  const out: SettlementAllocationView[] = [];
  let rest = total;
  for (let k = 0; k < 3 && rest > 0; k += 1) {
    const value = k === 2 || r() < 0.3 ? rest : int(r, 1, rest);
    rest -= value;
    out.push({
      invoiceId: `${kind}${k}`,
      invoiceNumber: null,
      amount: money(value),
      invoiceBookRate:
        currency !== ctx.bookCurrency && r() < 0.8
          ? {
              rate: pick(r, RATES[`${currency}>${ctx.bookCurrency}`] ?? []),
              rateSource: 'document',
              rateRef: null,
            }
          : null,
    });
  }
  return out;
}

function randomEntries(r: Rand, i: number, ctx: PostingContext): ProposedEntry[] {
  const out: ProposedEntry[] = [];
  out.push(...entriesForSalesInvoice(randomInvoice(r, i, ctx), ctx).entries);
  const receiptCurrency = pick(r, CURRENCIES);
  const receiptTotal = amount(r);
  out.push(
    ...entriesForReceipt(
      {
        id: `rc${i}`,
        number: null,
        status: 'recorded',
        revision: 1,
        receivedOn: pick(r, DAYS),
        amount: money(receiptTotal + (r() < 0.2 ? int(r, 1, 500) : 0)),
        currency: receiptCurrency,
        method: pick(r, ['VIREMENT', 'ESPECES']),
        accountId: pick(r, ['bank', 'usd', null]),
        customerId: 'c1',
        customerName: null,
        allocations: allocations(r, receiptTotal, 'inv', receiptCurrency, ctx),
      },
      ctx,
    ).entries,
  );
  const expenseTotal = amount(r);
  out.push(
    ...entriesForExpense(
      {
        id: `ex${i}`,
        status: 'recorded',
        revision: 1,
        spentOn: pick(r, DAYS),
        amount: money(expenseTotal),
        currency: pick(r, CURRENCIES),
        category: 'loyer',
        label: 'Dépense',
        supplierName: null,
        accountId: pick(r, ['bank', 'cash']),
        deductibleVat: r() < 0.5 ? money(int(r, 1, Math.max(1, expenseTotal - 1))) : null,
        reference: null,
        origin: null,
      },
      ctx,
    ).entries,
  );
  const siTotal = amount(r);
  const siCurrency = pick(r, CURRENCIES);
  out.push(
    ...entriesForSupplierInvoice(
      {
        id: `si${i}`,
        number: null,
        kind: 'invoice',
        status: 'validated',
        wasValidated: true,
        invoiceDate: pick(r, DAYS),
        currency: siCurrency,
        supplierId: 's1',
        supplierName: null,
        total: money(siTotal),
        deductibleVat: r() < 0.5 ? money(int(r, 0, siTotal)) : null,
        costAllocations: [{ category: 'achats', amount: money(siTotal) }],
      },
      ctx,
    ).entries,
  );
  const payCurrency = pick(r, CURRENCIES);
  const payTotal = amount(r);
  out.push(
    ...entriesForSupplierPayment(
      {
        id: `pf${i}`,
        number: null,
        status: 'recorded',
        paidOn: pick(r, DAYS),
        amount: money(payTotal),
        currency: payCurrency,
        method: 'bank_transfer',
        accountId: 'bank',
        supplierId: 's1',
        supplierName: null,
        allocations: allocations(r, payTotal, 'si', payCurrency, ctx),
      },
      ctx,
    ).entries,
  );
  const fromCurrency = pick(r, CURRENCIES);
  const toCurrency = pick(r, CURRENCIES);
  const outAmount = amount(r);
  out.push(
    ...entriesForTreasuryMovement(
      {
        id: `mv${i}`,
        kind: 'transfer',
        status: 'recorded',
        date: pick(r, DAYS),
        label: 'Virement',
        fromAccountId: 'bank',
        fromCurrency,
        toAccountId: 'usd',
        toCurrency,
        amountOut: money(outAmount),
        amountIn: money(fromCurrency === toCurrency ? outAmount : amount(r)),
        reference: null,
      },
      ctx,
    ).entries,
  );
  return out;
}

const JOURNALS: Record<string, string> = {
  sales: 'VE',
  purchases: 'AC',
  treasury: 'TR',
  misc: 'OD',
  opening: 'AN',
};

/** Persistance simulée (lot K5) : identifiant, journal, numéro séquentiel par journal. */
function persist(entries: readonly ProposedEntry[], prefix: string): ReportingEntry[] {
  const counters = new Map<string, number>();
  return entries.map((e, k) => {
    const journalCode = JOURNALS[e.journal.kind] ?? 'OD';
    const posted = e.status === 'ready';
    const number = posted ? (counters.get(journalCode) ?? 0) + 1 : null;
    if (number !== null) counters.set(journalCode, number);
    const p: ReportingPersistence = {
      id: `${prefix}${k}`,
      journalCode,
      fiscalYear: 2026,
      number,
      status: posted ? 'posted' : 'awaiting_rate',
      postedOn: posted ? e.date : null,
    };
    return toReportingEntry(e, p);
  });
}

const TEMPLATE: StatementTemplateView = {
  kind: 'balance_sheet',
  label: 'Bilan (test)',
  confirmation: 'to_confirm',
  sections: [
    {
      code: 'A',
      label: 'Actif',
      confirmation: 'to_confirm',
      rubrics: [
        {
          code: 'A1',
          label: 'Tiers et trésorerie',
          confirmation: 'to_confirm',
          normalBalance: 'debit',
          accounts: [{ from: '4', to: '5' }],
        },
      ],
    },
  ],
  coverage: [{ from: '1', to: '5' }],
};

interface Books {
  balanced: boolean;
  closing: Map<string, bigint>;
  perCurrency: Map<string, { debit: bigint; credit: bigint }>;
  perAccountCurrency: Map<string, bigint>;
}

/** Passe K3 complet ; rend les soldes pour les contrôles. */
function restitute(entries: readonly ReportingEntry[], bookCurrency: AccountingCurrency): Books {
  const period = { entries, bookCurrency, from: FROM, to: TO };
  const trial = computeTrialBalance(period);
  const ledger = computeLedger(period);
  computeStatement(trial, TEMPLATE, 'balance_sheet', { reserves: [] });
  const exp = exportRows({
    ...period,
    mode: 'simulation',
    chartPack: { slug: 'syscohada-revise-2017-cd', version: 1 },
    reserves: [],
  });
  expect(exp.totals.debit).toBe(exp.totals.credit);
  expect(exp.totals.debit).toBe(trial.totals.periodDebit);
  const posted = entries.filter((e) => e.status === 'posted');
  expect(exp.totals.lineCount).toBe(posted.reduce((s, e) => s + e.lines.length, 0));

  const perCurrency = new Map<string, { debit: bigint; credit: bigint }>();
  const perAccountCurrency = new Map<string, bigint>();
  for (const a of ledger.accounts) {
    for (const c of a.byCurrency) {
      const t = perCurrency.get(c.currency) ?? { debit: 0n, credit: 0n };
      t.debit += cents(c.debit);
      t.credit += cents(c.credit);
      perCurrency.set(c.currency, t);
      perAccountCurrency.set(`${a.accountNumber}|${c.currency}`, cents(c.balance));
    }
  }
  return {
    balanced: trial.balanced && trial.unbalancedEntries.length === 0,
    closing: new Map(trial.rows.map((row) => [row.accountNumber, cents(row.closingBalance)])),
    perCurrency,
    perAccountCurrency,
  };
}

describe('ADR-0049 — raccord K2/K3 : toReportingEntry', () => {
  const ctx = context({
    bookCurrency: 'USD',
    enteredRates: [{ date: '2026-10-15', from: 'CDF', to: 'USD', rate: '0.00035714' }],
  });

  it('côté inactif à null, clé d’opération, motif d’attente et pièce à lettrer recopiés', () => {
    const [entry] = entriesForSalesInvoice(
      {
        id: 'inv1',
        number: 'FV-1',
        status: 'normalized',
        type: 'FV',
        series: 'real',
        date: '2026-10-15',
        currency: 'CDF',
        customerId: 'c1',
        customerName: 'Client Un',
        groups: [
          { group: 'B', ht: '100000.00', vat: '0.10', total: '100000.10', specificTax: '0.00' },
        ],
        lines: [{ taxGroup: 'B', itemType: 'SER', amount: '100000.00' }],
        total: '100000.10',
        payments: [{ method: 'CREDIT', amount: '100000.10' }],
        conversion: null,
      },
      ctx,
    ).entries;
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const view = toReportingEntry(entry, {
      id: 'e1',
      journalCode: 'VE',
      fiscalYear: 2026,
      number: 7,
      status: 'posted',
      postedOn: '2026-10-16',
    });
    expect(view).toMatchObject({
      id: 'e1',
      journalCode: 'VE',
      number: 7,
      status: 'posted',
      bookCurrency: 'USD',
      sourceKey: entry.sourceKey,
      postedOn: '2026-10-16',
      source: { kind: 'sales_invoice', id: 'inv1', number: 'FV-1' },
    });
    entry.lines.forEach((l, i) => {
      const v = view.lines[i];
      expect(v?.operationKey).toBe(l.operationKey);
      expect(v?.suspenseReason).toBe(l.suspenseReason);
      expect(v?.documentRef).toBe(l.matchRef);
      expect(v?.amount).toBe(l.amount);
      expect(l.side === 'debit' ? v?.credit : v?.debit).toBeNull();
      expect(l.side === 'debit' ? v?.debit : v?.credit).toBe(l.bookAmount);
    });
    // La TVA de 0,10 CDF vaut 0,00 USD : côté gardé, ligne lue, comptée pour 0.
    const vat = view.lines.findIndex((l) => l.operationKey === 'sale.invoice.vat.B');
    expect(view.lines[vat]).toMatchObject({ credit: '0.00', debit: null, amount: '0.10' });
    expect(parseLine(view, vat)).toMatchObject({ book: 0n, doc: -10n });
    expect(view.lines[0]?.documentRef).toBe('sales_invoice:inv1');
  });

  it('refuse un statut contradictoire et un côté incohérent', () => {
    const [awaiting] = entriesForSalesInvoice(
      {
        id: 'inv2',
        number: null,
        status: 'normalized',
        type: 'FV',
        series: 'real',
        date: '2026-10-20',
        currency: 'CDF',
        customerId: 'c1',
        customerName: null,
        groups: [{ group: 'B', ht: '10.00', vat: '0.00', total: '10.00', specificTax: '0.00' }],
        lines: [{ taxGroup: 'B', itemType: 'SER', amount: '10.00' }],
        total: '10.00',
        payments: [{ method: 'CREDIT', amount: '10.00' }],
        conversion: null,
      },
      ctx,
    ).entries;
    if (awaiting === undefined) throw new Error('écriture attendue');
    expect(awaiting.status).toBe('awaiting_rate');
    const p = { id: 'x', journalCode: 'VE', fiscalYear: 2026, number: null } as const;
    expect(() => toReportingEntry(awaiting, { ...p, status: 'posted' })).toThrow(RangeError);
    const view = toReportingEntry(awaiting, { ...p, status: 'awaiting_rate' });
    expect(view.lines.every((l) => l.debit === null && l.credit === null)).toBe(true);

    const ready = entriesForSalesInvoice(
      {
        id: 'inv3',
        number: null,
        status: 'normalized',
        type: 'FV',
        series: 'real',
        date: '2026-10-15',
        currency: 'USD',
        customerId: 'c1',
        customerName: null,
        groups: [{ group: 'B', ht: '10.00', vat: '0.00', total: '10.00', specificTax: '0.00' }],
        lines: [{ taxGroup: 'B', itemType: 'SER', amount: '10.00' }],
        total: '10.00',
        payments: [{ method: 'CREDIT', amount: '10.00' }],
        conversion: null,
      },
      ctx,
    ).entries[0];
    if (ready === undefined) throw new Error('écriture attendue');
    expect(() => toReportingEntry(ready, { ...p, status: 'awaiting_rate' })).toThrow(RangeError);
    const broken = {
      ...ready,
      lines: ready.lines.map((l, i) => (i === 0 ? { ...l, credit: l.bookAmount } : l)),
    };
    expect(() => toReportingEntry(broken, { ...p, status: 'posted' })).toThrow(RangeError);
  });
});

describe('ADR-0049 — K3 : assouplissements explicites de parseLine', () => {
  const base: ReportingEntry = {
    id: 'e',
    journalCode: 'OD',
    fiscalYear: 2026,
    number: 1,
    date: '2026-10-15',
    status: 'posted',
    bookCurrency: 'USD',
    source: null,
    sourceKey: null,
    lines: [],
  };
  const line = (o: Partial<ReportingEntry['lines'][number]>): ReportingEntry => ({
    ...base,
    lines: [
      {
        accountNumber: '411',
        auxiliaryAccountNumber: null,
        label: 'l',
        debit: '0.00',
        credit: null,
        currency: 'CDF',
        amount: '0.10',
        ...o,
      },
    ],
  });

  it('ligne convertie à 0,00 en tenue : admise, montant en devise compté', () => {
    expect(parseLine(line({}), 0)).toMatchObject({ book: 0n, debit: 0n, doc: 10n });
  });
  it('ligne à 0,00 en tenue refusée dans la monnaie de tenue ou sans monnaie de tenue', () => {
    expect(() => parseLine(line({ currency: 'USD' }), 0)).toThrow(/strictement positif/);
    expect(() => parseLine({ ...line({}), bookCurrency: null }, 0)).toThrow(/strictement positif/);
  });
  it('montant en devise nul : admis pour un écart de change seulement, tenue > 0 exigée', () => {
    expect(
      parseLine(line({ amount: '0.00', debit: '1.00', exchangeDifference: true }), 0),
    ).toMatchObject({ book: 100n, doc: 0n });
    expect(() => parseLine(line({ amount: '0.00', debit: '1.00' }), 0)).toThrow(/en devise/);
    expect(() => parseLine(line({ amount: '0.00', exchangeDifference: true }), 0)).toThrow(
      /strictement positif/,
    );
    expect(() => parseLine(line({ amount: '0.00' }), 0)).toThrow(/strictement positif/);
  });
  it('un seul côté non nul reste exigé', () => {
    expect(() => parseLine(line({ credit: '0.00' }), 0)).toThrow(/soit un débit/);
    expect(() => parseLine(line({ debit: null }), 0)).toThrow(/soit un débit/);
  });
});

describe('ADR-0049 — raccord K2/K3 : propriétés de bout en bout à graine fixe', () => {
  it(
    'balances de tenue et par devise équilibrées ; la contre-passation ramène tout à zéro',
    HEAVY,
    () => {
      const r = rng(SEED);
      let zeroBook = 0;
      let exchange = 0;
      let posted = 0;
      let awaiting = 0;
      for (let i = 0; i < RUNS; i += 1) {
        const ctx = randomContext(r);
        const proposed = randomEntries(r, i, ctx);
        const entries = persist(proposed, `r${i}-`);
        for (const e of entries) {
          if (e.status !== 'posted') {
            awaiting += 1;
            continue;
          }
          posted += 1;
          for (const l of e.lines) {
            if (l.exchangeDifference === true) exchange += 1;
            if ((l.debit ?? l.credit) === '0.00') zeroBook += 1;
          }
        }

        const books = restitute(entries, ctx.bookCurrency);
        expect(books.balanced, `graine ${SEED}, tirage ${i}`).toBe(true);
        for (const [currency, t] of books.perCurrency) {
          expect(t.debit, `graine ${SEED}, tirage ${i}, ${currency}`).toBe(t.credit);
        }

        const reversals = proposed.map((e) =>
          reverseEntry(e, { sourceKey: `${e.sourceKey}:rev`, reason: 'MANUAL' }),
        );
        const both = [...entries, ...persist(reversals, `v${i}-`)];
        const net = restitute(both, ctx.bookCurrency);
        expect(net.balanced).toBe(true);
        for (const [account, balance] of net.closing) {
          expect(balance, `graine ${SEED}, tirage ${i}, ${account}`).toBe(0n);
        }
        for (const [key, balance] of net.perAccountCurrency) {
          expect(balance, `graine ${SEED}, tirage ${i}, ${key}`).toBe(0n);
        }
      }
      // Le générateur couvre bien les cas du raccord.
      expect(posted).toBeGreaterThan(RUNS * 3);
      expect(awaiting).toBeGreaterThan(20);
      expect(zeroBook).toBeGreaterThan(80);
      expect(exchange).toBeGreaterThan(40);
    },
  );
});
