// Absences et congés — corps de requête, requêtes et vues (ADR-0045 § 2.2, § 2.5 à
// § 2.7, § 3.2, § 3.3, § 6.1). ADR-0045 — H3.
//
// Types d'absence paramétrables (dont « saisi par les RH seulement »), jours fériés
// (liste VIDE par défaut), demandes et circuit de validation, grand livre des soldes,
// calendrier, réglages RH en écriture et élément `hr` de « Mes tâches ». Aucune règle
// légale : aucune durée de congé, aucun férié n'est posé par Lalanda (décisions
// ouvertes n° 7 et n° 12). Durées en CHAÎNES décimales, calculées par le moteur.
// Ici, la FORME seulement : les règles qui exigent la base (type actif de
// l'organisation, chevauchement, solde, séparation des tâches) sont vérifiées par l'API.

import { z } from 'zod';

import {
  HrCalendarDay,
  HrContractTypeSchema,
  HrExpectedRevision,
  HrId,
  HrMonthDay,
  HrWorkPatternSchema,
  LeaveBoundarySchema,
  hrDaysSchema,
  hrFr,
  hrIssue,
  hrOptionalText,
  hrRequiredText,
  type LeaveBoundary,
} from './common.js';
import {
  HR_APPROVAL_FLOWS,
  HR_CALENDAR_SCOPES,
  HR_HOLIDAY_HALVES,
  HR_LIMITS,
  HR_ORG_CHART_VISIBILITIES,
  HR_PAGE_LIMIT_DEFAULT,
  HR_PAGE_LIMIT_MAX,
  HR_TEAM_CALENDAR_VISIBILITIES,
  LEAVE_ACCRUAL_KINDS,
  LEAVE_LEDGER_KINDS,
  LEAVE_MANUAL_LEDGER_KINDS,
  LEAVE_PRORATIONS,
  LEAVE_REQUEST_STATUSES,
  LEAVE_UNITS,
  LEAVE_YEARLY_ACCRUAL_ON,
  type HrHolidayHalf,
  type LeaveApprovalDecisionValue,
  type LeaveApprovalStepKey,
  type LeaveLedgerKind,
  type LeaveProration,
  type LeaveRequestStatus,
  type LeaveUnit,
} from './constants.js';

const L = HR_LIMITS;

/** Codes propres au lot H3, en plus de ceux nommés par l'ADR (`HR_ERROR_CODES`). */
export const HR_H3_ERROR_CODES = [
  'LEAVE_TYPE_NOT_FOUND',
  'LEAVE_TYPE_ARCHIVED',
  'LEAVE_TYPE_LABEL_EXISTS',
  'LEAVE_TYPE_HR_ONLY',
  'LEAVE_HALF_DAY_NOT_ALLOWED',
  'LEAVE_END_BEFORE_START',
  'LEAVE_TOO_LONG',
  'LEAVE_REQUEST_NOT_FOUND',
  'LEAVE_NOT_PENDING',
  'LEAVE_NOT_CANCELLABLE',
  'LEAVE_ALREADY_STARTED',
  'LEAVE_CANCEL_FORBIDDEN',
  'LEAVE_CANCEL_REASON_REQUIRED',
  'HOLIDAY_NOT_FOUND',
  'HOLIDAY_EXISTS',
  'HR_CALENDAR_RANGE',
] as const;
export type HrH3ErrorCode = (typeof HR_H3_ERROR_CODES)[number];

/** Libellé de forme de l'élément « absence à valider » de « Mes tâches » (§ 8). */
export const HR_LEAVE_APPROVAL_KIND_LABEL = 'Validation d’absence';

// ── Types d'absence (§ 2.5) ─────────────────────────────────────────────────

const accrualDays = hrDaysSchema({ maxAbs: L.accrualDaysMax });

