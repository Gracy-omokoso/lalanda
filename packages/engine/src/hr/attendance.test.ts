// Présences (ADR-0051 § 2.3). Heures saisies en heure de Kinshasa (UTC+1) via
// le suffixe `+01:00`. Propriétés à graine fixe, rejouables. 2026-11-02 : lundi.

import { describe, expect, it } from 'vitest';

import {
  HR_VERSION,
  attendanceDay,
  attendanceDays,
  type AttendanceEventInput,
  type AttendanceOptions,
  type LeavePeriod,
  type ShiftInput,
} from '../index.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));

const MON = '2026-11-02';
const TUE = '2026-11-03';
const OFF: AttendanceOptions = { planningEnabled: false, lateToleranceMinutes: null };

let seq = 0;
const ev = (kind: 'in' | 'out', at: string, over: Partial<AttendanceEventInput> = {}): AttendanceEventInput => ({
  id: `e${String(seq++).padStart(3, '0')}`,
  kind,
  at,
  ...over,
});
const k = (day: string, time: string): string => `${day}T${time}:00+01:00`;

const shift = (over: Partial<ShiftInput> & { id: string }): ShiftInput => ({
  employeeId: 'B',
  date: MON,
  start: '08:00',
  end: '17:00',
  crossesMidnight: false,
  status: 'published',
  ...over,
});

