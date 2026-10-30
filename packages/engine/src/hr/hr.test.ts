// Moteur RH (ADR-0045 § 7). Attendus calculés à la main ; les propriétés
// utilisent un générateur pseudo-aléatoire à graine fixe : un échec est
// rejouable à l'identique.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENGINE_VERSION,
  HR_VERSION,
  MASKED_LEAVE_LABEL,
  absenteeism,
  accrualsDue,
  availabilityOf,
  carryOverExpiryOf,
  carryOverOf,
  checkLeaveDebit,
  departmentCycle,
  employeeStatusOf,
  headcount,
  hrDeadlines,
  hrViewerScope,
  leaveApprovalSteps,
  leaveBalance,
  leaveDays,
  leaveOverlaps,
  leaveYearBounds,
  leaveYearOf,
  movements,
  orgChart,
  reportingCycle,
  seniority,
  seniorityYears,
  teamCalendar,
  weeklyTimesheet,
  type DepartmentInput,
  type HolidayInput,
  type HrEmployeeInput,
  type LeaveBound,
  type LeaveLedgerEntryInput,
  type LeaveRequestInput,
  type LeaveTypePolicyInput,
  type WorkPattern,
} from '../index.js';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)] as T;
const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));
const addDays = (day: string, n: number): string => {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
/** Durée décimale → centièmes (test). */
const centi = (v: string): number => Math.round(Number.parseFloat(v) * 100);

const MON_FRI: WorkPattern = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 0, sun: 0 };
const ALL_WEEK: WorkPattern = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 };
const full = (date: string): LeaveBound => ({ date, half: 'full' });
const am = (date: string): LeaveBound => ({ date, half: 'am' });
const pm = (date: string): LeaveBound => ({ date, half: 'pm' });
const holiday = (
  date: string,
  halfDay: 'am' | 'pm' | null = null,
  recurring = false,
): HolidayInput => ({
  date,
  halfDay,
  recurring,
  label: `Férié ${date}`,
});
// Semaine du lundi 5 janvier 2026.
const MON = '2026-01-05';
const TUE = '2026-01-06';
const WED = '2026-01-07';
const THU = '2026-01-08';
const FRI = '2026-01-09';
const SAT = '2026-01-10';
const SUN = '2026-01-11';

describe('version', () => {
  it('le module a sa propre version, sans toucher ENGINE_VERSION', () => {
    expect(HR_VERSION).toBe('1.0.0');
    expect(ENGINE_VERSION).toBe('0.2.0');
  });
});

// ─── leaveDays ───────────────────────────────────────────────────────────────

describe('leaveDays', () => {
  it('critère 8 : lundi matin → vendredi midi, férié le mercredi = 3,5 jours', () => {
    const r = leaveDays(full(MON), am(FRI), MON_FRI, [holiday(WED)]);
    expect(r.days).toBe('3.5');
    expect(r.calendarDays).toBe(5);
    expect(r.version).toBe(HR_VERSION);
    expect(r.perDay.map((d) => d.days)).toEqual(['1', '1', '0', '1', '0.5']);
    expect(r.perDay[2]?.holiday).toBe(true);
    expect(r.perDay[4]?.halves).toEqual(['am']);
  });

  it('critère 8 : un samedi et un dimanche seuls = 0 (LEAVE_NO_WORKING_DAY)', () => {
    expect(leaveDays(full(SAT), full(SUN), MON_FRI, []).days).toBe('0');
  });

  it('demi-journées sur un même jour', () => {
    expect(leaveDays(am(MON), am(MON), MON_FRI, []).days).toBe('0.5');
    expect(leaveDays(pm(MON), pm(MON), MON_FRI, []).days).toBe('0.5');
    expect(leaveDays(pm(MON), full(MON), MON_FRI, []).days).toBe('0.5');
    expect(leaveDays(full(MON), am(MON), MON_FRI, []).days).toBe('0.5');
    expect(leaveDays(am(MON), pm(MON), MON_FRI, []).days).toBe('1');
    expect(() => leaveDays(pm(MON), am(MON), MON_FRI, [])).toThrow(RangeError);
  });

  it('férié d’une demi-journée', () => {
    expect(leaveDays(full(TUE), full(TUE), MON_FRI, [holiday(TUE, 'am')]).days).toBe('0.5');
    expect(leaveDays(am(TUE), am(TUE), MON_FRI, [holiday(TUE, 'am')]).days).toBe('0');
    expect(leaveDays(pm(TUE), pm(TUE), MON_FRI, [holiday(TUE, 'am')]).days).toBe('0.5');
    // deux demi-journées fériées le même jour = journée fériée
    expect(
      leaveDays(full(TUE), full(TUE), MON_FRI, [holiday(TUE, 'am'), holiday(TUE, 'pm')]).days,
    ).toBe('0');
  });

  it('temps partiel : une demi-journée travaillée n’est pas située dans la journée', () => {
    const part: WorkPattern = { ...MON_FRI, wed: 0.5 };
    expect(leaveDays(full(WED), full(WED), part, []).days).toBe('0.5');
    expect(leaveDays(am(WED), am(WED), part, []).days).toBe('0.5');
    expect(leaveDays(full(WED), full(WED), part, [holiday(WED, 'am')]).days).toBe('0.5');
    expect(leaveDays(full(WED), full(WED), part, [holiday(WED)]).days).toBe('0');
    expect(leaveDays(full(MON), full(FRI), part, []).days).toBe('4.5');
  });

  it('férié récurrent et changement d’année', () => {
    expect(leaveDays(full(MON), full(FRI), MON_FRI, [holiday('2019-01-06', null, true)]).days).toBe(
      '4',
    );
    // non récurrent : ne vaut que pour son année
    expect(leaveDays(full(MON), full(FRI), MON_FRI, [holiday('2019-01-06')]).days).toBe('5');
    const r = leaveDays(full('2026-12-28'), full('2027-01-01'), MON_FRI, [
      holiday('2000-01-01', null, true),
    ]);
    expect(r.days).toBe('4');
    expect(r.calendarDays).toBe(5);
  });

  it('aucune règle légale : sans férié saisi, aucun jour n’est retiré (critère 21)', () => {
    expect(leaveDays(full('2026-06-29'), full('2026-07-03'), MON_FRI, []).days).toBe('5');
  });

  it('refuse les entrées invalides', () => {
    expect(() => leaveDays(full(FRI), full(MON), MON_FRI, [])).toThrow(RangeError);
    expect(() => leaveDays(full('2026-01-01'), full('2027-01-02'), MON_FRI, [])).toThrow(/366/);
    expect(leaveDays(full('2026-01-01'), full('2027-01-01'), MON_FRI, []).calendarDays).toBe(366);
    expect(() => leaveDays(full(MON), full(FRI), { ...MON_FRI, mon: 0.25 as never }, [])).toThrow(
      RangeError,
    );
    expect(() => leaveDays(full('2026-02-30'), full(FRI), MON_FRI, [])).toThrow(RangeError);
    expect(() => leaveDays({ date: MON, half: 'x' as never }, full(FRI), MON_FRI, [])).toThrow(
      RangeError,
    );
    expect(() => leaveDays(full(MON), full(FRI), MON_FRI, [holiday('2026-13-01')])).toThrow(
      RangeError,
    );
  });

  it('propriétés : additivité, bornes, cohérence avec availabilityOf (graine 45)', () => {
    const r = rng(45);
    const patterns: WorkPattern[] = [
      MON_FRI,
      ALL_WEEK,
      { mon: 1, tue: 0.5, wed: 0, thu: 1, fri: 0.5, sat: 0.5, sun: 0 },
    ];
    for (let i = 0; i < 300; i += 1) {
      const pattern = pick(r, patterns);
      const start = addDays('2025-11-01', int(r, 0, 400));
      const length = int(r, 0, 60);
      const end = addDays(start, length);
      const holidays = Array.from({ length: int(r, 0, 5) }, () =>
        holiday(addDays(start, int(r, -5, 65)), pick(r, ['am', 'pm', null] as const), r() < 0.2),
      );
      const whole = leaveDays(full(start), full(end), pattern, holidays);
      expect(centi(whole.days)).toBeGreaterThanOrEqual(0);
      expect(centi(whole.days)).toBeLessThanOrEqual((length + 1) * 100);
      // Additivité : couper la période en deux
      if (length >= 1) {
        const cut = addDays(start, int(r, 0, length - 1));
        const a = leaveDays(full(start), full(cut), pattern, holidays);
        const b = leaveDays(full(addDays(cut, 1)), full(end), pattern, holidays);
        expect(centi(a.days) + centi(b.days)).toBe(centi(whole.days));
      }
      // Couper à midi : matin d'un côté, après-midi de l'autre
      const mid = addDays(start, int(r, 0, length));
      const left = leaveDays(full(start), am(mid), pattern, holidays);
      const right = leaveDays(pm(mid), full(end), pattern, holidays);
      // (une demi-journée travaillée non située peut compter des deux côtés)
      expect(centi(left.days) + centi(right.days)).toBeGreaterThanOrEqual(centi(whole.days));
      expect(centi(left.days) + centi(right.days)).toBeLessThanOrEqual(centi(whole.days) + 50);
      // Le décompte = la part d'absence d'availabilityOf sur la même fenêtre
      const avail = availabilityOf(
        pattern,
        [{ start: full(start), end: full(end) }],
        holidays,
        start,
        end,
      );
      expect(avail.absentDays).toBe(whole.days);
      expect(avail.availableDays).toBe('0');
      // Semaine complète sans férié : jours = jours civils
      if (pattern === ALL_WEEK && holidays.length === 0) {
        expect(whole.days).toBe(String(length + 1));
      }
    }
  });
});

