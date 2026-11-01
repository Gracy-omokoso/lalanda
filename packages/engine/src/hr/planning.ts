// ─────────────────────────────────────────────────────────────────────────────
// Plannings : créneaux, chevauchements, besoins minimaux (ADR-0051 § 2.4, § 9)
//
// - `shiftInterval` : instants UTC d'un créneau saisi en heure de Kinshasa
//   (UTC+1, sans heure d'été — ADR-0027), minuit franchi compris ; 24 h au plus.
// - `shiftOverlaps` : créneaux non annulés du même collaborateur qui croisent
//   un créneau candidat (`409 SHIFT_OVERLAP`). Intervalles semi-ouverts : un
//   créneau qui finit à 14:00 ne croise pas celui qui commence à 14:00.
// - `shiftConflicts` : constats d'un ensemble de créneaux — `SHIFT_OVERLAP`,
//   `SHIFT_DURING_LEAVE` (accepté, le planificateur décide),
//   `SHIFT_ABOVE_INDICATIVE_LIMIT` (seuil SAISI par l'organisation, éteint par
//   défaut, jamais un refus).
// - `staffingGaps` : effectif planifié et disponible d'un besoin minimal saisi
//   par l'organisation ; `UNDERSTAFFED_SLOT` si le disponible est sous le minimum.
//
// AUCUNE règle légale (J3) : ni durée maximale, ni repos, ni travail de nuit.
// Aucune affectation automatique (O5) : le moteur constate, il ne place personne.
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDays,
  byString,
  checkDay,
  checkId,
  checkIntegerIn,
  dayNumber,
  halvesOfDay,
  slotsOf,
  weekdayOf,
} from './days.js';
import { HR_VERSION, WEEKDAYS, type HrDay, type LeavePeriod, type Weekday } from './types.js';

/** Décalage de Kinshasa sur UTC (ADR-0027), en millisecondes. */
export const KINSHASA_UTC_OFFSET_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Durée maximale d'un créneau (ADR-0051 § 2.4) : 24 h. Contrainte d'outil, pas légale. */
export const SHIFT_MAX_MINUTES = 24 * 60;
/** Fenêtre maximale d'un calcul de planning, en jours civils. */
export const PLANNING_MAX_DAYS = 366;
/** Bornes d'un besoin minimal (ADR-0051 § 2.4). */
export const STAFFING_MIN_STAFF_BOUNDS = { min: 1, max: 200 } as const;

export type ShiftStatus = 'draft' | 'published' | 'cancelled';

/** Heure locale `HH:MM` (00:00 à 23:59). */
export type LocalTime = string;

export interface ShiftInput {
  id: string;
  employeeId: string;
  /** Jour civil du début. */
  date: HrDay;
  start: LocalTime;
  end: LocalTime;
  /** La fin tombe le lendemain (fin ≤ début ; fin = début : 24 h). */
  crossesMidnight: boolean;
  status: ShiftStatus;
  departmentId?: string | null;
  location?: string | null;
}

/** Absence approuvée d'un collaborateur. */
export interface EmployeeLeaveInput extends LeavePeriod {
  employeeId: string;
}

export type ShiftFindingCode = 'SHIFT_OVERLAP' | 'SHIFT_DURING_LEAVE' | 'SHIFT_ABOVE_INDICATIVE_LIMIT';

export interface ShiftFinding {
  code: ShiftFindingCode;
  employeeId: string;
  /** `SHIFT_OVERLAP` : les deux créneaux (ordre des identifiants) ; sinon un seul. */
  shiftIds: string[];
  /** `SHIFT_ABOVE_INDICATIVE_LIMIT` : lundi de la semaine et minutes planifiées. */
  week: HrDay | null;
  minutes: number | null;
}

export interface ShiftConflictsResult {
  version: string;
  findings: ShiftFinding[];
  /** Minutes planifiées (créneaux non annulés), par collaborateur et par semaine. */
  weeklyMinutes: { employeeId: string; week: HrDay; minutes: number }[];
}

export interface StaffingNeedInput {
  id: string;
  /** L'un des deux : service, ou lieu. */
  departmentId?: string | null;
  location?: string | null;
  weekday: Weekday;
  start: LocalTime;
  /** Fin ≤ début : la fenêtre franchit minuit. */
  end: LocalTime;
  minStaff: number;
}

export interface StaffingGap {
  code: 'UNDERSTAFFED_SLOT';
  needId: string;
  date: HrDay;
  start: LocalTime;
  end: LocalTime;
  minStaff: number;
  /** Effectif planifié au plus creux de la fenêtre (créneaux publiés). */
  planned: number;
  /** Idem, absences approuvées déduites. */
  available: number;
  shortfall: number;
}

