// Notes de frais (ADR-0051 § 2.1, § 3.1, § 6.1). Attendus calculés à la main ;
// les propriétés utilisent un générateur à graine fixe : un échec est rejouable.

import { describe, expect, it } from 'vitest';

import {
  EXPENSE_CATEGORY_CODES,
  EXPENSE_LINE_FORBIDDEN_CATEGORIES,
  HR_VERSION,
  checkExpenseReport,
  expenseApprovalSteps,
  expenseReportTotals,
  expenseSummary,
  type ExpenseLineInput,
  type ExpenseSummaryReportInput,
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
  const [i, f = ''] = s.split('.');
  return BigInt(i ?? '0') * 100n + BigInt(f.padEnd(2, '0'));
};
const amountOf = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

const ALLOWED = EXPENSE_CATEGORY_CODES.filter((c) => !EXPENSE_LINE_FORBIDDEN_CATEGORIES.includes(c));

const line = (over: Partial<ExpenseLineInput> = {}): ExpenseLineInput => ({
  spentOn: '2026-11-02',
  category: 'transport',
  amount: '15.00',
  hasReceipt: true,
  ...over,
});

describe('checkExpenseReport', () => {
  const today = '2026-11-05';

  it('note correcte', () => {
    const r = checkExpenseReport({ currency: 'USD', lines: [line()] }, today, {
      receiptRequired: true,
    });
    expect(r).toEqual({ version: HR_VERSION, ok: true, issues: [] });
  });

  it('note vide, trop de lignes, devise inconnue', () => {
    expect(
      checkExpenseReport({ currency: 'EUR', lines: [] }, today, { receiptRequired: false }).issues,
    ).toEqual([
      { lineIndex: null, code: 'EXPENSE_REPORT_CURRENCY_UNKNOWN' },
      { lineIndex: null, code: 'EXPENSE_REPORT_EMPTY' },
    ]);
    const many = Array.from({ length: 51 }, () => line());
    expect(
      checkExpenseReport({ currency: 'CDF', lines: many }, today, { receiptRequired: false }).issues,
    ).toEqual([{ lineIndex: null, code: 'EXPENSE_REPORT_TOO_MANY_LINES' }]);
    const fifty = Array.from({ length: 50 }, () => line());
    expect(checkExpenseReport({ currency: 'CDF', lines: fifty }, today, { receiptRequired: false }).ok).toBe(true);
  });

  it('date future, date illisible, aujourd’hui permis', () => {
    const r = checkExpenseReport(
      {
        currency: 'USD',
        lines: [line({ spentOn: '2026-11-06' }), line({ spentOn: '2026-02-30' }), line({ spentOn: today })],
      },
      today,
      { receiptRequired: false },
    );
    expect(r.issues).toEqual([
      { lineIndex: 0, code: 'EXPENSE_IN_FUTURE' },
      { lineIndex: 1, code: 'EXPENSE_DATE_INVALID' },
    ]);
  });

  it('catégories : investissement et emprunt refusés, inconnue signalée, les douze autres acceptées', () => {
    const r = checkExpenseReport(
      {
        currency: 'USD',
        lines: [
          line({ category: 'investissement' }),
          line({ category: 'remboursement_emprunt' }),
          line({ category: 'repas' }),
        ],
      },
      today,
      { receiptRequired: false },
    );
    expect(r.issues).toEqual([
      { lineIndex: 0, code: 'EXPENSE_LINE_CATEGORY_NOT_ALLOWED' },
      { lineIndex: 1, code: 'EXPENSE_LINE_CATEGORY_NOT_ALLOWED' },
      { lineIndex: 2, code: 'EXPENSE_LINE_CATEGORY_UNKNOWN' },
    ]);
    expect(ALLOWED).toHaveLength(12);
    const ok = checkExpenseReport(
      { currency: 'USD', lines: ALLOWED.map((category) => line({ category })) },
      today,
      { receiptRequired: false },
    );
    expect(ok.ok).toBe(true);
  });

  it('montant : > 0, deux décimales au plus', () => {
    const bad = ['0', '0.00', '-1.00', '1.234', 'abc', '', '1,50'];
    for (const amount of bad) {
      expect(
        checkExpenseReport({ currency: 'USD', lines: [line({ amount })] }, today, {
          receiptRequired: false,
        }).issues,
      ).toEqual([{ lineIndex: 0, code: 'EXPENSE_AMOUNT_INVALID' }]);
    }
    for (const amount of ['0.01', '7.5', '1250000']) {
      expect(
        checkExpenseReport({ currency: 'CDF', lines: [line({ amount })] }, today, {
          receiptRequired: false,
        }).ok,
      ).toBe(true);
    }
  });

  it('TVA déclarée : ≤ montant, jamais négative', () => {
    const r = checkExpenseReport(
      {
        currency: 'USD',
        lines: [
          line({ deductibleVat: '15.00' }),
          line({ deductibleVat: '15.01' }),
          line({ deductibleVat: '-1' }),
          line({ deductibleVat: '0' }),
          line({ deductibleVat: null }),
        ],
      },
      today,
      { receiptRequired: false },
    );
    expect(r.issues).toEqual([
      { lineIndex: 1, code: 'EXPENSE_VAT_INVALID' },
      { lineIndex: 2, code: 'EXPENSE_VAT_INVALID' },
    ]);
  });

  it('refacturable seulement avec un projet', () => {
    const r = checkExpenseReport(
      {
        currency: 'USD',
        lines: [line({ rebillable: true }), line({ rebillable: true, workProjectId: 'P' })],
      },
      today,
      { receiptRequired: false },
    );
    expect(r.issues).toEqual([{ lineIndex: 0, code: 'EXPENSE_REBILLABLE_WITHOUT_PROJECT' }]);
  });

  it('justificatif exigé : un motif suffit, aucun seuil de montant', () => {
    const lines = [
      line({ hasReceipt: false, amount: '0.01' }),
      line({ hasReceipt: false, missingReceiptReason: '  ' }),
      line({ hasReceipt: false, missingReceiptReason: 'Taxi sans reçu' }),
      line({ hasReceipt: true }),
    ];
    expect(checkExpenseReport({ currency: 'USD', lines }, today, { receiptRequired: true }).issues).toEqual([
      { lineIndex: 0, code: 'EXPENSE_RECEIPT_REASON_REQUIRED' },
      { lineIndex: 1, code: 'EXPENSE_RECEIPT_REASON_REQUIRED' },
    ]);
    expect(checkExpenseReport({ currency: 'USD', lines }, today, { receiptRequired: false }).ok).toBe(true);
  });
});

