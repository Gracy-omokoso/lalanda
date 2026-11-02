// Feuille de temps : colonne « présence » et constat `PROJECT_TIME_ABOVE_ATTENDANCE`
// (ADR-0051 § 7.8). ADR-0051 — H14.

import { describe, expect, it } from 'vitest';

import { weeklyTimesheet, type WorkPattern } from './index.js';

const MON_FRI: WorkPattern = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 };
const MON = '2026-01-05';
const TUE = '2026-01-06';
const WED = '2026-01-07';

describe('weeklyTimesheet — présence pointée (ADR-0051 § 7.8)', () => {
  const entries = [
    { projectId: 'p1', workedOn: MON, minutes: 480 },
    { projectId: 'p1', workedOn: TUE, minutes: 300 },
  ];

  it('sans `attendance` : sortie d’ADR-0045, aucune colonne, aucun constat nouveau', () => {
    const r = weeklyTimesheet(entries, [], [], MON_FRI, MON, { today: TUE });
    expect(r.days.every((d) => !('attendanceMinutes' in d))).toBe(true);
    expect(r.findings.some((f) => f.code === 'PROJECT_TIME_ABOVE_ATTENDANCE')).toBe(false);
    expect(weeklyTimesheet(entries, [], [], MON_FRI, MON, { attendance: null })).toEqual(
      weeklyTimesheet(entries, [], [], MON_FRI, MON),
    );
  });

  it('temps projet au-delà de la présence : constat, information seulement', () => {
    const r = weeklyTimesheet(entries, [], [], MON_FRI, MON, {
      today: TUE,
      attendance: [
        { date: MON, minutes: 548 },
        { date: TUE, minutes: 240 },
        // Hors de la semaine : ignoré.
        { date: '2026-01-12', minutes: 60 },
      ],
    });
    expect(r.days.map((d) => d.attendanceMinutes)).toEqual([548, 240, 0, 0, 0, 0, 0]);
    expect(r.findings).toContainEqual({
      code: 'PROJECT_TIME_ABOVE_ATTENDANCE',
      date: TUE,
      minutes: 60,
    });
    expect(r.findings.filter((f) => f.code === 'PROJECT_TIME_ABOVE_ATTENDANCE')).toHaveLength(1);
    // Les saisies et les totaux sont inchangés.
    expect(r.totalMinutes).toBe(780);
  });

  it('refuse des minutes de présence invalides', () => {
    expect(() =>
      weeklyTimesheet([], [], [], MON_FRI, MON, { attendance: [{ date: WED, minutes: -1 }] }),
    ).toThrow(RangeError);
  });
});
