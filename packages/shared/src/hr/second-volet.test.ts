// ADR-0051 — H8 : contrats du second volet RH (frais, avances, présences, plannings,
// objectifs et évaluations). Valeurs par défaut prudentes, aucune règle légale, schémas.

import { describe, expect, it } from 'vitest';

import {
  ADVANCE_KINDS,
  ATTENDANCE_FORBIDDEN_FIELDS,
  AdvanceMaxAmountSchema,
  ClockAttendanceBody,
  CreateAdvanceBody,
  CreateAdvanceSettlementBody,
  CreateAttendanceCorrectionBody,
  CreateExpenseReportBody,
  CreateReviewCycleBody,
  CreateShiftBody,
  EXPENSE_LINE_CATEGORIES,
  EXPENSE_REPORT_NUMBER_PATTERN,
  ADVANCE_NUMBER_PATTERN,
  ExpenseLineSchema,
  GoalProgressBody,
  HR_ADVANCES_SETTINGS_DEFAULTS,
  HR_ATTENDANCE_SETTINGS_DEFAULTS,
  HR_DEFAULT_REVIEW_TEMPLATE_TITLES,
  HR_EXPENSES_SETTINGS_DEFAULTS,
  HR_PERFORMANCE_SETTINGS_DEFAULTS,
  HR_PLANNING_SETTINGS_DEFAULTS,
  REVIEW_SECTIONS,
  RevealReviewBody,
  StaffingNeedBody,
  WriteReviewSectionBody,
  hrAdvanceMovementLabel,
  shiftDurationMinutes,
} from './index.js';

const codes = (r: { success: boolean; error?: { issues: { params?: unknown }[] } }): string[] =>
  (r.error?.issues ?? []).map((i) => (i.params as { code?: string } | undefined)?.code ?? '');

const ligne = {
  spentOn: '2026-11-03',
  category: 'transport',
  label: 'Taxi aéroport',
  amount: '15.00',
};

describe('ADR-0051 § 2.7 — valeurs par défaut prudentes (décisions ouvertes)', () => {
  it('frais ouverts, avance sur salaire et régularisation sur la paie éteintes, aucun plafond', () => {
    expect(HR_EXPENSES_SETTINGS_DEFAULTS).toEqual({
      enabled: true,
      approvalFlow: 'manager_then_finance',
      receiptRequired: true,
    });
    expect(HR_ADVANCES_SETTINGS_DEFAULTS).toEqual({
      enabled: { expenses: true, salary: false },
      maxAmount: { CDF: null, USD: null },
      allowDeclaredPayrollSettlement: false,
    });
  });

  it('pointage, plannings, objectifs et évaluations éteints ; aucun seuil légal', () => {
    expect(HR_ATTENDANCE_SETTINGS_DEFAULTS).toEqual({
      enabled: false,
      selfClock: true,
      lateToleranceMinutes: null,
    });
    expect(HR_PLANNING_SETTINGS_DEFAULTS).toEqual({
      enabled: false,
      indicativeMaxMinutesPerWeek: null,
    });
    expect(HR_PERFORMANCE_SETTINGS_DEFAULTS).toEqual({ enabled: false, managerChainDepth: 1 });
  });

  it('trame proposée : des titres seulement, sans échelle', () => {
    expect(HR_DEFAULT_REVIEW_TEMPLATE_TITLES).toEqual([
      'Bilan de la période',
      'Objectifs',
      'Besoins de formation',
      'Commentaire du collaborateur',
    ]);
  });
});

