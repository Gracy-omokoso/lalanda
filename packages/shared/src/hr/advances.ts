// Avances au personnel (ADR-0051 § 1, § 2.2, § 3.2, § 3.3, § 4). ADR-0051 — H8.
//
// Libellé d'interface ↔ code : « Avance » = `EmployeeAdvance`, « Régularisation » =
// `AdvanceSettlement`.
//
// Contrats seulement. AUCUN plafond, aucune quotité, aucune retenue sur salaire n'est posé
// par Lalanda (J1) : un plafond SAISI par l'organisation est vide par défaut ; une avance
// sur salaire ne lit jamais le salaire. Le reste dû (`advanceOutstanding`) et la
// répartition d'une note entre l'avance et le complément (`advanceSettlementPlan`) sont
// calculés par le moteur (lot H9). Aucune régularisation n'est déclenchée par le temps.

import { z } from 'zod';

import {
  HrCalendarDay,
  HrCurrencySchema,
  HrExpectedRevision,
  HrId,
  HrPositiveAmount,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
} from './common.js';
import { HR_CURRENCIES, type HrCurrency } from './constants.js';
import { HrPaymentMethodSchema, hrPageLimit } from './expenses.js';

// ── Unions fermées ──────────────────────────────────────────────────────────

/** `expenses` : avance DE FRAIS, à justifier ; `salary` : avance SUR SALAIRE, sensible. */
export const ADVANCE_KINDS = ['expenses', 'salary'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];

/** Statut stocké (§ 2.2). `outstanding` n'est jamais stocké. */
export const ADVANCE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'disbursed',
  'partially_settled',
  'settled',
  'cancelled',
  'written_off',
] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

/** Natures de régularisation (§ 3.3), ajout seul. */
export const ADVANCE_SETTLEMENT_KINDS = [
  'expense_report',
  'cash_return',
  'declared_payroll',
  'top_up',
  'write_off',
] as const;
export type AdvanceSettlementKind = (typeof ADVANCE_SETTLEMENT_KINDS)[number];

/**
 * Régularisations saisies par une personne via `POST …/:id/settlements`. `expense_report`
 * et `top_up` naissent de l'approbation et du remboursement d'une note liée.
 */
export const ADVANCE_MANUAL_SETTLEMENT_KINDS = [
  'cash_return',
  'declared_payroll',
  'write_off',
] as const;
export type AdvanceManualSettlementKind = (typeof ADVANCE_MANUAL_SETTLEMENT_KINDS)[number];

/**
 * Libellé PARTAGÉ d'une avance : une liste vue par un tiers dit « Avance », jamais
 * « Avance sur salaire » (§ 10). Le mouvement de trésorerie ne porte pas le nom.
 */
export const HR_ADVANCE_NEUTRAL_LABEL = 'Avance';

/** Libellé neutre du mouvement de trésorerie : « Avance au personnel AV2611-000012 ». */
export function hrAdvanceMovementLabel(advanceNumber: string): string {
  return `Avance au personnel ${advanceNumber}`;
}

// ── Bornes et réglages ──────────────────────────────────────────────────────

export const ADVANCE_LIMITS = Object.freeze({
  reason: 500,
  purpose: 200,
  settlementsMax: 100,
  settlementNote: 500,
  reference: 120,
  comment: 2_000,
  cancelReason: 500,
});

/** Numéro d'avance : `AV{AA}{MM}-NNNNNN`, à la soumission (§ 1). */
export const ADVANCE_NUMBER_PATTERN = /^AV\d{4}-\d{6}$/;

/** Mois de régularisation annoncé : `AAAA-MM` (informatif). */
export const ADVANCE_EXPECTED_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Réglages `hr_settings.advances` par défaut (§ 2.7, décisions ouvertes n° 4 et 5) :
 * avance sur salaire ÉTEINTE, régularisation déclarée sur la paie ÉTEINTE jusqu'à la
 * réponse du juriste, aucun plafond.
 */
