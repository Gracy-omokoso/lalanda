// Dépenses et trésorerie (ADR-0034) — cas littéraux et propriétés.
//
// Les propriétés recoupent le moteur par une arithmétique de contrôle propre au
// test (centimes entiers obtenus en retirant le point), indépendante de
// `money.ts`, et par un générateur pseudo-aléatoire à graine fixe : un échec
// est rejouable à l'identique.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCENARIO_HYPOTHESES,
  EXPENSE_CATEGORY_CODES,
  FORECAST_HORIZONS,
  aggregateExpenses,
  computeAccountBalances,
  exercisePeriodOf,
  forecastTreasury,
  isOccurrenceOf,
  isValidScenarioHypotheses,
  monthlyEquivalentCents,
  occurrencesOf,
  planExpenseActuals,
  reconcileExpenses,
  type ExpenseCategory,
  type ExpenseInput,
  type RecurrenceFrequency,
  type TreasuryCurrency,
  type TreasuryForecastInput,
  type TreasuryMovementInput,
} from '../index.js';

// ── Outils de contrôle ───────────────────────────────────────────────────────

/** Centimes d'un montant « 12.34 » / « -0.05 », sans passer par le moteur. */
function cents(amount: string): bigint {
  const negative = amount.startsWith('-');
  const [i, f = ''] = (negative ? amount.slice(1) : amount).split('.');
  const v = BigInt(i ?? '0') * 100n + BigInt(f.padEnd(2, '0'));
  return negative ? -v : v;
}