describe('ADR-0051 § 2.1 — notes de frais', () => {
  it('douze catégories : les quatorze d’ADR-0034 moins investissement et emprunt', () => {
    expect(EXPENSE_LINE_CATEGORIES).toHaveLength(12);
    const r = ExpenseLineSchema.safeParse({ ...ligne, category: 'investissement' });
    expect(codes(r)).toContain('EXPENSE_LINE_CATEGORY_NOT_ALLOWED');
  });

  it('montant en chaîne, TVA déclarée ≤ montant, refacturable seulement avec un projet', () => {
    expect(ExpenseLineSchema.parse({ ...ligne, amount: '7.5' }).amount).toBe('7.50');
    expect(codes(ExpenseLineSchema.safeParse({ ...ligne, amount: 15 }))).toContain(
      'DECIMAL_MUST_BE_STRING',
    );
    expect(codes(ExpenseLineSchema.safeParse({ ...ligne, deductibleVat: '16.00' }))).toContain(
      'EXPENSE_VAT_ABOVE_AMOUNT',
    );
    expect(codes(ExpenseLineSchema.safeParse({ ...ligne, rebillable: true }))).toContain(
      'EXPENSE_REBILLABLE_WITHOUT_PROJECT',
    );
    expect(
      ExpenseLineSchema.safeParse({
        ...ligne,
        rebillable: true,
        workProjectId: 'a'.repeat(24),
      }).success,
    ).toBe(true);
  });

  it('aucun barème : un champ inconnu (indemnité, forfait) est refusé', () => {
    expect(ExpenseLineSchema.safeParse({ ...ligne, perDiem: '10.00' }).success).toBe(false);
  });

  it('une devise par note, 1 à 50 lignes, numérotation NF', () => {
    expect(
      CreateExpenseReportBody.safeParse({ title: 'Mission', currency: 'USD', lines: [ligne] })
        .success,
    ).toBe(true);
    expect(
      CreateExpenseReportBody.safeParse({ title: 'Mission', currency: 'EUR', lines: [ligne] })
        .success,
    ).toBe(false);
    expect(
      CreateExpenseReportBody.safeParse({ title: 'Mission', currency: 'USD', lines: [] }).success,
    ).toBe(false);
    expect(EXPENSE_REPORT_NUMBER_PATTERN.test('NF2611-000012')).toBe(true);
  });
});

describe('ADR-0051 § 2.2, § 3.3 — avances', () => {
  it('deux natures ; aucun plafond imposé ; plafond saisi facultatif', () => {
    expect(ADVANCE_KINDS).toEqual(['expenses', 'salary']);
    expect(
      CreateAdvanceBody.safeParse({ kind: 'expenses', amount: '1000000.00', currency: 'CDF' })
        .success,
    ).toBe(true);
    expect(AdvanceMaxAmountSchema.parse({ CDF: null, USD: '200' })).toEqual({
      CDF: null,
      USD: '200.00',
    });
    expect(ADVANCE_NUMBER_PATTERN.test('AV2611-000012')).toBe(true);
  });

  it('une avance sur salaire ne porte ni objet de mission ni projet', () => {
    expect(
      codes(
        CreateAdvanceBody.safeParse({
          kind: 'salary',
          amount: '50.00',
          currency: 'USD',
          purpose: 'Mission',
        }),
      ),
    ).toContain('ADVANCE_SALARY_NO_PURPOSE');
  });

  it('libellé de trésorerie neutre : numéro, jamais le nom ni la nature', () => {
    expect(hrAdvanceMovementLabel('AV2611-000012')).toBe('Avance au personnel AV2611-000012');
  });

  it('régularisations saisies : retour d’espèces avec compte, paie avec mois, abandon motivé', () => {
    const base = { expectedRevision: 1, amount: '20.00', on: '2026-11-10' };
    expect(
      codes(CreateAdvanceSettlementBody.safeParse({ ...base, kind: 'cash_return' })),
    ).toContain('ADVANCE_SETTLEMENT_ACCOUNT_REQUIRED');
    expect(
      codes(CreateAdvanceSettlementBody.safeParse({ ...base, kind: 'declared_payroll' })),
    ).toContain('ADVANCE_SETTLEMENT_MONTH_REQUIRED');
    expect(
      CreateAdvanceSettlementBody.safeParse({
        ...base,
        kind: 'declared_payroll',
        reference: '2026-11',
      }).success,
    ).toBe(true);
    expect(codes(CreateAdvanceSettlementBody.safeParse({ ...base, kind: 'write_off' }))).toContain(
      'ADVANCE_WRITE_OFF_REASON_REQUIRED',
    );
    // `expense_report` et `top_up` ne se saisissent pas : ils naissent d'une note liée.
    expect(
      CreateAdvanceSettlementBody.safeParse({ ...base, kind: 'top_up', accountId: 'a'.repeat(24) })
        .success,
    ).toBe(false);
  });
});