describe('expenseReportTotals', () => {
  it('critère 5 : transport 15,00 (projet P) + charges diverses 7,50 = 22,50', () => {
    const r = expenseReportTotals([
      { category: 'transport', amount: '15.00', workProjectId: 'P', rebillable: true },
      { category: 'charges_diverses', amount: '7.5' },
    ]);
    expect(r).toEqual({
      version: HR_VERSION,
      lineCount: 2,
      total: '22.50',
      byCategory: [
        { category: 'transport', total: '15.00', lines: 1 },
        { category: 'charges_diverses', total: '7.50', lines: 1 },
      ],
      byProject: [
        { workProjectId: 'P', total: '15.00', lines: 1 },
        { workProjectId: null, total: '7.50', lines: 1 },
      ],
      rebillable: '15.00',
    });
  });

  it('centimes exacts (0,10 + 0,20 = 0,30, sans flottant)', () => {
    const r = expenseReportTotals([
      { category: 'transport', amount: '0.10' },
      { category: 'transport', amount: '0.20' },
    ]);
    expect(r.total).toBe('0.30');
    expect(r.byCategory).toEqual([{ category: 'transport', total: '0.30', lines: 2 }]);
  });

  it('grands montants en CDF sans perte', () => {
    const r = expenseReportTotals([
      { category: 'transport', amount: '999999999999999.99' },
      { category: 'transport', amount: '0.01' },
    ]);
    expect(r.total).toBe('1000000000000000.00');
  });

  it('note vide : zéro ; ligne invalide : erreur', () => {
    expect(expenseReportTotals([]).total).toBe('0.00');
    expect(() => expenseReportTotals([{ category: 'transport', amount: '0' }])).toThrow(RangeError);
    expect(() => expenseReportTotals([{ category: 'investissement', amount: '1' }])).toThrow(
      RangeError,
    );
    expect(() =>
      expenseReportTotals(Array.from({ length: 51 }, () => ({ category: 'transport', amount: '1' }))),
    ).toThrow(RangeError);
  });

  it('propriété : total = Σ lignes = Σ catégories = Σ projets ; ordre des lignes sans effet', { timeout: 120_000 }, () => {
    const r = rng(20261101);
    for (let run = 0; run < 2_000; run += 1) {
      const n = int(r, 1, 50);
      const lines = Array.from({ length: n }, () => ({
        category: pick(r, ALLOWED),
        amount: amountOf(int(r, 1, r() < 0.1 ? 10_000_000_000 : 50_000)),
        workProjectId: r() < 0.4 ? pick(r, ['P1', 'P2', 'P3']) : null,
        rebillable: r() < 0.3,
      }));
      const t = expenseReportTotals(lines);
      const expected = lines.reduce((s, l) => s + toCents(l.amount), 0n);
      expect(toCents(t.total)).toBe(expected);
      expect(t.byCategory.reduce((s, g) => s + toCents(g.total), 0n)).toBe(expected);
      expect(t.byProject.reduce((s, g) => s + toCents(g.total), 0n)).toBe(expected);
      expect(t.byCategory.reduce((s, g) => s + g.lines, 0)).toBe(n);
      expect(t.byProject.reduce((s, g) => s + g.lines, 0)).toBe(n);
      expect(toCents(t.rebillable)).toBe(
        lines
          .filter((l) => l.rebillable && l.workProjectId !== null)
          .reduce((s, l) => s + toCents(l.amount), 0n),
      );
      const shuffled = [...lines].sort(() => (r() < 0.5 ? -1 : 1));
      expect(expenseReportTotals(shuffled)).toEqual(t);
    }
  });
});

