// Plannings et besoins minimaux d'effectif (ADR-0051 § 1, § 2.4, § 3.6, § 6.2).
// ADR-0051 — H8.
//
// Libellé d'interface ↔ code : « Créneau de planning » = `Shift`, « Besoin minimal
// d'effectif » = `StaffingNeed`.
//
// Une GRILLE saisie par le manager ou les RH (O5), jamais un optimiseur : aucune
// affectation automatique, aucun contrôle de durée maximale, de repos ou de travail de nuit
// (J3). Un seuil INDICATIF saisi par l'organisation lève un constat, jamais un refus.
// Désactivé par défaut (décision ouverte n° 9).

import { z } from 'zod';

import { HrCalendarDay, HrId, hrFr, hrIssue, hrOptionalText, hrRequiredText } from './common.js';
import { HR_CALENDAR_SCOPES, HR_WEEKDAYS } from './constants.js';

// ── Unions fermées ──────────────────────────────────────────────────────────

export const SHIFT_STATUSES = ['draft', 'published', 'cancelled'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** Portées de lecture des créneaux (celles du calendrier d'équipe, ADR-0045). */
export const SHIFT_SCOPES = HR_CALENDAR_SCOPES;

// ── Bornes et réglages ──────────────────────────────────────────────────────

export const PLANNING_LIMITS = Object.freeze({
  label: 60,
  location: 120,
  note: 300,
  needLabel: 60,
  minStaffMin: 1,
  minStaffMax: 200,
  publishIdsMax: 500,
  rangeDaysMax: 62,
  indicativeMaxMinutesPerWeekMax: 7 * 24 * 60,
  unavailabilityComment: 300,
});

/** Réglages `hr_settings.planning` par défaut (§ 2.7) : éteints, aucun seuil. */
export const HR_PLANNING_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  indicativeMaxMinutesPerWeek: null as number | null,
});

// ── Codes ───────────────────────────────────────────────────────────────────

export const HR_PLANNING_ERROR_CODES = [
  'HR_FEATURE_DISABLED',
  'SHIFT_OVERLAP',
  'SHIFT_TOO_LONG',
  'SHIFT_EMPTY',
  'STALE_REVISION',
] as const;
export type HrPlanningErrorCode = (typeof HR_PLANNING_ERROR_CODES)[number];

/** Constats calculés par le moteur (`shiftConflicts`, `staffingGaps`) : jamais un refus. */
export const HR_PLANNING_FINDING_CODES = [
  'SHIFT_DURING_LEAVE',
  'SHIFT_ABOVE_INDICATIVE_LIMIT',
  'UNDERSTAFFED_SLOT',
] as const;
export type HrPlanningFindingCode = (typeof HR_PLANNING_FINDING_CODES)[number];

// ── Briques ─────────────────────────────────────────────────────────────────

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Heure locale `HH:MM` (Kinshasa). */
export const HrClockTime = z
  .string(hrFr('Heure attendue au format HH:MM.'))
  .refine((v) => HH_MM.test(v), {
    message: 'Heure attendue au format HH:MM.',
    params: { code: 'INVALID_TIME' },
  });

/** Minutes depuis minuit d'une heure `HH:MM` valide. */
export function hrClockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Durée d'un créneau en minutes : `end` le lendemain si `crossesMidnight`. */
export function shiftDurationMinutes(start: string, end: string, crossesMidnight: boolean): number {
  const s = hrClockMinutes(start);
  const e = hrClockMinutes(end) + (crossesMidnight ? 24 * 60 : 0);
  return e - s;
}

function checkSlot(
  b: { start: string; end: string; crossesMidnight?: boolean | undefined },
  ctx: z.RefinementCtx,
): void {
  const minutes = shiftDurationMinutes(b.start, b.end, b.crossesMidnight === true);
  if (minutes <= 0) {
    hrIssue(ctx, 'SHIFT_EMPTY', 'La fin suit le début (cochez « finit le lendemain »).', ['end']);
  } else if (minutes > 24 * 60) {
    hrIssue(ctx, 'SHIFT_TOO_LONG', 'Un créneau dure 24 heures au plus.', ['end']);
  }
}

// ── Corps ───────────────────────────────────────────────────────────────────

