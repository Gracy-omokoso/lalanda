// ─────────────────────────────────────────────────────────────────────────────
// Présences : journée de présence calculée, jamais stockée (ADR-0051 § 2.3, § 9)
//
// Les pointages (`in`, `out`) d'un collaborateur sont appariés dans l'ordre du
// temps : un `out` ferme le dernier `in` ouvert s'il le suit de 24 h au plus ;
// un `in` qui en suit un autre laisse le premier non apparié. Une paire compte
// pour le jour civil (Kinshasa) de son `in` : une nuit franchissant minuit est
// une seule paire. Durée en MINUTES entières (secondes tronquées par paire).
// Les pointages annulés par une correction (`voidedBy`) sont ignorés.
//
// Constats, des FAITS, jamais des sanctions :
//   `ATTENDANCE_UNPAIRED`, `ATTENDANCE_ON_LEAVE_DAY`, `ATTENDANCE_WITHOUT_SHIFT`
//   (plannings actifs), `SHIFT_WITHOUT_ATTENDANCE` (créneau publié terminé),
//   `ATTENDANCE_LATE_START` (tolérance SAISIE par l'organisation ; `null` =
//   constat éteint, défaut).
// Aucune heure supplémentaire, aucune durée légale (J3).
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDays,
  byString,
  checkDay,
  checkId,
  checkIntegerIn,
  dayNumber,
  halvesLabel,
  halvesOfDay,
  holidayIndex,
  slotsOf,
  type Halves,
} from './days.js';
import { kinshasaDayOf, shiftInterval, type ShiftInput } from './planning.js';
import {
  HR_VERSION,
  type HalfDay,
  type HolidayInput,
  type HrDay,
  type LeavePeriod,
} from './types.js';

/** Écart maximal entre un `in` et son `out` (créneau de 24 h au plus). */
export const ATTENDANCE_MAX_PAIR_MINUTES = 24 * 60;
/** Bornes de la tolérance de retard saisie par l'organisation, en minutes. */
export const LATE_TOLERANCE_BOUNDS = { min: 0, max: 240 } as const;

const MINUTE_MS = 60 * 1000;

export interface AttendanceEventInput {
  id: string;
  kind: 'in' | 'out';
  /** Horodatage ISO 8601 avec fuseau (`2026-11-02T07:02:00Z`). */
  at: string;
  /** Correction qui l'annule ; `null` : valide. */
  voidedBy?: string | null;
}

export type AttendanceFindingCode =
  | 'ATTENDANCE_UNPAIRED'
  | 'ATTENDANCE_ON_LEAVE_DAY'
  | 'ATTENDANCE_WITHOUT_SHIFT'
  | 'SHIFT_WITHOUT_ATTENDANCE'
  | 'ATTENDANCE_LATE_START';

export interface AttendanceFinding {
  code: AttendanceFindingCode;
  eventId: string | null;
  shiftId: string | null;
  /** `ATTENDANCE_LATE_START` : minutes après le début du créneau. */
  minutes: number | null;
}

export interface AttendancePair {
  inId: string;
  outId: string;
  in: string;
  out: string;
  minutes: number;
}

export interface AttendanceDayResult {
  version: string;
  date: HrDay;
  /** Paires dont le `in` tombe ce jour, dans l'ordre du temps. */
  pairs: AttendancePair[];
  minutes: number;
  /** Premier `in` et dernier `out` du jour (paires et pointages isolés). */
  firstIn: string | null;
  lastOut: string | null;
  unpairedEventIds: string[];
  /** Demi-journées d'absence approuvée. */
  leave: HalfDay | 'full' | null;
  holiday: HalfDay | 'full' | null;
  /** Créneaux publiés commençant ce jour. */
  shiftIds: string[];
  findings: AttendanceFinding[];
}

export interface AttendanceOptions {
  /** `hr_settings.planning.enabled` : active `ATTENDANCE_WITHOUT_SHIFT`. */
  planningEnabled: boolean;
  /** `hr_settings.attendance.lateToleranceMinutes` ; `null` = constat éteint. */
  lateToleranceMinutes: number | null;
  /** Instant présent (ISO) ; sans lui, `SHIFT_WITHOUT_ATTENDANCE` n'est jamais levé. */
  now?: string | null;
}

