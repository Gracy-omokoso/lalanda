// Tests unitaires du lot H10 (ADR-0051 — H10) : catégories partagées = moteur, réglages
// par défaut prudents, portée des notes et des avances, répartition par l'avance.

import {
  EXPENSE_CATEGORY_CODES,
  EXPENSE_LINE_FORBIDDEN_CATEGORIES as ENGINE_FORBIDDEN,
  advanceSettlementPlan,
} from '@lalanda/engine';
import {
  EXPENSE_LINE_CATEGORIES,
  EXPENSE_LINE_FORBIDDEN_CATEGORIES,
  UpdateHrAdvancesSettingsBody,
} from '@lalanda/shared/hr';
import { describe, expect, it } from 'vitest';

import type { Action } from '../../authz/permissions.js';
import {
  advanceAccessOf,
  advanceInputOf,
  moneyStatusOf,
  seesAdvance,
} from '../advances/advance-model.js';
import { currentStepOf, financeApproverOf } from './hr-expenses.common.js';
import { expensesSettingsOf } from './hr-expenses-settings.service.js';
import { reportAccessOf, seesReceipts, seesReport } from './hr-expense-reports.service.js';

const viewerOf = (actions: Action[], self: string | null = null, team: string[] = []) => ({
  userId: 'u-viewer',
  actions: new Set<Action>(actions),
  scope: { selfEmployeeId: self, teamEmployeeIds: team } as never,
});

describe('catégories des lignes de frais', () => {
  it('égalent les catégories de dépense du moteur, moins investissement et emprunt', () => {
    const fromEngine = EXPENSE_CATEGORY_CODES.filter(
      (c) => !(ENGINE_FORBIDDEN as readonly string[]).includes(c),
    );
    expect([...EXPENSE_LINE_CATEGORIES]).toEqual([...fromEngine]);
    expect([...EXPENSE_LINE_FORBIDDEN_CATEGORIES].sort()).toEqual([...ENGINE_FORBIDDEN].sort());
    expect(EXPENSE_CATEGORY_CODES).toHaveLength(14);
    expect(EXPENSE_LINE_CATEGORIES).toHaveLength(12);
  });
});

describe('réglages par défaut (§ 2.7)', () => {
  it('sans document : frais ouverts, avance sur salaire éteinte, aucun plafond, déclaration éteinte', () => {
    const s = expensesSettingsOf(null);
    expect(s.expenses).toEqual({
      enabled: true,
      approvalFlow: 'manager_then_finance',
      receiptRequired: true,
      receiptsRetentionYears: null,
    });
    expect(s.advances).toEqual({
      enabled: { expenses: true, salary: false },
      maxAmount: { CDF: null, USD: null },
      allowDeclaredPayrollSettlement: false,
    });
    expect(s.revision).toBe(0);
  });

  it('une valeur hors contrat retombe sur le défaut prudent', () => {
    const s = expensesSettingsOf({
      expenses: { approvalFlow: 'nobody', enabled: 'oui' },
      advances: { enabled: { salary: 'yes' }, maxAmount: { USD: '-3', CDF: '0' } },
      revision: 4,
    });
    expect(s.expenses.approvalFlow).toBe('manager_then_finance');
    expect(s.expenses.enabled).toBe(true);
    expect(s.advances.enabled.salary).toBe(false);
    expect(s.advances.maxAmount).toEqual({ CDF: null, USD: null });
    expect(s.revision).toBe(4);
  });

  it('un plafond saisi est un montant positif, jamais un nombre', () => {
    expect(
      UpdateHrAdvancesSettingsBody.safeParse({
        expectedRevision: 0,
        maxAmount: { CDF: null, USD: 200 },
      }).success,
    ).toBe(false);
    expect(
      UpdateHrAdvancesSettingsBody.safeParse({
        expectedRevision: 0,
        maxAmount: { CDF: null, USD: '200.00' },
      }).success,
    ).toBe(true);
  });
});