const shiftFields = {
  employeeId: HrId,
  date: HrCalendarDay,
  start: HrClockTime,
  end: HrClockTime,
  crossesMidnight: z.boolean(hrFr('Booléen attendu.')).optional(),
  label: hrOptionalText(PLANNING_LIMITS.label).optional(),
  location: hrOptionalText(PLANNING_LIMITS.location).optional(),
  departmentId: HrId.nullable().optional(),
  workProjectId: HrId.nullable().optional(),
  note: hrOptionalText(PLANNING_LIMITS.note).optional(),
};

/** `POST /hr/shifts` — manager (équipe) ou `hr.manage` ; brouillon. */
export const CreateShiftBody = z.object(shiftFields).strict().superRefine(checkSlot);
export type CreateShiftBody = z.output<typeof CreateShiftBody>;

/** `PUT /hr/shifts/:id`. */
export const UpdateShiftBody = z
  .object({ ...shiftFields, expectedRevision: z.number().int().min(1) })
  .strict()
  .superRefine(checkSlot);
export type UpdateShiftBody = z.output<typeof UpdateShiftBody>;

/** `POST /hr/shifts/publish`. */
export const PublishShiftsBody = z
  .object({
    ids: z
      .array(HrId)
      .min(1, { message: 'Au moins un créneau.' })
      .max(PLANNING_LIMITS.publishIdsMax, {
        message: `${PLANNING_LIMITS.publishIdsMax} créneaux au plus.`,
      }),
  })
  .strict();
export type PublishShiftsBody = z.output<typeof PublishShiftsBody>;

/** `POST /hr/shifts/copy-week` — crée des BROUILLONS (jamais publiés seuls). */
export const CopyShiftWeekBody = z
  .object({
    fromWeekStart: HrCalendarDay,
    toWeekStart: HrCalendarDay,
    employeeIds: z.array(HrId).max(PLANNING_LIMITS.publishIdsMax).optional(),
  })
  .strict();
export type CopyShiftWeekBody = z.output<typeof CopyShiftWeekBody>;

/** Signaler une indisponibilité sur son créneau (commentaire, § 3.6). */
export const ShiftUnavailabilityBody = z
  .object({ comment: hrRequiredText(PLANNING_LIMITS.unavailabilityComment, 'Commentaire') })
  .strict();
export type ShiftUnavailabilityBody = z.output<typeof ShiftUnavailabilityBody>;

/** `GET /hr/shifts`. */
export const ListShiftsQuery = z
  .object({
    from: HrCalendarDay,
    to: HrCalendarDay,
    scope: z.enum(SHIFT_SCOPES).default('me'),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.to < q.from) hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'La fin précède le début.', ['to']);
  });
export type ListShiftsQuery = z.output<typeof ListShiftsQuery>;

/** Besoin minimal (`POST` · `PUT /hr/staffing-needs`) : un service OU un lieu. */
export const StaffingNeedBody = z
  .object({
    departmentId: HrId.nullable().optional(),
    location: hrOptionalText(PLANNING_LIMITS.location).optional(),
    weekday: z.enum(HR_WEEKDAYS, hrFr('Jour attendu : mon … sun.')),
    start: HrClockTime,
    end: HrClockTime,
    crossesMidnight: z.boolean().optional(),
    minStaff: z
      .number(hrFr('Effectif attendu : un entier.'))
      .int()
      .min(PLANNING_LIMITS.minStaffMin)
      .max(PLANNING_LIMITS.minStaffMax),
    label: hrOptionalText(PLANNING_LIMITS.needLabel).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const dept = (b.departmentId ?? null) !== null;
    const loc = (b.location ?? null) !== null;
    if (dept === loc) {
      hrIssue(ctx, 'STAFFING_NEED_TARGET', 'Un service ou un lieu, l’un des deux.', [
        'departmentId',
      ]);
    }
    checkSlot(b, ctx);
  });
export type StaffingNeedBody = z.output<typeof StaffingNeedBody>;

/** `GET /hr/planning/gaps`. */
export const PlanningGapsQuery = z
  .object({ from: HrCalendarDay, to: HrCalendarDay })
  .strict()
  .superRefine((q, ctx) => {
    if (q.to < q.from) hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'La fin précède le début.', ['to']);
  });
export type PlanningGapsQuery = z.output<typeof PlanningGapsQuery>;