// ─── Internes ────────────────────────────────────────────────────────────────

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function instantOf(value: unknown, what: string): number {
  const ms = typeof value === 'string' && ISO_WITH_ZONE.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new RangeError(`${what} : horodatage ISO avec fuseau attendu`);
  return ms;
}

interface TimedEvent {
  e: AttendanceEventInput;
  ms: number;
}

interface Pairing {
  pairs: { inE: TimedEvent; outE: TimedEvent }[];
  unpaired: TimedEvent[];
}

function pairEvents(events: readonly AttendanceEventInput[]): Pairing {
  const ids = new Set<string>();
  const timed: TimedEvent[] = [];
  for (const [i, e] of events.entries()) {
    const what = `Pointage n° ${i + 1}`;
    checkId(e.id, what);
    if (ids.has(e.id)) throw new RangeError(`${what} : identifiant en double`);
    ids.add(e.id);
    if (e.kind !== 'in' && e.kind !== 'out') throw new RangeError(`${what} : « in » ou « out »`);
    const ms = instantOf(e.at, what);
    if (e.voidedBy !== undefined && e.voidedBy !== null) continue;
    timed.push({ e, ms });
  }
  timed.sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : byString(a.e.id, b.e.id)));
  const pairs: Pairing['pairs'] = [];
  const unpaired: TimedEvent[] = [];
  let open: TimedEvent | null = null;
  for (const t of timed) {
    if (t.e.kind === 'in') {
      if (open !== null) unpaired.push(open);
      open = t;
    } else if (open !== null && t.ms - open.ms <= ATTENDANCE_MAX_PAIR_MINUTES * MINUTE_MS) {
      pairs.push({ inE: open, outE: t });
      open = null;
    } else {
      if (open !== null) unpaired.push(open);
      open = null;
      unpaired.push(t);
    }
  }
  if (open !== null) unpaired.push(open);
  return { pairs, unpaired };
}

// ─── Journée ─────────────────────────────────────────────────────────────────

/**
 * Journée de présence d'un collaborateur (ADR-0051 § 2.3). `events` : ses
 * pointages, y compris ceux de la veille (une nuit commencée la veille reste à
 * la veille) ; `shifts` : ses créneaux ; `absences` : ses absences APPROUVÉES.
 */