export const HR_ADVANCES_SETTINGS_DEFAULTS = Object.freeze({
  enabled: Object.freeze({ expenses: true, salary: false }),
  maxAmount: Object.freeze({ CDF: null, USD: null } as Record<HrCurrency, string | null>),
  allowDeclaredPayrollSettlement: false,
});

// ── Codes ───────────────────────────────────────────────────────────────────

export const HR_ADVANCES_ERROR_CODES = [
  'HR_FEATURE_DISABLED',
  'EMPLOYEE_NOT_LINKED',
  'ADVANCE_KIND_DISABLED',
  'ADVANCE_ABOVE_ORGANIZATION_LIMIT',
  'ADVANCE_SALARY_NOT_YOUR_STEP',
  'ADVANCE_SETTLEMENT_EXCEEDS_OUTSTANDING',
  'ADVANCE_DECLARED_PAYROLL_DISABLED',
  'SELF_APPROVAL_FORBIDDEN',
  'CREATOR_APPROVAL_FORBIDDEN',
  'APPROVER_ALREADY_APPROVED',
  'EXPENSE_NOT_YOUR_STEP',
  'SELF_PAYMENT_FORBIDDEN',
  'APPROVER_CANNOT_PAY',
  'MOVEMENT_OWNED_BY_HR',
  'STALE_REVISION',
] as const;
export type HrAdvancesErrorCode = (typeof HR_ADVANCES_ERROR_CODES)[number];

/** Constats du moteur (§ 7.2) : des faits, jamais une retenue. */
export const HR_ADVANCES_FINDING_CODES = ['ADVANCE_SETTLED_ON_PAYROLL', 'ADVANCE_OVERDUE'] as const;
export type HrAdvancesFindingCode = (typeof HR_ADVANCES_FINDING_CODES)[number];

/** Lecture du motif d'une avance sur salaire : audit STRICT (§ 4). */
export const HR_ADVANCES_AUDIT_EVENTS = [
  'hr.advance.reason_revealed',
  'hr.advance.disbursed',
  'hr.advance.settled',
  'hr.advance.written_off',
] as const;
export type HrAdvancesAuditEvent = (typeof HR_ADVANCES_AUDIT_EVENTS)[number];

// ── Corps ───────────────────────────────────────────────────────────────────

const expectedSettlement = z
  .string(hrFr('Date ou mois attendu.'))
  .refine((v) => ADVANCE_EXPECTED_MONTH_PATTERN.test(v) || HrCalendarDay.safeParse(v).success, {
    message: 'Date AAAA-MM-JJ ou mois AAAA-MM attendu.',
    params: { code: 'INVALID_DATE' },
  });

/**
 * `POST /hr/advances` — `expenses.claim`. Le plafond saisi par l'organisation et
 * l'activation du type sont vérifiés par l'API. `purpose` et `workProjectId` ne valent
 * que pour une avance de frais ; le motif d'une avance sur salaire est chiffré.
 */
export const CreateAdvanceBody = z
  .object({
    employeeId: HrId.optional(),
    kind: z.enum(ADVANCE_KINDS, hrFr('Nature attendue : expenses ou salary.')),
    amount: HrPositiveAmount,
    currency: HrCurrencySchema,
    reason: hrOptionalText(ADVANCE_LIMITS.reason).optional(),
    purpose: hrOptionalText(ADVANCE_LIMITS.purpose).optional(),
    workProjectId: HrId.nullable().optional(),
    expectedSettlement: expectedSettlement.nullable().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (
      b.kind === 'salary' &&
      ((b.purpose ?? null) !== null || (b.workProjectId ?? null) !== null)
    ) {
      hrIssue(
        ctx,
        'ADVANCE_SALARY_NO_PURPOSE',
        'Une avance sur salaire ne porte ni objet de mission ni projet.',
        ['kind'],
      );
    }
  });
export type CreateAdvanceBody = z.output<typeof CreateAdvanceBody>;

