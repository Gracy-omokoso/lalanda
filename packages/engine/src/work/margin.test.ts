// Marge par projet (ADR-0039 § 5) — cas littéraux et propriétés.
//
// Les propriétés recoupent le moteur par une arithmétique de contrôle propre au
// test (centimes entiers obtenus en retirant le point), indépendante de
// `money.ts`, avec un générateur pseudo-aléatoire à graine fixe : un échec est
// rejouable à l'identique.

import { describe, expect, it } from 'vitest';

import {
  WORK_MARGIN_VERSION,
  computeProjectMargin,
  type ProjectMarginInput,
  type WorkMarginCreditNoteInput,
  type WorkMarginInvoiceInput,
} from '../index.js';

const base = (over: Partial<ProjectMarginInput> = {}): ProjectMarginInput => ({
  invoices: [],
  creditNotes: [],
  expenses: [],
  timeEntries: [],
  rates: [],
  from: null,
  to: null,
  ...over,
});

const invoice = (over: Partial<WorkMarginInvoiceInput> = {}): WorkMarginInvoiceInput => ({
  id: 'f1',
  currency: 'USD',
  final: true,
  issuedOn: '2026-10-01',
  payments: [
    { method: 'MOBILEMONEY', amount: '46.40' },
    { method: 'CREDIT', amount: '46.40' },
  ],
  allocations: [{ receivedOn: '2026-10-10', amount: '46.40' }],
  taxGroups: [{ group: 'B', ht: '80.00' }],
  ...over,
});

const creditNote = (over: Partial<WorkMarginCreditNoteInput> = {}): WorkMarginCreditNoteInput => ({
  id: 'a1',
  currency: 'USD',
  final: true,
  issuedOn: '2026-10-15',
  payments: [{ method: 'ESPECES', amount: '10.00' }],
  taxGroups: [{ group: 'B', ht: '8.62' }],
  ...over,
});

const findingCodes = (r: ReturnType<typeof computeProjectMargin>): string[] =>
  r.findings.map((f) => f.code);

describe('computeProjectMargin — critère 14 d’ADR-0039', () => {
  const input = base({
    invoices: [invoice()],
    expenses: [
      { id: 'd1', currency: 'USD', spentOn: '2026-10-05', amount: '20.00' },
      { id: 'd2', currency: 'CDF', spentOn: '2026-10-06', amount: '10000.00' },
    ],
    timeEntries: [
      { userId: 'u1', workedOn: '2026-10-02', minutes: 90 },
      { userId: 'u2', workedOn: '2026-10-02', minutes: 30 },
    ],
    rates: [{ userId: 'u1', currency: 'USD', hourlyCost: '12.50', effectiveFrom: '2026-01-01' }],
  });
  const r = computeProjectMargin(input);

  it('USD : encaissé 92,80 (moitié à l’émission, moitié encaissée), temps 18,75, marge 54,05', () => {
    expect(r.version).toBe(WORK_MARGIN_VERSION);
    expect(r.currencies.find((c) => c.currency === 'USD')).toEqual({
      currency: 'USD',
      received: '92.80',
      refunded: '0.00',
      expenses: '20.00',
      timeCost: '18.75',
      margin: '54.05',
      invoicedExclTax: '80.00',
      invoiceCount: 1,
      expenseCount: 1,
      timeMinutes: 90,
    });
  });

  it('CDF : seconde devise, jamais additionnée ; constats MULTI_CURRENCY et TIME_WITHOUT_RATE', () => {
    expect(r.currencies.map((c) => c.currency)).toEqual(['CDF', 'USD']);
    expect(r.currencies[0]).toMatchObject({ expenses: '10000.00', margin: '-10000.00' });
    expect(r.minutesWithoutRate).toBe(30);
    expect(r.findings).toEqual([
      { code: 'MULTI_CURRENCY', count: 2 },
      { code: 'TIME_WITHOUT_RATE', minutes: 30 },
      { code: 'AMOUNTS_INCLUDE_TAX' },
    ]);
    expect(r.byMember).toEqual([{ userId: 'u1', currency: 'USD', minutes: 90, cost: '18.75' }]);
  });

  it('pur : l’entrée n’est pas modifiée et le calcul est reproductible', () => {
    const copy = JSON.parse(JSON.stringify(input));
    expect(computeProjectMargin(input)).toEqual(r);
    expect(input).toEqual(copy);
  });
});