describe('attendanceDay', () => {
  it('critère 11 : « J’arrive » 08:02, « Je pars » 17:10 → 548 minutes', () => {
    const a = ev('in', k(MON, '08:02'));
    const b = ev('out', k(MON, '17:10'));
    expect(attendanceDay([a, b], [], [], [], MON, OFF)).toEqual({
      version: HR_VERSION,
      date: MON,
      pairs: [{ inId: a.id, outId: b.id, in: a.at, out: b.at, minutes: 548 }],
      minutes: 548,
      firstIn: a.at,
      lastOut: b.at,
      unpairedEventIds: [],
      leave: null,
      holiday: null,
      shiftIds: [],
      findings: [],
    });
  });

  it('heure UTC acceptée ; secondes tronquées par paire', () => {
    const r = attendanceDay(
      [ev('in', '2026-11-02T07:00:30Z'), ev('out', '2026-11-02T08:00:29Z')],
      [],
      [],
      [],
      MON,
      OFF,
    );
    expect(r.minutes).toBe(59);
  });

  it('critère 11 : un deuxième `in` sans `out` lève ATTENDANCE_UNPAIRED', () => {
    const a = ev('in', k(MON, '08:00'));
    const b = ev('in', k(MON, '08:05'));
    const c = ev('out', k(MON, '12:00'));
    const r = attendanceDay([a, b, c], [], [], [], MON, OFF);
    expect(r.pairs.map((p) => [p.inId, p.outId, p.minutes])).toEqual([[b.id, c.id, 235]]);
    expect(r.unpairedEventIds).toEqual([a.id]);
    expect(r.findings).toEqual([{ code: 'ATTENDANCE_UNPAIRED', eventId: a.id, shiftId: null, minutes: null }]);
    expect(r.firstIn).toBe(a.at);
  });

  it('`out` isolé, `in` laissé ouvert, plusieurs paires dans la journée', () => {
    const o = ev('out', k(MON, '07:00'));
    const p1 = [ev('in', k(MON, '08:00')), ev('out', k(MON, '12:00'))];
    const p2 = [ev('in', k(MON, '13:00')), ev('out', k(MON, '17:30'))];
    const open = ev('in', k(MON, '20:00'));
    const r = attendanceDay([open, ...p2, o, ...p1], [], [], [], MON, OFF);
    expect(r.minutes).toBe(240 + 270);
    expect(r.unpairedEventIds).toEqual([o.id, open.id]);
    expect(r.findings.map((f) => f.code)).toEqual(['ATTENDANCE_UNPAIRED', 'ATTENDANCE_UNPAIRED']);
    expect(r.lastOut).toBe(p2[1]?.at);
  });

  it('nuit franchissant minuit : la paire compte pour le jour de l’arrivée', () => {
    const events = [ev('in', k(MON, '22:00')), ev('out', k(TUE, '06:15'))];
    expect(attendanceDay(events, [], [], [], MON, OFF).minutes).toBe(495);
    const tue = attendanceDay(events, [], [], [], TUE, OFF);
    expect(tue.minutes).toBe(0);
    expect(tue.pairs).toEqual([]);
    expect(tue.findings).toEqual([]);
  });

  it('au-delà de 24 h : pas de paire', () => {
    const a = ev('in', k(MON, '08:00'));
    const b = ev('out', k(TUE, '08:01'));
    const r = attendanceDay([a, b], [], [], [], MON, OFF);
    expect(r.pairs).toEqual([]);
    expect(r.unpairedEventIds).toEqual([a.id]);
    expect(attendanceDay([a, b], [], [], [], TUE, OFF).unpairedEventIds).toEqual([b.id]);
  });

  it('critère 11 : un pointage annulé par une correction est ignoré, le corrigé compte', () => {
    const wrong = ev('in', k(MON, '10:00'), { voidedBy: 'c1' });
    const fixed = ev('in', k(MON, '08:00'));
    const out = ev('out', k(MON, '12:00'));
    const r = attendanceDay([wrong, fixed, out], [], [], [], MON, OFF);
    expect(r.minutes).toBe(240);
    expect(r.unpairedEventIds).toEqual([]);
  });

  it('ATTENDANCE_ON_LEAVE_DAY, demi-journée comprise ; férié rendu pour information', () => {
    const leave: LeavePeriod[] = [{ start: { date: MON, half: 'pm' }, end: { date: MON, half: 'full' } }];
    const r = attendanceDay(
      [ev('in', k(MON, '08:00')), ev('out', k(MON, '12:00'))],
      [],
      leave,
      [{ date: MON, halfDay: null, recurring: false }],
      MON,
      OFF,
    );
    expect(r.leave).toBe('pm');
    expect(r.holiday).toBe('full');
    expect(r.findings).toEqual([{ code: 'ATTENDANCE_ON_LEAVE_DAY', eventId: null, shiftId: null, minutes: null }]);
    expect(attendanceDay([], [], leave, [], MON, OFF).findings).toEqual([]);
  });

  it('ATTENDANCE_WITHOUT_SHIFT seulement si les plannings sont actifs', () => {
    const events = [ev('in', k(MON, '08:00')), ev('out', k(MON, '12:00'))];
    expect(attendanceDay(events, [], [], [], MON, OFF).findings).toEqual([]);
    const on = { ...OFF, planningEnabled: true };
    expect(attendanceDay(events, [], [], [], MON, on).findings.map((f) => f.code)).toEqual(['ATTENDANCE_WITHOUT_SHIFT']);
    expect(attendanceDay(events, [shift({ id: 's', status: 'draft' })], [], [], MON, on).findings.map((f) => f.code)).toEqual([
      'ATTENDANCE_WITHOUT_SHIFT',
    ]);
    expect(attendanceDay(events, [shift({ id: 's' })], [], [], MON, on).findings).toEqual([]);
    // Nuit commencée la veille : la sortie du matin n'est pas « sans créneau ».
    const night = [shift({ id: 'n', date: '2026-11-01', start: '22:00', end: '06:00', crossesMidnight: true })];
    const morning = [ev('in', k(MON, '05:00')), ev('out', k(MON, '06:00'))];
    expect(attendanceDay(morning, night, [], [], MON, on).findings).toEqual([]);
  });

  it('SHIFT_WITHOUT_ATTENDANCE : créneau publié terminé sans pointage, jamais sans « now »', () => {
    const s = [shift({ id: 's' })];
    expect(attendanceDay([], s, [], [], MON, OFF).findings).toEqual([]);
    expect(attendanceDay([], s, [], [], MON, { ...OFF, now: k(MON, '16:59') }).findings).toEqual([]);
    expect(attendanceDay([], s, [], [], MON, { ...OFF, now: k(MON, '17:00') }).findings).toEqual([
      { code: 'SHIFT_WITHOUT_ATTENDANCE', eventId: null, shiftId: 's', minutes: null },
    ]);
    // Arrivé avant le début : présent.
    const early = [ev('in', k(MON, '07:50')), ev('out', k(MON, '17:05'))];
    expect(attendanceDay(early, s, [], [], MON, { ...OFF, now: k(TUE, '00:00') }).findings).toEqual([]);
  });

  it('ATTENDANCE_LATE_START : éteint par défaut ; tolérance saisie', () => {
    const s = [shift({ id: 's' })];
    const late = [ev('in', k(MON, '08:20')), ev('out', k(MON, '17:00'))];
    expect(attendanceDay(late, s, [], [], MON, OFF).findings).toEqual([]);
    expect(attendanceDay(late, s, [], [], MON, { ...OFF, lateToleranceMinutes: 20 }).findings).toEqual([]);
    expect(attendanceDay(late, s, [], [], MON, { ...OFF, lateToleranceMinutes: 15 }).findings).toEqual([
      { code: 'ATTENDANCE_LATE_START', eventId: null, shiftId: 's', minutes: 20 },
    ]);
    expect(attendanceDay(late, s, [], [], MON, { ...OFF, lateToleranceMinutes: 0 }).findings[0]?.minutes).toBe(20);
  });

  it('entrées invalides', () => {
    expect(() => attendanceDay([ev('in', '2026-11-02 08:00')], [], [], [], MON, OFF)).toThrow(RangeError);
    expect(() => attendanceDay([ev('in', '2026-11-02T08:00:00')], [], [], [], MON, OFF)).toThrow(RangeError);
    expect(() => attendanceDay([ev('pause' as never, k(MON, '08:00'))], [], [], [], MON, OFF)).toThrow(RangeError);
    const a = ev('in', k(MON, '08:00'));
    expect(() => attendanceDay([a, { ...a }], [], [], [], MON, OFF)).toThrow(RangeError);
    expect(() => attendanceDay([], [], [], [], MON, { ...OFF, lateToleranceMinutes: -1 })).toThrow(RangeError);
    expect(() => attendanceDay([], [], [], [], '2026-02-30', OFF)).toThrow(RangeError);
  });

  it('aucun champ de localisation, d’adresse ni d’appareil dans le résultat', () => {
    const r = attendanceDay([ev('in', k(MON, '08:00')), ev('out', k(MON, '09:00'))], [], [], [], MON, OFF);
    expect(JSON.stringify(r)).not.toMatch(/ip|lat|lon|geo|device|position/i);
  });
});