/** `PUT /hr/advances/:id` — brouillon seulement ; la nature ne change pas. */
export const UpdateAdvanceBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    amount: HrPositiveAmount.optional(),
    currency: HrCurrencySchema.optional(),
    reason: hrOptionalText(ADVANCE_LIMITS.reason).optional(),
    purpose: hrOptionalText(ADVANCE_LIMITS.purpose).optional(),
    workProjectId: HrId.nullable().optional(),
    expectedSettlement: expectedSettlement.nullable().optional(),
  })
  .strict();
export type UpdateAdvanceBody = z.output<typeof UpdateAdvanceBody>;

/** `POST /hr/advances/:id/disburse` — `payables.pay` + `treasury.read`. */
export const DisburseAdvanceBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    paidOn: HrCalendarDay,
    accountId: HrId,
    method: HrPaymentMethodSchema,
    reference: hrOptionalText(ADVANCE_LIMITS.reference).optional(),
  })
  .strict();
export type DisburseAdvanceBody = z.output<typeof DisburseAdvanceBody>;

/** `POST /hr/advances/:id/disbursement/cancel` — motif obligatoire. */
export const CancelDisbursementBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    reason: hrRequiredText(ADVANCE_LIMITS.cancelReason, 'Motif'),
  })
  .strict();
export type CancelDisbursementBody = z.output<typeof CancelDisbursementBody>;

/**
 * `POST /hr/advances/:id/settlements` — régularisation saisie (§ 3.3). `cash_return`
 * exige un compte ; `declared_payroll` un mois (`AAAA-MM`) dans `reference` ;
 * `write_off` un motif. Jamais automatique.
 */
export const CreateAdvanceSettlementBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    kind: z.enum(
      ADVANCE_MANUAL_SETTLEMENT_KINDS,
      hrFr('Nature attendue : cash_return, declared_payroll ou write_off.'),
    ),
    amount: HrPositiveAmount,
    on: HrCalendarDay,
    accountId: HrId.nullable().optional(),
    reference: hrOptionalText(ADVANCE_LIMITS.reference).optional(),
    note: hrOptionalText(ADVANCE_LIMITS.settlementNote).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.kind === 'cash_return' && (b.accountId ?? null) === null) {
      hrIssue(ctx, 'ADVANCE_SETTLEMENT_ACCOUNT_REQUIRED', 'Le compte qui reçoit est requis.', [
        'accountId',
      ]);
    }
    if (b.kind === 'declared_payroll' && !ADVANCE_EXPECTED_MONTH_PATTERN.test(b.reference ?? '')) {
      hrIssue(
        ctx,
        'ADVANCE_SETTLEMENT_MONTH_REQUIRED',
        'Indiquez le mois de paie (AAAA-MM) sur lequel l’avance a été régularisée.',
        ['reference'],
      );
    }
    if (b.kind === 'write_off' && (b.note ?? null) === null) {
      hrIssue(ctx, 'ADVANCE_WRITE_OFF_REASON_REQUIRED', 'Un abandon porte un motif.', ['note']);
    }
  });
export type CreateAdvanceSettlementBody = z.output<typeof CreateAdvanceSettlementBody>;

/** `GET /hr/advances`. */
export const ListAdvancesQuery = z
  .object({
    employeeId: HrId.optional(),
    status: z.enum(ADVANCE_STATUSES).optional(),
    kind: z.enum(ADVANCE_KINDS).optional(),
    cursor: z.string().max(200).optional(),
    limit: hrPageLimit,
  })
  .strict();
export type ListAdvancesQuery = z.output<typeof ListAdvancesQuery>;

/** Plafonds saisis par l'organisation (`hr_settings.advances.maxAmount`), vides par défaut. */
export const AdvanceMaxAmountSchema = z
  .object(
    Object.fromEntries(HR_CURRENCIES.map((c) => [c, HrPositiveAmount.nullable()])) as Record<
      HrCurrency,
      z.ZodNullable<typeof HrPositiveAmount>
    >,
  )
  .strict();
export type AdvanceMaxAmountInput = z.output<typeof AdvanceMaxAmountSchema>;