export function attendanceDay(
  events: readonly AttendanceEventInput[],
  shifts: readonly ShiftInput[],
  absences: readonly LeavePeriod[],
  holidays: readonly HolidayInput[],
  date: HrDay,
  options: AttendanceOptions,
): AttendanceDayResult {
  checkDay(date, 'Jour');
  const tolerance = options.lateToleranceMinutes;
  if (tolerance !== null) {
    checkIntegerIn(tolerance, LATE_TOLERANCE_BOUNDS.min, LATE_TOLERANCE_BOUNDS.max, 'Tolérance');
  }
  const nowMs =
    options.now === undefined || options.now === null ? null : instantOf(options.now, 'Maintenant');
  const { pairs: allPairs, unpaired: allUnpaired } = pairEvents(events);

  const n = dayNumber(date);
  let leaveHalves: Halves = 0;
  for (const [i, a] of absences.entries()) {
    const [first, last] = slotsOf(a.start, a.end, `Absence n° ${i + 1}`);
    leaveHalves |= halvesOfDay(n, first, last);
  }
  const holiday = holidayIndex(holidays).halvesOn(date);

  const pairs = allPairs.filter((p) => kinshasaDayOf(p.inE.ms) === date);
  const unpaired = allUnpaired.filter((t) => kinshasaDayOf(t.ms) === date);
  const dayEvents = [...pairs.flatMap((p) => [p.inE, p.outE]), ...unpaired];

  const published = shifts
    .map((s, i) => ({ s, ...shiftInterval(s, `Créneau n° ${i + 1}`) }))
    .filter((x) => x.s.status === 'published');
  const today = published
    .filter((x) => x.s.date === date)
    .sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : byString(a.s.id, b.s.id)));

  const findings: AttendanceFinding[] = [];
  for (const t of unpaired) {
    findings.push({ code: 'ATTENDANCE_UNPAIRED', eventId: t.e.id, shiftId: null, minutes: null });
  }
  if (dayEvents.length > 0 && leaveHalves !== 0) {
    findings.push({ code: 'ATTENDANCE_ON_LEAVE_DAY', eventId: null, shiftId: null, minutes: null });
  }
  if (options.planningEnabled && dayEvents.length > 0) {
    // Un créneau de nuit commencé la veille couvre aussi ce jour.
    const yesterday = addDays(date, -1);
    const covered = published.some(
      (x) => x.s.date === date || (x.s.date === yesterday && kinshasaDayOf(x.endMs - 1) === date),
    );
    if (!covered) {
      findings.push({ code: 'ATTENDANCE_WITHOUT_SHIFT', eventId: null, shiftId: null, minutes: null });
    }
  }
  for (const x of today) {
    // Arrivée : premier `in` dont la paire croise le créneau, ou `in` isolé dans le créneau.
    const arrivals = [
      ...pairs.filter((p) => p.inE.ms < x.endMs && x.startMs < p.outE.ms).map((p) => p.inE.ms),
      ...unpaired
        .filter((t) => t.e.kind === 'in' && t.ms >= x.startMs && t.ms < x.endMs)
        .map((t) => t.ms),
    ];
    const outsInside = unpaired.some(
      (t) => t.e.kind === 'out' && t.ms > x.startMs && t.ms <= x.endMs,
    );
    if (arrivals.length === 0) {
      if (!outsInside && nowMs !== null && x.endMs <= nowMs) {
        findings.push({ code: 'SHIFT_WITHOUT_ATTENDANCE', eventId: null, shiftId: x.s.id, minutes: null });
      }
      continue;
    }
    const arrival = Math.min(...arrivals);
    if (tolerance !== null && arrival > x.startMs + tolerance * MINUTE_MS) {
      findings.push({
        code: 'ATTENDANCE_LATE_START',
        eventId: null,
        shiftId: x.s.id,
        minutes: Math.floor((arrival - x.startMs) / MINUTE_MS),
      });
    }
  }

  const ins = dayEvents.filter((t) => t.e.kind === 'in').map((t) => t.ms);
  const outs = dayEvents.filter((t) => t.e.kind === 'out').map((t) => t.ms);
  const pick = (ms: number | null): string | null =>
    ms === null ? null : (dayEvents.find((t) => t.ms === ms)?.e.at ?? null);
  const resultPairs = pairs.map((p) => ({
    inId: p.inE.e.id,
    outId: p.outE.e.id,
    in: p.inE.e.at,
    out: p.outE.e.at,
    minutes: Math.floor((p.outE.ms - p.inE.ms) / MINUTE_MS),
  }));
  return {
    version: HR_VERSION,
    date,
    pairs: resultPairs,
    minutes: resultPairs.reduce((s, p) => s + p.minutes, 0),
    firstIn: pick(ins.length === 0 ? null : Math.min(...ins)),
    lastOut: pick(outs.length === 0 ? null : Math.max(...outs)),
    unpairedEventIds: unpaired.map((t) => t.e.id),
    leave: halvesLabel(leaveHalves),
    holiday: halvesLabel(holiday),
    shiftIds: today.map((x) => x.s.id),
    findings,
  };
}

/** Journées de `from` à `to` (366 jours au plus), mêmes règles qu'`attendanceDay`. */
export function attendanceDays(
  events: readonly AttendanceEventInput[],
  shifts: readonly ShiftInput[],
  absences: readonly LeavePeriod[],
  holidays: readonly HolidayInput[],
  from: HrDay,
  to: HrDay,
  options: AttendanceOptions,
): { version: string; from: HrDay; to: HrDay; days: AttendanceDayResult[]; minutes: number } {
  checkDay(from, 'Début');
  checkDay(to, 'Fin');
  const span = dayNumber(to) - dayNumber(from) + 1;
  if (span < 1) throw new RangeError('Présences : la fin précède le début');
  if (span > 366) throw new RangeError('Présences : 366 jours au plus');
  const days = Array.from({ length: span }, (_, i) =>
    attendanceDay(events, shifts, absences, holidays, addDays(from, i), options),
  );
  return { version: HR_VERSION, from, to, days, minutes: days.reduce((s, d) => s + d.minutes, 0) };
}
