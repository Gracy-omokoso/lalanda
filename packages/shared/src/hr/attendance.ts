// Présences et pointage simple (ADR-0051 § 1, § 2.3, § 3.4, § 6.2). ADR-0051 — H8.
//
// Libellé d'interface ↔ code : « Pointage » = `AttendanceEvent`, « Journée de présence » =
// `AttendanceDay` (calculée par le moteur, jamais stockée), « Demande de correction » =
// `AttendanceCorrection`.
//
// Pointage SIMPLE (O4) : « J'arrive » / « Je pars », horodatage serveur. AUCUNE adresse IP,
// position, photo, empreinte ni identifiant d'appareil n'est accepté ni stocké. Aucune
// durée légale, aucun calcul d'heures supplémentaires (J3) : les constats sont des faits,
// jamais des sanctions. Désactivé par défaut (décision ouverte n° 8).

import { z } from 'zod';

import { HrCalendarDay, HrId, hrFr, hrIssue, hrOptionalText, hrRequiredText } from './common.js';
import { hrPageLimit } from './expenses.js';

// ── Unions fermées ──────────────────────────────────────────────────────────

export const ATTENDANCE_EVENT_KINDS = ['in', 'out'] as const;
export type AttendanceEventKind = (typeof ATTENDANCE_EVENT_KINDS)[number];

/** `self` : horodatage serveur ; `manager`, `hr` : saisi ; `correction` : approuvée. */
export const ATTENDANCE_SOURCES = ['self', 'manager', 'hr', 'correction'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const ATTENDANCE_CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AttendanceCorrectionStatus = (typeof ATTENDANCE_CORRECTION_STATUSES)[number];

/** Champs qu'un pointage NE porte jamais (O4, critère 11) : test anti-collecte. */
export const ATTENDANCE_FORBIDDEN_FIELDS = [
  'ip',
  'ipAddress',
  'location',
  'latitude',
  'longitude',
  'photo',
  'fingerprint',
  'deviceId',
  'userAgent',
] as const;

/** Ce que l'écran dit du pointage (§ 10). */
export const ATTENDANCE_CLOCK_NOTICE = 'Lalanda enregistre l’heure du serveur, rien d’autre.';

// ── Bornes et réglages ──────────────────────────────────────────────────────

export const ATTENDANCE_LIMITS = Object.freeze({
  note: 200,
  correctionReason: 300,
  correctionProposedMax: 10,
  correctionVoidMax: 10,
  comment: 2_000,
  eventsPerDayMax: 20,
  lateToleranceMinutesMax: 240,
  retentionMonthsMax: 600,
});

/**
 * Réglages `hr_settings.attendance` par défaut (§ 2.7) : pointage éteint ; pointage par
 * soi autorisé une fois activé ; constat de retard éteint (tolérance non saisie).
 */
export const HR_ATTENDANCE_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  selfClock: true,
  lateToleranceMinutes: null as number | null,
});

/** Durée de conservation des pointages : non fixée, aucune purge (J4). */
export const HR_ATTENDANCE_RETENTION_DEFAULT: number | null = null;

// ── Codes ───────────────────────────────────────────────────────────────────

export const HR_ATTENDANCE_ERROR_CODES = [
  'HR_FEATURE_DISABLED',
  'EMPLOYEE_NOT_LINKED',
  'ATTENDANCE_RATE_LIMITED',
  'ATTENDANCE_IN_FUTURE',
  'ATTENDANCE_CORRECTION_NOT_YOURS',
  'SELF_APPROVAL_FORBIDDEN',
  'CREATOR_APPROVAL_FORBIDDEN',
  'STALE_REVISION',
] as const;
export type HrAttendanceErrorCode = (typeof HR_ATTENDANCE_ERROR_CODES)[number];

/** Constats de la journée de présence (moteur `attendanceDay`, § 2.3). */
export const HR_ATTENDANCE_FINDING_CODES = [
  'ATTENDANCE_UNPAIRED',
  'ATTENDANCE_ON_LEAVE_DAY',
  'ATTENDANCE_WITHOUT_SHIFT',
  'SHIFT_WITHOUT_ATTENDANCE',
  'ATTENDANCE_LATE_START',
  'PROJECT_TIME_ABOVE_ATTENDANCE',
] as const;
export type HrAttendanceFindingCode = (typeof HR_ATTENDANCE_FINDING_CODES)[number];

