// ─────────────────────────────────────────────────────────────────────────────
// Absences : décompte, chevauchements, disponibilité, calendrier d'équipe
// (ADR-0045 § 2.7, § 5, § 6.2, § 7)
//
// - `leaveDays` : pour chaque jour civil de la demande, la fraction travaillée
//   de la semaine de travail, moins les fériés de l'organisation (demi-journée
//   comprise), bornée par les demi-journées de début et de fin. Une journée
//   travaillée à moitié (`0.5`) n'est pas située dans la journée : elle compte
//   min(½, demi-journées couvertes non fériées × ½).
// - `leaveOverlaps` : chevauchement à la demi-journée près, sur le temps civil.
// - `availabilityOf` : jours travaillés − absences − fériés (futur plan de charge).
// - `teamCalendar` : absences d'une portée, type masqué en « Absent » pour un
//   type confidentiel hors ayants droit.
// Aucune semaine de travail ni aucun férié par défaut : tout est en entrée.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOTH,
  boundOfEndSlot,
  boundOfStartSlot,
  byString,
  checkDay,
  checkId,
  checkWorkPattern,
  countedCenti,
  dayNumber,
  dayOfNumber,
  formatDays,
  fractionCenti,
  halvesList,
  halvesOfDay,
  holidayIndex,
  nonNegativeCenti,
  slotsOf,
  trustedCenti,
  weekdayOf,
  type Halves,
} from './days.js';
import {
  HR_VERSION,
  LEAVE_MAX_CALENDAR_DAYS,
  MASKED_LEAVE_LABEL,
  type AvailabilityResult,
  type CalendarLeaveTypeInput,
  type HolidayInput,
  type HrDay,
  type HrDays,
  type LeaveBound,
  type LeaveDayDetail,
  type LeaveDaysResult,
  type LeaveDebitCheck,
  type LeaveOverlap,
  type LeaveOverlapsResult,
  type LeavePeriod,
  type LeaveRequestInput,
  type TeamCalendarEntry,
  type TeamCalendarResult,
  type TeamCalendarViewer,
  type WorkPattern,
} from './types.js';

/**
 * Jours d'absence décomptés d'une demande (ADR-0045 § 5). Lève une
 * `RangeError` si la fin précède le début ou si la demande dépasse 366 jours
 * civils ; « 0 » signifie qu'aucun jour travaillé n'est couvert.
 */
export function leaveDays(
  start: LeaveBound,
  end: LeaveBound,
  workPattern: WorkPattern,
  holidays: readonly HolidayInput[],
): LeaveDaysResult {
  const pattern = checkWorkPattern(workPattern);
  const [first, last] = slotsOf(start, end, 'Demande d’absence');
  const firstDay = Math.floor(first / 2);
  const lastDay = Math.floor(last / 2);
  const calendarDays = lastDay - firstDay + 1;
  if (calendarDays > LEAVE_MAX_CALENDAR_DAYS) {
    throw new RangeError(
      `Demande d’absence : ${LEAVE_MAX_CALENDAR_DAYS} jours civils au plus, reçu ${calendarDays}`,
    );
  }
  const index = holidayIndex(holidays);
  let total = 0n;
  const perDay: LeaveDayDetail[] = [];
  for (let n = firstDay; n <= lastDay; n += 1) {
    const date = dayOfNumber(n);
    const requested = halvesOfDay(n, first, last);
    const off = index.halvesOn(date);
    const counted = countedCenti(fractionCenti(pattern, weekdayOf(date)), requested & ~off);
    total += counted;
    perDay.push({
      date,
      days: formatDays(counted),
      halves: halvesList(requested),
      holiday: off !== 0,
    });
  }
  return { version: HR_VERSION, days: formatDays(total), calendarDays, perDay };
}

/**
 * Demandes `pending` ou `approved` du même collaborateur qui recouvrent la
 * période candidate, ne serait-ce que d'une demi-journée (`409 LEAVE_OVERLAP`).
 * La demande candidate elle-même (même `id`) est ignorée.
 */
