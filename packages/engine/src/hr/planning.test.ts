// Plannings (ADR-0051 § 2.4). Attendus calculés à la main ; propriétés à graine
// fixe, rejouables. 2026-11-02 est un lundi.

import { describe, expect, it } from 'vitest';

import {
  HR_VERSION,
  kinshasaDayOf,
  kinshasaInstant,
  shiftConflicts,
  shiftInterval,
  shiftOverlaps,
  staffingGaps,
  type EmployeeLeaveInput,
  type ShiftInput,
  type StaffingNeedInput,
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
const pick = <T>(r: () => number, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)] as T;
const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const MON = '2026-11-02';
const TUE = '2026-11-03';

const shift = (over: Partial<ShiftInput> & { id: string }): ShiftInput => ({
  employeeId: 'B',
  date: MON,
  start: '08:00',
  end: '12:00',
  crossesMidnight: false,
  status: 'published',
  ...over,
});

const leave = (
  employeeId: string,
  from: string,
  to: string,
  half: 'full' | 'am' | 'pm' = 'full',
): EmployeeLeaveInput => ({
  employeeId,
  start: { date: from, half: half === 'pm' ? 'pm' : 'full' },
  end: { date: to, half: half === 'am' ? 'am' : 'full' },
});

describe('heures et instants', () => {
  it('Kinshasa = UTC+1', () => {
    expect(new Date(kinshasaInstant(MON, 8 * 60)).toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(kinshasaDayOf(Date.parse('2026-11-02T23:30:00Z'))).toBe(TUE);
    expect(kinshasaDayOf(Date.parse('2026-11-02T22:59:59Z'))).toBe(MON);
  });

  it('durée, minuit franchi, 24 h au plus', () => {
    expect(shiftInterval(shift({ id: 'a' })).minutes).toBe(240);
    expect(
      shiftInterval(shift({ id: 'a', start: '22:00', end: '06:00', crossesMidnight: true }))
        .minutes,
    ).toBe(480);
    expect(
      shiftInterval(shift({ id: 'a', start: '07:00', end: '07:00', crossesMidnight: true }))
        .minutes,
    ).toBe(1440);
    expect(() => shiftInterval(shift({ id: 'a', start: '22:00', end: '06:00' }))).toThrow(
      RangeError,
    );
    expect(() =>
      shiftInterval(shift({ id: 'a', start: '08:00', end: '12:00', crossesMidnight: true })),
    ).toThrow(RangeError);
    expect(() => shiftInterval(shift({ id: 'a', start: '08:00', end: '08:00' }))).toThrow(
      RangeError,
    );
    expect(() => shiftInterval(shift({ id: 'a', start: '24:00' }))).toThrow(RangeError);
    expect(() => shiftInterval(shift({ id: 'a', start: '8:00' }))).toThrow(RangeError);
  });
});

describe('shiftOverlaps', () => {
  const existing = [
    shift({ id: 's1', start: '08:00', end: '12:00' }),
    shift({ id: 's2', start: '14:00', end: '18:00' }),
    shift({ id: 's3', start: '10:00', end: '11:00', status: 'cancelled' }),
    shift({ id: 's4', employeeId: 'C', start: '08:00', end: '18:00' }),
    shift({ id: 's5', start: '22:00', end: '06:00', crossesMidnight: true }),
  ];

  it('critère 12 : deux créneaux qui se chevauchent', () => {
    expect(shiftOverlaps(shift({ id: 'n', start: '11:00', end: '15:00' }), existing)).toEqual([
      's1',
      's2',
    ]);
  });
  it('bornes jointives : aucun chevauchement', () => {
    expect(shiftOverlaps(shift({ id: 'n', start: '12:00', end: '14:00' }), existing)).toEqual([]);
  });
  it('annulés, autre collaborateur, soi-même : ignorés', () => {
    expect(shiftOverlaps(shift({ id: 's1', start: '10:00', end: '11:00' }), existing)).toEqual([]);
    expect(
      shiftOverlaps(
        shift({ id: 'n', start: '10:00', end: '11:00', status: 'cancelled' }),
        existing,
      ),
    ).toEqual([]);
  });
  it('nuit franchissant minuit : chevauche le lendemain matin', () => {
    expect(
      shiftOverlaps(shift({ id: 'n', date: TUE, start: '05:00', end: '09:00' }), existing),
    ).toEqual(['s5']);
    expect(
      shiftOverlaps(shift({ id: 'n', date: TUE, start: '06:00', end: '09:00' }), existing),
    ).toEqual([]);
  });
});

describe('shiftConflicts', () => {
  it('chevauchement, congé, seuil indicatif', () => {
    const shifts = [
      shift({ id: 's1', start: '08:00', end: '12:00' }),
      shift({ id: 's2', start: '11:00', end: '13:00', status: 'draft' }),
      shift({ id: 's3', date: TUE, start: '08:00', end: '18:00' }),
      shift({
        id: 's4',
        employeeId: 'C',
        date: TUE,
        start: '22:00',
        end: '06:00',
        crossesMidnight: true,
      }),
    ];
    const absences = [leave('B', TUE, TUE), leave('C', '2026-11-04', '2026-11-04', 'am')];
    const r = shiftConflicts(shifts, absences, { indicativeMaxMinutesPerWeek: 600 });
    expect(r).toEqual({
      version: HR_VERSION,
      findings: [
        {
          code: 'SHIFT_OVERLAP',
          employeeId: 'B',
          shiftIds: ['s1', 's2'],
          week: null,
          minutes: null,
        },
        {
          code: 'SHIFT_DURING_LEAVE',
          employeeId: 'B',
          shiftIds: ['s3'],
          week: null,
          minutes: null,
        },
        {
          code: 'SHIFT_DURING_LEAVE',
          employeeId: 'C',
          shiftIds: ['s4'],
          week: null,
          minutes: null,
        },
        {
          code: 'SHIFT_ABOVE_INDICATIVE_LIMIT',
          employeeId: 'B',
          shiftIds: ['s1', 's2', 's3'],
          week: MON,
          minutes: 960,
        },
      ],
      weeklyMinutes: [
        { employeeId: 'B', week: MON, minutes: 960 },
        { employeeId: 'C', week: MON, minutes: 480 },
      ],
    });
  });

  it('critère 12 : sans seuil saisi, aucune limite hebdomadaire', () => {
    const shifts = Array.from({ length: 7 }, (_, d) =>
      shift({
        id: `s${d}`,
        date: `2026-11-0${d + 2}`,
        start: '00:00',
        end: '00:00',
        crossesMidnight: true,
      }),
    );
    const r = shiftConflicts(shifts, []);
    expect(r.findings).toEqual([]);
    expect(r.weeklyMinutes).toEqual([{ employeeId: 'B', week: MON, minutes: 7 * 1440 }]);
  });

  it('un créneau annulé ne compte pas ; dimanche appartient à la semaine du lundi précédent', () => {
    const r = shiftConflicts(
      [shift({ id: 'a', status: 'cancelled' }), shift({ id: 'b', date: '2026-11-08' })],
      [],
    );
    expect(r.weeklyMinutes).toEqual([{ employeeId: 'B', week: MON, minutes: 240 }]);
  });

  it('entrées invalides', () => {
    expect(() => shiftConflicts([shift({ id: 'a' }), shift({ id: 'a', date: TUE })], [])).toThrow(
      RangeError,
    );
    expect(() => shiftConflicts([], [], { indicativeMaxMinutesPerWeek: 0 })).toThrow(RangeError);
    expect(() => shiftConflicts([shift({ id: 'a', status: 'done' as never })], [])).toThrow(
      RangeError,
    );
  });

  it(
    'propriété : jamais deux créneaux qui se chevauchent quand shiftOverlaps les a refusés',
    { timeout: 120_000 },
    () => {
      const r = rng(20261102);
      for (let run = 0; run < 400; run += 1) {
        const accepted: ShiftInput[] = [];
        for (let k = 0; k < 40; k += 1) {
          const start = int(r, 0, 23 * 60 + 59);
          const minutes = int(r, 1, 1440);
          const endM = (start + minutes) % 1440;
          const cand = shift({
            id: `s${k}`,
            employeeId: pick(r, ['A', 'B', 'C']),
            date: `2026-11-0${int(r, 2, 8)}`,
            start: hhmm(start),
            end: hhmm(endM),
            crossesMidnight: start + minutes >= 1440,
            status: pick(r, ['draft', 'published', 'published', 'cancelled'] as const),
          });
          // Le service refuse (409 SHIFT_OVERLAP) tout créneau qui en croise un autre.
          if (shiftOverlaps(cand, accepted).length === 0) accepted.push(cand);
        }
        const c = shiftConflicts(accepted, []);
        expect(c.findings.filter((f) => f.code === 'SHIFT_OVERLAP')).toEqual([]);
        // Vérification indépendante, par paires.
        const live = accepted
          .filter((s) => s.status !== 'cancelled')
          .map((s) => ({ s, ...shiftInterval(s) }));
        for (const a of live) {
          for (const b of live) {
            if (a.s.id >= b.s.id || a.s.employeeId !== b.s.employeeId) continue;
            expect(a.startMs < b.endMs && b.startMs < a.endMs).toBe(false);
          }
        }
        // Σ minutes hebdomadaires = Σ durées des créneaux non annulés.
        expect(c.weeklyMinutes.reduce((s, w) => s + w.minutes, 0)).toBe(
          live.reduce((s, x) => s + x.minutes, 0),
        );
      }
    },
  );

  it(
    'propriété : shiftConflicts trouve exactement les paires qui se croisent',
    { timeout: 120_000 },
    () => {
      const r = rng(99);
      for (let run = 0; run < 400; run += 1) {
        const shifts = Array.from({ length: int(r, 0, 25) }, (_, k) => {
          const start = int(r, 0, 95) * 15;
          const minutes = int(r, 1, 48) * 15;
          return shift({
            id: `s${String(k).padStart(2, '0')}`,
            employeeId: pick(r, ['A', 'B']),
            date: pick(r, [MON, TUE]),
            start: hhmm(start),
            end: hhmm((start + minutes) % 1440),
            crossesMidnight: start + minutes >= 1440,
            status: pick(r, ['draft', 'published', 'cancelled'] as const),
          });
        });
        const expected: string[] = [];
        const live = shifts
          .filter((s) => s.status !== 'cancelled')
          .map((s) => ({ s, ...shiftInterval(s) }));
        for (const a of live) {
          for (const b of live) {
            if (
              a.s.id < b.s.id &&
              a.s.employeeId === b.s.employeeId &&
              a.startMs < b.endMs &&
              b.startMs < a.endMs
            ) {
              expected.push(`${a.s.id},${b.s.id}`);
            }
          }
        }
        const found = shiftConflicts(shifts, [])
          .findings.filter((f) => f.code === 'SHIFT_OVERLAP')
          .map((f) => f.shiftIds.join(','));
        expect(found.sort()).toEqual(expected.sort());
      }
    },
  );
});

describe('staffingGaps', () => {
  const need: StaffingNeedInput = {
    id: 'n1',
    location: 'Accueil',
    weekday: 'mon',
    start: '08:00',
    end: '17:00',
    minStaff: 2,
  };

  it('critère 12 : besoin de 2, une seule personne planifiée → UNDERSTAFFED_SLOT', () => {
    const shifts = [shift({ id: 's1', start: '08:00', end: '17:00', location: 'Accueil' })];
    const r = staffingGaps(shifts, [need], [], MON, '2026-11-08');
    expect(r).toEqual({
      version: HR_VERSION,
      from: MON,
      to: '2026-11-08',
      gaps: [
        {
          code: 'UNDERSTAFFED_SLOT',
          needId: 'n1',
          date: MON,
          start: '08:00',
          end: '17:00',
          minStaff: 2,
          planned: 1,
          available: 1,
          shortfall: 1,
        },
      ],
      slotsChecked: 1,
    });
  });

  it('le creux compte : relève à 12:00 sans recouvrement → 1 au plus creux', () => {
    const shifts = [
      shift({ id: 'a', employeeId: 'A', start: '08:00', end: '17:00', location: 'Accueil' }),
      shift({ id: 'b', employeeId: 'B', start: '08:00', end: '12:00', location: 'Accueil' }),
      shift({ id: 'c', employeeId: 'C', start: '12:30', end: '17:00', location: 'Accueil' }),
    ];
    expect(staffingGaps(shifts, [need], [], MON, MON).gaps[0]).toMatchObject({
      planned: 1,
      available: 1,
    });
    const covered = [
      ...shifts,
      shift({ id: 'd', employeeId: 'D', start: '11:00', end: '13:00', location: 'Accueil' }),
    ];
    expect(staffingGaps(covered, [need], [], MON, MON).gaps).toEqual([]);
  });

  it('absences déduites ; brouillons, autres lieux et annulés ignorés ; une personne comptée une fois', () => {
    const shifts = [
      shift({ id: 'a', employeeId: 'A', start: '08:00', end: '17:00', location: 'Accueil' }),
      shift({ id: 'b', employeeId: 'B', start: '08:00', end: '17:00', location: 'Accueil' }),
      shift({
        id: 'c',
        employeeId: 'C',
        start: '08:00',
        end: '17:00',
        location: 'Accueil',
        status: 'draft',
      }),
      shift({ id: 'd', employeeId: 'D', start: '08:00', end: '17:00', location: 'Dépôt' }),
      shift({
        id: 'e',
        employeeId: 'E',
        start: '08:00',
        end: '17:00',
        location: 'Accueil',
        status: 'cancelled',
      }),
    ];
    expect(staffingGaps(shifts, [need], [], MON, MON).gaps).toEqual([]);
    const r = staffingGaps(shifts, [need], [leave('B', MON, MON, 'pm')], MON, MON);
    expect(r.gaps[0]).toMatchObject({ planned: 2, available: 1, shortfall: 1 });
  });

  it('besoin par service ; fenêtre de nuit', () => {
    const night: StaffingNeedInput = {
      id: 'n2',
      departmentId: 'G',
      weekday: 'mon',
      start: '22:00',
      end: '06:00',
      minStaff: 1,
    };
    const ok = [
      shift({ id: 'a', departmentId: 'G', start: '22:00', end: '06:00', crossesMidnight: true }),
    ];
    expect(staffingGaps(ok, [night], [], MON, MON).gaps).toEqual([]);
    const short = [
      shift({ id: 'a', departmentId: 'G', start: '22:00', end: '02:00', crossesMidnight: true }),
    ];
    expect(staffingGaps(short, [night], [], MON, MON).gaps[0]).toMatchObject({
      planned: 0,
      shortfall: 1,
    });
    // Absent le lendemain matin : la fenêtre de nuit le déduit.
    expect(staffingGaps(ok, [night], [leave('B', TUE, TUE, 'am')], MON, MON).gaps[0]).toMatchObject(
      {
        planned: 1,
        available: 0,
      },
    );
  });

  it('entrées invalides', () => {
    expect(() => staffingGaps([], [{ ...need, departmentId: 'D' }], [], MON, MON)).toThrow(
      RangeError,
    );
    expect(() => staffingGaps([], [{ ...need, location: null }], [], MON, MON)).toThrow(RangeError);
    expect(() => staffingGaps([], [{ ...need, minStaff: 0 }], [], MON, MON)).toThrow(RangeError);
    expect(() => staffingGaps([], [{ ...need, minStaff: 201 }], [], MON, MON)).toThrow(RangeError);
    expect(() => staffingGaps([], [need], [], TUE, MON)).toThrow(RangeError);
    expect(() => staffingGaps([], [need], [], '2026-01-01', '2027-01-02')).toThrow(RangeError);
  });

  it(
    'propriété : 0 ≤ disponible ≤ planifié, manque = minimum − disponible',
    { timeout: 120_000 },
    () => {
      const r = rng(314);
      for (let run = 0; run < 300; run += 1) {
        const shifts = Array.from({ length: int(r, 0, 20) }, (_, k) => {
          const start = int(r, 0, 47) * 30;
          const minutes = int(r, 1, 24) * 30;
          return shift({
            id: `s${k}`,
            employeeId: pick(r, ['A', 'B', 'C', 'D', 'E']),
            date: pick(r, [MON, TUE]),
            start: hhmm(start),
            end: hhmm((start + minutes) % 1440),
            crossesMidnight: start + minutes >= 1440,
            location: pick(r, ['Accueil', 'Dépôt']),
            status: pick(r, ['published', 'published', 'draft'] as const),
          });
        });
        const needs: StaffingNeedInput[] = Array.from({ length: int(r, 1, 3) }, (_, k) => ({
          id: `n${k}`,
          location: 'Accueil',
          weekday: pick(r, ['mon', 'tue'] as const),
          start: hhmm(int(r, 0, 47) * 30),
          end: hhmm(int(r, 0, 47) * 30),
          minStaff: int(r, 1, 4),
        }));
        const absences = r() < 0.5 ? [leave(pick(r, ['A', 'B']), MON, MON)] : [];
        const g = staffingGaps(shifts, needs, absences, MON, TUE);
        for (const gap of g.gaps) {
          expect(gap.available >= 0 && gap.available <= gap.planned).toBe(true);
          expect(gap.available < gap.minStaff).toBe(true);
          expect(gap.shortfall).toBe(gap.minStaff - gap.available);
          expect(gap.planned <= 5).toBe(true);
        }
        expect(staffingGaps(shifts, needs, absences, MON, TUE)).toEqual(g);
      }
    },
  );
});
