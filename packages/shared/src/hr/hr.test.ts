import { describe, expect, it } from 'vitest';

import {
  EMPLOYEE_EXIT_CATEGORIES,
  EMPLOYEE_STATUSES,
  HR_APPROVAL_FLOWS,
  HR_DEFAULT_CONTRACT_TYPES,
  HR_DEFAULT_LEAVE_TYPES,
  HR_DOCUMENT_CATEGORIES,
  HR_EMPLOYEE_VISIBLE_DOCUMENT_CATEGORIES,
  HR_ERROR_CODES,
  HR_PRIVATE_SECTIONS,
  HR_SENSITIVE_DOCUMENT_CATEGORIES,
  HR_SETTINGS_DEFAULTS,
  HrCalendarDay,
  HrContractTypeSchema,
  HrId,
  HrMonthDay,
  HrPositiveAmount,
  HrWorkPatternSchema,
  LEAVE_LEDGER_KINDS,
  LeaveBoundarySchema,
  canonicalHrDays,
  employeeNumberKey,
  hrDaysSchema,
  isHrCalendarDay,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

describe('RH — constantes (ADR-0045 § 1, § 2)', () => {
  it('statuts stockés : « à venir » et « en essai » sont dérivés, jamais stockés', () => {
    expect([...EMPLOYEE_STATUSES]).toEqual(['active', 'exited', 'anonymized']);
    expect(EMPLOYEE_EXIT_CATEGORIES).toHaveLength(7);
  });

  it('réglages par défaut : lundi à vendredi, manager seul, aucune purge (décisions ouvertes)', () => {
    expect(HR_SETTINGS_DEFAULTS.workPattern).toEqual({
      mon: 1,
      tue: 1,
      wed: 1,
      thu: 1,
      fri: 1,
      sat: 0,
      sun: 0,
    });
    expect(HR_SETTINGS_DEFAULTS.leaveYearStart).toBe('01-01');
    expect(HR_SETTINGS_DEFAULTS.approvalFlow).toBe('manager_only');
    expect(HR_APPROVAL_FLOWS).toContain(HR_SETTINGS_DEFAULTS.approvalFlow);
    expect(HR_SETTINGS_DEFAULTS.allowSoleApprover).toBe(true);
    expect(HR_SETTINGS_DEFAULTS.reminders).toEqual({
      probationEnd: 15,
      contractEnd: 30,
      documentExpiry: 30,
    });
    expect(HR_SETTINGS_DEFAULTS.teamCalendarVisibility).toBe('department');
    expect(HR_SETTINGS_DEFAULTS.orgChartVisibility).toBe('members');
    expect(HR_SETTINGS_DEFAULTS.retention).toEqual({
      privateDataMonthsAfterExit: null,
      anonymizeYearsAfterExit: null,
    });
  });

  it('types de contrat proposés : six, CDD et Stage avec date de fin', () => {
    expect(HR_DEFAULT_CONTRACT_TYPES.map((c) => c.key)).toEqual([
      'permanent',
      'fixed_term',
      'internship',
      'freelance',
      'daily',
      'other',
    ]);
    expect(HR_DEFAULT_CONTRACT_TYPES.filter((c) => c.hasEndDate).map((c) => c.key)).toEqual([
      'fixed_term',
      'internship',
    ]);
    for (const c of HR_DEFAULT_CONTRACT_TYPES) {
      expect(HrContractTypeSchema.safeParse(c).success, c.key).toBe(true);
    }
  });

  it('types d’absence proposés : aucun droit chiffré, « Maladie » confidentiel (critère 21)', () => {
    expect(HR_DEFAULT_LEAVE_TYPES.map((t) => t.label)).toEqual([
      'Congés',
      'Maladie',
      'Absence autorisée',
      'Absence non justifiée',
    ]);
    for (const t of HR_DEFAULT_LEAVE_TYPES) expect(t).not.toHaveProperty('accrual');
    expect(HR_DEFAULT_LEAVE_TYPES.filter((t) => t.confidential).map((t) => t.label)).toEqual([
      'Maladie',
    ]);
    expect(HR_DEFAULT_LEAVE_TYPES.filter((t) => t.deductsFromBalance).map((t) => t.label)).toEqual([
      'Congés',
    ]);
  });

  it('sections sensibles, grand livre et documents', () => {
    expect([...HR_PRIVATE_SECTIONS]).toEqual([
      'compensation',
      'bankDetails',
      'identity',
      'personalContact',
    ]);
    expect(LEAVE_LEDGER_KINDS).toHaveLength(7);
    for (const c of HR_SENSITIVE_DOCUMENT_CATEGORIES) expect(HR_DOCUMENT_CATEGORIES).toContain(c);
    for (const c of HR_EMPLOYEE_VISIBLE_DOCUMENT_CATEGORIES) {
      expect(HR_SENSITIVE_DOCUMENT_CATEGORIES).not.toContain(c);
    }
  });

  it('codes d’erreur nommés, sans doublon', () => {
    expect(new Set(HR_ERROR_CODES).size).toBe(HR_ERROR_CODES.length);
    for (const code of [
      'EMPLOYEE_USER_ALREADY_LINKED',
      'MANAGER_CYCLE',
      'LEAVE_NO_WORKING_DAY',
      'LEAVE_OVERLAP',
      'SELF_APPROVAL_FORBIDDEN',
      'LEAVE_NOT_YOUR_STEP',
      'APPROVER_ALREADY_APPROVED',
      'HR_REVEAL_RATE_LIMITED',
    ]) {
      expect(HR_ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('matricule : majuscules, sans espace ni tiret', () => {
    expect(employeeNumberKey('ab-01 2')).toBe('AB012');
  });
});

describe('RH — briques de schéma', () => {
  it('identifiant Mongo ramené en minuscules', () => {
    expect(HrId.parse('64B7F0C2A1D3E4F5A6B7C8D9')).toBe('64b7f0c2a1d3e4f5a6b7c8d9');
    expect(codes(HrId.safeParse('xyz'))).toEqual(['HR_ID_INVALID']);
  });

  it('dates civiles et jour de l’année', () => {
    expect(isHrCalendarDay('2028-02-29')).toBe(true);
    expect(isHrCalendarDay('2027-02-29')).toBe(false);
    expect(codes(HrCalendarDay.safeParse('2026-13-01'))).toEqual(['INVALID_DATE']);
    expect(HrMonthDay.safeParse('01-01').success).toBe(true);
    expect(codes(HrMonthDay.safeParse('02-29'))).toEqual(['INVALID_MONTH_DAY']);
  });

  it('salaire déclaré : chaîne, deux décimales, strictement positif', () => {
    expect(HrPositiveAmount.parse('450000.5')).toBe('450000.50');
    expect(codes(HrPositiveAmount.safeParse(450000))).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(codes(HrPositiveAmount.safeParse('0'))).toEqual(['AMOUNT_NOT_POSITIVE']);
    expect(codes(HrPositiveAmount.safeParse('1.234'))).toEqual(['INVALID_AMOUNT']);
  });

  it('durées en jours : chaînes, deux décimales, signe sur demande', () => {
    expect(canonicalHrDays('2.5')).toBe('2.50');
    expect(canonicalHrDays('-1')).toBe('-1.00');
    expect(canonicalHrDays('-0')).toBe('0.00');
    expect(canonicalHrDays('1.005')).toBeNull();
    expect(hrDaysSchema().parse('1.03')).toBe('1.03');
    expect(codes(hrDaysSchema().safeParse('-1'))).toEqual(['DAYS_NEGATIVE']);
    expect(hrDaysSchema({ signed: true }).parse('-1.5')).toBe('-1.50');
    expect(codes(hrDaysSchema({ nonZero: true }).safeParse('0'))).toEqual(['DAYS_ZERO']);
    expect(codes(hrDaysSchema({ maxAbs: 60 }).safeParse('60.01'))).toEqual(['DAYS_TOO_LARGE']);
    expect(hrDaysSchema({ maxAbs: 60 }).parse('60')).toBe('60.00');
    expect(codes(hrDaysSchema().safeParse(2))).toEqual(['DECIMAL_MUST_BE_STRING']);
  });

  it('semaine de travail : fractions 0, 0,5 ou 1, au moins un jour, corps strict', () => {
    expect(HrWorkPatternSchema.safeParse(HR_SETTINGS_DEFAULTS.workPattern).success).toBe(true);
    const vide = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
    expect(codes(HrWorkPatternSchema.safeParse(vide))).toEqual(['WORK_PATTERN_EMPTY']);
    expect(
      codes(HrWorkPatternSchema.safeParse({ ...HR_SETTINGS_DEFAULTS.workPattern, sat: 0.25 })),
    ).toEqual(['WORK_FRACTION_INVALID']);
    expect(
      HrWorkPatternSchema.safeParse({ ...HR_SETTINGS_DEFAULTS.workPattern, extra: 1 }).success,
    ).toBe(false);
  });

  it('borne de demande : date et demi-journée', () => {
    expect(LeaveBoundarySchema.parse({ date: '2026-11-02', half: 'am' })).toEqual({
      date: '2026-11-02',
      half: 'am',
    });
    expect(LeaveBoundarySchema.safeParse({ date: '2026-11-02', half: 'night' }).success).toBe(
      false,
    );
  });
});