// ── Corps ───────────────────────────────────────────────────────────────────

/** Horodatage ISO 8601 UTC (`…Z`) d'un pointage saisi pour autrui. */
export const HrInstant = z
  .string(hrFr('Horodatage attendu.'))
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(v), {
    message: 'Horodatage ISO 8601 en UTC attendu (par exemple 2026-11-02T07:02:00Z).',
    params: { code: 'INVALID_INSTANT' },
  })
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Horodatage invalide.',
    params: { code: 'INVALID_INSTANT' },
  });

const kind = z.enum(ATTENDANCE_EVENT_KINDS, hrFr('Pointage attendu : in ou out.'));

/** `POST /hr/attendance/clock` — `attendance.clock`. Rien d'autre que la nature. */
export const ClockAttendanceBody = z.object({ kind }).strict();
export type ClockAttendanceBody = z.output<typeof ClockAttendanceBody>;

/** `POST /hr/attendance/events` — manager (équipe) ou `hr.manage` ; note obligatoire. */
export const CreateAttendanceEventBody = z
  .object({
    employeeId: HrId,
    kind,
    at: HrInstant,
    note: hrRequiredText(ATTENDANCE_LIMITS.note, 'Note'),
  })
  .strict();
export type CreateAttendanceEventBody = z.output<typeof CreateAttendanceEventBody>;

/**
 * `POST /hr/attendance/corrections` — `attendance.clock` (pour soi, sans `employeeId`)
 * ou manager / `hr.manage` (pour autrui). Décidée par `attendanceCorrectionDecision`.
 */
export const CreateAttendanceCorrectionBody = z
  .object({
    employeeId: HrId.optional(),
    date: HrCalendarDay,
    proposed: z
      .array(z.object({ kind, at: HrInstant }).strict())
      .max(ATTENDANCE_LIMITS.correctionProposedMax, {
        message: `${ATTENDANCE_LIMITS.correctionProposedMax} pointages au plus.`,
      }),
    voidEventIds: z.array(HrId).max(ATTENDANCE_LIMITS.correctionVoidMax, {
      message: `${ATTENDANCE_LIMITS.correctionVoidMax} pointages annulés au plus.`,
    }),
    reason: hrRequiredText(ATTENDANCE_LIMITS.correctionReason, 'Motif'),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.proposed.length === 0 && b.voidEventIds.length === 0) {
      hrIssue(ctx, 'ATTENDANCE_CORRECTION_EMPTY', 'Proposez ou annulez au moins un pointage.');
    }
  });
export type CreateAttendanceCorrectionBody = z.output<typeof CreateAttendanceCorrectionBody>;

/** `POST …/corrections/:id/approve` · `…/reject` (commentaire obligatoire au refus). */
export const DecideAttendanceCorrectionBody = z
  .object({ comment: hrOptionalText(ATTENDANCE_LIMITS.comment).optional() })
  .strict();
export type DecideAttendanceCorrectionBody = z.output<typeof DecideAttendanceCorrectionBody>;

export const RejectAttendanceCorrectionBody = z
  .object({ comment: hrRequiredText(ATTENDANCE_LIMITS.comment, 'Commentaire') })
  .strict();
export type RejectAttendanceCorrectionBody = z.output<typeof RejectAttendanceCorrectionBody>;

/** `GET /hr/attendance/days` — journées calculées par le moteur. */
export const AttendanceDaysQuery = z
  .object({
    employeeId: HrId.optional(),
    from: HrCalendarDay,
    to: HrCalendarDay,
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.to < q.from) hrIssue(ctx, 'PERIOD_END_BEFORE_START', 'La fin précède le début.', ['to']);
  });
export type AttendanceDaysQuery = z.output<typeof AttendanceDaysQuery>;

/** `GET /hr/attendance/corrections`. */
export const ListAttendanceCorrectionsQuery = z
  .object({
    employeeId: HrId.optional(),
    status: z.enum(ATTENDANCE_CORRECTION_STATUSES).optional(),
    cursor: z.string().max(200).optional(),
    limit: hrPageLimit,
  })
  .strict();
export type ListAttendanceCorrectionsQuery = z.output<typeof ListAttendanceCorrectionsQuery>;
