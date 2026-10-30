// ─────────────────────────────────────────────────────────────────────────────
// Feuille de temps hebdomadaire en lecture (ADR-0045 O5, § 6.3)
//
// Grille jour × projet des saisies de temps EXISTANTES (`work_time_entries`)
// d'une personne, croisée avec ses absences approuvées et les fériés. Aucune
// saisie, aucune validation, aucun verrou. Deux constats :
//   - `TIME_ON_LEAVE_DAY` : temps saisi un jour d'absence pleine ;
//   - `NO_TIME_ON_WORKING_DAY` : jour encore travaillé (fériés et absences
//     déduits) sans saisie — information ; limité aux jours ≤ `today` s'il est
//     fourni.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BOTH,
  addDays,
  byString,
  checkDay,
  checkId,
  checkWorkPattern,
  countedCenti,
  dayNumber,
  formatDays,
  fractionCenti,
  halvesLabel,
  halvesOfDay,
  holidayIndex,
  slotsOf,
  weekdayOf,
  type Halves,
} from './days.js';
import {
  HR_VERSION,
  type HolidayInput,
  type HrDay,
  type LeavePeriod,
  type TimesheetDay,
  type TimesheetEntryInput,
  type WeeklyTimesheetResult,
  type WorkPattern,
} from './types.js';

export function weeklyTimesheet(
  entries: readonly TimesheetEntryInput[],
  absences: readonly LeavePeriod[],
  holidays: readonly HolidayInput[],
  workPattern: WorkPattern,
  week: HrDay,
  options: { today?: HrDay | null } = {},
): WeeklyTimesheetResult {
  const pattern = checkWorkPattern(workPattern);
  checkDay(week, 'Semaine');
  if (weekdayOf(week) !== 'mon') throw new RangeError('Semaine : le lundi est attendu');
  const today =
    options.today === undefined || options.today === null
      ? null
      : checkDay(options.today, 'Aujourd’hui');
  const firstN = dayNumber(week);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const index = holidayIndex(holidays);

  const absent: Halves[] = [0, 0, 0, 0, 0, 0, 0];
  for (const [i, a] of absences.entries()) {
    const [first, last] = slotsOf(a.start, a.end, `Absence n° ${i + 1}`);
    for (let d = 0; d < 7; d += 1)
      absent[d] = (absent[d] ?? 0) | halvesOfDay(firstN + d, first, last);
  }

  const byProject = new Map<string, number[]>();
  for (const [i, e] of entries.entries()) {
    const what = `Saisie n° ${i + 1}`;
    checkId(e.projectId, `${what} (projet)`);
    const day = checkDay(e.workedOn, `${what} (jour)`);
    if (typeof e.minutes !== 'number' || !Number.isInteger(e.minutes) || e.minutes < 0) {
      throw new RangeError(`${what} : minutes entières positives ou nulles attendues`);
    }
    const d = dayNumber(day) - firstN;
    if (d < 0 || d > 6) continue;
    const row = byProject.get(e.projectId) ?? [0, 0, 0, 0, 0, 0, 0];
    row[d] = (row[d] ?? 0) + e.minutes;
    byProject.set(e.projectId, row);
  }
  const projects = [...byProject.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([projectId, minutesByDay]) => ({
      projectId,
      minutesByDay,
      totalMinutes: minutesByDay.reduce((s, m) => s + m, 0),
    }));

  const days: TimesheetDay[] = [];
  const findings: WeeklyTimesheetResult['findings'] = [];
  for (let d = 0; d < 7; d += 1) {
    const date = dates[d] as HrDay;
    const weekday = weekdayOf(date);
    const p = fractionCenti(pattern, weekday);
    const off = index.halvesOn(date);
    const away = absent[d] ?? 0;
    const totalMinutes = projects.reduce((s, pr) => s + (pr.minutesByDay[d] ?? 0), 0);
    const expected = countedCenti(p, BOTH & ~off & ~away);
    days.push({
      date,
      weekday,
      scheduled: formatDays(p),
      holiday: halvesLabel(off),
      absence: halvesLabel(away),
      expected: formatDays(expected),
      totalMinutes,
    });
    if (away === BOTH && totalMinutes > 0) {
      findings.push({ code: 'TIME_ON_LEAVE_DAY', date, minutes: totalMinutes });
    }
    if (expected > 0n && totalMinutes === 0 && (today === null || date <= today)) {
      findings.push({ code: 'NO_TIME_ON_WORKING_DAY', date, minutes: 0 });
    }
  }
  return {
    version: HR_VERSION,
    week,
    days,
    projects,
    totalMinutes: projects.reduce((s, pr) => s + pr.totalMinutes, 0),
    findings,
  };
}