/** Acquisition : `none` par défaut, aucun droit n'est posé par Lalanda (décision n° 7). */
export const LeaveAccrualSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('none') }).strict(),
    z.object({ kind: z.literal('monthly'), days: accrualDays }).strict(),
    z
      .object({
        kind: z.literal('yearly'),
        days: accrualDays,
        on: z.enum(LEAVE_YEARLY_ACCRUAL_ON, hrFr('« leave_year_start » ou « anniversary ».')),
      })
      .strict(),
  ],
  hrFr(`Acquisition attendue : ${LEAVE_ACCRUAL_KINDS.join(', ')}.`),
);
export type LeaveAccrualInput = z.output<typeof LeaveAccrualSchema>;

export const LeaveCarryOverSchema = z
  .object({
    maxDays: hrDaysSchema({ maxAbs: L.carryOverMaxDays }).nullable(),
    expiresAfterMonths: z
      .number(hrFr('Nombre de mois attendu.'))
      .int({ message: 'Nombre de mois entier attendu.' })
      .min(1, { message: '1 mois au moins.' })
      .max(L.carryOverExpiresAfterMonthsMax, {
        message: `${L.carryOverExpiresAfterMonthsMax} mois au plus.`,
      })
      .nullable(),
  })
  .strict();
export type LeaveCarryOverInput = z.output<typeof LeaveCarryOverSchema>;

const leaveTypeFields = {
  label: hrRequiredText(L.leaveTypeLabel, 'Libellé'),
  unit: z.enum(LEAVE_UNITS, hrFr('Unité attendue : day ou half_day.')),
  deductsFromBalance: z.boolean(hrFr('Booléen attendu.')),
  accrual: LeaveAccrualSchema,
  proration: z.enum(LEAVE_PRORATIONS, hrFr('Prorata attendu : calendar_days ou none.')),
  carryOver: LeaveCarryOverSchema,
  allowNegative: z.boolean(hrFr('Booléen attendu.')),
  requiresDocument: z.boolean(hrFr('Booléen attendu.')),
  confidential: z.boolean(hrFr('Booléen attendu.')),
  requiresHrApproval: z.boolean(hrFr('Booléen attendu.')),
  countsAsAbsenteeism: z.boolean(hrFr('Booléen attendu.')),
  hrOnly: z.boolean(hrFr('Booléen attendu.')),
};

/** `POST /hr/leave-types` — `hr.manage`. Valeurs par défaut prudentes : aucun droit. */
export const CreateLeaveTypeBody = z
  .object({
    label: leaveTypeFields.label,
    unit: leaveTypeFields.unit.default('day'),
    deductsFromBalance: leaveTypeFields.deductsFromBalance.default(false),
    accrual: leaveTypeFields.accrual.default({ kind: 'none' }),
    proration: leaveTypeFields.proration.default('calendar_days'),
    carryOver: leaveTypeFields.carryOver.default({ maxDays: null, expiresAfterMonths: null }),
    allowNegative: leaveTypeFields.allowNegative.default(false),
    requiresDocument: leaveTypeFields.requiresDocument.default(false),
    confidential: leaveTypeFields.confidential.default(false),
    requiresHrApproval: leaveTypeFields.requiresHrApproval.default(false),
    countsAsAbsenteeism: leaveTypeFields.countsAsAbsenteeism.default(true),
    hrOnly: leaveTypeFields.hrOnly.default(false),
  })
  .strict();
export type CreateLeaveTypeBody = z.output<typeof CreateLeaveTypeBody>;

/** `PUT /hr/leave-types/:id` — `hr.manage`. Champs absents : inchangés. */
export const UpdateLeaveTypeBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    label: leaveTypeFields.label.optional(),
    unit: leaveTypeFields.unit.optional(),
    deductsFromBalance: leaveTypeFields.deductsFromBalance.optional(),
    accrual: leaveTypeFields.accrual.optional(),
    proration: leaveTypeFields.proration.optional(),
    carryOver: leaveTypeFields.carryOver.optional(),
    allowNegative: leaveTypeFields.allowNegative.optional(),
    requiresDocument: leaveTypeFields.requiresDocument.optional(),
    confidential: leaveTypeFields.confidential.optional(),
    requiresHrApproval: leaveTypeFields.requiresHrApproval.optional(),
    countsAsAbsenteeism: leaveTypeFields.countsAsAbsenteeism.optional(),
    hrOnly: leaveTypeFields.hrOnly.optional(),
  })
  .strict();