// ─── leaveOverlaps, checkLeaveDebit ──────────────────────────────────────────

const request = (
  id: string,
  employeeId: string,
  start: LeaveBound,
  end: LeaveBound,
  status: LeaveRequestInput['status'] = 'approved',
  typeId = 'conges',
  days = '1',
): LeaveRequestInput => ({ id, employeeId, typeId, status, start, end, days });

describe('leaveOverlaps', () => {
  const existing = [
    request('r1', 'B', pm(MON), am(WED)),
    request('r2', 'B', full(FRI), full(FRI), 'rejected'),
    request('r3', 'B', full(FRI), full(FRI), 'cancelled'),
    request('r4', 'C', full(MON), full(FRI)),
    request('r5', 'B', full(THU), full(THU), 'pending'),
  ];
  it('critère 12 : un recouvrement d’une demi-journée est un chevauchement', () => {
    const r = leaveOverlaps({ employeeId: 'B', start: am(WED), end: am(WED) }, existing);
    expect(r.overlaps).toEqual([{ requestId: 'r1', status: 'approved', from: WED, to: WED }]);
    expect(
      leaveOverlaps({ employeeId: 'B', start: full(MON), end: full(MON) }, existing).overlaps,
    ).toHaveLength(1);
  });
  it('demi-journées adjacentes : pas de chevauchement', () => {
    expect(
      leaveOverlaps({ employeeId: 'B', start: pm(WED), end: pm(WED) }, existing).overlaps,
    ).toEqual([]);
    expect(
      leaveOverlaps({ employeeId: 'B', start: am(MON), end: am(MON) }, existing).overlaps,
    ).toEqual([]);
  });
  it('ignore les autres collaborateurs, les refusées, les annulées et la demande elle-même', () => {
    expect(
      leaveOverlaps({ employeeId: 'B', start: full(FRI), end: full(FRI) }, existing).overlaps,
    ).toEqual([]);
    const r = leaveOverlaps({ employeeId: 'B', start: full(MON), end: full(FRI) }, existing);
    expect(r.overlaps.map((o) => o.requestId)).toEqual(['r1', 'r5']);
    expect(
      leaveOverlaps({ id: 'r5', employeeId: 'B', start: full(THU), end: full(THU) }, existing)
        .overlaps,
    ).toEqual([]);
  });
  it('propriété : la relation est symétrique (graine 12)', () => {
    const r = rng(12);
    const halves = ['full', 'am', 'pm'] as const;
    for (let i = 0; i < 400; i += 1) {
      const mk = (id: string): LeaveRequestInput => {
        const s = addDays(MON, int(r, 0, 10));
        const e = addDays(s, int(r, 0, 4));
        const sh = pick(r, halves);
        let eh = pick(r, halves);
        if (s === e && sh === 'pm' && eh === 'am') eh = 'full';
        return request(id, 'B', { date: s, half: sh }, { date: e, half: eh }, 'pending');
      };
      const a = mk('a');
      const b = mk('b');
      const ab = leaveOverlaps(a, [b]).overlaps.length;
      const ba = leaveOverlaps(b, [a]).overlaps.length;
      expect(ab).toBe(ba);
    }
  });
});

describe('checkLeaveDebit', () => {
  it('critère 11 : 3 jours demandés pour 2,5 disponibles', () => {
    expect(checkLeaveDebit('2.5', '3', false)).toEqual({
      version: HR_VERSION,
      ok: false,
      shortfall: '0.5',
      availableAfter: '-0.5',
    });
    expect(checkLeaveDebit('2.5', '3', true).ok).toBe(true);
    expect(checkLeaveDebit('3', '3', false)).toMatchObject({
      ok: true,
      shortfall: '0',
      availableAfter: '0',
    });
    expect(() => checkLeaveDebit('2.5', '-1', false)).toThrow(RangeError);
    expect(() => checkLeaveDebit('2.555', '1', false)).toThrow(RangeError);
  });
});

// ─── availabilityOf, teamCalendar ────────────────────────────────────────────

describe('availabilityOf', () => {
  it('jours travaillés − absences − fériés, recouvrements comptés une fois', () => {
    const r = availabilityOf(
      MON_FRI,
      [
        { start: full(THU), end: am(FRI) },
        { start: am(THU), end: am(THU) },
      ],
      [holiday(WED)],
      MON,
      SUN,
    );
    expect(r).toMatchObject({ workingDays: '4', absentDays: '1.5', availableDays: '2.5' });
    expect(r.perDay).toHaveLength(7);
    expect(r.perDay[4]).toEqual({ date: FRI, working: '1', available: '0.5' });
    expect(() => availabilityOf(MON_FRI, [], [], FRI, MON)).toThrow(RangeError);
  });
});