export function leaveOverlaps(
  candidate: LeavePeriod & { employeeId: string; id?: string | null },
  existing: readonly LeaveRequestInput[],
): LeaveOverlapsResult {
  checkId(candidate.employeeId, 'Collaborateur');
  const [first, last] = slotsOf(candidate.start, candidate.end, 'Demande candidate');
  const overlaps: LeaveOverlap[] = [];
  for (const [i, r] of existing.entries()) {
    if (r.employeeId !== candidate.employeeId) continue;
    if (r.status !== 'pending' && r.status !== 'approved') continue;
    if (candidate.id !== undefined && candidate.id !== null && r.id === candidate.id) continue;
    const [f, l] = slotsOf(r.start, r.end, `Demande n° ${i + 1}`);
    const from = Math.max(first, f);
    const to = Math.min(last, l);
    if (from > to) continue;
    overlaps.push({
      requestId: r.id,
      status: r.status,
      from: dayOfNumber(Math.floor(from / 2)),
      to: dayOfNumber(Math.floor(to / 2)),
    });
  }
  overlaps.sort((a, b) => byString(a.from, b.from) || byString(a.requestId, b.requestId));
  return { version: HR_VERSION, overlaps };
}

/**
 * Le solde disponible couvre-t-il la demande ? (`409 LEAVE_BALANCE_INSUFFICIENT`
 * si non et que le type n'autorise pas le négatif.) Les deux durées viennent du
 * moteur (`leaveBalance`, `leaveDays`).
 */
export function checkLeaveDebit(
  available: HrDays,
  requested: HrDays,
  allowNegative: boolean,
): LeaveDebitCheck {
  const avail = trustedCenti(available, 'Disponible');
  const req = nonNegativeCenti(requested, 'Jours demandés');
  const after = avail - req;
  const shortfall = after < 0n ? -after : 0n;
  return {
    version: HR_VERSION,
    ok: allowNegative || after >= 0n,
    shortfall: formatDays(shortfall),
    availableAfter: formatDays(after),
  };
}

/** Demi-journées couvertes par des absences, par numéro de jour, dans `[fromN, toN]`. */
function absentHalves(
  absences: readonly LeavePeriod[],
  fromN: number,
  toN: number,
): Map<number, Halves> {
  const map = new Map<number, Halves>();
  for (const [i, a] of absences.entries()) {
    const [first, last] = slotsOf(a.start, a.end, `Absence n° ${i + 1}`);
    const lo = Math.max(fromN, Math.floor(first / 2));
    const hi = Math.min(toN, Math.floor(last / 2));
    for (let n = lo; n <= hi; n += 1) map.set(n, (map.get(n) ?? 0) | halvesOfDay(n, first, last));
  }
  return map;
}

function checkWindow(from: HrDay, to: HrDay, what: string): [number, number] {
  const f = dayNumber(checkDay(from, `${what} (début)`));
  const t = dayNumber(checkDay(to, `${what} (fin)`));
  if (t < f) throw new RangeError(`${what} : la fin précède le début`);
  return [f, t];
}

/**
 * Disponibilité d'une personne entre `from` et `to` inclus (ADR-0045 § 6.2) :
 * jours travaillés (semaine de travail moins fériés), moins les absences
 * passées en entrée (l'appelant choisit lesquelles : approuvées, en général).
 * Les absences qui se recouvrent ne sont comptées qu'une fois.
 */
export function availabilityOf(
  workPattern: WorkPattern,
  absences: readonly LeavePeriod[],
  holidays: readonly HolidayInput[],
  from: HrDay,
  to: HrDay,
): AvailabilityResult {
  const pattern = checkWorkPattern(workPattern);
  const [fromN, toN] = checkWindow(from, to, 'Disponibilité');
  const index = holidayIndex(holidays);
  const absent = absentHalves(absences, fromN, toN);
  let working = 0n;
  let available = 0n;
  const perDay: AvailabilityResult['perDay'] = [];
  for (let n = fromN; n <= toN; n += 1) {
    const date = dayOfNumber(n);
    const open = BOTH & ~index.halvesOn(date);
    const p = fractionCenti(pattern, weekdayOf(date));
    const w = countedCenti(p, open);
    const a = countedCenti(p, open & ~(absent.get(n) ?? 0));
    working += w;
    available += a;
    perDay.push({ date, working: formatDays(w), available: formatDays(a) });
  }
  return {
    version: HR_VERSION,
    workingDays: formatDays(working),
    absentDays: formatDays(working - available),
    availableDays: formatDays(available),
    perDay,
  };
}