export type UpdateLeaveTypeBody = z.output<typeof UpdateLeaveTypeBody>;

export const LeaveTypeRevisionBody = z.object({ expectedRevision: HrExpectedRevision }).strict();
export type LeaveTypeRevisionBody = z.output<typeof LeaveTypeRevisionBody>;

export const ListLeaveTypesQuery = z
  .object({ active: z.enum(['true', 'false', 'all']).default('true') })
  .strict();
export type ListLeaveTypesQuery = z.output<typeof ListLeaveTypesQuery>;

/**
 * Type d'absence. Tout membre lit le nom, l'unité et la confidentialité (§ 3.2) ;
 * la politique (acquisition, report, négatif…) n'est servie qu'aux détenteurs de
 * `hr.read` (`policy: null` sinon).
 */
export interface LeaveTypeView {
  id: string;
  /** Clé d'un type créé à l'activation (`paid_leave`…), `null` pour un type ajouté. */
  key: string | null;
  label: string;
  unit: LeaveUnit;
  confidential: boolean;
  deductsFromBalance: boolean;
  requiresDocument: boolean;
  requiresHrApproval: boolean;
  /** Saisi par les RH seulement (« Absence non justifiée »). */
  hrOnly: boolean;
  active: boolean;
  policy: {
    accrual: LeaveAccrualInput;
    proration: LeaveProration;
    carryOver: LeaveCarryOverInput;
    allowNegative: boolean;
    countsAsAbsenteeism: boolean;
  } | null;
  revision: number;
}

export interface LeaveTypeListView {
  items: LeaveTypeView[];
}

// ── Jours fériés (§ 2.6) — liste VIDE par défaut ────────────────────────────

export const CreateHolidayBody = z
  .object({
    date: HrCalendarDay,
    label: hrRequiredText(L.holidayLabel, 'Libellé'),
    halfDay: z
      .enum(HR_HOLIDAY_HALVES, hrFr('Demi-journée attendue : am ou pm.'))
      .nullable()
      .default(null),
    recurring: z.boolean(hrFr('Booléen attendu.')).default(false),
  })
  .strict();
export type CreateHolidayBody = z.output<typeof CreateHolidayBody>;

export const ListHolidaysQuery = z
  .object({
    year: z
      .string()
      .regex(/^\d{4}$/, { message: 'Année attendue (AAAA).' })
      .transform(Number)
      .optional(),
  })
  .strict();
export type ListHolidaysQuery = z.output<typeof ListHolidaysQuery>;

export interface HolidayView {
  id: string;
  date: string;
  label: string;
  halfDay: HrHolidayHalf | null;
  recurring: boolean;
  createdAt: string;
}

export interface HolidayListView {
  items: HolidayView[];
}

// ── Demandes (§ 2.7, § 3.2) ─────────────────────────────────────────────────

const slot = (b: LeaveBoundary, start: boolean): number => {
  const [y, m, d] = b.date.split('-').map(Number) as [number, number, number];
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) * 2;
  if (start) return n + (b.half === 'pm' ? 1 : 0);
  return n + (b.half === 'am' ? 0 : 1);
};

/** `POST /hr/leave-requests` — `leave.request` (pour soi) ; `hr.manage` (pour un autre). */
export const CreateLeaveRequestBody = z
  .object({
    employeeId: HrId.optional(),
    typeId: HrId,
    start: LeaveBoundarySchema,
    end: LeaveBoundarySchema,
    reason: hrOptionalText(L.leaveReason).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const first = slot(b.start, true);
    const last = slot(b.end, false);
    if (last < first) {
      hrIssue(ctx, 'LEAVE_END_BEFORE_START', 'La fin précède le début.', ['end']);
      return;
    }
    if (Math.floor(last / 2) - Math.floor(first / 2) + 1 > L.leaveCalendarDaysMax) {
      hrIssue(ctx, 'LEAVE_TOO_LONG', `${L.leaveCalendarDaysMax} jours civils au plus.`, ['end']);
    }
  });
