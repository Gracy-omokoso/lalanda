// Avances au personnel (ADR-0051 § 2.2, § 3.2, § 3.3, § 7.2). Attendus calculés
// à la main ; propriétés à graine fixe, rejouables.

import { describe, expect, it } from 'vitest';

import {
  HR_VERSION,
  advanceApprovalSteps,
  advanceFindings,
  advanceOutstanding,
  advanceSettlementPlan,
  checkAdvanceRequest,
  checkAdvanceSettlement,
  type AdvanceInput,
  type AdvanceSettings,
  type AdvanceSettlementKind,
} from '../index.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)] as T;
const toCents = (s: string): bigint => {
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const c = BigInt(i ?? '0') * 100n + BigInt(f.padEnd(2, '0'));
  return neg ? -c : c;
};
const amountOf = (cents: bigint | number): string => {
  const c = BigInt(cents);
  return `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
};

/** Réglages par défaut d'ADR-0051 § 2.7. */
const DEFAULTS: AdvanceSettings = {
  enabled: { expenses: true, salary: false },
  maxAmount: { CDF: null, USD: null },
  allowDeclaredPayrollSettlement: false,
};

const advance = (over: Partial<AdvanceInput> = {}): AdvanceInput => ({
  kind: 'expenses',
  currency: 'USD',
  amount: '100.00',
  disbursement: { paidOn: '2026-11-01' },
  settlements: [],
  ...over,
});

describe('checkAdvanceRequest', () => {
  it('défauts : avance de frais ouverte, avance sur salaire éteinte', () => {
    expect(
      checkAdvanceRequest({ kind: 'expenses', currency: 'USD', amount: '100' }, DEFAULTS),
    ).toEqual({ version: HR_VERSION, ok: true, code: null });
    expect(
      checkAdvanceRequest({ kind: 'salary', currency: 'USD', amount: '100' }, DEFAULTS).code,
    ).toBe('ADVANCE_KIND_DISABLED');
  });

  it('critère 9 : aucun plafond inventé ; plafond saisi de 200,00 USD', () => {
    for (const amount of ['0.01', '200.00', '1000000', '999999999999999.99']) {
      expect(checkAdvanceRequest({ kind: 'expenses', currency: 'USD', amount }, DEFAULTS).ok).toBe(
        true,
      );
    }
    const capped: AdvanceSettings = { ...DEFAULTS, maxAmount: { CDF: null, USD: '200.00' } };
    expect(
      checkAdvanceRequest({ kind: 'expenses', currency: 'USD', amount: '200.00' }, capped).ok,
    ).toBe(true);
    expect(
      checkAdvanceRequest({ kind: 'expenses', currency: 'USD', amount: '250.00' }, capped).code,
    ).toBe('ADVANCE_ABOVE_ORGANIZATION_LIMIT');
    // Le plafond USD ne s'applique pas au CDF (aucune conversion).
    expect(
      checkAdvanceRequest({ kind: 'expenses', currency: 'CDF', amount: '250000' }, capped).ok,
    ).toBe(true);
  });

  it('montant invalide', () => {
    for (const amount of ['0', '-5', '1.001', 'x']) {
      expect(
        checkAdvanceRequest({ kind: 'expenses', currency: 'USD', amount }, DEFAULTS).code,
      ).toBe('ADVANCE_AMOUNT_INVALID');
    }
  });
});

describe('advanceApprovalSteps', () => {
  const settings = { approvalFlow: 'manager_then_finance' as const };
  const employee = { managerEmployeeId: 'A', managerUserId: 'uA' };
  it('avance de frais : comme une note ; avance sur salaire : finance seule, sans le manager', () => {
    expect(advanceApprovalSteps('expenses', settings, employee, 'uB').steps).toEqual([
      'manager',
      'finance',
    ]);
    expect(advanceApprovalSteps('salary', settings, employee, 'uB')).toEqual({
      version: HR_VERSION,
      steps: ['finance'],
      managerReplacedBy: 'SALARY_ADVANCE',
    });
  });
});

describe('advanceOutstanding', () => {
  it('avant versement : rien de dû', () => {
    expect(advanceOutstanding(advance({ disbursement: null }))).toMatchObject({
      disbursed: '0.00',
      outstanding: '0.00',
      state: 'not_disbursed',
    });
  });

  it('critère 7 : versé 100, note 80, retour 20 → soldée', () => {
    const v = advance();
    expect(advanceOutstanding(v)).toMatchObject({
      disbursed: '100.00',
      outstanding: '100.00',
      state: 'open',
    });
    const afterNote = advance({
      settlements: [{ id: 's1', kind: 'expense_report', amount: '80.00', on: '2026-11-05' }],
    });
    expect(advanceOutstanding(afterNote)).toMatchObject({
      settled: '80.00',
      outstanding: '20.00',
      state: 'partially_settled',
    });
    const settled = advance({
      settlements: [
        { id: 's1', kind: 'expense_report', amount: '80.00', on: '2026-11-05' },
        { id: 's2', kind: 'cash_return', amount: '20.00', on: '2026-11-06' },
      ],
    });
    expect(advanceOutstanding(settled)).toEqual({
      version: HR_VERSION,
      currency: 'USD',
      disbursed: '100.00',
      settled: '100.00',
      toppedUp: '0.00',
      outstanding: '0.00',
      overSettled: '0.00',
      bySettlementKind: [
        { kind: 'expense_report', amount: '80.00', count: 1 },
        { kind: 'cash_return', amount: '20.00', count: 1 },
      ],
      state: 'settled',
    });
  });

  it('complément (top_up) : ne réduit pas le reste dû', () => {
    const v = advance({
      settlements: [
        { id: 's1', kind: 'expense_report', amount: '100.00', on: '2026-11-05' },
        { id: 's2', kind: 'top_up', amount: '30.00', on: '2026-11-05' },
      ],
    });
    expect(advanceOutstanding(v)).toMatchObject({
      outstanding: '0.00',
      toppedUp: '30.00',
      state: 'settled',
    });
  });

  it('données incohérentes : excès rendu à part, reste dû jamais négatif', () => {
    const v = advance({
      settlements: [{ id: 's1', kind: 'cash_return', amount: '130.00', on: '2026-11-05' }],
    });
    expect(advanceOutstanding(v)).toMatchObject({ outstanding: '0.00', overSettled: '30.00' });
  });

  it('entrées invalides', () => {
    expect(() => advanceOutstanding(advance({ amount: '0' }))).toThrow(RangeError);
    expect(() => advanceOutstanding(advance({ currency: 'EUR' as never }))).toThrow(RangeError);
    expect(() =>
      advanceOutstanding(
        advance({
          settlements: [
            { id: 's', kind: 'cash_return', amount: '1', on: '2026-11-05' },
            { id: 's', kind: 'cash_return', amount: '1', on: '2026-11-05' },
          ],
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      advanceOutstanding(
        advance({
          settlements: [{ id: 's', kind: 'payroll' as never, amount: '1', on: '2026-11-05' }],
        }),
      ),
    ).toThrow(RangeError);
  });
});

describe('checkAdvanceSettlement', () => {
  it('au-delà du reste dû : refusé', () => {
    const v = advance({
      settlements: [{ id: 's1', kind: 'expense_report', amount: '80.00', on: '2026-11-05' }],
    });
    expect(checkAdvanceSettlement(v, { kind: 'cash_return', amount: '20.01' }, DEFAULTS)).toEqual({
      version: HR_VERSION,
      ok: false,
      code: 'ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING',
      outstandingBefore: '20.00',
      outstandingAfter: '20.00',
    });
    expect(
      checkAdvanceSettlement(v, { kind: 'cash_return', amount: '20.00' }, DEFAULTS),
    ).toMatchObject({
      ok: true,
      outstandingAfter: '0.00',
    });
  });

  it('avant versement, montant invalide', () => {
    expect(
      checkAdvanceSettlement(
        advance({ disbursement: null }),
        { kind: 'cash_return', amount: '1' },
        DEFAULTS,
      ).code,
    ).toBe('ADVANCE_NOT_DISBURSED');
    expect(
      checkAdvanceSettlement(advance(), { kind: 'cash_return', amount: '0' }, DEFAULTS).code,
    ).toBe('ADVANCE_SETTLEMENT_AMOUNT_INVALID');
  });

  it('critère 8 : déclaration sur la paie éteinte par défaut, permise une fois activée', () => {
    const salary = advance({ kind: 'salary' });
    expect(
      checkAdvanceSettlement(salary, { kind: 'declared_payroll', amount: '100' }, DEFAULTS).code,
    ).toBe('ADVANCE_DECLARED_PAYROLL_DISABLED');
    expect(
      checkAdvanceSettlement(
        salary,
        { kind: 'declared_payroll', amount: '100' },
        { allowDeclaredPayrollSettlement: true },
      ),
    ).toMatchObject({ ok: true, outstandingAfter: '0.00' });
  });

  it('avance sur salaire : ni note de frais, ni complément', () => {
    const salary = advance({ kind: 'salary' });
    for (const kind of ['expense_report', 'top_up'] as const) {
      expect(checkAdvanceSettlement(salary, { kind, amount: '1' }, DEFAULTS).code).toBe(
        'ADVANCE_SETTLEMENT_KIND_MISMATCH',
      );
    }
  });

  it('cent régularisations au plus', () => {
    const settlements = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      kind: 'cash_return' as const,
      amount: '0.01',
      on: '2026-11-05',
    }));
    expect(
      checkAdvanceSettlement(
        advance({ settlements }),
        { kind: 'cash_return', amount: '0.01' },
        DEFAULTS,
      ).code,
    ).toBe('ADVANCE_SETTLEMENT_LIMIT_REACHED');
  });
});

describe('advanceSettlementPlan', () => {
  it('critère 7 : note de 80 sur une avance de 100 → 80 sans compte, reste 20', () => {
    const p = advanceSettlementPlan(advance(), { currency: 'USD', lines: [{ amount: '80.00' }] });
    expect(p).toEqual({
      version: HR_VERSION,
      ok: true,
      reportTotal: '80.00',
      outstandingBefore: '100.00',
      fromAdvance: '80.00',
      topUp: '0.00',
      outstandingAfter: '20.00',
      lines: [{ lineIndex: 0, amount: '80.00', fromAdvance: '80.00', topUp: '0.00' }],
      settlements: [{ kind: 'expense_report', amount: '80.00' }],
    });
  });

  it('critère 7 : note de 130 sur une avance de 100 → 100 sans compte + 30 de complément', () => {
    const p = advanceSettlementPlan(advance(), {
      currency: 'USD',
      lines: [{ amount: '65.00' }, { amount: '65.00' }],
    });
    expect(p).toMatchObject({
      ok: true,
      fromAdvance: '100.00',
      topUp: '30.00',
      outstandingAfter: '0.00',
      lines: [
        { lineIndex: 0, amount: '65.00', fromAdvance: '50.00', topUp: '15.00' },
        { lineIndex: 1, amount: '65.00', fromAdvance: '50.00', topUp: '15.00' },
      ],
      settlements: [
        { kind: 'expense_report', amount: '100.00' },
        { kind: 'top_up', amount: '30.00' },
      ],
    });
  });

  it('plus fort reste, égalité au plus petit rang : 0,10 sur trois lignes égales', () => {
    const p = advanceSettlementPlan(advance({ amount: '0.10' }), {
      currency: 'USD',
      lines: [{ amount: '1.00' }, { amount: '1.00' }, { amount: '1.00' }],
    });
    expect(p.ok && p.lines.map((l) => l.fromAdvance)).toEqual(['0.04', '0.03', '0.03']);
  });

  it('refus : avance sur salaire, autre devise, non versée, déjà soldée', () => {
    const lines = [{ amount: '10' }];
    expect(
      advanceSettlementPlan(advance({ kind: 'salary' }), { currency: 'USD', lines }),
    ).toMatchObject({
      ok: false,
      code: 'ADVANCE_SETTLEMENT_KIND_MISMATCH',
    });
    expect(advanceSettlementPlan(advance(), { currency: 'CDF', lines })).toMatchObject({
      ok: false,
      code: 'EXPENSE_REPORT_CURRENCY_MISMATCH',
    });
    expect(
      advanceSettlementPlan(advance({ disbursement: null }), { currency: 'USD', lines }),
    ).toMatchObject({
      ok: false,
      code: 'ADVANCE_NOT_DISBURSED',
    });
    const done = advance({
      settlements: [{ id: 's', kind: 'cash_return', amount: '100', on: '2026-11-02' }],
    });
    expect(advanceSettlementPlan(done, { currency: 'USD', lines })).toMatchObject({
      ok: false,
      code: 'ADVANCE_ALREADY_SETTLED',
    });
    expect(() => advanceSettlementPlan(advance(), { currency: 'USD', lines: [] })).toThrow(
      RangeError,
    );
  });

  it(
    'propriété : répartition exacte au centime, déterministe, jamais négative',
    { timeout: 120_000 },
    () => {
      const r = rng(2611);
      for (let run = 0; run < 3_000; run += 1) {
        const adv = int(r, 1, r() < 0.2 ? 100 : 5_000_000);
        const already = r() < 0.3 ? int(r, 0, adv - 1) : 0;
        const a = advance({
          amount: amountOf(adv),
          settlements:
            already > 0
              ? [{ id: 's0', kind: 'cash_return', amount: amountOf(already), on: '2026-11-02' }]
              : [],
        });
        const lines = Array.from({ length: int(r, 1, 50) }, () => ({
          amount: amountOf(int(r, 1, 2_000_000)),
        }));
        const p = advanceSettlementPlan(a, { currency: 'USD', lines });
        if (!p.ok) throw new Error(p.code);
        const total = lines.reduce((s, l) => s + toCents(l.amount), 0n);
        const before = BigInt(adv - already);
        const covered = before < total ? before : total;
        expect(toCents(p.reportTotal)).toBe(total);
        expect(toCents(p.fromAdvance)).toBe(covered);
        expect(toCents(p.fromAdvance) + toCents(p.topUp)).toBe(total);
        expect(toCents(p.outstandingAfter)).toBe(before - covered);
        expect(p.lines.reduce((s, l) => s + toCents(l.fromAdvance), 0n)).toBe(covered);
        expect(p.lines.reduce((s, l) => s + toCents(l.topUp), 0n)).toBe(total - covered);
        for (const [i, l] of p.lines.entries()) {
          expect(toCents(l.fromAdvance) >= 0n && toCents(l.topUp) >= 0n).toBe(true);
          expect(toCents(l.fromAdvance) + toCents(l.topUp)).toBe(toCents(lines[i]?.amount ?? '0'));
          // Prorata à un centime près.
          const exact = (covered * toCents(l.amount) * 1000n) / total;
          const diff = toCents(l.fromAdvance) * 1000n - exact;
          expect(diff > -1000n && diff < 1000n).toBe(true);
        }
        expect(advanceSettlementPlan(a, { currency: 'USD', lines })).toEqual(p);
        // Appliquer le plan : le reste dû suit exactement.
        const applied = advance({
          ...a,
          settlements: [
            ...a.settlements,
            ...p.settlements.map((s, k) => ({
              id: `p${k}`,
              kind: s.kind,
              amount: s.amount,
              on: '2026-11-03',
            })),
          ],
        });
        expect(advanceOutstanding(applied).outstanding).toBe(p.outstandingAfter);
      }
    },
  );
});

describe('propriété : le solde d’une avance n’est jamais incohérent', () => {
  it(
    'suite aléatoire de régularisations acceptées par checkAdvanceSettlement',
    { timeout: 120_000 },
    () => {
      const r = rng(42);
      const kinds: AdvanceSettlementKind[] = [
        'expense_report',
        'cash_return',
        'declared_payroll',
        'top_up',
        'write_off',
      ];
      for (let run = 0; run < 1_500; run += 1) {
        const kind = pick(r, ['expenses', 'salary'] as const);
        const amount = int(r, 1, 1_000_000);
        let a = advance({
          kind,
          amount: amountOf(amount),
          disbursement: r() < 0.1 ? null : { paidOn: '2026-11-01' },
        });
        const settings = { allowDeclaredPayrollSettlement: r() < 0.5 };
        for (let step = 0; step < int(r, 0, 30); step += 1) {
          const s = {
            kind: pick(r, kinds),
            amount: amountOf(int(r, 1, Math.max(1, Math.floor(amount / 3)))),
          };
          const check = checkAdvanceSettlement(a, s, settings);
          const before = advanceOutstanding(a);
          expect(check.outstandingBefore).toBe(before.outstanding);
          if (!check.ok) {
            expect(check.outstandingAfter).toBe(check.outstandingBefore);
            continue;
          }
          a = { ...a, settlements: [...a.settlements, { id: `s${step}`, ...s, on: '2026-11-02' }] };
          const after = advanceOutstanding(a);
          expect(after.outstanding).toBe(check.outstandingAfter);
        }
        const o = advanceOutstanding(a);
        const disbursed = toCents(o.disbursed);
        const out = toCents(o.outstanding);
        // 0 ≤ reste ≤ versé ; versé = reste + réglé ; jamais d'excès par le chemin contrôlé.
        expect(out >= 0n && out <= disbursed).toBe(true);
        expect(toCents(o.overSettled)).toBe(0n);
        expect(out + toCents(o.settled)).toBe(disbursed);
        expect(o.bySettlementKind.reduce((s, k) => s + toCents(k.amount), 0n)).toBe(
          toCents(o.settled) + toCents(o.toppedUp),
        );
        expect(o.state === 'settled').toBe(a.disbursement !== null && out === 0n);
        if (kind === 'salary') expect(o.toppedUp).toBe('0.00');
      }
    },
  );

  it('données quelconques : reste + réglé − excès = versé', { timeout: 120_000 }, () => {
    const r = rng(7);
    for (let run = 0; run < 2_000; run += 1) {
      const a = advance({
        amount: amountOf(int(r, 1, 100_000)),
        disbursement: r() < 0.2 ? null : { paidOn: '2026-11-01' },
        settlements: Array.from({ length: int(r, 0, 10) }, (_, i) => ({
          id: `s${i}`,
          kind: pick(r, [
            'expense_report',
            'cash_return',
            'declared_payroll',
            'top_up',
            'write_off',
          ] as const),
          amount: amountOf(int(r, 1, 50_000)),
          on: '2026-11-02',
        })),
      });
      const o = advanceOutstanding(a);
      expect(toCents(o.outstanding) >= 0n).toBe(true);
      expect(toCents(o.overSettled) >= 0n).toBe(true);
      expect(toCents(o.outstanding) === 0n || toCents(o.overSettled) === 0n).toBe(true);
      expect(toCents(o.outstanding) + toCents(o.settled) - toCents(o.overSettled)).toBe(
        toCents(o.disbursed),
      );
    }
  });
});

describe('advanceFindings', () => {
  it('ADVANCE_OVERDUE : après la date ou le mois annoncé, reste dû seulement', () => {
    const a = advance({ expectedSettlement: '2026-11' });
    expect(advanceFindings(a, '2026-11-30')).toEqual([]);
    expect(advanceFindings(a, '2026-12-01')).toEqual([
      {
        code: 'ADVANCE_OVERDUE',
        dueOn: '2026-11-30',
        payrollMonth: null,
        amount: '100.00',
        settlementId: null,
      },
    ]);
    expect(
      advanceFindings(advance({ expectedSettlement: '2027-02' }), '2027-03-01')[0]?.dueOn,
    ).toBe('2027-02-28');
    expect(
      advanceFindings(advance({ expectedSettlement: '2026-11-10' }), '2026-11-11'),
    ).toHaveLength(1);
    const settled = advance({
      expectedSettlement: '2026-11-10',
      settlements: [{ id: 's', kind: 'cash_return', amount: '100', on: '2026-11-09' }],
    });
    expect(advanceFindings(settled, '2026-12-01')).toEqual([]);
    expect(
      advanceFindings(
        advance({ expectedSettlement: '2026-11-10', disbursement: null }),
        '2026-12-01',
      ),
    ).toEqual([]);
    expect(advanceFindings(advance(), '2030-01-01')).toEqual([]);
  });

  it('ADVANCE_SETTLED_ON_PAYROLL : un constat par déclaration, sans aucun mouvement', () => {
    const a = advance({
      kind: 'salary',
      settlements: [
        { id: 's2', kind: 'declared_payroll', amount: '40', on: '2026-12-31' },
        { id: 's1', kind: 'declared_payroll', amount: '60', on: '2026-11-30' },
      ],
    });
    expect(advanceFindings(a, '2027-01-05')).toEqual([
      {
        code: 'ADVANCE_SETTLED_ON_PAYROLL',
        dueOn: null,
        payrollMonth: '2026-11',
        amount: '60.00',
        settlementId: 's1',
      },
      {
        code: 'ADVANCE_SETTLED_ON_PAYROLL',
        dueOn: null,
        payrollMonth: '2026-12',
        amount: '40.00',
        settlementId: 's2',
      },
    ]);
  });

  it('échéance illisible', () => {
    expect(() => advanceFindings(advance({ expectedSettlement: '2026-13' }), '2026-12-01')).toThrow(
      RangeError,
    );
  });
});