describe('ADR-0051 § 2.3 — pointage simple', () => {
  it('« J’arrive » ne porte que sa nature : ni position, ni appareil, ni horodatage client', () => {
    expect(ClockAttendanceBody.parse({ kind: 'in' })).toEqual({ kind: 'in' });
    for (const field of ATTENDANCE_FORBIDDEN_FIELDS) {
      expect(ClockAttendanceBody.safeParse({ kind: 'in', [field]: 'x' }).success, field).toBe(
        false,
      );
    }
    expect(ClockAttendanceBody.safeParse({ kind: 'in', at: '2026-11-02T07:02:00Z' }).success).toBe(
      false,
    );
  });

  it('une correction propose ou annule au moins un pointage, avec un motif', () => {
    expect(
      codes(
        CreateAttendanceCorrectionBody.safeParse({
          date: '2026-11-02',
          proposed: [],
          voidEventIds: [],
          reason: 'Oubli',
        }),
      ),
    ).toContain('ATTENDANCE_CORRECTION_EMPTY');
    expect(
      CreateAttendanceCorrectionBody.safeParse({
        date: '2026-11-02',
        proposed: [{ kind: 'out', at: '2026-11-02T16:10:00Z' }],
        voidEventIds: [],
        reason: 'Oubli du départ',
      }).success,
    ).toBe(true);
  });
});

describe('ADR-0051 § 2.4 — plannings', () => {
  const creneau = {
    employeeId: 'a'.repeat(24),
    date: '2026-11-02',
    start: '22:00',
    end: '06:00',
  };

  it('durée ≤ 24 h ; un créneau de nuit se déclare', () => {
    expect(codes(CreateShiftBody.safeParse(creneau))).toContain('SHIFT_EMPTY');
    expect(CreateShiftBody.safeParse({ ...creneau, crossesMidnight: true }).success).toBe(true);
    expect(shiftDurationMinutes('22:00', '06:00', true)).toBe(480);
    expect(codes(CreateShiftBody.safeParse({ ...creneau, start: '24:00' }))).toContain(
      'INVALID_TIME',
    );
  });

  it('un besoin minimal vise un service OU un lieu', () => {
    const besoin = { weekday: 'mon', start: '08:00', end: '12:00', minStaff: 2 };
    expect(codes(StaffingNeedBody.safeParse(besoin))).toContain('STAFFING_NEED_TARGET');
    expect(StaffingNeedBody.safeParse({ ...besoin, location: 'Accueil' }).success).toBe(true);
  });
});

describe('ADR-0051 § 2.5, § 2.6 — objectifs et évaluations', () => {
  it('quatre sections chiffrées ; `reveal` les nomme, jamais de contenu dans la requête', () => {
    expect(REVIEW_SECTIONS).toEqual([
      'selfAssessment',
      'managerAssessment',
      'employeeComment',
      'hrNote',
    ]);
    expect(RevealReviewBody.safeParse({ sections: ['managerAssessment'] }).success).toBe(true);
    expect(RevealReviewBody.safeParse({ sections: [] }).success).toBe(false);
  });

  it('l’échelle est saisie par l’organisation ; une section notée la porte', () => {
    const cycle = {
      label: 'Revue 2026',
      period: { from: '2026-01-01', to: '2026-12-31' },
      template: { sections: [{ id: 'bilan', title: 'Bilan', kind: 'scale' }] },
      openOn: '2026-12-01',
      dueOn: '2026-12-31',
      employeeIds: [],
    };
    expect(codes(CreateReviewCycleBody.safeParse(cycle))).toContain('REVIEW_SCALE_REQUIRED');
    const ok = CreateReviewCycleBody.parse({
      ...cycle,
      template: {
        sections: [
          { id: 'bilan', title: 'Bilan', kind: 'scale', scale: { min: 1, max: 4, labels: [] } },
        ],
      },
    });
    expect(ok.includesSelfAssessment).toBe(true);
  });

  it('aucune note calculée : `overall` est facultatif et choisi ; l’avancement est déclaré', () => {
    expect(WriteReviewSectionBody.parse({ expectedRevision: 1, answers: {} }).overall).toBe(
      undefined,
    );
    expect(GoalProgressBody.safeParse({ percent: 101, note: 'x' }).success).toBe(false);
    expect(GoalProgressBody.safeParse({ percent: 40, note: 'À mi-parcours' }).success).toBe(true);
  });
});