describe('attendanceDays', () => {
  it('fenêtre de jours, total', () => {
    const events = [
      ev('in', k(MON, '08:00')),
      ev('out', k(MON, '12:00')),
      ev('in', k(TUE, '22:00')),
      ev('out', k('2026-11-04', '02:00')),
    ];
    const r = attendanceDays(events, [], [], [], MON, '2026-11-04', OFF);
    expect(r.days.map((d) => d.minutes)).toEqual([240, 240, 0]);
    expect(r.minutes).toBe(480);
    expect(() => attendanceDays(events, [], [], [], TUE, MON, OFF)).toThrow(RangeError);
    expect(() => attendanceDays(events, [], [], [], '2026-01-01', '2027-01-02', OFF)).toThrow(RangeError);
  });

  it('propriété : chaque pointage valide est apparié une fois ou isolé une fois ; minutes ≥ 0 ; ordre sans effet', { timeout: 120_000 }, () => {
    const r = rng(1102);
    const base = Date.parse('2026-11-01T23:00:00Z'); // 2026-11-02 00:00 à Kinshasa
    for (let run = 0; run < 400; run += 1) {
      const events: AttendanceEventInput[] = Array.from({ length: int(r, 0, 20) }, (_, i) => ({
        id: `x${String(i).padStart(2, '0')}`,
        kind: r() < 0.5 ? 'in' : 'out',
        at: new Date(base + int(r, 0, 4 * 24 * 60) * 60_000 + int(r, 0, 59) * 1000).toISOString(),
        voidedBy: r() < 0.1 ? 'c' : null,
      }));
      const res = attendanceDays(events, [], [], [], MON, '2026-11-05', OFF);
      const seen = new Map<string, number>();
      for (const d of res.days) {
        for (const p of d.pairs) {
          expect(p.minutes >= 0 && p.minutes <= 24 * 60).toBe(true);
          seen.set(p.inId, (seen.get(p.inId) ?? 0) + 1);
          seen.set(p.outId, (seen.get(p.outId) ?? 0) + 1);
        }
        for (const id of d.unpairedEventIds) seen.set(id, (seen.get(id) ?? 0) + 1);
        expect(d.minutes).toBe(d.pairs.reduce((s, p) => s + p.minutes, 0));
      }
      for (const e of events) {
        const inWindow = e.at >= '2026-11-01T23:00:00' && e.at < '2026-11-05T23:00:00';
        if (e.voidedBy !== null) expect(seen.has(e.id)).toBe(false);
        else if (inWindow) expect(seen.get(e.id)).toBe(1);
      }
      const shuffled = [...events].reverse();
      expect(attendanceDays(shuffled, [], [], [], MON, '2026-11-05', OFF)).toEqual(res);
    }
  });
});