/**
 * Calendrier d'équipe (ADR-0045 § 3.2, § 6.1) : absences approuvées des
 * collaborateurs visibles, et demandes en attente de ceux dont le lecteur voit
 * l'attente (soi, son équipe, les RH). Un type confidentiel est rendu
 * « Absent », sans identifiant de type, sauf pour le collaborateur lui-même et
 * les détenteurs de `hr.sensitive.read`. Les bornes sont ramenées à la fenêtre.
 */
export function teamCalendar(
  requests: readonly LeaveRequestInput[],
  types: readonly CalendarLeaveTypeInput[],
  viewer: TeamCalendarViewer,
  holidays: readonly HolidayInput[],
  from: HrDay,
  to: HrDay,
): TeamCalendarResult {
  const [fromN, toN] = checkWindow(from, to, 'Calendrier');
  if (toN - fromN + 1 > LEAVE_MAX_CALENDAR_DAYS) {
    throw new RangeError(`Calendrier : ${LEAVE_MAX_CALENDAR_DAYS} jours au plus`);
  }
  const typeById = new Map(types.map((t) => [t.id, t]));
  const visible = new Set(viewer.visibleEmployeeIds);
  const pendingVisible = new Set(viewer.pendingVisibleEmployeeIds);
  const windowFirst = fromN * 2;
  const windowLast = toN * 2 + 1;
  const entries: TeamCalendarEntry[] = [];
  const absentByDay = new Map<number, Set<string>>();

  for (const [i, r] of requests.entries()) {
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    const isSelf = viewer.selfEmployeeId !== null && r.employeeId === viewer.selfEmployeeId;
    if (!isSelf && !visible.has(r.employeeId)) continue;
    if (r.status === 'pending' && !isSelf && !pendingVisible.has(r.employeeId)) continue;
    const [first, last] = slotsOf(r.start, r.end, `Demande n° ${i + 1}`);
    const lo = Math.max(first, windowFirst);
    const hi = Math.min(last, windowLast);
    if (lo > hi) continue;
    const type = typeById.get(r.typeId);
    if (type === undefined) throw new RangeError(`Demande n° ${i + 1} : type inconnu ${r.typeId}`);
    const masked = type.confidential && !isSelf && !viewer.seesConfidential;
    entries.push({
      requestId: r.id,
      employeeId: r.employeeId,
      status: r.status,
      start: boundOfStartSlot(lo),
      end: boundOfEndSlot(hi),
      typeId: masked ? null : type.id,
      label: masked ? MASKED_LEAVE_LABEL : type.label,
      masked,
    });
    if (r.status === 'approved') {
      for (let n = Math.floor(lo / 2); n <= Math.floor(hi / 2); n += 1) {
        const set = absentByDay.get(n) ?? new Set<string>();
        set.add(r.employeeId);
        absentByDay.set(n, set);
      }
    }
  }
  entries.sort(
    (a, b) =>
      byString(a.start.date, b.start.date) ||
      byString(a.employeeId, b.employeeId) ||
      byString(a.requestId, b.requestId),
  );

  const index = holidayIndex(holidays);
  const days: TeamCalendarResult['days'] = [];
  const holidayList: TeamCalendarResult['holidays'] = [];
  for (let n = fromN; n <= toN; n += 1) {
    const date = dayOfNumber(n);
    days.push({ date, absentEmployeeIds: [...(absentByDay.get(n) ?? [])].sort(byString) });
    const off = index.halvesOn(date);
    if (off !== 0) {
      holidayList.push({
        date,
        halfDay: off === BOTH ? null : off === 1 ? 'am' : 'pm',
        label: index.labelOn(date),
      });
    }
  }
  return {
    version: HR_VERSION,
    from: dayOfNumber(fromN),
    to: dayOfNumber(toN),
    entries,
    days,
    holidays: holidayList,
  };
}