describe('expenseApprovalSteps', () => {
  const flow = { approvalFlow: 'manager_then_finance' as const };
  it('manager puis finance', () => {
    expect(expenseApprovalSteps(flow, { managerEmployeeId: 'A', managerUserId: 'uA' }, 'uB')).toEqual({
      version: HR_VERSION,
      steps: ['manager', 'finance'],
      managerReplacedBy: null,
    });
  });
  it('finance seule : circuit, sans manager, manager sans compte, manager bénéficiaire', () => {
    const cases = [
      [{ approvalFlow: 'finance_only' as const }, { managerEmployeeId: 'A', managerUserId: 'uA' }, 'uB', 'FINANCE_ONLY_FLOW'],
      [flow, { managerEmployeeId: null, managerUserId: null }, 'uB', 'NO_MANAGER'],
      [flow, { managerEmployeeId: 'A', managerUserId: null }, 'uB', 'MANAGER_WITHOUT_ACCOUNT'],
      [flow, { managerEmployeeId: 'A', managerUserId: 'uA' }, 'uA', 'MANAGER_IS_BENEFICIARY'],
    ] as const;
    for (const [settings, employee, beneficiary, reason] of cases) {
      expect(expenseApprovalSteps(settings, employee, beneficiary)).toEqual({
        version: HR_VERSION,
        steps: ['finance'],
        managerReplacedBy: reason,
      });
    }
  });
  it('chauffeur sans compte (bénéficiaire nul) : le manager reste', () => {
    expect(
      expenseApprovalSteps(flow, { managerEmployeeId: 'A', managerUserId: 'uA' }, null).steps,
    ).toEqual(['manager', 'finance']);
  });
  it('circuit inconnu', () => {
    expect(() =>
      expenseApprovalSteps(
        { approvalFlow: 'manager_only' as never },
        { managerEmployeeId: null, managerUserId: null },
        null,
      ),
    ).toThrow(RangeError);
  });
});

