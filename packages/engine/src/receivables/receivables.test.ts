// Encaissements, statut de règlement, agrégats et réalisé issu des ventes (ADR-0031).
// Attendus calculés à la main.

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  aggregateReceiptsByMonth,
  aggregateRevenueByMonth,
  checkReceipt,
  computeSettlement,
  fiscalPeriodOfMonth,
  isCalendarDate,
  isCalendarMonth,
  planRunActuals,
  RECEIPT_METHODS,
  RECEIVABLES_VERSION,
  revenueAmountsFor,
  revenueBaseOf,
  signedAmountToJsonNumber,
  type RevenueDocumentInput,
} from '../index.js';

const codes = (r: { issues: readonly { code: string }[] }) => r.issues.map((i) => i.code);

describe('checkReceipt', () => {
  const base = {
    amount: '150.00',
    method: 'VIREMENT',
    allocations: [{ invoiceId: 'f1', amount: '150.00' }],
    outstandingByInvoice: { f1: '200.00', f2: '50.00' },
  };

  it('accepte un encaissement partiel entièrement lettré', () => {
    expect(checkReceipt(base)).toEqual({ ok: true, issues: [] });
  });

  it('les six moyens de règlement excluent CREDIT', () => {
    expect([...RECEIPT_METHODS]).toEqual([
      'ESPECES',
      'VIREMENT',
      'CARTEBANCAIRE',
      'MOBILEMONEY',
      'CHEQUES',
      'AUTRE',
    ]);
    expect(codes(checkReceipt({ ...base, method: 'CREDIT' }))).toEqual(['RECEIPT_METHOD_INVALID']);
  });

  it('multi-factures : la somme exacte des lettrages égale le montant (0,10 + 0,20 = 0,30)', () => {
    const r = checkReceipt({
      ...base,
      amount: '0.30',
      allocations: [
        { invoiceId: 'f1', amount: '0.10' },
        { invoiceId: 'f2', amount: '0.20' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('rend tous les problèmes d’un coup', () => {
    const r = checkReceipt({
      amount: '100.00',
      method: 'TROC',
      allocations: [
        { invoiceId: 'f1', amount: '60.00' },
        { invoiceId: 'f1', amount: '0' },
        { invoiceId: 'f2', amount: '60.00' },
      ],
      outstandingByInvoice: base.outstandingByInvoice,
    });
    expect(codes(r)).toEqual([
      'RECEIPT_METHOD_INVALID',
      'RECEIPT_ALLOCATION_INVALID',
      'RECEIPT_ALLOCATION_DUPLICATE',
      'RECEIPT_ALLOCATION_EXCEEDS_BALANCE',
    ]);
    const depasse = r.issues.find((i) => i.code === 'RECEIPT_ALLOCATION_EXCEEDS_BALANCE');
    expect(depasse).toMatchObject({ allocationIndex: 2, details: { outstanding: '50.00' } });
  });

  it('somme des lettrages différente du montant → RECEIPT_ALLOCATIONS_MISMATCH', () => {
    const r = checkReceipt({ ...base, amount: '150.01' });
    expect(codes(r)).toEqual(['RECEIPT_ALLOCATIONS_MISMATCH']);
    expect(r.issues[0]?.details).toEqual({ allocated: '150.00', amount: '150.01' });
  });

  it('montant nul, négatif ou trop précis ; aucun lettrage', () => {
    for (const amount of ['0', '0.00', '-5.00', '1.005', '1e3', '']) {
      expect(codes(checkReceipt({ ...base, amount }))).toContain('RECEIPT_AMOUNT_INVALID');
    }
    expect(codes(checkReceipt({ ...base, allocations: [] }))).toEqual(['RECEIPT_NO_ALLOCATION']);
  });

  it('une facture non résolue par l’appelant est une erreur de programmation', () => {
    expect(() =>
      checkReceipt({ ...base, allocations: [{ invoiceId: 'inconnue', amount: '1.00' }] }),
    ).toThrow(RangeError);
  });
});

describe('computeSettlement', () => {
  const s = (over: Partial<Parameters<typeof computeSettlement>[0]> = {}) =>
    computeSettlement({
      amountOnCredit: '200.00',
      creditNoteCredits: [],
      allocations: [],
      dueDate: null,
      asOf: '2026-10-21',
      ...over,
    });

  it('réglée entièrement à l’émission (aucune part CREDIT) → payée', () => {
    expect(s({ amountOnCredit: '0.00' })).toMatchObject({ status: 'paid', outstanding: '0.00' });
  });

  it('non payée, partiellement payée, payée', () => {
    expect(s()).toMatchObject({ status: 'unpaid', outstanding: '200.00', received: '0.00' });
    expect(s({ allocations: ['50.00', '0.10'] })).toMatchObject({
      status: 'partially_paid',
      received: '50.10',
      outstanding: '149.90',
    });
    expect(s({ allocations: ['50.00', '150.00'] })).toMatchObject({
      status: 'paid',
      outstanding: '0.00',
      creditBalance: '0.00',
      version: RECEIVABLES_VERSION,
    });
  });

  it('en retard seulement avec une échéance dépassée et un reste', () => {
    expect(s({ dueDate: '2026-10-20' })).toMatchObject({ status: 'overdue', overdue: true });
    expect(s({ dueDate: '2026-10-21' })).toMatchObject({ status: 'unpaid', overdue: false });
    expect(s({ dueDate: '2026-10-20', allocations: ['10.00'] })).toMatchObject({
      status: 'overdue',
      received: '10.00',
    });
    expect(s({ dueDate: '2026-01-01', allocations: ['200.00'] })).toMatchObject({
      status: 'paid',
      overdue: false,
    });
  });

  it('sans échéance, jamais en retard (aucun délai inventé)', () => {
    expect(s({ asOf: '2099-12-31' })).toMatchObject({ status: 'unpaid', overdue: false });
  });

  it('un avoir à crédit réduit le reste ; l’excédent devient un crédit client', () => {
    expect(s({ creditNoteCredits: ['80.00'] })).toMatchObject({
      status: 'partially_paid',
      credited: '80.00',
      outstanding: '120.00',
    });
    expect(s({ creditNoteCredits: ['80.00'], allocations: ['200.00'] })).toMatchObject({
      status: 'paid',
      outstanding: '0.00',
      creditBalance: '80.00',
    });
  });

  it('refuse une date illisible', () => {
    expect(() => s({ asOf: '2026-02-30' })).toThrow(RangeError);
    expect(() => s({ dueDate: '21/10/2026' })).toThrow(RangeError);
  });
});

describe('calendrier', () => {
  it('dates et mois civils', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarMonth('2026-10')).toBe(true);
    expect(isCalendarMonth('2026-00')).toBe(false);
  });

  it('mois civil → exercice et mois d’exercice', () => {
    expect(fiscalPeriodOfMonth('2026-07', '2026-07')).toEqual({ year: 1, month: 1 });
    expect(fiscalPeriodOfMonth('2027-06', '2026-07')).toEqual({ year: 1, month: 12 });
    expect(fiscalPeriodOfMonth('2027-07', '2026-07')).toEqual({ year: 2, month: 1 });
    expect(fiscalPeriodOfMonth('2031-06', '2026-07')).toEqual({ year: 5, month: 12 });
    expect(fiscalPeriodOfMonth('2031-07', '2026-07')).toBeNull();
    expect(fiscalPeriodOfMonth('2026-06', '2026-07')).toBeNull();
  });
});

describe('aggregateReceiptsByMonth', () => {
  it('par mois et par devise, jamais de somme entre devises', () => {
    expect(
      aggregateReceiptsByMonth([
        { receivedOn: '2026-10-31', currency: 'USD', amount: '0.10' },
        { receivedOn: '2026-11-01', currency: 'USD', amount: '5.00' },
        { receivedOn: '2026-10-01', currency: 'CDF', amount: '1000.00' },
        { receivedOn: '2026-10-15', currency: 'USD', amount: '0.20' },
      ]),
    ).toEqual([
      { month: '2026-10', currency: 'CDF', total: '1000.00', count: 1 },
      { month: '2026-10', currency: 'USD', total: '0.30', count: 2 },
      { month: '2026-11', currency: 'USD', total: '5.00', count: 1 },
    ]);
  });

  it('liste vide → aucun mois', () => {
    expect(aggregateReceiptsByMonth([])).toEqual([]);
  });
});

const doc = (over: Partial<RevenueDocumentInput> & { id: string }): RevenueDocumentInput => ({
  issuedOn: '2026-10-05',
  kind: 'invoice',
  document: {
    currency: 'USD',
    groups: [
      { group: 'B', ht: '100.00' },
      { group: 'L', ht: '7.00' },
    ],
  },
  normalized: null,
  ...over,
});

describe('chiffre d’affaires des ventes', () => {
  it('somme des bases HT hors groupes H, I, J, L, N', () => {
    expect(
      revenueBaseOf([
        { group: 'A', ht: '1.00' },
        { group: 'B', ht: '100.00' },
        { group: 'H', ht: '2.00' },
        { group: 'I', ht: '3.00' },
        { group: 'J', ht: '4.00' },
        { group: 'K', ht: '10.00' },
        { group: 'L', ht: '5.00' },
        { group: 'N', ht: '6.00' },
      ]),
    ).toBe('111.00');
  });

  it('devise : document, CDF normalisé, ou non convertible — jamais de taux', () => {
    const usd = doc({ id: 'u' });
    const normalisee = doc({
      id: 'n',
      normalized: { currency: 'CDF', groups: [{ group: 'B', ht: '226232.00' }] },
    });
    expect(revenueAmountsFor(usd, 'USD')).toEqual({
      ok: true,
      currency: 'USD',
      ht: '100.00',
      source: 'document',
    });
    expect(revenueAmountsFor(usd, 'CDF')).toEqual({
      ok: false,
      reason: 'CURRENCY_NOT_CONVERTIBLE',
    });
    expect(revenueAmountsFor(normalisee, 'CDF')).toMatchObject({
      ht: '226232.00',
      source: 'normalized',
    });
    expect(revenueAmountsFor(normalisee, 'USD')).toMatchObject({
      ht: '100.00',
      source: 'document',
    });
    expect(revenueAmountsFor(usd, 'EUR').ok).toBe(false);
  });

  it('factures moins avoirs, par mois ; acomptes à part ; un mois non convertible est nul', () => {
    const months = aggregateRevenueByMonth(
      [
        doc({ id: 'f1' }),
        doc({
          id: 'a1',
          kind: 'credit_note',
          document: { currency: 'USD', groups: [{ group: 'B', ht: '30.00' }] },
        }),
        doc({ id: 't1', kind: 'deposit' }),
        doc({ id: 'f2', issuedOn: '2026-11-02' }),
        doc({
          id: 'c1',
          issuedOn: '2026-11-03',
          document: { currency: 'CDF', groups: [{ group: 'B', ht: '9.00' }] },
        }),
        doc({ id: 'a2', issuedOn: '2026-12-01', kind: 'credit_note' }),
      ],
      'USD',
    );
    expect(months).toEqual([
      {
        month: '2026-10',
        currency: 'USD',
        revenueHt: '70.00',
        invoicesHt: '100.00',
        creditNotesHt: '30.00',
        invoiceIds: ['f1'],
        creditNoteIds: ['a1'],
        depositIds: ['t1'],
        nonConvertibleIds: [],
      },
      {
        month: '2026-11',
        currency: 'USD',
        revenueHt: null,
        invoicesHt: '100.00',
        creditNotesHt: '0.00',
        invoiceIds: ['f2'],
        creditNoteIds: [],
        depositIds: [],
        nonConvertibleIds: ['c1'],
      },
      {
        month: '2026-12',
        currency: 'USD',
        revenueHt: '-100.00',
        invoicesHt: '0.00',
        creditNotesHt: '100.00',
        invoiceIds: [],
        creditNoteIds: ['a2'],
        depositIds: [],
        nonConvertibleIds: [],
      },
    ]);
  });
});

describe('planRunActuals', () => {
  const documents = [
    doc({ id: 'f-oct' }),
    doc({ id: 'f-jun', issuedOn: '2026-06-30' }),
    doc({ id: 'f-nov', issuedOn: '2026-11-10' }),
    doc({
      id: 'c-nov',
      issuedOn: '2026-11-11',
      document: { currency: 'CDF', groups: [{ group: 'B', ht: '1.00' }] },
    }),
    doc({ id: 't-dec', issuedOn: '2026-12-01', kind: 'deposit' }),
    doc({ id: 'f-2032', issuedOn: '2032-01-15' }),
  ];
  const input = {
    documents,
    projectCurrency: 'USD',
    exerciseStart: '2026-07',
    revenueLineId: 'ca',
  };

  it('valeur par mois d’exercice et raisons de non-report', () => {
    expect(planRunActuals(input)).toEqual({
      version: RECEIVABLES_VERSION,
      periods: [
        {
          calendarMonth: '2026-10',
          year: 1,
          month: 4,
          values: { ca: '100.00' },
          documentIds: ['f-oct'],
        },
      ],
      skipped: [
        {
          calendarMonth: '2026-06',
          reason: 'OUTSIDE_PLAN_HORIZON',
          fiscal: null,
          documentIds: ['f-jun'],
        },
        {
          calendarMonth: '2026-11',
          reason: 'CURRENCY_NOT_CONVERTIBLE',
          fiscal: { year: 1, month: 5 },
          documentIds: ['c-nov'],
        },
        {
          calendarMonth: '2032-01',
          reason: 'OUTSIDE_PLAN_HORIZON',
          fiscal: null,
          documentIds: ['f-2032'],
        },
      ],
      excludedDepositIds: ['t-dec'],
    });
  });

  it('déterministe et indifférent à l’ordre : base de l’idempotence', () => {
    const a = planRunActuals(input);
    const b = planRunActuals({ ...input, documents: [...documents].reverse() });
    expect(b).toEqual(a);
  });

  it('aucune vente → aucune période (pas de zéro inventé)', () => {
    expect(planRunActuals({ ...input, documents: [] }).periods).toEqual([]);
  });

  it('début d’exercice illisible → erreur', () => {
    expect(() => planRunActuals({ ...input, exerciseStart: '2026-7' })).toThrow(RangeError);
  });
});

describe('frontière JSON', () => {
  it('montant signé → nombre JSON', () => {
    expect(signedAmountToJsonNumber('-100.50')).toBe(-100.5);
    expect(signedAmountToJsonNumber('0.00')).toBe(0);
    expect(() => signedAmountToJsonNumber('1e3')).toThrow(RangeError);
  });
});

describe('lecture des sources', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('aucun import hors du moteur, aucune horloge', () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const m of source.matchAll(/from '([^']+)'/g)) {
        expect(m[1], file).toMatch(/^\.\.?\/(invoice-totals\/)?[\w.-]+\.js$/);
      }
      expect(source, file).not.toMatch(/new Date|Date\.now|performance\.now/);
    }
  });

  it('aucun parseFloat ni toFixed pour un montant', () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      expect(source, file).not.toMatch(/parseFloat|\.toFixed\(/);
    }
  });
});