describe('teamCalendar', () => {
  const types = [
    { id: 'conges', label: 'Congés', confidential: false },
    { id: 'maladie', label: 'Maladie', confidential: true },
  ];
  const requests = [
    request('r1', 'B', full(TUE), full(WED), 'approved', 'maladie'),
    request('r2', 'C', full('2026-01-02'), am(MON), 'approved', 'conges'),
    request('r3', 'C', full(THU), full(THU), 'pending', 'conges'),
    request('r4', 'D', full(MON), full(FRI), 'approved', 'conges'),
    request('r5', 'B', full(FRI), full(FRI), 'rejected', 'conges'),
    request('r6', 'A', full(FRI), full(FRI), 'pending', 'maladie'),
  ];
  const manager = {
    selfEmployeeId: 'A',
    visibleEmployeeIds: ['B', 'C'],
    pendingVisibleEmployeeIds: ['B', 'C'],
    seesConfidential: false,
  };

  it('critère 10 : un type confidentiel est « Absent » pour le manager', () => {
    const r = teamCalendar(requests, types, manager, [holiday(WED)], MON, SUN);
    expect(r.entries.map((e) => [e.requestId, e.label, e.typeId, e.status])).toEqual([
      ['r2', 'Congés', 'conges', 'approved'],
      ['r1', MASKED_LEAVE_LABEL, null, 'approved'],
      ['r3', 'Congés', 'conges', 'pending'],
      ['r6', 'Maladie', 'maladie', 'pending'], // sa propre absence : type visible
    ]);
    expect(JSON.stringify(r.entries.filter((e) => e.employeeId === 'B'))).not.toContain('Maladie');
    // bornes ramenées à la fenêtre
    expect(r.entries[0]?.start).toEqual(full(MON));
    expect(r.entries[0]?.end).toEqual(am(MON));
    expect(r.days[0]).toEqual({ date: MON, absentEmployeeIds: ['C'] });
    expect(r.days[1]).toEqual({ date: TUE, absentEmployeeIds: ['B'] });
    expect(r.days[3]?.absentEmployeeIds).toEqual([]); // l'attente n'est pas comptée
    expect(r.holidays).toEqual([{ date: WED, halfDay: null, label: `Férié ${WED}` }]);
  });

  it('les ayants droit voient le type ; l’attente hors portée est masquée', () => {
    const hr = { ...manager, seesConfidential: true, pendingVisibleEmployeeIds: [] };
    const r = teamCalendar(requests, types, hr, [], MON, SUN);
    expect(r.entries.find((e) => e.requestId === 'r1')?.label).toBe('Maladie');
    expect(r.entries.find((e) => e.requestId === 'r3')).toBeUndefined();
    expect(r.entries.find((e) => e.requestId === 'r4')).toBeUndefined();
    expect(() =>
      teamCalendar(
        [request('x', 'B', full(MON), full(MON), 'approved', 'inconnu')],
        types,
        manager,
        [],
        MON,
        SUN,
      ),
    ).toThrow(RangeError);
  });
});

// ─── Grand livre et soldes ───────────────────────────────────────────────────

const entry = (
  kind: LeaveLedgerEntryInput['kind'],
  days: string,
  effectiveOn: string,
  leaveYear = 2026,
  typeId = 'conges',
): LeaveLedgerEntryInput => ({ typeId, kind, days, effectiveOn, leaveYear });