export type CreateLeaveRequestBody = z.output<typeof CreateLeaveRequestBody>;

export const ApproveLeaveRequestBody = z
  .object({
    expectedRevision: HrExpectedRevision,
    comment: hrOptionalText(L.leaveComment).optional(),
  })
  .strict();
export type ApproveLeaveRequestBody = z.output<typeof ApproveLeaveRequestBody>;

/** Un refus porte toujours un commentaire (§ 4.3). */
export const RejectLeaveRequestBody = z
  .object({
    expectedRevision: HrExpectedRevision.optional(),
    comment: hrRequiredText(L.leaveComment, 'Commentaire'),
  })
  .strict();
export type RejectLeaveRequestBody = z.output<typeof RejectLeaveRequestBody>;

export const CancelLeaveRequestBody = z
  .object({ reason: hrOptionalText(L.leaveReason).optional() })
  .strict();
export type CancelLeaveRequestBody = z.output<typeof CancelLeaveRequestBody>;

const pageLimit = z
  .string()
  .regex(/^\d{1,3}$/, { message: 'Nombre attendu.' })
  .transform(Number)
  .refine((n) => n >= 1 && n <= HR_PAGE_LIMIT_MAX, {
    message: `Entre 1 et ${HR_PAGE_LIMIT_MAX}.`,
  })
  .default(HR_PAGE_LIMIT_DEFAULT);

export const ListLeaveRequestsQuery = z
  .object({
    employeeId: HrId.optional(),
    status: z.enum(LEAVE_REQUEST_STATUSES).optional(),
    from: HrCalendarDay.optional(),
    to: HrCalendarDay.optional(),
    cursor: z.string().max(200).optional(),
    limit: pageLimit,
  })
  .strict();
export type ListLeaveRequestsQuery = z.output<typeof ListLeaveRequestsQuery>;

export const PendingApprovalsQuery = z
  .object({ cursor: z.string().max(200).optional(), limit: pageLimit })
  .strict();
export type PendingApprovalsQuery = z.output<typeof PendingApprovalsQuery>;

export interface LeaveBoundView {
  date: string;
  half: 'full' | 'am' | 'pm';
}

export interface LeaveApprovalView {
  step: LeaveApprovalStepKey;
  userId: string;
  userName: string | null;
  decision: LeaveApprovalDecisionValue;
  at: string;
  comment: string | null;
  soleApprover: boolean;
  onBehalfOfManager: boolean;
}

/**
 * Demande d'absence. Pour un type confidentiel hors ayants droit (§ 2.5) : `typeId`
 * `null`, `typeLabel` « Absent », `reason` `null`, `masked` vrai.
 */