function money(c: bigint): string {
  const negative = c < 0n;
  const abs = negative ? -c : c;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Générateur congruentiel (Park–Miller) à graine fixe. */
function generator(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  const next = (): number => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  return {
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    bool: (): boolean => next() < 0.5,
  };
}

function day(year: number, month: number, d: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function randomDay(random: ReturnType<typeof generator>, year = 2026): string {
  const month = random.int(1, 12);
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day(year, month, random.int(1, dim));
}

const expense = (
  id: string,
  spentOn: string,
  amount: string,
  category: ExpenseCategory,
  currency: TreasuryCurrency = 'USD',
): ExpenseInput => ({ id, spentOn, amount, currency, category, label: `Dépense ${id}` });

// ── Calendrier et récurrences ────────────────────────────────────────────────

describe('exercisePeriodOf (même règle qu’ADR-0031 § 3)', () => {
  it('convertit un mois civil en (exercice, mois), bornes comprises', () => {
    expect(exercisePeriodOf('2026-03', '2026-03')).toEqual({ year: 1, month: 1 });
    expect(exercisePeriodOf('2027-02', '2026-03')).toEqual({ year: 1, month: 12 });
    expect(exercisePeriodOf('2027-03', '2026-03')).toEqual({ year: 2, month: 1 });
    expect(exercisePeriodOf('2031-02', '2026-03')).toEqual({ year: 5, month: 12 });
    expect(exercisePeriodOf('2031-03', '2026-03')).toBeNull();
    expect(exercisePeriodOf('2026-02', '2026-03')).toBeNull();
  });
});

describe('occurrencesOf — quantième ramené au dernier jour du mois', () => {
  it('31 janvier mensuel : 28 février puis 31 mars, jamais 28 mars', () => {
    const rule = { frequency: 'monthly' as const, startDate: '2026-01-31', endDate: null };
    expect(occurrencesOf(rule, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrencesOf({ ...rule, startDate: '2028-01-31' }, '2028-02-01', '2028-02-29')).toEqual(
      ['2028-02-29'],
    );
  });

  it('hebdomadaire, trimestriel, annuel et date de fin', () => {
    expect(
      occurrencesOf(
        { frequency: 'weekly', startDate: '2026-10-01', endDate: '2026-10-22' },
        '2026-10-02',
        '2026-12-31',
      ),
    ).toEqual(['2026-10-08', '2026-10-15', '2026-10-22']);
    expect(
      occurrencesOf(
        { frequency: 'quarterly', startDate: '2025-11-30', endDate: null },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-02-28', '2026-05-30', '2026-08-30', '2026-11-30']);
    expect(
      occurrencesOf(
        { frequency: 'yearly', startDate: '2024-02-29', endDate: null },
        '2024-01-01',
        '2028-12-31',
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(
      occurrencesOf(
        { frequency: 'monthly', startDate: '2026-06-15', endDate: null },
        '2026-01-01',
        '2026-06-14',
      ),
    ).toEqual([]);
  });

  it(
    'propriété : triées, uniques, dans la fenêtre, et identiques à une énumération naïve',
    { timeout: 120_000 },
    () => {
      const random = generator(20261021);
      const frequencies: RecurrenceFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
      for (let n = 0; n < 400; n += 1) {
        const frequency = random.pick(frequencies);
        const startDate = randomDay(random, random.int(2024, 2026));
        const endDate = random.bool() ? null : randomDay(random, random.int(2026, 2028));
        const from = randomDay(random, random.int(2025, 2027));
        const to = randomDay(random, 2028);
        const rule = { frequency, startDate, endDate };
        const got = occurrencesOf(rule, from, to);
        // Énumération naïve : toutes les occurrences depuis le début, filtrées.
        const naive: string[] = [];
        const start = new Date(`${startDate}T00:00:00Z`);
        for (let k = 0; k < 2000; k += 1) {
          let d: string;
          if (frequency === 'weekly') {
            d = new Date(start.getTime() + 7 * k * 86_400_000).toISOString().slice(0, 10);
          } else {
            const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
            const m = start.getUTCMonth() + step * k;
            const y = start.getUTCFullYear() + Math.floor(m / 12);
            const mm = (m % 12) + 1;
            const dim = new Date(Date.UTC(y, mm, 0)).getUTCDate();
            d = day(y, mm, Math.min(start.getUTCDate(), dim));
          }
          if (d > to || (endDate !== null && d > endDate)) break;
          if (d >= from) naive.push(d);
        }
        expect(got, JSON.stringify(rule)).toEqual(naive);
        for (const d of got) expect(isOccurrenceOf(rule, d)).toBe(true);
      }
    },
  );

  it('équivalent mensuel', () => {
    expect(monthlyEquivalentCents('120.00', 'yearly')).toBe(1000n);
    expect(monthlyEquivalentCents('100.00', 'quarterly')).toBe(3333n);
    expect(monthlyEquivalentCents('30.00', 'weekly')).toBe(13000n);
    expect(monthlyEquivalentCents('45.50', 'monthly')).toBe(4550n);
  });
});

// ── Soldes ───────────────────────────────────────────────────────────────────

describe('computeAccountBalances', () => {
  it('ouverture au début du jour, mouvements hors bornes écartés et comptés', () => {
    const result = computeAccountBalances(
      [
        { id: 'caisse', currency: 'CDF', openingBalance: '100000.00', openingDate: '2026-10-01' },
        {
          id: 'banque',
          currency: 'USD',
          openingBalance: '-50.00',
          openingDate: '2026-10-05',
          active: true,
        },
      ],
      [
        { accountId: 'caisse', date: '2026-10-01', direction: 'out', amount: '2500.50' },
        { accountId: 'caisse', date: '2026-09-30', direction: 'out', amount: '1.00' },
        { accountId: 'caisse', date: '2026-10-25', direction: 'in', amount: '9.00' },
        { accountId: 'banque', date: '2026-10-10', direction: 'in', amount: '200.00' },
        { accountId: 'inconnu', date: '2026-10-10', direction: 'in', amount: '1.00' },
      ],
      '2026-10-21',
    );
    expect(result.accounts.map((a) => [a.accountId, a.balance])).toEqual([
      ['caisse', '97499.50'],
      ['banque', '150.00'],
    ]);
    expect(result.totalsByCurrency).toEqual({ CDF: '97499.50', USD: '150.00' });
    expect(result.ignored).toEqual({ unknownAccount: 1, beforeOpening: 1, afterAsOf: 1 });
  });

  it(
    'propriété : solde = ouverture + Σ entrées − Σ sorties ; un virement de même devise conserve le total',
    { timeout: 120_000 },
    () => {
      const random = generator(4242);
      for (let n = 0; n < 300; n += 1) {
        const accounts = Array.from({ length: random.int(1, 4) }, (_, i) => ({
          id: `a${i}`,
          currency: 'USD' as const,
          openingBalance: money(BigInt(random.int(-100_000, 10_000_000))),
          openingDate: '2026-01-01',
        }));
        const movements: TreasuryMovementInput[] = [];
        const expected = new Map(accounts.map((a) => [a.id, cents(a.openingBalance)]));
        for (let m = 0; m < random.int(0, 30); m += 1) {
          const account = random.pick(accounts);
          const amount = BigInt(random.int(1, 5_000_000));
          const direction = random.bool() ? 'in' : 'out';
          movements.push({
            accountId: account.id,
            date: randomDay(random),
            direction,
            amount: money(amount),
          });
          const signed = direction === 'in' ? amount : -amount;
          expected.set(account.id, (expected.get(account.id) ?? 0n) + signed);
        }
        const asOf = '2026-12-31';
        const before = computeAccountBalances(accounts, movements, asOf);
        for (const a of before.accounts) expect(cents(a.balance)).toBe(expected.get(a.accountId));
        const total = [...expected.values()].reduce((s, v) => s + v, 0n);
        expect(cents(before.totalsByCurrency.USD ?? '0')).toBe(total);

        if (accounts.length >= 2) {
          const amount = money(BigInt(random.int(1, 1_000_000)));
          const after = computeAccountBalances(
            accounts,
            [
              ...movements,
              { accountId: 'a0', date: '2026-06-01', direction: 'out', amount },
              { accountId: 'a1', date: '2026-06-01', direction: 'in', amount },
            ],
            asOf,
          );
          expect(after.totalsByCurrency.USD).toBe(before.totalsByCurrency.USD);
        }
      }
    },
  );
});

// ── Agrégats et pont vers le réalisé ─────────────────────────────────────────

describe('aggregateExpenses et planExpenseActuals', () => {
  const expenses = [
    expense('e1', '2026-03-02', '1200.00', 'loyer'),
    expense('e2', '2026-03-15', '300.50', 'personnel'),
    expense('e3', '2026-03-20', '50.00', 'marketing'),
    expense('e4', '2026-04-01', '1200.00', 'loyer'),
    expense('e5', '2026-04-03', '70000.00', 'achats', 'CDF'),
    expense('e6', '2026-04-04', '10.00', 'achats'),
    expense('e7', '2031-03-01', '5.00', 'loyer'),
  ];
  const mapping = {
    loyer: 'charges_operationnelles',
    personnel: 'charges_operationnelles',
    achats: 'cout_matiere',
  };

  it('totaux par mois, devise et catégorie, utilisables sans plan', () => {
    const agg = aggregateExpenses(expenses);
    expect(agg.totalsByCurrency).toEqual({ CDF: '70000.00', USD: '2765.50' });
    expect(agg.byMonth.find((r) => r.month === '2026-03' && r.category === 'loyer')).toEqual({
      month: '2026-03',
      currency: 'USD',
      category: 'loyer',
      total: '1200.00',
      count: 1,
    });
  });

  it('report par ligne, case non convertible écartée en entier, hors horizon, non rattachées', () => {
    const plan = planExpenseActuals({
      expenses,
      mapping,
      projectCurrency: 'USD',
      firstMonth: '2026-03',
    });
    expect(plan.cells).toEqual([
      {
        year: 1,
        month: 1,
        calendarMonth: '2026-03',
        lineId: 'charges_operationnelles',
        amount: '1500.50',
        documents: ['e1', 'e2'],
        categories: [
          { category: 'personnel', amount: '300.50' },
          { category: 'loyer', amount: '1200.00' },
        ],
      },
      {
        year: 1,
        month: 2,
        calendarMonth: '2026-04',
        lineId: 'charges_operationnelles',
        amount: '1200.00',
        documents: ['e4'],
        categories: [{ category: 'loyer', amount: '1200.00' }],
      },
    ]);
    expect(plan.skipped.map((s) => [s.calendarMonth, s.lineId, s.reason, s.expenseIds])).toEqual([
      ['2026-04', 'cout_matiere', 'CURRENCY_NOT_CONVERTIBLE', ['e5', 'e6']],
      ['2031-03', 'charges_operationnelles', 'OUTSIDE_PLAN_HORIZON', ['e7']],
    ]);
    expect(plan.unmapped).toEqual([
      {
        calendarMonth: '2026-03',
        category: 'marketing',
        currency: 'USD',
        total: '50.00',
        count: 1,
      },
    ]);
  });

  it(
    'propriété : idempotence et conservation — reporté + écarté + non rattaché = total',
    { timeout: 120_000 },
    () => {
      const random = generator(777);
      const categories = EXPENSE_CATEGORY_CODES;
      for (let n = 0; n < 200; n += 1) {
        const list = Array.from({ length: random.int(0, 40) }, (_, i) =>
          expense(
            `x${i}`,
            randomDay(random, random.int(2026, 2027)),
            money(BigInt(random.int(1, 9_999_999))),
            random.pick(categories),
            random.bool() ? 'USD' : 'CDF',
          ),
        );
        const map = Object.fromEntries(
          categories.filter(() => random.bool()).map((c) => [c, random.pick(['l1', 'l2', 'l3'])]),
        );
        const input = {
          expenses: list,
          mapping: map,
          projectCurrency: 'USD',
          firstMonth: '2026-01',
        };
        const a = planExpenseActuals(input);
        const b = planExpenseActuals({ ...input, expenses: [...list].reverse() });
        expect(b).toEqual(a);

        const total = list.reduce((s, e) => s + cents(e.amount), 0n);
        const reported = a.cells.reduce((s, c) => s + cents(c.amount), 0n);
        const skipped = a.skipped.reduce(
          (s, k) => s + Object.values(k.totalsByCurrency).reduce((t, v) => t + cents(v ?? '0'), 0n),
          0n,
        );
        const unmapped = a.unmapped.reduce((s, u) => s + cents(u.total), 0n);
        expect(reported + skipped + unmapped).toBe(total);
        for (const c of a.cells) {
          expect(c.categories.reduce((s, x) => s + cents(x.amount), 0n)).toBe(cents(c.amount));
        }
        const agg = aggregateExpenses(list);
        expect(agg.byMonth.reduce((s, r) => s + cents(r.total), 0n)).toBe(total);
      }
    },
  );
});

// ── Rapprochement ────────────────────────────────────────────────────────────

describe('reconcileExpenses', () => {
  const expenses = [
    expense('e1', '2026-03-02', '1200.00', 'loyer'),
    expense('e2', '2026-03-15', '300.50', 'personnel'),
    expense('e4', '2026-04-01', '900.00', 'loyer'),
    expense('e5', '2026-05-03', '70000.00', 'loyer', 'CDF'),
  ];
  const plan = planExpenseActuals({
    expenses,
    mapping: { loyer: 'charges_operationnelles', personnel: 'charges_operationnelles' },
    projectCurrency: 'USD',
    firstMonth: '2026-03',
  });

  it('prévu, réalisé, porté, écart, statut et constats ; jamais de chiffre fabriqué', () => {
    const r = reconcileExpenses({
      year: 1,
      lines: [
        { lineId: 'charges_operationnelles', label: 'Charges opérationnelles', prevuMensuel: 1000 },
        { lineId: 'cout_matiere', label: 'Coût matière', prevuMensuel: null },
      ],
      plan,
      expenses,
      periods: [
        {
          month: 1,
          status: 'open',
          values: { charges_operationnelles: 1500.5 },
          sources: { charges_operationnelles: { source: 'run.expenses' } },
        },
        { month: 2, status: 'closed', values: { charges_operationnelles: 950 }, sources: {} },
      ],
    });
    const line = r.lines[0]!;
    expect(line.months[0]).toMatchObject({
      prevu: '1000.00',
      realise: '1500.50',
      stored: '1500.50',
      storedSource: 'run.expenses',
      ecart: '500.50',
      statut: 'defavorable',
      findings: [],
    });
    expect(line.months[1]).toMatchObject({
      realise: '900.00',
      stored: '950.00',
      storedSource: 'manual',
      ecart: '-100.00',
      statut: 'favorable',
      findings: ['PERIOD_CLOSED', 'MANUAL_VALUE_PRESENT', 'NOT_SYNCED'],
    });
    expect(line.months[2]).toMatchObject({
      realise: null,
      ecart: null,
      findings: ['CURRENCY_NOT_CONVERTIBLE'],
    });
    expect(line.months[3]).toMatchObject({ realise: null, stored: null, findings: [] });
    expect(line.total).toEqual({
      monthsCounted: [1, 2],
      prevuCumule: '2000.00',
      realiseCumule: '2400.50',
      ecart: '400.50',
      ecartPct: 0.2003,
      statut: 'defavorable',
    });
    expect(line.categories).toEqual([
      { category: 'personnel', amount: '300.50' },
      { category: 'loyer', amount: '2100.00' },
    ]);
    expect(line.topExpenses.map((e) => e.id)).toEqual(['e1', 'e4', 'e2']);

    const sansBase = r.lines[1]!;
    expect(sansBase.comparable).toBe(false);
    expect(sansBase.total.ecart).toBeNull();
    expect(
      sansBase.months.every((m) => m.prevu === null && m.findings.includes('NO_PLAN_BASE')),
    ).toBe(true);
  });
});

// ── Prévision ────────────────────────────────────────────────────────────────

function baseForecast(overrides: Partial<TreasuryForecastInput> = {}): TreasuryForecastInput {
  return {
    asOf: '2026-10-21',
    currency: 'USD',
    accounts: [
      {
        id: 'banque',
        currency: 'USD',
        openingBalance: '1000.00',
        openingDate: '2026-01-01',
        active: true,
      },
      {
        id: 'caisse',
        currency: 'CDF',
        openingBalance: '500000.00',
        openingDate: '2026-01-01',
        active: true,
      },
    ],
    movements: [],
    receivables: [],
    recurring: [],
    confirmedOccurrences: [],
    plan: null,
    scenarios: { ...DEFAULT_SCENARIO_HYPOTHESES },
    minimumBalance: null,
    externalFindings: [],
    ...overrides,
  };
}

describe('forecastTreasury', () => {
  it('sans flux : solde constant, 181 points, horizons 7/30/90/180, compte d’une autre devise signalé', () => {
    const f = forecastTreasury(baseForecast());
    expect(f.openingBalance).toBe('1000.00');
    for (const s of f.scenarios) {
      expect(s.series).toHaveLength(181);
      expect(s.series.every((p) => p.balance === '1000.00')).toBe(true);
      expect(s.horizons.map((h) => h.days)).toEqual([...FORECAST_HORIZONS]);
      expect(s.alerts).toEqual([]);
    }
    expect(f.uncertainty.findings).toEqual([
      { code: 'ACCOUNTS_OTHER_CURRENCY', count: 1, detail: null },
    ]);
  });

  it('échéances, récurrences confirmées exclues, retards à J+1, alerte et cause probable', () => {
    const f = forecastTreasury(
      baseForecast({
        receivables: [
          {
            id: 'f1',
            label: 'Facture FV-1',
            currency: 'USD',
            outstanding: '500.00',
            dueDate: '2026-11-05',
            issuedOn: '2026-10-01',
          },
          {
            id: 'f2',
            label: 'Facture FV-2',
            currency: 'USD',
            outstanding: '200.00',
            dueDate: null,
            issuedOn: '2026-10-10',
          },
          {
            id: 'f3',
            label: 'Facture FV-3',
            currency: 'CDF',
            outstanding: '10.00',
            dueDate: null,
            issuedOn: '2026-10-10',
          },
        ],
        recurring: [
          {
            id: 'r1',
            label: 'Loyer',
            category: 'loyer',
            currency: 'USD',
            amount: '800.00',
            frequency: 'monthly',
            startDate: '2026-09-25',
            endDate: null,
            active: true,
          },
        ],
        confirmedOccurrences: [{ recurringExpenseId: 'r1', occurrenceDate: '2026-09-25' }],
        minimumBalance: '300.00',
      }),
    );
    const opt = f.scenarios.find((s) => s.id === 'optimistic')!;
    // Optimiste : 1000 + 500 (5 nov.) + 200 (9 nov.) − 800 (25 oct.) − 800 (25 nov.) …
    expect(opt.flows.slice(0, 4).map((x) => [x.date, x.source, x.amount])).toEqual([
      ['2026-10-25', 'recurring', '800.00'],
      ['2026-11-05', 'receivable', '500.00'],
      ['2026-11-09', 'receivable', '200.00'],
      ['2026-11-25', 'recurring', '800.00'],
    ]);
    expect(opt.horizons[0]).toMatchObject({
      days: 7,
      closing: '200.00',
      min: '200.00',
      minDate: '2026-10-25',
    });
    // 1000 − 800 = 200 le 25 oct. (sous le minimum de 300) ; +700 en novembre,
    // −800 le 25 nov. (100), −800 le 25 déc. : rupture.
    expect(opt.alerts).toEqual([
      {
        severity: 'tension',
        date: '2026-10-25',
        dayIndex: 4,
        horizon: 7,
        balance: '200.00',
        threshold: '300.00',
        probableCause: { label: 'Loyer', amount: '800.00', date: '2026-10-25' },
      },
      {
        severity: 'critique',
        date: '2026-12-25',
        dayIndex: 65,
        horizon: 90,
        balance: '-700.00',
        threshold: '0.00',
        probableCause: { label: 'Loyer', amount: '800.00', date: '2026-12-25' },
      },
    ]);
    const pess = f.scenarios.find((s) => s.id === 'pessimistic')!;
    expect(pess.alerts.map((a) => a.severity)).toContain('critique');
    const codes = f.uncertainty.findings.map((x) => x.code).sort();
    expect(codes).toEqual([
      'ACCOUNTS_OTHER_CURRENCY',
      'RECEIVABLES_OTHER_CURRENCY',
      'RECEIVABLES_WITHOUT_DUE_DATE',
    ]);
  });

  it('plan BUILD : rythme journalier exact, charge diminuée des récurrences de sa catégorie', () => {
    const f = forecastTreasury(
      baseForecast({
        accounts: [],
        recurring: [
          {
            id: 'r1',
            label: 'Loyer',
            category: 'loyer',
            currency: 'USD',
            amount: '300.00',
            frequency: 'monthly',
            startDate: '2027-06-01',
            endDate: null,
            active: true,
          },
        ],
        plan: {
          lines: [
            { lineId: 'ca', label: 'CA', direction: 'in', monthlyAmount: 3650 },
            {
              lineId: 'charges_operationnelles',
              label: 'Charges',
              direction: 'out',
              monthlyAmount: 1000,
            },
          ],
          mapping: { loyer: 'charges_operationnelles' },
        },
      }),
    );
    const opt = f.scenarios.find((s) => s.id === 'optimistic')!;
    // 3650 × 12 ÷ 365 = 120 par jour d'entrée ; (1000 − 300) × 12 ÷ 365 par jour de sortie.
    const h180 = opt.horizons[3]!;
    expect(h180.bySource.plan_in).toBe('21600.00');
    expect(h180.bySource.plan_out).toBe(money((70000n * 12n * 180n * 2n + 365n) / (365n * 2n)));
    expect(f.uncertainty.findings.map((x) => x.code)).toContain('NO_ACCOUNT');
  });

  it(
    'propriété : avec des hypothèses monotones, optimiste ≥ probable ≥ pessimiste chaque jour ; série = ouverture + flux',
    { timeout: 120_000 },
    () => {
      const random = generator(9001);
      for (let n = 0; n < 60; n += 1) {
        const receivables = Array.from({ length: random.int(0, 8) }, (_, i) => ({
          id: `f${i}`,
          label: `F${i}`,
          currency: 'USD' as const,
          outstanding: money(BigInt(random.int(1, 500_000))),
          dueDate: random.bool() ? null : randomDay(random, random.int(2026, 2027)),
          issuedOn: randomDay(random, 2026),
        }));
        const recurring = Array.from({ length: random.int(0, 4) }, (_, i) => ({
          id: `r${i}`,
          label: `R${i}`,
          category: random.pick(EXPENSE_CATEGORY_CODES),
          currency: 'USD' as const,
          amount: money(BigInt(random.int(1, 300_000))),
          frequency: random.pick(['weekly', 'monthly', 'quarterly', 'yearly'] as const),
          startDate: randomDay(random, random.int(2025, 2027)),
          endDate: null,
          active: true,
        }));
        const plan = random.bool()
          ? {
              lines: [
                {
                  lineId: 'ca',
                  label: 'CA',
                  direction: 'in' as const,
                  monthlyAmount: random.int(0, 100_000),
                },
                {
                  lineId: 'ch',
                  label: 'Ch',
                  direction: 'out' as const,
                  monthlyAmount: random.int(0, 80_000),
                },
              ],
              mapping: { loyer: 'ch' },
            }
          : null;
        const f = forecastTreasury(
          baseForecast({
            receivables,
            recurring,
            plan,
            accounts: [
              {
                id: 'b',
                currency: 'USD',
                openingBalance: money(BigInt(random.int(-1_000_000, 5_000_000))),
                openingDate: '2026-01-01',
                active: true,
              },
            ],
          }),
        );
        const [opt, prob, pess] = ['optimistic', 'probable', 'pessimistic'].map((id) =>
          f.scenarios.find((s) => s.id === id)!,
        );
        for (let d = 0; d <= 180; d += 1) {
          expect(cents(opt!.series[d]!.balance)).toBeGreaterThanOrEqual(
            cents(prob!.series[d]!.balance),
          );
          expect(cents(prob!.series[d]!.balance)).toBeGreaterThanOrEqual(
            cents(pess!.series[d]!.balance),
          );
        }
        for (const s of f.scenarios) {
          for (const h of s.horizons) {
            const closing = cents(h.closing);
            expect(closing).toBe(cents(s.series[h.days]!.balance));
            expect(closing).toBe(cents(f.openingBalance) + cents(h.inflows) - cents(h.outflows));
            expect(cents(h.min)).toBeLessThanOrEqual(closing);
          }
        }
        for (const u of f.uncertainty.horizons) {
          expect(cents(u.spread)).toBe(cents(u.high) - cents(u.low));
          expect(cents(u.spread)).toBeGreaterThanOrEqual(0n);
        }
      }
    },
  );

  it('hypothèses : bornes de validation, valeurs par défaut valides', () => {
    for (const h of Object.values(DEFAULT_SCENARIO_HYPOTHESES))
      expect(isValidScenarioHypotheses(h)).toBe(true);
    expect(
      isValidScenarioHypotheses({
        ...DEFAULT_SCENARIO_HYPOTHESES.probable,
        receivableCollectionRate: -0.1,
      }),
    ).toBe(false);
    expect(
      isValidScenarioHypotheses({
        ...DEFAULT_SCENARIO_HYPOTHESES.probable,
        receivableDelayDays: 1.5,
      }),
    ).toBe(false);
  });
});