describe('expenseSummary', () => {
  const reports: ExpenseSummaryReportInput[] = [
    {
      id: 'r1',
      currency: 'USD',
      status: 'reimbursed',
      departmentId: 'D1',
      lines: [
        { spentOn: '2026-10-03', category: 'transport', amount: '15.00', workProjectId: 'P' },
        { spentOn: '2026-10-03', category: 'charges_diverses', amount: '7.50' },
      ],
    },
    {
      id: 'r2',
      currency: 'USD',
      status: 'approved',
      departmentId: null,
      lines: [{ spentOn: '2026-10-20', category: 'transport', amount: '10.00', workProjectId: 'P' }],
    },
    {
      id: 'r3',
      currency: 'CDF',
      status: 'settled_by_advance',
      departmentId: 'D1',
      lines: [{ spentOn: '2026-10-21', category: 'transport', amount: '50000' }],
    },
    {
      id: 'r4',
      currency: 'USD',
      status: 'submitted',
      lines: [{ spentOn: '2026-10-21', category: 'transport', amount: '99.00' }],
    },
    {
      id: 'r5',
      currency: 'USD',
      status: 'reimbursed',
      lines: [{ spentOn: '2026-09-30', category: 'transport', amount: '1.00' }],
    },
  ];

  it('par catégorie : approuvées et réglées, par devise, fenêtre sur la date de ligne', () => {
    const r = expenseSummary(reports, '2026-10-01', '2026-10-31', 'category');
    expect(r.groups).toEqual([
      { key: 'transport', currency: 'CDF', total: '50000.00', lines: 1, reports: 1 },
      { key: 'transport', currency: 'USD', total: '25.00', lines: 2, reports: 2 },
      { key: 'charges_diverses', currency: 'USD', total: '7.50', lines: 1, reports: 1 },
    ]);
    expect(r.totals).toEqual([
      { currency: 'CDF', total: '50000.00', awaitingReimbursement: '0.00' },
      { currency: 'USD', total: '32.50', awaitingReimbursement: '10.00' },
    ]);
  });

  it('par service (jamais par personne) et par projet', () => {
    expect(expenseSummary(reports, '2026-10-01', '2026-10-31', 'department').groups).toEqual([
      { key: 'D1', currency: 'CDF', total: '50000.00', lines: 1, reports: 1 },
      { key: 'D1', currency: 'USD', total: '22.50', lines: 2, reports: 1 },
      { key: null, currency: 'USD', total: '10.00', lines: 1, reports: 1 },
    ]);
    expect(expenseSummary(reports, '2026-10-01', '2026-10-31', 'project').groups).toEqual([
      { key: null, currency: 'CDF', total: '50000.00', lines: 1, reports: 1 },
      { key: 'P', currency: 'USD', total: '25.00', lines: 2, reports: 2 },
      { key: null, currency: 'USD', total: '7.50', lines: 1, reports: 1 },
    ]);
  });

  it('entrées invalides', () => {
    expect(() => expenseSummary(reports, '2026-10-31', '2026-10-01', 'category')).toThrow(RangeError);
    expect(() => expenseSummary(reports, '2026-10-01', '2026-10-31', 'employee' as never)).toThrow(
      RangeError,
    );
  });

  it('propriété : Σ groupes = Σ totaux par devise, quel que soit le regroupement', { timeout: 120_000 }, () => {
    const r = rng(51);
    const statuses = [
      'draft',
      'submitted',
      'approved',
      'rejected',
      'reimbursed',
      'settled_by_advance',
      'partially_settled',
      'cancelled',
    ] as const;
    for (let run = 0; run < 300; run += 1) {
      const rs: ExpenseSummaryReportInput[] = Array.from({ length: int(r, 0, 20) }, (_, k) => ({
        id: `r${k}`,
        currency: pick(r, ['CDF', 'USD'] as const),
        status: pick(r, statuses),
        departmentId: r() < 0.3 ? null : pick(r, ['D1', 'D2']),
        lines: Array.from({ length: int(r, 1, 6) }, () => ({
          spentOn: `2026-${String(int(r, 9, 11)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`,
          category: pick(r, ALLOWED),
          amount: amountOf(int(r, 1, 100_000)),
          workProjectId: r() < 0.5 ? null : pick(r, ['P1', 'P2']),
        })),
      }));
      const expected = new Map<string, bigint>();
      for (const rep of rs) {
        if (!['approved', 'reimbursed', 'settled_by_advance', 'partially_settled'].includes(rep.status)) continue;
        for (const l of rep.lines) {
          if (l.spentOn < '2026-10-01' || l.spentOn > '2026-10-31') continue;
          expected.set(rep.currency, (expected.get(rep.currency) ?? 0n) + toCents(l.amount));
        }
      }
      for (const g of ['category', 'department', 'project'] as const) {
        const s = expenseSummary(rs, '2026-10-01', '2026-10-31', g);
        for (const t of s.totals) {
          expect(toCents(t.total)).toBe(expected.get(t.currency));
          expect(
            s.groups.filter((x) => x.currency === t.currency).reduce((a, x) => a + toCents(x.total), 0n),
          ).toBe(expected.get(t.currency));
          expect(toCents(t.awaitingReimbursement) <= toCents(t.total)).toBe(true);
        }
        expect(s.totals.map((t) => t.currency).sort()).toEqual([...expected.keys()].sort());
      }
    }
  });
});