export interface StaffingGapsResult {
  version: string;
  from: HrDay;
  to: HrDay;
  /** Nombres seulement, jamais de nom (§ 8). */
  gaps: StaffingGap[];
  /** Fenêtres examinées (besoin × jour). */
  slotsChecked: number;
}

// ─── Heures ──────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes depuis minuit d'une heure `HH:MM`. */
export function minutesOfTime(value: unknown, what: string): number {
  const m = typeof value === 'string' ? HHMM.exec(value) : null;
  if (m === null) throw new RangeError(`${what} : heure « HH:MM » attendue`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Instant UTC (ms) d'une heure locale de Kinshasa un jour civil donné. */
export function kinshasaInstant(day: HrDay, minutesOfDay: number): number {
  return dayNumber(day) * DAY_MS + minutesOfDay * MINUTE_MS - KINSHASA_UTC_OFFSET_MS;
}

/** Jour civil de Kinshasa d'un instant UTC (ms). */
export function kinshasaDayOf(instantMs: number): HrDay {
  return new Date(instantMs + KINSHASA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instants `[début, fin)` d'un créneau (ms UTC) et sa durée en minutes. */
export function shiftInterval(
  shift: Pick<ShiftInput, 'date' | 'start' | 'end' | 'crossesMidnight'>,
  what = 'Créneau',
): { startMs: number; endMs: number; minutes: number } {
  const date = checkDay(shift.date, `${what} (jour)`);
  const start = minutesOfTime(shift.start, `${what} (début)`);
  const end = minutesOfTime(shift.end, `${what} (fin)`);
  if (typeof shift.crossesMidnight !== 'boolean') {
    throw new RangeError(`${what} : « crossesMidnight » booléen attendu`);
  }
  if (shift.crossesMidnight !== end <= start) {
    throw new RangeError(
      `${what} : ${shift.crossesMidnight ? 'la fin doit précéder ou égaler le début' : 'la fin doit suivre le début'}`,
    );
  }
  const minutes = shift.crossesMidnight ? end + SHIFT_MAX_MINUTES - start : end - start;
  const startMs = kinshasaInstant(date, start);
  return { startMs, endMs: startMs + minutes * MINUTE_MS, minutes };
}

function checkShift(shift: ShiftInput, what: string): { startMs: number; endMs: number; minutes: number } {
  checkId(shift.id, what);
  checkId(shift.employeeId, `${what} (collaborateur)`);
  if (shift.status !== 'draft' && shift.status !== 'published' && shift.status !== 'cancelled') {
    throw new RangeError(`${what} : statut inconnu ${JSON.stringify(shift.status)}`);
  }
  return shiftInterval(shift, what);
}

/** Lundi de la semaine d'un jour. */
function mondayOf(day: HrDay): HrDay {
  return addDays(day, -WEEKDAYS.indexOf(weekdayOf(day)));
}

/** Jours couverts (demi-journée au moins) par une absence, par collaborateur. */
function leaveDaysByEmployee(absences: readonly EmployeeLeaveInput[]): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const [i, a] of absences.entries()) {
    const what = `Absence n° ${i + 1}`;
    checkId(a.employeeId, `${what} (collaborateur)`);
    const slots = slotsOf(a.start, a.end, what);
    const list = out.get(a.employeeId) ?? [];
    list.push(slots);
    out.set(a.employeeId, list);
  }
  return out;
}

function onLeave(leaves: [number, number][] | undefined, day: HrDay): boolean {
  if (leaves === undefined) return false;
  const n = dayNumber(day);
  return leaves.some(([first, last]) => halvesOfDay(n, first, last) !== 0);
}

// ─── Chevauchements ──────────────────────────────────────────────────────────

/**
 * Créneaux non annulés du même collaborateur qui croisent `candidate` (le
 * candidat lui-même, par identifiant, est ignoré). Un candidat annulé ne
 * croise rien. Ordre des identifiants.
 */
export function shiftOverlaps(candidate: ShiftInput, others: readonly ShiftInput[]): string[] {
  const c = checkShift(candidate, 'Créneau candidat');
  if (candidate.status === 'cancelled') return [];
  const ids: string[] = [];
  for (const [i, other] of others.entries()) {
    const o = checkShift(other, `Créneau n° ${i + 1}`);
    if (other.id === candidate.id || other.status === 'cancelled') continue;
    if (other.employeeId !== candidate.employeeId) continue;
    if (o.startMs < c.endMs && c.startMs < o.endMs) ids.push(other.id);
  }
  return ids.sort(byString);
}

/**
 * Constats d'un ensemble de créneaux (ADR-0051 § 2.4). Un congé couvrant le
 * jour du début (ou du lendemain, minuit franchi) à la demi-journée près suffit
 * pour `SHIFT_DURING_LEAVE` ; un créneau compte dans la semaine de son début.
 */
export function shiftConflicts(
  shifts: readonly ShiftInput[],
  absences: readonly EmployeeLeaveInput[],
  options: { indicativeMaxMinutesPerWeek: number | null } = { indicativeMaxMinutesPerWeek: null },
): ShiftConflictsResult {
  const limit = options.indicativeMaxMinutesPerWeek;
  if (limit !== null) checkIntegerIn(limit, 1, 7 * SHIFT_MAX_MINUTES, 'Seuil indicatif hebdomadaire');
  const leaves = leaveDaysByEmployee(absences);
  const active = shifts
    .map((s, i) => ({ s, ...checkShift(s, `Créneau n° ${i + 1}`) }))
    .filter((x) => x.s.status !== 'cancelled')
    .sort((a, b) =>
      a.s.employeeId !== b.s.employeeId
        ? byString(a.s.employeeId, b.s.employeeId)
        : a.startMs !== b.startMs
          ? a.startMs - b.startMs
          : byString(a.s.id, b.s.id),
    );
  const ids = new Set<string>();
  for (const x of active) {
    if (ids.has(x.s.id)) throw new RangeError(`Créneau ${x.s.id} : identifiant en double`);
    ids.add(x.s.id);
  }

  const findings: ShiftFinding[] = [];
  // Chevauchements : balayage par collaborateur, trié par début.
  for (let i = 0; i < active.length; i += 1) {
    const a = active[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j];
      if (b === undefined || b.s.employeeId !== a.s.employeeId || b.startMs >= a.endMs) break;
      findings.push({
        code: 'SHIFT_OVERLAP',
        employeeId: a.s.employeeId,
        shiftIds: [a.s.id, b.s.id].sort(byString),
        week: null,
        minutes: null,
      });
    }
  }
  for (const x of active) {
    const own = leaves.get(x.s.employeeId);
    const lastDay = x.s.crossesMidnight ? addDays(x.s.date, 1) : x.s.date;
    if (onLeave(own, x.s.date) || (lastDay !== x.s.date && onLeave(own, lastDay))) {
      findings.push({
        code: 'SHIFT_DURING_LEAVE',
        employeeId: x.s.employeeId,
        shiftIds: [x.s.id],
        week: null,
        minutes: null,
      });
    }
  }
  const weekly = new Map<string, { employeeId: string; week: HrDay; minutes: number }>();
  for (const x of active) {
    const week = mondayOf(x.s.date);
    const key = `${x.s.employeeId}\u0000${week}`;
    const w = weekly.get(key) ?? { employeeId: x.s.employeeId, week, minutes: 0 };
    w.minutes += x.minutes;
    weekly.set(key, w);
  }
  const weeklyMinutes = [...weekly.values()].sort((a, b) =>
    a.employeeId !== b.employeeId ? byString(a.employeeId, b.employeeId) : byString(a.week, b.week),
  );
  if (limit !== null) {
    for (const w of weeklyMinutes) {
      if (w.minutes > limit) {
        findings.push({
          code: 'SHIFT_ABOVE_INDICATIVE_LIMIT',
          employeeId: w.employeeId,
          shiftIds: active
            .filter((x) => x.s.employeeId === w.employeeId && mondayOf(x.s.date) === w.week)
            .map((x) => x.s.id)
            .sort(byString),
          week: w.week,
          minutes: w.minutes,
        });
      }
    }
  }
  const rank: Record<ShiftFindingCode, number> = {
    SHIFT_OVERLAP: 0,
    SHIFT_DURING_LEAVE: 1,
    SHIFT_ABOVE_INDICATIVE_LIMIT: 2,
  };
  findings.sort((a, b) =>
    rank[a.code] !== rank[b.code]
      ? rank[a.code] - rank[b.code]
      : a.employeeId !== b.employeeId
        ? byString(a.employeeId, b.employeeId)
        : byString(a.shiftIds.join(','), b.shiftIds.join(',')),
  );
  return { version: HR_VERSION, findings, weeklyMinutes };
}

// ─── Besoins minimaux ────────────────────────────────────────────────────────

/**
 * Effectif minimal d'une fenêtre : nombre de collaborateurs distincts présents
 * (créneau qui la couvre) au point le plus creux de `[start, end)`.
 */
function minimumPresence(
  windowStart: number,
  windowEnd: number,
  intervals: readonly { employeeId: string; startMs: number; endMs: number }[],
): number {
  const cuts = new Set<number>([windowStart]);
  for (const iv of intervals) {
    if (iv.startMs > windowStart && iv.startMs < windowEnd) cuts.add(iv.startMs);
    if (iv.endMs > windowStart && iv.endMs < windowEnd) cuts.add(iv.endMs);
  }
  let min = Number.POSITIVE_INFINITY;
  for (const t of cuts) {
    const present = new Set<string>();
    for (const iv of intervals) if (iv.startMs <= t && t < iv.endMs) present.add(iv.employeeId);
    if (present.size < min) min = present.size;
  }
  return min === Number.POSITIVE_INFINITY ? 0 : min;
}

/**
 * Sous-effectif (ADR-0051 § 2.4) : pour chaque jour de `from` à `to` et chaque
 * besoin de ce jour de semaine, effectif planifié (créneaux PUBLIÉS du service
 * ou du lieu du besoin) et effectif disponible (sans les collaborateurs en
 * absence approuvée ce jour-là, demi-journée comprise : l'alerte est prudente).
 */
export function staffingGaps(
  shifts: readonly ShiftInput[],
  needs: readonly StaffingNeedInput[],
  absences: readonly EmployeeLeaveInput[],
  from: HrDay,
  to: HrDay,
): StaffingGapsResult {
  checkDay(from, 'Début');
  checkDay(to, 'Fin');
  if (to < from) throw new RangeError('Planning : la fin précède le début');
  const span = dayNumber(to) - dayNumber(from) + 1;
  if (span > PLANNING_MAX_DAYS) throw new RangeError(`Planning : ${PLANNING_MAX_DAYS} jours au plus`);
  const leaves = leaveDaysByEmployee(absences);
  const published = shifts
    .map((s, i) => ({ s, ...checkShift(s, `Créneau n° ${i + 1}`) }))
    .filter((x) => x.s.status === 'published');

  const checkedNeeds = needs.map((n, i) => {
    const what = `Besoin n° ${i + 1}`;
    checkId(n.id, what);
    const dept = n.departmentId ?? null;
    const location = n.location ?? null;
    if ((dept === null) === (location === null)) {
      throw new RangeError(`${what} : un service ou un lieu, l'un des deux`);
    }
    if (!WEEKDAYS.includes(n.weekday)) throw new RangeError(`${what} : jour de semaine inconnu`);
    checkIntegerIn(
      n.minStaff,
      STAFFING_MIN_STAFF_BOUNDS.min,
      STAFFING_MIN_STAFF_BOUNDS.max,
      `${what} (effectif minimal)`,
    );
    const start = minutesOfTime(n.start, `${what} (début)`);
    const end = minutesOfTime(n.end, `${what} (fin)`);
    const minutes = end > start ? end - start : end + SHIFT_MAX_MINUTES - start;
    return { n, dept, location, start, minutes };
  });

  const gaps: StaffingGap[] = [];
  let slotsChecked = 0;
  for (let d = 0; d < span; d += 1) {
    const date = addDays(from, d);
    const weekday = weekdayOf(date);
    for (const need of checkedNeeds) {
      if (need.n.weekday !== weekday) continue;
      slotsChecked += 1;
      const windowStart = kinshasaInstant(date, need.start);
      const windowEnd = windowStart + need.minutes * MINUTE_MS;
      const matching = published.filter(
        (x) =>
          x.startMs < windowEnd &&
          windowStart < x.endMs &&
          (need.dept !== null
            ? (x.s.departmentId ?? null) === need.dept
            : (x.s.location ?? null) === need.location),
      );
      const intervals = matching.map((x) => ({
        employeeId: x.s.employeeId,
        startMs: x.startMs,
        endMs: x.endMs,
      }));
      const planned = minimumPresence(windowStart, windowEnd, intervals);
      const days = new Set([date, kinshasaDayOf(windowEnd - 1)]);
      const availableIntervals = intervals.filter(
        (iv) => ![...days].some((day) => onLeave(leaves.get(iv.employeeId), day)),
      );
      const available = minimumPresence(windowStart, windowEnd, availableIntervals);
      if (available < need.n.minStaff) {
        gaps.push({
          code: 'UNDERSTAFFED_SLOT',
          needId: need.n.id,
          date,
          start: need.n.start,
          end: need.n.end,
          minStaff: need.n.minStaff,
          planned,
          available,
          shortfall: need.n.minStaff - available,
        });
      }
    }
  }
  gaps.sort((a, b) =>
    a.date !== b.date
      ? byString(a.date, b.date)
      : a.start !== b.start
        ? byString(a.start, b.start)
        : byString(a.needId, b.needId),
  );
  return { version: HR_VERSION, from, to, gaps, slotsChecked };
}