export interface LeaveRequestView {
  id: string;
  employeeId: string;
  employeeName: string;
  typeId: string | null;
  typeLabel: string;
  masked: boolean;
  start: LeaveBoundView;
  end: LeaveBoundView;
  /** Jours décomptés par le moteur (`leaveDays`), chaîne décimale. */
  days: string;
  reason: string | null;
  status: LeaveRequestStatus;
  steps: LeaveApprovalStepKey[];
  approvals: LeaveApprovalView[];
  currentStep: LeaveApprovalStepKey | null;
  cancellation: { at: string; by: string; reason: string | null } | null;
  createdBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestPage {
  items: LeaveRequestView[];
  nextCursor: string | null;
}

// ── Soldes et grand livre (§ 2.7) ───────────────────────────────────────────

export const LeaveBalancesQuery = z
  .object({ employeeId: HrId.optional(), asOf: HrCalendarDay.optional() })
  .strict();
export type LeaveBalancesQuery = z.output<typeof LeaveBalancesQuery>;

/** Solde d'un type, rendu par le moteur (`leaveBalance`) : jamais stocké. */
export interface LeaveBalanceView {
  typeId: string;
  typeLabel: string;
  leaveYear: number;
  accrued: string;
  allocated: string;
  adjusted: string;
  carriedOver: string;
  expired: string;
  taken: string;
  upcoming: string;
  pending: string;
  available: string;
}

export interface LeaveBalancesView {
  employeeId: string;
  asOf: string;
  leaveYear: number;
  balances: LeaveBalanceView[];
}

export const ListLeaveLedgerQuery = z
  .object({ employeeId: HrId.optional(), typeId: HrId.optional() })
  .strict();
export type ListLeaveLedgerQuery = z.output<typeof ListLeaveLedgerQuery>;

/** `POST /hr/leave-ledger` — `hr.manage`, note obligatoire, audit `hr.leave_balance.adjusted`. */
export const CreateLeaveLedgerEntryBody = z
  .object({
    employeeId: HrId,
    typeId: HrId,
    kind: z.enum(LEAVE_MANUAL_LEDGER_KINDS, hrFr('Nature attendue : allocation ou adjustment.')),
    days: hrDaysSchema({ signed: true, nonZero: true, maxAbs: L.carryOverMaxDays }),
    effectiveOn: HrCalendarDay,
    note: hrRequiredText(L.ledgerNote, 'Note'),
  })
  .strict();
export type CreateLeaveLedgerEntryBody = z.output<typeof CreateLeaveLedgerEntryBody>;

export interface LeaveLedgerEntryView {
  id: string;
  employeeId: string;
  typeId: string;
  kind: LeaveLedgerKind;
  /** Signé : crédit positif, débit négatif. */
  days: string;
  effectiveOn: string;
  leaveYear: number;
  requestId: string | null;
  period: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface LeaveLedgerView {
  items: LeaveLedgerEntryView[];
}

export { LEAVE_LEDGER_KINDS };

// ── Calendrier (§ 3.2, moteur `teamCalendar`) ───────────────────────────────

export const HrCalendarQuery = z
  .object({
    from: HrCalendarDay,
    to: HrCalendarDay,
    scope: z.enum(HR_CALENDAR_SCOPES).default('team'),
  })
  .strict();
export type HrCalendarQuery = z.output<typeof HrCalendarQuery>;

export interface HrCalendarEntryView {
  requestId: string;
  employeeId: string;
  employeeName: string;
  status: 'pending' | 'approved';
  start: LeaveBoundView;
  end: LeaveBoundView;
  typeId: string | null;
  label: string;
  masked: boolean;
}

export interface HrCalendarView {
  version: string;
  from: string;
  to: string;
  scope: (typeof HR_CALENDAR_SCOPES)[number];
  entries: HrCalendarEntryView[];
  days: { date: string; absentEmployeeIds: string[] }[];
  holidays: { date: string; halfDay: HrHolidayHalf | null; label: string | null }[];
  employees: { id: string; name: string; departmentId: string | null }[];
}

// ── Réglages RH en écriture (§ 2.2, § 3.3) ──────────────────────────────────

/**
 * `PUT /hr/settings` — `hr.manage`. Tout sauf le circuit : changer QUI valide passe
 * par `PUT /hr/settings/approval`, qui exige d'être soi-même validateur
 * (`leave.approve`, motif d'ADR-0044 § 3.7).
 */
export const UpdateHrSettingsBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    workPattern: HrWorkPatternSchema.optional(),
    leaveYearStart: HrMonthDay.optional(),
    contractTypes: z
      .array(HrContractTypeSchema)
      .min(L.contractTypesMin, { message: 'Au moins un type de contrat.' })
      .max(L.contractTypesMax, { message: `${L.contractTypesMax} types de contrat au plus.` })
      .superRefine((types, ctx) => {
        const keys = new Set<string>();
        for (const [i, t] of types.entries()) {
          if (keys.has(t.key)) {
            hrIssue(ctx, 'CONTRACT_TYPE_DUPLICATE', 'Clé de type de contrat en double.', [
              i,
              'key',
            ]);
          }
          keys.add(t.key);
        }
        if (!types.some((t) => t.active)) {
          hrIssue(ctx, 'CONTRACT_TYPE_NONE_ACTIVE', 'Au moins un type de contrat actif.');
        }
      })
      .optional(),
    reminders: z
      .object({
        probationEnd: z.number().int().min(0).max(L.reminderDaysMax),
        contractEnd: z.number().int().min(0).max(L.reminderDaysMax),
        documentExpiry: z.number().int().min(0).max(L.reminderDaysMax),
      })
      .strict()
      .optional(),
    teamCalendarVisibility: z.enum(HR_TEAM_CALENDAR_VISIBILITIES).optional(),
    orgChartVisibility: z.enum(HR_ORG_CHART_VISIBILITIES).optional(),
    retention: z
      .object({
        privateDataMonthsAfterExit: z.number().int().min(1).max(L.retentionMonthsMax).nullable(),
        anonymizeYearsAfterExit: z.number().int().min(1).max(L.retentionYearsMax).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdateHrSettingsBody = z.output<typeof UpdateHrSettingsBody>;

/** `PUT /hr/settings/approval` — `leave.approve` ET `hr.manage`. */
export const UpdateHrApprovalSettingsBody = z
  .object({
    expectedRevision: z.number().int().min(0),
    approvalFlow: z.enum(HR_APPROVAL_FLOWS).optional(),
    allowSoleApprover: z.boolean().optional(),
  })
  .strict();
export type UpdateHrApprovalSettingsBody = z.output<typeof UpdateHrApprovalSettingsBody>;

// ── Exceptions d'acquisition d'un collaborateur (§ 2.1, `leavePolicyOverrides`) ──

/** Par type d'absence (identifiant) : acquisition propre (temps partiel, contrat négocié). */
export const LeavePolicyOverridesSchema = z
  .record(HrId, z.object({ accrual: LeaveAccrualSchema }).strict())
  .refine((r) => Object.keys(r).length <= 20, { message: '20 exceptions au plus.' })
  .nullable();
export type LeavePolicyOverridesInput = z.output<typeof LeavePolicyOverridesSchema>;

// ── « Mes tâches » (§ 6.1) ──────────────────────────────────────────────────

export const HR_AGENDA_ID_PREFIX = 'hr:' as const;

/** Demande que l'appelant peut traiter : pas de case à cocher (valider est une décision). */
export interface HrLeaveApprovalTaskItem {
  source: 'hr';
  kind: 'leave_approval';
  /** `hr:leave:<requestId>`. */
  id: string;
  requestId: string;
  employeeName: string;
  /** Libellé du type, ou « Absence » pour un type confidentiel hors ayants droit. */
  typeLabel: string;
  start: LeaveBoundView;
  end: LeaveBoundView;
  days: string;
  /** Premier jour de l'absence : échéance naturelle de la décision. */
  dueDate: string;
  priority: 'none';
  /** Rang de tri dans un même jour : l'instant de soumission. */
  rank: string;
  done: false;
  kindLabel: typeof HR_LEAVE_APPROVAL_KIND_LABEL;
  href: string;
}

/** Élément de liste d'entrée ou de sortie assigné à l'appelant (lecteur fourni par H4). */
export interface HrChecklistTaskItem {
  source: 'hr';
  kind: 'checklist_item';
  /** `hr:item:<checklistId>:<itemId>`. */
  id: string;
  checklistId: string;
  itemId: string;
  label: string;
  employeeName: string;
  dueDate: string | null;
  priority: 'none';
  rank: string;
  done: boolean;
  /** « Liste d'accueil » ou « Liste de départ ». */
  kindLabel: string;
  href: string;
}

export type HrMyTaskItem = HrLeaveApprovalTaskItem | HrChecklistTaskItem;

export function hrLeaveAgendaId(requestId: string): string {
  return `${HR_AGENDA_ID_PREFIX}leave:${requestId}`;
}

export function hrChecklistAgendaId(checklistId: string, itemId: string): string {
  return `${HR_AGENDA_ID_PREFIX}item:${checklistId}:${itemId}`;
}

/** Écran ouvert par un clic : la liste « À valider » (§ 8). */
export const HR_LEAVE_APPROVALS_HREF = '/rh/absences?vue=a-valider';

export type { LeaveBoundary };