describe('coût du temps', () => {
  it('un seul arrondi par devise : 3 × 1 min à 0,20/h = 0,01 (et non 3 × 0,00)', () => {
    const r = computeProjectMargin(
      base({
        timeEntries: [1, 2, 3].map(() => ({ userId: 'u', workedOn: '2026-10-01', minutes: 1 })),
        rates: [{ userId: 'u', currency: 'CDF', hourlyCost: '0.20', effectiveFrom: '2026-01-01' }],
      }),
    );
    // 3 × 20 centimes-minute = 60 → 1 centime ; arrondir chaque ligne donnerait 0.
    expect(r.currencies[0]?.timeCost).toBe('0.01');
  });

  it('demi vers le haut : 1 min à 0,30/h = 0,5 centime → 0,01', () => {
    const r = computeProjectMargin(
      base({
        timeEntries: [{ userId: 'u', workedOn: '2026-10-01', minutes: 1 }],
        rates: [{ userId: 'u', currency: 'USD', hourlyCost: '0.30', effectiveFrom: '2026-01-01' }],
      }),
    );
    expect(r.currencies[0]?.timeCost).toBe('0.01');
  });

  it('taux par période : le plus récent ≤ jour travaillé, devise comprise', () => {
    const r = computeProjectMargin(
      base({
        timeEntries: [
          { userId: 'u', workedOn: '2026-01-31', minutes: 60 },
          { userId: 'u', workedOn: '2026-02-01', minutes: 60 },
          { userId: 'u', workedOn: '2026-06-15', minutes: 60 },
          { userId: 'u', workedOn: '2025-12-31', minutes: 45 },
        ],
        rates: [
          { userId: 'u', currency: 'USD', hourlyCost: '20.00', effectiveFrom: '2026-02-01' },
          { userId: 'u', currency: 'USD', hourlyCost: '10.00', effectiveFrom: '2026-01-01' },
          { userId: 'u', currency: 'CDF', hourlyCost: '50000.00', effectiveFrom: '2026-06-01' },
        ],
      }),
    );
    expect(r.currencies).toMatchObject([
      { currency: 'CDF', timeCost: '50000.00', timeMinutes: 60 },
      { currency: 'USD', timeCost: '30.00', timeMinutes: 120 },
    ]);
    expect(r.minutesWithoutRate).toBe(45);
    expect(r.byMember).toEqual([
      { userId: 'u', currency: 'CDF', minutes: 60, cost: '50000.00' },
      { userId: 'u', currency: 'USD', minutes: 120, cost: '30.00' },
    ]);
  });

  it('sans aucun taux : aucune devise créée, minutes signalées, jamais un coût nul', () => {
    const r = computeProjectMargin(
      base({ timeEntries: [{ userId: 'u', workedOn: '2026-10-01', minutes: 120 }] }),
    );
    expect(r.currencies).toEqual([]);
    expect(r.minutesWithoutRate).toBe(120);
    expect(findingCodes(r)).toContain('TIME_WITHOUT_RATE');
  });

  it('refuse des minutes non entières et deux taux à la même date', () => {
    expect(() =>
      computeProjectMargin(
        base({ timeEntries: [{ userId: 'u', workedOn: '2026-10-01', minutes: 1.5 }] }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      computeProjectMargin(
        base({
          rates: [
            { userId: 'u', currency: 'USD', hourlyCost: '1.00', effectiveFrom: '2026-01-01' },
            { userId: 'u', currency: 'CDF', hourlyCost: '1.00', effectiveFrom: '2026-01-01' },
          ],
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe('factures, avoirs, dépenses', () => {
  it('factures non finales ignorées et comptées ; aucune facture : NO_INVOICE_LINKED', () => {
    const r = computeProjectMargin(
      base({ invoices: [invoice({ final: false, issuedOn: null }), invoice({ id: 'f2' })] }),
    );
    expect(r.currencies[0]).toMatchObject({ received: '92.80', invoiceCount: 1 });
    expect(r.findings).toContainEqual({ code: 'DRAFT_INVOICES_IGNORED', count: 1 });
    expect(findingCodes(computeProjectMargin(base()))).toEqual([
      'NO_INVOICE_LINKED',
      'AMOUNTS_INCLUDE_TAX',
    ]);
  });

  it('avoir remboursé : sa part non CREDIT est retranchée ; sa part CREDIT ne l’est pas', () => {
    const r = computeProjectMargin(
      base({
        invoices: [invoice()],
        creditNotes: [
          creditNote(),
          creditNote({ id: 'a2', payments: [{ method: 'CREDIT', amount: '5.00' }] }),
          creditNote({ id: 'a3', final: false, issuedOn: null }),
        ],
      }),
    );
    expect(r.currencies[0]).toMatchObject({
      received: '92.80',
      refunded: '10.00',
      margin: '82.80',
      invoicedExclTax: '62.76',
    });
  });

  it('période : jour d’émission, d’encaissement, de dépense et de travail, bornes incluses', () => {
    const r = computeProjectMargin(
      base({
        invoices: [invoice()],
        expenses: [
          { id: 'd1', currency: 'USD', spentOn: '2026-10-09', amount: '1.00' },
          { id: 'd2', currency: 'USD', spentOn: '2026-10-10', amount: '2.00' },
        ],
        timeEntries: [
          { userId: 'u', workedOn: '2026-10-01', minutes: 60 },
          { userId: 'u', workedOn: '2026-10-10', minutes: 60 },
        ],
        rates: [{ userId: 'u', currency: 'USD', hourlyCost: '6.00', effectiveFrom: '2026-01-01' }],
        from: '2026-10-10',
        to: '2026-10-10',
      }),
    );
    // Émission (01/10) hors période : seul l'encaissement du 10/10 compte.
    expect(r.currencies[0]).toMatchObject({
      received: '46.40',
      expenses: '2.00',
      expenseCount: 1,
      timeCost: '6.00',
      timeMinutes: 60,
      invoicedExclTax: '0.00',
      margin: '38.40',
    });
    expect(r).toMatchObject({ from: '2026-10-10', to: '2026-10-10' });
  });

  it('marge négative signée ; entrées invalides refusées', () => {
    const r = computeProjectMargin(
      base({ expenses: [{ id: 'd', currency: 'USD', spentOn: '2026-10-01', amount: '5.5' }] }),
    );
    expect(r.currencies[0]?.margin).toBe('-5.50');
    expect(() =>
      computeProjectMargin(
        base({ expenses: [{ id: 'd', currency: 'USD', spentOn: '2026-10-01', amount: '1.234' }] }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      computeProjectMargin(base({ invoices: [invoice({ currency: 'EUR' as 'USD' })] })),
    ).toThrow(RangeError);
    expect(() => computeProjectMargin(base({ from: '2026-10-10', to: '2026-10-01' }))).toThrow(
      RangeError,
    );
  });
});

// ── Propriétés : marge = somme des composantes, arithmétique de contrôle ─────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const cents = (v: string): bigint => {
  const neg = v.startsWith('-');
  const [i, d = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(`${i}${d.padEnd(2, '0')}`);
  return neg ? -c : c;
};
const str = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};

describe('propriétés (graine fixe)', () => {
  it('pour 200 projets tirés au hasard, chaque devise vérifie l’égalité et l’arrondi unique', () => {
    const rand = rng(20261029);
    const amount = () => str(BigInt(Math.floor(rand() * 1_000_000)));
    const cur = () => (rand() < 0.5 ? 'CDF' : 'USD') as 'CDF' | 'USD';
    for (let n = 0; n < 200; n += 1) {
      const rates = ['u1', 'u2', 'u3'].map((u) => ({
        userId: u,
        currency: cur(),
        hourlyCost: str(BigInt(1 + Math.floor(rand() * 5_000_000))),
        effectiveFrom: '2026-01-01',
      }));
      const input = base({
        invoices: Array.from({ length: Math.floor(rand() * 3) }, (_, i) =>
          invoice({
            id: `f${i}`,
            currency: cur(),
            payments: [{ method: 'ESPECES', amount: amount() }],
            allocations: [{ receivedOn: '2026-10-02', amount: amount() }],
          }),
        ),
        expenses: Array.from({ length: Math.floor(rand() * 4) }, (_, i) => ({
          id: `d${i}`,
          currency: cur(),
          spentOn: '2026-10-03',
          amount: amount(),
        })),
        timeEntries: Array.from({ length: Math.floor(rand() * 6) }, () => ({
          userId: ['u1', 'u2', 'u3', 'u4'][Math.floor(rand() * 4)] as string,
          workedOn: '2026-10-04',
          minutes: 1 + Math.floor(rand() * 1440),
        })),
        rates,
      });
      const r = computeProjectMargin(input);
      for (const c of r.currencies) {
        expect(cents(c.margin)).toBe(
          cents(c.received) - cents(c.refunded) - cents(c.expenses) - cents(c.timeCost),
        );
        // Coût de contrôle : Σ minutes × centimes, arrondi une fois.
        let exact = 0n;
        for (const e of input.timeEntries) {
          const rate = rates.find((x) => x.userId === e.userId);
          if (rate && rate.currency === c.currency)
            exact += BigInt(e.minutes) * cents(rate.hourlyCost);
        }
        expect(cents(c.timeCost)).toBe((exact * 2n + 60n) / 120n);
      }
      const unrated = input.timeEntries
        .filter((e) => e.userId === 'u4')
        .reduce((s, e) => s + e.minutes, 0);
      expect(r.minutesWithoutRate).toBe(unrated);
    }
  });
});