describe('leaveBalance', () => {
  const ledger = [
    entry('allocation', '5', '2026-01-01'),
    entry('carry_over', '3', '2026-01-01'),
    entry('adjustment', '-1', '2026-01-15'),
    entry('accrual', '2', '2026-01-31'),
    entry('accrual', '2', '2026-02-28'),
    entry('taken', '-2', '2026-02-10'),
    entry('taken', '-1', '2026-02-20'),
    entry('taken_reversal', '1', '2026-02-20'),
    entry('taken', '-3', '2026-04-06'),
    entry('expiry', '-1', '2026-03-31'),
    entry('accrual', '2', '2026-03-31'),
    entry('accrual', '9', '2025-12-31', 2025),
    entry('allocation', '4', '2026-01-01', 2026, 'autre'),
  ];
  const pending = [
    { typeId: 'conges', startDate: '2026-05-04', days: '1.5' },
    { typeId: 'conges', startDate: '2027-01-04', days: '2' },
  ];

  it('acquis, pris, à venir, en attente, disponible', () => {
    const r = leaveBalance(ledger, pending, '2026-03-15');
    expect(r.leaveYear).toBe(2026);
    expect(r.balances.map((b) => b.typeId)).toEqual(['autre', 'conges']);
    expect(r.balances[1]).toEqual({
      typeId: 'conges',
      leaveYear: 2026,
      accrued: '4',
      allocated: '5',
      adjusted: '-1',
      carriedOver: '3',
      expired: '0',
      taken: '2',
      upcoming: '3',
      pending: '1.5',
      available: '4.5',
    });
    // Après la date d'effet de l'expiration et de l'acquisition de mars
    const later = leaveBalance(ledger, pending, '2026-04-30');
    expect(later.balances[1]).toMatchObject({
      accrued: '6',
      expired: '1',
      upcoming: '0',
      taken: '5',
      available: '5.5',
    });
  });

  it('critère 11 : annuler une absence approuvée future rend les jours', () => {
    const before = leaveBalance(
      [entry('allocation', '10', '2026-01-01'), entry('taken', '-3', '2026-06-01')],
      [],
      '2026-03-01',
    );
    expect(before.balances[0]?.available).toBe('7');
    const after = leaveBalance(
      [
        entry('allocation', '10', '2026-01-01'),
        entry('taken', '-3', '2026-06-01'),
        entry('taken_reversal', '3', '2026-06-01'),
      ],
      [],
      '2026-03-01',
    );
    expect(after.balances[0]?.available).toBe('10');
  });

  it('année de congé décalée', () => {
    expect(leaveYearOf('2026-03-15', '07-01')).toBe(2025);
    expect(leaveYearOf('2026-07-01', '07-01')).toBe(2026);
    expect(leaveYearBounds(2025, '07-01')).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    expect(leaveBalance(ledger, pending, '2026-03-15', '07-01').leaveYear).toBe(2025);
    expect(() => leaveYearOf('2026-03-15', '02-29')).toThrow(RangeError);
    expect(() => leaveYearOf('2026-03-15', '04-31')).toThrow(RangeError);
    expect(() => leaveYearOf('2026-03-15', '1-1')).toThrow(RangeError);
  });

  it('refuse un signe incompatible ou une nature inconnue', () => {
    expect(() => leaveBalance([entry('accrual', '-1', '2026-01-01')], [], '2026-02-01')).toThrow(
      RangeError,
    );
    expect(() => leaveBalance([entry('taken', '1', '2026-01-01')], [], '2026-02-01')).toThrow(
      RangeError,
    );
    expect(() => leaveBalance([entry('expiry', '1', '2026-01-01')], [], '2026-02-01')).toThrow(
      RangeError,
    );
    expect(() =>
      leaveBalance([entry('taken_reversal', '-1', '2026-01-01')], [], '2026-02-01'),
    ).toThrow(RangeError);
    expect(() =>
      leaveBalance([entry('bonus' as never, '1', '2026-01-01')], [], '2026-02-01'),
    ).toThrow(RangeError);
    expect(() =>
      leaveBalance([entry('allocation', '1.005', '2026-01-01')], [], '2026-02-01'),
    ).toThrow(RangeError);
  });

  it('propriétés : identité du disponible, indépendance de l’ordre (graine 7)', () => {
    const r = rng(7);
    const kinds = [
      'accrual',
      'allocation',
      'adjustment',
      'taken',
      'taken_reversal',
      'carry_over',
      'expiry',
    ] as const;
    for (let i = 0; i < 200; i += 1) {
      const list: LeaveLedgerEntryInput[] = Array.from({ length: int(r, 0, 25) }, () => {
        const kind = pick(r, kinds);
        const magnitude = int(r, 0, 1000);
        const sign =
          kind === 'taken' || kind === 'expiry'
            ? -1
            : kind === 'adjustment' || kind === 'allocation'
              ? pick(r, [1, -1])
              : 1;
        const value = sign * magnitude;
        const days = `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;
        return entry(kind, days, addDays('2026-01-01', int(r, 0, 364)), 2026, pick(r, ['a', 'b']));
      });
      const asOf = addDays('2026-01-01', int(r, 0, 364));
      const res = leaveBalance(list, [], asOf);
      const shuffled = [...list].sort(() => (r() < 0.5 ? -1 : 1));
      expect(leaveBalance(shuffled, [], asOf)).toEqual(res);
      for (const b of res.balances) {
        const expected =
          centi(b.accrued) +
          centi(b.allocated) +
          centi(b.adjusted) +
          centi(b.carriedOver) -
          centi(b.expired) -
          centi(b.taken) -
          centi(b.upcoming) -
          centi(b.pending);
        expect(centi(b.available)).toBe(expected);
        // somme brute du grand livre de l'année jusqu'à asOf, plus l'à venir
        const raw = list
          .filter(
            (e) =>
              e.typeId === b.typeId &&
              (e.effectiveOn <= asOf || e.kind === 'taken' || e.kind === 'taken_reversal'),
          )
          .reduce((s, e) => s + centi(e.days), 0);
        expect(centi(b.available)).toBe(raw);
      }
    }
  });
});

// ─── Acquisitions ────────────────────────────────────────────────────────────

const conges = (
  accrual: LeaveTypePolicyInput['accrual'],
  extra: Partial<LeaveTypePolicyInput> = {},
): LeaveTypePolicyInput => ({
  id: 'conges',
  accrual,
  ...extra,
});

describe('accrualsDue', () => {
  const monthly2 = conges({ kind: 'monthly', days: '2' });

  it('critère 11 : 2 jours par mois, entrée le 16 janvier → 1,03 ; rejouée, rien de plus', () => {
    const r = accrualsDue(monthly2, { startDate: '2026-01-16' }, null, '2026-02-01');
    expect(r.entries).toEqual([
      {
        period: '2026-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        effectiveOn: '2026-01-31',
        leaveYear: 2026,
        days: '1.03',
        activeDays: 16,
        periodDays: 31,
      },
    ]);
    expect(
      accrualsDue(monthly2, { startDate: '2026-01-16' }, '2026-01', '2026-02-01').entries,
    ).toEqual([]);
    expect(accrualsDue(monthly2, { startDate: '2026-01-16' }, null, '2026-01-31').entries).toEqual(
      [],
    );
  });

  it('sortie en cours de période, prorata, exception du collaborateur', () => {
    const r = accrualsDue(
      monthly2,
      { startDate: '2026-01-16', endDate: '2026-03-10' },
      null,
      '2026-06-15',
    );
    expect(r.entries.map((e) => [e.period, e.days])).toEqual([
      ['2026-01', '1.03'],
      ['2026-02', '2'],
      ['2026-03', '0.65'],
    ]);
    const none = accrualsDue(
      conges({ kind: 'monthly', days: '2' }, { proration: 'none' }),
      { startDate: '2026-01-16' },
      null,
      '2026-02-01',
    );
    expect(none.entries[0]?.days).toBe('2');
    const override = accrualsDue(
      monthly2,
      {
        startDate: '2026-01-16',
        leavePolicyOverrides: { conges: { accrual: { kind: 'monthly', days: '1' } } },
      },
      null,
      '2026-02-01',
    );
    expect(override.entries[0]?.days).toBe('0.52');
  });

  it('critère 21 : sans acquisition paramétrée, rien n’est acquis', () => {
    expect(
      accrualsDue(conges({ kind: 'none' }), { startDate: '2020-01-01' }, null, '2026-10-30')
        .entries,
    ).toEqual([]);
  });

  it('annuelle au début de l’année de congé, créditée d’avance, au prorata', () => {
    const yearly = conges({ kind: 'yearly', days: '24', on: 'leave_year_start' });
    const r = accrualsDue(yearly, { startDate: '2026-04-01' }, null, '2027-01-01');
    expect(
      r.entries.map((e) => [
        e.period,
        e.effectiveOn,
        e.days,
        e.activeDays,
        e.periodDays,
        e.leaveYear,
      ]),
    ).toEqual([
      ['2026-01-01', '2026-04-01', '18.08', 275, 365, 2026],
      ['2027-01-01', '2027-01-01', '24', 365, 365, 2027],
    ]);
    expect(
      accrualsDue(yearly, { startDate: '2026-04-01' }, null, '2026-12-31').entries,
    ).toHaveLength(1);
    expect(
      accrualsDue(yearly, { startDate: '2026-04-01' }, '2026-01-01', '2027-01-01').entries.map(
        (e) => e.period,
      ),
    ).toEqual(['2027-01-01']);
    // année de congé décalée
    const shifted = accrualsDue(yearly, { startDate: '2026-04-01' }, null, '2026-07-01', '07-01');
    expect(shifted.entries.map((e) => [e.period, e.days, e.leaveYear])).toEqual([
      ['2025-07-01', '5.98', 2025],
      ['2026-07-01', '24', 2026],
    ]);
  });

  it('annuelle à l’anniversaire, sortie connue', () => {
    const yearly = conges({ kind: 'yearly', days: '10', on: 'anniversary' });
    expect(
      accrualsDue(yearly, { startDate: '2025-03-10' }, null, '2026-03-10').entries.map((e) => [
        e.period,
        e.days,
      ]),
    ).toEqual([
      ['2025-03-10', '10'],
      ['2026-03-10', '10'],
    ]);
    expect(
      accrualsDue(yearly, { startDate: '2025-03-10' }, null, '2026-03-09').entries,
    ).toHaveLength(1);
    const exited = accrualsDue(
      yearly,
      { startDate: '2025-03-10', endDate: '2026-06-30' },
      null,
      '2026-12-31',
    );
    expect(exited.entries.map((e) => [e.period, e.days, e.activeDays])).toEqual([
      ['2025-03-10', '10', 365],
      ['2026-03-10', '3.1', 113],
    ]);
  });

  it('refuse les paramètres invalides', () => {
    expect(() =>
      accrualsDue(
        conges({ kind: 'monthly', days: '61' }),
        { startDate: '2026-01-01' },
        null,
        '2026-03-01',
      ),
    ).toThrow(RangeError);
    expect(() =>
      accrualsDue(
        conges({ kind: 'monthly', days: '-1' }),
        { startDate: '2026-01-01' },
        null,
        '2026-03-01',
      ),
    ).toThrow(RangeError);
    expect(() =>
      accrualsDue(monthly2, { startDate: '2026-03-01', endDate: '2026-02-01' }, null, '2026-03-01'),
    ).toThrow(RangeError);
    expect(() =>
      accrualsDue(
        conges({ kind: 'yearly', days: '1', on: 'x' as never }),
        { startDate: '2026-01-01' },
        null,
        '2026-03-01',
      ),
    ).toThrow(RangeError);
  });

  it('propriétés : idempotence et découpage des exécutions (graine 2026)', () => {
    const r = rng(2026);
    const policies = [
      conges({ kind: 'monthly', days: '2.08' }),
      conges({ kind: 'monthly', days: '1.5' }, { proration: 'none' }),
      conges({ kind: 'yearly', days: '18', on: 'leave_year_start' }),
      conges({ kind: 'yearly', days: '12.5', on: 'anniversary' }),
    ];
    for (let i = 0; i < 200; i += 1) {
      const type = pick(r, policies);
      const startDate = addDays('2023-01-01', int(r, 0, 900));
      const endDate = r() < 0.3 ? addDays(startDate, int(r, 0, 600)) : null;
      const employee = { startDate, endDate };
      const asOf1 = addDays(startDate, int(r, -10, 700));
      const asOf2 = addDays(asOf1, int(r, 0, 400));
      const once = accrualsDue(type, employee, null, asOf2).entries;
      const first = accrualsDue(type, employee, null, asOf1).entries;
      const last = first.at(-1)?.period ?? null;
      const second = accrualsDue(type, employee, last, asOf2).entries;
      expect([...first, ...second]).toEqual(once);
      expect(accrualsDue(type, employee, once.at(-1)?.period ?? null, asOf2).entries).toEqual([]);
      for (const e of once) {
        expect(e.effectiveOn <= asOf2).toBe(true);
        expect(e.activeDays).toBeGreaterThan(0);
        expect(e.activeDays).toBeLessThanOrEqual(e.periodDays);
        const amount = type.accrual.kind === 'none' ? 0 : centi(type.accrual.days);
        expect(centi(e.days)).toBeLessThanOrEqual(amount);
      }
      const periods = once.map((e) => e.period);
      expect(new Set(periods).size).toBe(periods.length);
    }
  });
});

describe('carryOverOf, carryOverExpiryOf', () => {
  const policy = conges({ kind: 'none' }, { carryOver: { maxDays: '5', expiresAfterMonths: 3 } });
  it('plafond, solde négatif, sans plafond', () => {
    expect(carryOverOf('7.5', policy, 2027)).toEqual({
      version: HR_VERSION,
      typeId: 'conges',
      leaveYear: 2027,
      carried: '5',
      lapsed: '2.5',
      expiresOn: '2027-04-01',
    });
    expect(carryOverOf('-2', policy, 2027)).toMatchObject({ carried: '-2', lapsed: '0' });
    expect(carryOverOf('7.5', conges({ kind: 'none' }), 2027)).toMatchObject({
      carried: '7.5',
      lapsed: '0',
      expiresOn: null,
    });
    expect(carryOverOf('7.5', policy, 2027, '07-01').expiresOn).toBe('2027-10-01');
    expect(() =>
      carryOverOf(
        '1',
        conges({ kind: 'none' }, { carryOver: { maxDays: null, expiresAfterMonths: 37 } }),
        2027,
      ),
    ).toThrow(RangeError);
  });
  it('le reporté non pris expire ; les prises consomment d’abord le reporté', () => {
    const ledger = [
      entry('carry_over', '5', '2027-01-01', 2027),
      entry('taken', '-2', '2027-02-10', 2027),
      entry('taken', '-4', '2027-05-10', 2027),
      entry('accrual', '2', '2027-01-31', 2027),
      entry('carry_over', '9', '2026-01-01', 2026),
    ];
    expect(carryOverExpiryOf(ledger, policy, 2027, '2027-03-31')).toMatchObject({
      due: false,
      expired: '0',
      expiresOn: '2027-04-01',
    });
    expect(carryOverExpiryOf(ledger, policy, 2027, '2027-04-01')).toMatchObject({
      due: true,
      expired: '3',
    });
    expect(
      carryOverExpiryOf(
        [...ledger, entry('expiry', '-3', '2027-04-01', 2027)],
        policy,
        2027,
        '2027-04-02',
      ).expired,
    ).toBe('0');
    expect(carryOverExpiryOf(ledger, conges({ kind: 'none' }), 2027, '2027-12-31')).toMatchObject({
      due: false,
      expired: '0',
      expiresOn: null,
    });
  });
});

// ─── Circuit, hiérarchie, services ───────────────────────────────────────────

describe('leaveApprovalSteps', () => {
  const withManager = { managerEmployeeId: 'A', managerUserId: 'uA' };
  const plain = { confidential: false, requiresHrApproval: false };
  it('table des circuits', () => {
    expect(leaveApprovalSteps({ approvalFlow: 'manager_only' }, plain, withManager)).toEqual({
      version: HR_VERSION,
      steps: ['manager'],
      managerReplacedBy: null,
    });
    expect(
      leaveApprovalSteps({ approvalFlow: 'manager_then_hr' }, plain, withManager).steps,
    ).toEqual(['manager', 'hr']);
    expect(
      leaveApprovalSteps(
        { approvalFlow: 'manager_only' },
        { ...plain, requiresHrApproval: true },
        withManager,
      ).steps,
    ).toEqual(['manager', 'hr']);
    expect(leaveApprovalSteps({ approvalFlow: 'hr_only' }, plain, withManager)).toMatchObject({
      steps: ['hr'],
      managerReplacedBy: 'HR_ONLY_FLOW',
    });
  });
  it('l’étape manager devient RH : type confidentiel, sans manager, manager sans compte', () => {
    expect(
      leaveApprovalSteps(
        { approvalFlow: 'manager_then_hr' },
        { ...plain, confidential: true },
        withManager,
      ),
    ).toMatchObject({ steps: ['hr'], managerReplacedBy: 'CONFIDENTIAL_TYPE' });
    expect(
      leaveApprovalSteps({ approvalFlow: 'manager_only' }, plain, {
        managerEmployeeId: null,
        managerUserId: null,
      }),
    ).toMatchObject({ steps: ['hr'], managerReplacedBy: 'NO_MANAGER' });
    expect(
      leaveApprovalSteps({ approvalFlow: 'manager_then_hr' }, plain, {
        managerEmployeeId: 'A',
        managerUserId: null,
      }),
    ).toMatchObject({ steps: ['hr'], managerReplacedBy: 'MANAGER_WITHOUT_ACCOUNT' });
    expect(() => leaveApprovalSteps({ approvalFlow: 'x' as never }, plain, withManager)).toThrow(
      RangeError,
    );
  });
});

describe('reportingCycle, departmentCycle', () => {
  const chain = [
    { id: 'A', managerEmployeeId: null },
    { id: 'B', managerEmployeeId: 'A' },
    { id: 'C', managerEmployeeId: 'B' },
    { id: 'X', managerEmployeeId: 'Y' },
    { id: 'Y', managerEmployeeId: 'X' },
  ];
  it('critère 5 : faire de C le manager de A est un cycle', () => {
    expect(reportingCycle(chain, 'A', 'C').cycle).toBe(true);
    expect(reportingCycle(chain, 'A', 'A').cycle).toBe(true);
    expect(reportingCycle(chain, 'C', 'A').cycle).toBe(false);
    expect(reportingCycle(chain, 'A', null).cycle).toBe(false);
    expect(reportingCycle(chain, 'Z', 'X').cycle).toBe(false); // cycle existant : pas de boucle infinie
  });
  const depts = [
    { id: 'R', parentId: null },
    { id: 'S', parentId: 'R' },
    { id: 'T', parentId: 'S' },
  ];
  it('cycle et profondeur des services', () => {
    expect(departmentCycle(depts, 'R', 'T')).toMatchObject({ cycle: true });
    expect(departmentCycle(depts, 'R', 'R')).toMatchObject({ cycle: true });
    expect(departmentCycle(depts, 'T', 'R')).toMatchObject({
      cycle: false,
      depth: 2,
      tooDeep: false,
    });
    expect(departmentCycle(depts, 'S', null)).toMatchObject({ cycle: false, depth: 2 });
    expect(departmentCycle(depts, null, 'T')).toMatchObject({ cycle: false, depth: 4 });
    const deep = Array.from({ length: 8 }, (_, i) => ({
      id: `d${i}`,
      parentId: i === 0 ? null : `d${i - 1}`,
    }));
    expect(departmentCycle(deep, null, 'd6')).toMatchObject({ depth: 8, tooDeep: false });
    expect(departmentCycle(deep, null, 'd7')).toMatchObject({ depth: 9, tooDeep: true });
    expect(
      departmentCycle(
        [...deep, { id: 'n', parentId: null }, { id: 'n2', parentId: 'n' }],
        'n',
        'd6',
      ),
    ).toMatchObject({ depth: 9, tooDeep: true });
  });
});

// ─── Organigramme et portée ──────────────────────────────────────────────────

const emp = (id: string, extra: Partial<HrEmployeeInput> = {}): HrEmployeeInput => ({
  id,
  status: 'active',
  startDate: '2024-01-01',
  ...extra,
});

describe('orgChart', () => {
  const departments: DepartmentInput[] = [
    { id: 'dir', name: 'Direction', parentId: null, active: true, headEmployeeId: 'A' },
    { id: 'ops', name: 'Opérations', parentId: 'dir', active: true },
    { id: 'old', name: 'Ancien', parentId: null, active: false },
    { id: 'c1', name: 'Boucle 1', parentId: 'c2', active: true },
    { id: 'c2', name: 'Boucle 2', parentId: 'c1', active: true },
  ];
  const employees = [
    emp('A', { departmentId: 'dir', sortName: 'a' }),
    emp('B', { departmentId: 'ops', managerEmployeeId: 'A', sortName: 'b' }),
    emp('C', { departmentId: 'ops', managerEmployeeId: 'B', sortName: 'c' }),
    emp('D', { departmentId: 'old', managerEmployeeId: 'A', sortName: 'd' }),
    emp('E', { status: 'exited', departmentId: 'ops', managerEmployeeId: 'A' }),
    emp('F', { managerEmployeeId: 'E', sortName: 'f' }),
    emp('G', { managerEmployeeId: 'H', sortName: 'g' }),
    emp('H', { managerEmployeeId: 'G', sortName: 'h' }),
  ];
  it('par services : effectifs directs et cumulés, sortis exclus', () => {
    const r = orgChart(departments, employees, 'departments');
    if (r.view !== 'departments') throw new Error('vue');
    expect(r.headcount).toBe(7);
    expect(r.unassignedEmployeeIds).toEqual(['D', 'F', 'G', 'H']);
    const dir = r.roots.find((n) => n.departmentId === 'dir');
    expect(dir).toMatchObject({ headcount: 1, totalHeadcount: 3, headEmployeeId: 'A' });
    expect(dir?.children[0]).toMatchObject({ departmentId: 'ops', employeeIds: ['B', 'C'] });
    expect(r.roots.map((n) => n.departmentId)).toEqual(['dir', 'c1']);
    expect(r.roots[1]?.children.map((n) => n.departmentId)).toEqual(['c2']);
  });
  it('par ligne hiérarchique : racines sans manager actif, cycles rompus', () => {
    const r = orgChart(departments, employees, 'reporting');
    if (r.view !== 'reporting') throw new Error('vue');
    expect(r.roots.map((n) => n.employeeId)).toEqual(['A', 'F', 'G']);
    expect(r.roots[0]).toMatchObject({ directReports: 2, totalReports: 3 });
    expect(r.cycleBrokenAt).toEqual(['G']);
    const count = (nodes: typeof r.roots): number =>
      nodes.reduce((s, n) => s + 1 + count(n.children), 0);
    expect(count(r.roots)).toBe(r.headcount);
  });
});

describe('hrViewerScope', () => {
  const settings = { teamCalendarVisibility: 'department', orgChartVisibility: 'members' } as const;
  const employees = [
    emp('A', { userId: 'uA', departmentId: 'd1' }),
    emp('B', { userId: 'uB', departmentId: 'd2', managerEmployeeId: 'A' }),
    emp('C', { userId: 'uC', departmentId: 'd2', managerEmployeeId: 'B' }),
    emp('D', { departmentId: 'd1' }),
    emp('E', { userId: 'uE', status: 'exited', managerEmployeeId: 'A', departmentId: 'd1' }),
    emp('Z', { userId: 'uZ', status: 'anonymized' }),
  ];
  it('critère 5 : le manager voit son équipe directe et indirecte', () => {
    const s = hrViewerScope({
      viewerUserId: 'uA',
      employees,
      effectiveActions: ['analytics.read', 'leave.request'],
      settings,
    });
    expect(s).toMatchObject({
      selfEmployeeId: 'A',
      directReportIds: ['B'],
      teamEmployeeIds: ['B', 'C'],
      departmentEmployeeIds: ['D'],
      seesAll: false,
      seesConfidential: false,
      holdsLeaveApprove: false,
      isManager: true,
      calendarEmployeeIds: ['A', 'B', 'C', 'D'],
      pendingVisibleEmployeeIds: ['A', 'B', 'C'],
      orgChartVisible: true,
    });
  });
  it('C ne voit ni A ni B, sauf dans l’organigramme', () => {
    const s = hrViewerScope({ viewerUserId: 'uC', employees, effectiveActions: [], settings });
    expect(s).toMatchObject({
      selfEmployeeId: 'C',
      teamEmployeeIds: [],
      departmentEmployeeIds: ['B'],
      isManager: false,
      orgChartVisible: true,
    });
    expect(
      hrViewerScope({
        viewerUserId: 'uC',
        employees,
        effectiveActions: [],
        settings: { ...settings, orgChartVisibility: 'hr_only' },
      }).orgChartVisible,
    ).toBe(false);
    expect(
      hrViewerScope({
        viewerUserId: 'uC',
        employees,
        effectiveActions: [],
        settings: { ...settings, teamCalendarVisibility: 'managers_and_hr' },
      }).calendarEmployeeIds,
    ).toEqual(['C']);
  });
  it('droits effectifs et membre sans fiche', () => {
    const hr = hrViewerScope({
      viewerUserId: 'uX',
      employees,
      effectiveActions: ['hr.read', 'hr.sensitive.read', 'leave.approve'],
      settings,
    });
    expect(hr).toMatchObject({
      selfEmployeeId: null,
      seesAll: true,
      seesConfidential: true,
      holdsLeaveApprove: true,
      orgChartVisible: true,
    });
    expect(hr.calendarEmployeeIds).toEqual(['A', 'B', 'C', 'D']);
    const none = hrViewerScope({ viewerUserId: 'uX', employees, effectiveActions: [], settings });
    expect(none).toMatchObject({
      selfEmployeeId: null,
      calendarEmployeeIds: [],
      orgChartVisible: false,
    });
    expect(
      hrViewerScope({ viewerUserId: 'uZ', employees, effectiveActions: [], settings })
        .selfEmployeeId,
    ).toBeNull();
    expect(
      hrViewerScope({ viewerUserId: 'uE', employees, effectiveActions: [], settings })
        .selfEmployeeId,
    ).toBe('E');
  });
  it('équipe bornée à dix niveaux', () => {
    const chain = Array.from({ length: 13 }, (_, i) =>
      emp(`e${String(i).padStart(2, '0')}`, {
        userId: `u${i}`,
        managerEmployeeId: i === 0 ? null : `e${String(i - 1).padStart(2, '0')}`,
      }),
    );
    expect(
      hrViewerScope({ viewerUserId: 'u0', employees: chain, effectiveActions: [], settings })
        .teamEmployeeIds,
    ).toHaveLength(10);
  });
});

// ─── Rapports et échéances ───────────────────────────────────────────────────

describe('employeeStatusOf, headcount, movements, seniority', () => {
  it('statut dérivé', () => {
    expect(employeeStatusOf(emp('A', { startDate: '2026-11-01' }), '2026-10-30')).toBe('upcoming');
    expect(employeeStatusOf(emp('A', { probationEndDate: '2026-10-30' }), '2026-10-30')).toBe(
      'probation',
    );
    expect(employeeStatusOf(emp('A', { probationEndDate: '2026-10-29' }), '2026-10-30')).toBe(
      'active',
    );
    expect(
      employeeStatusOf(emp('A', { status: 'exited', endDate: '2026-10-31' }), '2026-10-30'),
    ).toBe('active');
    expect(
      employeeStatusOf(emp('A', { status: 'exited', endDate: '2026-10-29' }), '2026-10-30'),
    ).toBe('exited');
    expect(
      employeeStatusOf(emp('A', { status: 'anonymized', endDate: '2020-01-01' }), '2026-10-30'),
    ).toBe('anonymized');
  });

  const people = [
    emp('E1', { startDate: '2025-03-01', departmentId: 'd1', contractType: 'permanent' }),
    emp('E2', { startDate: '2026-01-06', departmentId: 'd1', contractType: 'fixed_term' }),
    emp('E3', {
      startDate: '2025-05-01',
      endDate: '2026-01-05',
      status: 'exited',
      exitCategory: 'resignation',
    }),
    emp('E4', {
      startDate: '2020-01-01',
      endDate: '2025-06-30',
      status: 'anonymized',
      exitCategory: 'dismissal',
    }),
  ];
  it('effectif par service et type de contrat', () => {
    expect(headcount(people, '2026-01-05')).toMatchObject({ total: 2, groups: [] });
    expect(headcount(people, '2026-01-06', 'department').groups).toEqual([{ key: 'd1', count: 2 }]);
    expect(headcount(people, '2025-06-01', 'contract_type').groups).toEqual([
      { key: 'permanent', count: 1 },
      { key: null, count: 2 },
    ]);
  });
  it('entrées, sorties et taux de sortie', () => {
    const r = movements(people, '2026-01-01', '2026-01-10');
    expect(r).toMatchObject({
      entries: 1,
      exits: 1,
      averageHeadcount: '2.00',
      exitRatePercent: '50.00',
    });
    expect(r.exitsByCategory).toEqual([{ category: 'resignation', count: 1 }]);
    const year = movements(people, '2025-01-01', '2025-12-31');
    expect(year).toMatchObject({ entries: 2, exits: 1 });
    expect(movements([], '2026-01-01', '2026-01-10')).toMatchObject({
      averageHeadcount: '0.00',
      exitRatePercent: null,
    });
    expect(() => movements(people, '2026-01-10', '2026-01-01')).toThrow(RangeError);
  });
  it('ancienneté par tranches', () => {
    const staff = [
      emp('a', { startDate: '2026-01-01' }),
      emp('b', { startDate: '2025-06-30' }),
      emp('c', { startDate: '2025-07-01' }),
      emp('d', { startDate: '2016-06-30' }),
      emp('e', { startDate: '2021-07-01' }),
      emp('f', { startDate: '2020-02-29' }),
      emp('g', { startDate: '2010-01-01', endDate: '2026-01-01', status: 'exited' }),
      emp('h', { startDate: '2026-07-01' }),
    ];
    expect(seniority(staff, '2026-06-30')).toEqual({
      version: HR_VERSION,
      asOf: '2026-06-30',
      total: 6,
      buckets: [
        { bucket: 'lt1', count: 2 },
        { bucket: '1to3', count: 1 },
        { bucket: '3to5', count: 1 },
        { bucket: '5to10', count: 1 },
        { bucket: 'gte10', count: 1 },
      ],
    });
    expect(seniorityYears('2020-02-29', '2021-02-27')).toBe(0);
    expect(seniorityYears('2020-02-29', '2021-02-28')).toBe(1);
    expect(seniorityYears('2026-01-01', '2025-01-01')).toBe(0);
  });
});

describe('absenteeism', () => {
  it('par service, recouvrements comptés une fois, types non comptés exclus', () => {
    const types = [
      { id: 'maladie', countsAsAbsenteeism: true },
      { id: 'conges', countsAsAbsenteeism: false },
    ];
    const employees = [
      emp('E1', { departmentId: 'd1' }),
      emp('E2', {
        departmentId: 'd1',
        workPattern: { mon: 0.5, tue: 0.5, wed: 0.5, thu: 0.5, fri: 0.5, sat: 0, sun: 0 },
      }),
      emp('E3', { startDate: FRI }),
      emp('E4', { endDate: '2025-12-31', status: 'exited' }),
    ];
    const requests = [
      request('r1', 'E1', full(THU), full(THU), 'approved', 'maladie'),
      request('r2', 'E1', am(THU), am(THU), 'approved', 'maladie'),
      request('r3', 'E1', full(FRI), full(FRI), 'approved', 'conges'),
      request('r4', 'E2', full(MON), full(MON), 'pending', 'maladie'),
      request('r5', 'E4', full(MON), full(FRI), 'approved', 'maladie'),
    ];
    const r = absenteeism(requests, types, employees, [holiday(WED)], MON, SUN, MON_FRI);
    expect(r.groups).toEqual([
      {
        departmentId: 'd1',
        employees: 2,
        theoreticalDays: '6.00',
        absenceDays: '1.00',
        ratePercent: '16.67',
      },
      {
        departmentId: null,
        employees: 1,
        theoreticalDays: '1.00',
        absenceDays: '0.00',
        ratePercent: '0.00',
      },
    ]);
    expect(r.total).toEqual({
      employees: 3,
      theoreticalDays: '7.00',
      absenceDays: '1.00',
      ratePercent: '14.29',
    });
    expect(JSON.stringify(r)).not.toContain('E1');
  });
});

describe('hrDeadlines', () => {
  const today = '2026-10-30';
  const horizons = { probationEnd: 15, contractEnd: 30, documentExpiry: 30 };
  it('critère 14 : fin de CDD à 30 jours, fin d’essai à 15, passeport à 30', () => {
    const employees = [
      emp('B', { contractEndDate: addDays(today, 30), probationEndDate: addDays(today, 15) }),
      emp('C', { contractEndDate: addDays(today, 31), probationEndDate: addDays(today, 16) }),
      emp('X', { status: 'exited', endDate: '2026-09-30', contractEndDate: addDays(today, 3) }),
      emp('P', { probationEndDate: addDays(today, -1) }),
    ];
    const documents = [
      { id: 'doc1', employeeId: 'C', expiresOn: addDays(today, 31) },
      { id: 'doc2', employeeId: 'C', expiresOn: today, deleted: true },
      { id: 'doc3', employeeId: 'X', expiresOn: today },
      { id: 'doc4', employeeId: 'C', expiresOn: null },
    ];
    const ids = [{ employeeId: 'B', kind: 'passport', expiresOn: addDays(today, 30) }];
    const r = hrDeadlines(employees, documents, ids, today, horizons);
    expect(r.total).toBe(3);
    expect(r.counts).toEqual({
      probation_end: 1,
      contract_end: 1,
      document_expiry: 0,
      id_expiry: 1,
    });
    expect(r.deadlines.map((d) => [d.kind, d.daysLeft, d.dedupeKey])).toEqual([
      ['probation_end', 15, `B:probation_end:${addDays(today, 15)}`],
      ['contract_end', 30, `B:contract_end:${addDays(today, 30)}`],
      ['id_expiry', 30, `B:id_expiry:${addDays(today, 30)}:passport`],
    ]);
    // Rejouée : mêmes clés, l'appelant dédoublonne.
    expect(hrDeadlines(employees, documents, ids, today, horizons)).toEqual(r);
    const doc = hrDeadlines(
      employees,
      [{ id: 'doc9', employeeId: 'B', expiresOn: today }],
      [],
      today,
      horizons,
    );
    expect(doc.deadlines[0]).toMatchObject({
      kind: 'document_expiry',
      documentId: 'doc9',
      daysLeft: 0,
      dedupeKey: `B:document_expiry:${today}:doc9`,
    });
    expect(() => hrDeadlines(employees, [], [], today, { ...horizons, contractEnd: 121 })).toThrow(
      RangeError,
    );
  });
});

// ─── Feuille de temps ────────────────────────────────────────────────────────

describe('weeklyTimesheet', () => {
  it('critère 17 : 120 minutes saisies un jour d’absence', () => {
    const r = weeklyTimesheet(
      [
        { projectId: 'p2', workedOn: MON, minutes: 240 },
        { projectId: 'p1', workedOn: MON, minutes: 60 },
        { projectId: 'p1', workedOn: WED, minutes: 120 },
        { projectId: 'p1', workedOn: '2026-01-12', minutes: 999 },
      ],
      [{ start: full(TUE), end: full(THU) }],
      [holiday(FRI, 'pm')],
      MON_FRI,
      MON,
    );
    expect(r.projects).toEqual([
      { projectId: 'p1', minutesByDay: [60, 0, 120, 0, 0, 0, 0], totalMinutes: 180 },
      { projectId: 'p2', minutesByDay: [240, 0, 0, 0, 0, 0, 0], totalMinutes: 240 },
    ]);
    expect(r.totalMinutes).toBe(420);
    expect(r.days[2]).toMatchObject({ absence: 'full', expected: '0', totalMinutes: 120 });
    expect(r.days[4]).toMatchObject({ holiday: 'pm', expected: '0.5', scheduled: '1' });
    expect(r.days[5]).toMatchObject({ weekday: 'sat', scheduled: '0' });
    expect(r.findings).toEqual([
      { code: 'TIME_ON_LEAVE_DAY', date: WED, minutes: 120 },
      { code: 'NO_TIME_ON_WORKING_DAY', date: FRI, minutes: 0 },
    ]);
    const early = weeklyTimesheet([], [], [], MON_FRI, MON, { today: TUE });
    expect(early.findings.map((f) => f.date)).toEqual([MON, TUE]);
  });
  it('refuse une semaine qui ne commence pas un lundi, des minutes invalides', () => {
    expect(() => weeklyTimesheet([], [], [], MON_FRI, TUE)).toThrow(RangeError);
    expect(() =>
      weeklyTimesheet([{ projectId: 'p', workedOn: MON, minutes: 1.5 }], [], [], MON_FRI, MON),
    ).toThrow(RangeError);
  });
});

// ─── Pureté ──────────────────────────────────────────────────────────────────

describe('pureté du module', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

  it('aucune horloge, aucun flottant pour une durée, aucune règle légale codée (critère 21)', () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/new Date\(|Date\.now|parseFloat|\bNumber\(|Math\.random/);
      // aucun férié ni droit à congé de la RDC en dur
      expect(text, f).not.toMatch(/30-06|06-30|\b-?25 jours|CNSS|IPR|INPP|ONEM/);
    }
  });

  it('déterministe : mêmes entrées, même sortie', () => {
    const a = leaveDays(full(MON), am(FRI), MON_FRI, [holiday(WED)]);
    const b = leaveDays(full(MON), am(FRI), MON_FRI, [holiday(WED)]);
    expect(a).toEqual(b);
  });
});