describe('portée d’une note (§ 4)', () => {
  const r = { employeeId: 'e-b', createdBy: 'u-rh' };

  it('un brouillon : bénéficiaire et auteur seulement', () => {
    expect(seesReport(reportAccessOf(r, viewerOf([], 'e-b')), 'draft')).toBe(true);
    expect(seesReport(reportAccessOf(r, viewerOf(['expenses.approve'])), 'draft')).toBe(false);
    expect(seesReport(reportAccessOf(r, viewerOf([], null, ['e-b'])), 'draft')).toBe(false);
  });

  it('`hr.read` voit la note soumise, jamais son justificatif ; le payeur le voit', () => {
    const rh = reportAccessOf(r, viewerOf(['hr.read']));
    expect(seesReport(rh, 'submitted')).toBe(true);
    expect(seesReceipts(rh)).toBe(false);
    expect(seesReceipts(reportAccessOf(r, viewerOf(['payables.pay'])))).toBe(true);
    expect(seesReport(reportAccessOf(r, viewerOf([])), 'submitted')).toBe(false);
  });
});

describe('portée d’une avance sur salaire (§ 4)', () => {
  const salary = { kind: 'salary' as const, employeeId: 'e-b', createdBy: 'u-b' };
  const as = (actions: Action[], self: string | null = null, team: string[] = []) =>
    advanceAccessOf(salary, {
      userId: 'u-x',
      actions: new Set(actions),
      selfEmployeeId: self,
      teamEmployeeIds: team,
    });

  it('le manager et `hr.read` seul ne la voient pas', () => {
    expect(seesAdvance(as([], null, ['e-b']), 'submitted')).toBe(false);
    expect(seesAdvance(as(['hr.read']), 'submitted')).toBe(false);
    expect(seesAdvance(as(['expenses.approve']), 'submitted')).toBe(false);
  });

  it('validateur habilité : tout ; payeur : sans la nature', () => {
    const v = as(['expenses.approve', 'hr.sensitive.read']);
    expect(seesAdvance(v, 'submitted')).toBe(true);
    expect(v.sensitive).toBe(true);
    const p = as(['payables.pay']);
    expect(seesAdvance(p, 'approved')).toBe(true);
    expect(p.sensitive).toBe(false);
  });
});

describe('circuit et argent', () => {
  it('étape en cours et approbateur de l’étape finance', () => {
    const d = {
      status: 'submitted',
      steps: ['manager', 'finance'] as ('manager' | 'finance')[],
      approvals: [{ step: 'manager' as const, userId: 'a', decision: 'approved' as const }],
    };
    expect(currentStepOf(d)).toBe('finance');
    expect(financeApproverOf(d)).toBeNull();
    expect(
      financeApproverOf({
        ...d,
        approvals: [...d.approvals, { step: 'finance', userId: 'f', decision: 'approved' }],
      }),
    ).toBe('f');
  });

  it('note de 130,00 sur une avance de 100,00 : 100,00 couverts, 30,00 de complément ; avance soldée', () => {
    const advance = {
      kind: 'expenses' as const,
      currency: 'USD' as const,
      amount: '100.00',
      disbursement: { paidOn: '2026-10-01' } as never,
      settlements: [],
      expectedSettlement: null,
    };
    const plan = advanceSettlementPlan(advanceInputOf(advance), {
      currency: 'USD',
      lines: [{ amount: '100.00' }, { amount: '30.00' }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.fromAdvance).toBe('100.00');
    expect(plan.topUp).toBe('30.00');
    expect(
      moneyStatusOf(
        advanceInputOf(advance, [
          {
            id: '000000000000000000000001',
            kind: 'expense_report',
            amount: '100.00',
            on: '2026-10-02',
          },
        ]),
      ),
    ).toBe('settled');
    expect(
      moneyStatusOf(
        advanceInputOf(advance, [
          { id: '000000000000000000000001', kind: 'write_off', amount: '100.00', on: '2026-10-02' },
        ]),
      ),
    ).toBe('written_off');
  });

  it('un complément annulé est ignoré par le moteur', () => {
    const input = advanceInputOf({
      kind: 'expenses',
      currency: 'USD',
      amount: '100.00',
      disbursement: { paidOn: '2026-10-01' } as never,
      expectedSettlement: null,
      settlements: [
        {
          id: '000000000000000000000002',
          kind: 'cash_return',
          amount: '20.00',
          on: '2026-10-05',
          cancelledAt: new Date(),
        } as never,
      ],
    });
    expect(input.settlements).toHaveLength(0);
  });
});
