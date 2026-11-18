// ADR-0080 : heures de début et d'échéance, fuseau de l'organisation.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { computeWorkProjectOverview, overviewHealth } from './overview.js';
import { planProblems } from './plan.js';
import { projectHealth } from './portfolio.js';
import { dependencyConflicts, ganttRows, groupMyTasks } from './scheduling.js';
import {
  CreateProjectFromQuoteBody,
  CreateWorkProjectBody,
  CreateWorkTaskBody,
  PatchWorkTaskBody,
  UpdateWorkProjectBody,
} from './schemas.js';
import {
  WORK_DEFAULT_TIME_ZONE,
  compareDue,
  datesInverted,
  dayIn,
  dueDeadline,
  dueKey,
  formatDayTime,
  formatTimeLong,
  formatTimeShort,
  hourIn,
  isPastDue,
  isTimeOfDay,
  isWorkTimeZone,
  orgClock,
  workTimeZoneOr,
  zonedInstant,
} from './time.js';

function codes(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const c = (i as { params?: { code?: unknown } }).params?.code;
    return typeof c === 'string' ? c : i.code;
  });
}

describe('fuseaux', () => {
  it('Kinshasa par défaut, Lubumbashi permis, le reste refusé', () => {
    expect(WORK_DEFAULT_TIME_ZONE).toBe('Africa/Kinshasa');
    expect(isWorkTimeZone('Africa/Lubumbashi')).toBe(true);
    expect(isWorkTimeZone('Europe/Paris')).toBe(false);
    expect(workTimeZoneOr(undefined)).toBe('Africa/Kinshasa');
    expect(workTimeZoneOr('Mars/Olympus')).toBe('Africa/Kinshasa');
  });

  it('horloge de l’organisation : même instant, deux fuseaux de la RDC', () => {
    const now = new Date('2026-11-18T22:30:00Z');
    expect(orgClock(now, 'Africa/Kinshasa')).toEqual({ today: '2026-11-18', time: '23:30' });
    // À Lubumbashi (UTC+2), il est déjà le lendemain.
    expect(orgClock(now, 'Africa/Lubumbashi')).toEqual({ today: '2026-11-19', time: '00:30' });
    expect(dayIn(now, 'Africa/Lubumbashi')).toBe('2026-11-19');
    expect(hourIn(now, 'Africa/Kinshasa')).toBe(23);
    expect(hourIn(new Date('2026-11-18T23:00:00Z'), 'Africa/Kinshasa')).toBe(0);
  });

  it('instant d’un jour et d’une heure dans un fuseau', () => {
    expect(zonedInstant('2026-11-18', '14:00', 'Africa/Kinshasa').toISOString()).toBe(
      '2026-11-18T13:00:00.000Z',
    );
    expect(zonedInstant('2026-11-18', '14:00', 'Africa/Lubumbashi').toISOString()).toBe(
      '2026-11-18T12:00:00.000Z',
    );
    expect(zonedInstant('2026-11-18', '00:30', 'Africa/Kinshasa').toISOString()).toBe(
      '2026-11-17T23:30:00.000Z',
    );
  });

  it('fin d’une échéance : l’heure exacte, sinon le lendemain à 0 h', () => {
    expect(dueDeadline('2026-11-18', '14:00', 'Africa/Kinshasa').toISOString()).toBe(
      '2026-11-18T13:00:00.000Z',
    );
    expect(dueDeadline('2026-11-18', null, 'Africa/Kinshasa').toISOString()).toBe(
      '2026-11-18T23:00:00.000Z',
    );
    expect(dueDeadline('2026-12-31', null, 'Africa/Lubumbashi').toISOString()).toBe(
      '2026-12-31T22:00:00.000Z',
    );
  });
});

describe('heure du jour', () => {
  it('HH:mm sur 24 h seulement', () => {
    for (const ok of ['00:00', '09:30', '23:59']) expect(isTimeOfDay(ok)).toBe(true);
    for (const ko of ['24:00', '9:30', '12:60', '12h30', '12:30:00', '', 1230, null]) {
      expect(isTimeOfDay(ko)).toBe(false);
    }
  });
});

describe('en retard', () => {
  const clock = { today: '2026-11-18', time: '14:00' };

  it('sans heure : comportement d’avant (en retard le lendemain)', () => {
    expect(isPastDue({ dueDate: '2026-11-17' }, clock)).toBe(true);
    expect(isPastDue({ dueDate: '2026-11-18' }, clock)).toBe(false);
    expect(isPastDue({ dueDate: '2026-11-18', dueTime: null }, { ...clock, time: '23:59' })).toBe(
      false,
    );
    expect(isPastDue({ dueDate: null }, clock)).toBe(false);
  });

  it('avec heure : en retard à l’heure exacte', () => {
    expect(isPastDue({ dueDate: '2026-11-18', dueTime: '13:59' }, clock)).toBe(true);
    expect(isPastDue({ dueDate: '2026-11-18', dueTime: '14:00' }, clock)).toBe(true);
    expect(isPastDue({ dueDate: '2026-11-18', dueTime: '14:01' }, clock)).toBe(false);
    expect(isPastDue({ dueDate: '2026-11-19', dueTime: '00:00' }, clock)).toBe(false);
  });

  it('changement de fuseau : la même échéance est dépassée à l’Est, pas à l’Ouest', () => {
    const now = new Date('2026-11-18T12:30:00Z'); // 13:30 à Kinshasa, 14:30 à Lubumbashi
    const due = { dueDate: '2026-11-18', dueTime: '14:00' };
    expect(isPastDue(due, orgClock(now, 'Africa/Kinshasa'))).toBe(false);
    expect(isPastDue(due, orgClock(now, 'Africa/Lubumbashi'))).toBe(true);
  });

  it('tri : une heure passe avant « toute la journée »', () => {
    const xs = [
      { dueDate: '2026-11-18', dueTime: null },
      { dueDate: '2026-11-18', dueTime: '17:00' },
      { dueDate: null },
      { dueDate: '2026-11-18', dueTime: '09:00' },
    ];
    expect([...xs].sort(compareDue).map((x) => `${x.dueDate}/${x.dueTime ?? '-'}`)).toEqual([
      '2026-11-18/09:00',
      '2026-11-18/17:00',
      '2026-11-18/-',
      'null/-',
    ]);
    expect(dueKey('2026-11-18', null)).toBe('2026-11-18');
    expect(dueKey('2026-11-18', '09:00')).toBe('2026-11-18T09:00');
  });
});

describe('« Mes tâches » avec heure', () => {
  const base = { done: false, priority: 'none' as const, rank: 'm' };
  const tasks = [
    { ...base, id: 'a', dueDate: '2026-11-18', dueTime: '10:00' },
    { ...base, id: 'b', dueDate: '2026-11-18', dueTime: '16:00' },
    { ...base, id: 'c', dueDate: '2026-11-18', dueTime: null },
  ];

  it('sans heure courante : la règle du jour seule (compatibilité)', () => {
    const g = groupMyTasks(tasks, '2026-11-18', 3);
    expect(g.overdue).toEqual([]);
    expect(g.today.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('avec l’heure de l’organisation : la tâche de 10 h passe en retard', () => {
    const g = groupMyTasks(tasks, '2026-11-18', 3, '12:00');
    expect(g.overdue.map((t) => t.id)).toEqual(['a']);
    expect(g.today.map((t) => t.id)).toEqual(['b', 'c']);
    expect(g.dueSoonCount).toBe(2);
  });
});

describe('validation des corps', () => {
  it('heures facultatives : sans heure, rien ne change', () => {
    const r = CreateWorkTaskBody.parse({
      title: 'T',
      startDate: '2026-11-18',
      dueDate: '2026-11-18',
    });
    expect(r.startTime).toBeUndefined();
    expect(r.dueTime).toBeUndefined();
  });

  it('format HH:mm 24 h', () => {
    expect(
      codes(CreateWorkTaskBody, { title: 'T', dueDate: '2026-11-18', dueTime: '25:00' }),
    ).toEqual(['WORK_TIME_INVALID']);
    expect(codes(CreateWorkTaskBody, { title: 'T', dueDate: '2026-11-18', dueTime: '9h' })).toEqual(
      ['WORK_TIME_INVALID'],
    );
    expect(
      codes(CreateWorkTaskBody, { title: 'T', dueDate: '2026-11-18', dueTime: '09:05' }),
    ).toEqual([]);
  });

  it('une heure sans date est refusée', () => {
    expect(codes(CreateWorkTaskBody, { title: 'T', dueTime: '10:00' })).toEqual([
      'WORK_TIME_WITHOUT_DATE',
    ]);
    expect(
      codes(CreateWorkProjectBody, { name: 'P', kind: 'internal', startTime: '08:00' }),
    ).toEqual(['WORK_TIME_WITHOUT_DATE']);
    expect(
      codes(PatchWorkTaskBody, { expectedRevision: 1, dueDate: null, dueTime: '10:00' }),
    ).toEqual(['WORK_TIME_WITHOUT_DATE']);
    // Jour absent du corps de modification : vérifié par le service contre l'état stocké.
    expect(codes(PatchWorkTaskBody, { expectedRevision: 1, dueTime: '10:00' })).toEqual([]);
    // Retirer l'heure seule est toujours permis.
    expect(codes(PatchWorkTaskBody, { expectedRevision: 1, dueDate: null, dueTime: null })).toEqual(
      [],
    );
  });

  it('échéance (jour + heure) ≥ début (jour + heure)', () => {
    const t = { title: 'T', startDate: '2026-11-18', dueDate: '2026-11-18' };
    expect(codes(CreateWorkTaskBody, { ...t, startTime: '10:00', dueTime: '09:00' })).toEqual([
      'WORK_DATES_INVERTED',
    ]);
    expect(codes(CreateWorkTaskBody, { ...t, startTime: '10:00', dueTime: '10:00' })).toEqual([]);
    // Début à 10 h, échéance « toute la journée » : la fin de journée suit le début.
    expect(codes(CreateWorkTaskBody, { ...t, startTime: '10:00' })).toEqual([]);
    expect(codes(CreateWorkTaskBody, { ...t, dueTime: '07:00' })).toEqual([]);
    expect(
      codes(UpdateWorkProjectBody, {
        expectedRevision: 1,
        startDate: '2026-11-19',
        dueDate: '2026-11-18',
        dueTime: '23:00',
      }),
    ).toEqual(['WORK_DATES_INVERTED']);
    expect(
      datesInverted({
        startDate: '2026-11-17',
        startTime: '18:00',
        dueDate: '2026-11-18',
        dueTime: '08:00',
      }),
    ).toBe(false);
  });

  it('jalon : pas d’heure de début, heure d’échéance permise', () => {
    expect(
      codes(CreateWorkTaskBody, {
        title: 'J',
        isMilestone: true,
        dueDate: '2026-11-20',
        dueTime: '12:00',
      }),
    ).toEqual([]);
    expect(
      codes(CreateWorkTaskBody, {
        title: 'J',
        isMilestone: true,
        dueDate: '2026-11-20',
        startTime: '08:00',
      }),
    ).toContain('WORK_MILESTONE_HAS_START');
    expect(
      CreateProjectFromQuoteBody.parse({
        quoteId: '64b7f0c2a1b2c3d4e5f60718',
        milestone: { title: 'Livraison', dueDate: '2026-11-20', dueTime: '17:00' },
      }).milestone?.dueTime,
    ).toBe('17:00');
  });

  it('plan (import, IA) : mêmes règles', () => {
    const p = planProblems([
      { ref: 'a', title: 'A', dueTime: '10:00' },
      {
        ref: 'b',
        title: 'B',
        startDate: '2026-11-18',
        startTime: '12:00',
        dueDate: '2026-11-18',
        dueTime: '11:00',
      },
    ]);
    expect(p.map((x) => x.code)).toEqual(['WORK_TIME_WITHOUT_DATE', 'WORK_DATES_INVERTED']);
  });
});

describe('santé et aperçu', () => {
  it('échéance du projet à l’heure : passée dès l’heure atteinte', () => {
    const input = {
      status: 'active',
      projectDueDate: '2026-11-18',
      today: '2026-11-18',
      open: 2,
      done: 0,
      overdue: 0,
    };
    expect(overviewHealth(input).reasons).not.toContain('PROJECT_DUE_PASSED');
    expect(
      overviewHealth({ ...input, projectDueTime: '10:00', nowTime: '10:00' }).reasons,
    ).toContain('PROJECT_DUE_PASSED');
    expect(
      projectHealth(
        {
          status: 'active',
          dueDate: '2026-11-18',
          dueTime: '10:00',
          openTaskCount: 1,
          doneTaskCount: 0,
          overdueTaskCount: 0,
          overdueMilestoneCount: 0,
        },
        '2026-11-18',
        '11:00',
      ),
    ).toBe('late');
  });

  it('aperçu : tâche du jour en retard à l’heure, selon le fuseau de l’organisation', () => {
    const task = {
      id: 't1',
      number: 1,
      title: 'Remise',
      parentTaskId: null,
      done: false,
      completedAt: null,
      createdAt: new Date('2026-11-01T08:00:00Z'),
      dueDate: '2026-11-18',
      dueTime: '14:00',
      isMilestone: false,
      assignee: null,
    };
    const now = new Date('2026-11-18T12:30:00Z');
    const args = {
      projectId: 'p',
      status: 'active',
      projectDueDate: null,
      tasks: [task],
      commentTaskIds: [],
      now,
    };
    expect(computeWorkProjectOverview(args).totals.overdue).toBe(0);
    const est = computeWorkProjectOverview({ ...args, timeZone: 'Africa/Lubumbashi' });
    expect(est.totals.overdue).toBe(1);
    expect(est.overdueTasks[0]?.dueTime).toBe('14:00');
  });
});

describe('dépendances et chronologie', () => {
  it('même jour : début à l’heure de l’échéance du prédécesseur ou après → pas de conflit', () => {
    const pred = {
      id: 'p',
      blockedBy: [],
      startDate: null,
      dueDate: '2026-11-18',
      dueTime: '12:00',
    };
    const succ = (startTime: string | null) => ({
      id: 's',
      blockedBy: [{ taskId: 'p' }],
      startDate: '2026-11-18',
      startTime,
      dueDate: '2026-11-19',
    });
    expect(dependencyConflicts([pred, succ('13:00')])).toEqual([]);
    expect(dependencyConflicts([pred, succ('11:00')])).toHaveLength(1);
    expect(dependencyConflicts([pred, succ(null)])).toHaveLength(1);
  });

  it('les lignes de la chronologie portent les heures', () => {
    const { rows } = ganttRows([
      {
        id: 'a',
        blockedBy: [],
        startDate: '2026-11-18',
        startTime: '08:00',
        dueDate: '2026-11-19',
        dueTime: '17:00',
        parentTaskId: null,
        isMilestone: false,
        rank: 'm',
      },
    ]);
    expect(rows[0]).toMatchObject({ startTime: '08:00', endTime: '17:00' });
  });
});

describe('affichage', () => {
  it('heure suivie du fuseau (lève l’ambiguïté Ouest / Est)', () => {
    expect(formatTimeShort('14:00', 'Africa/Kinshasa')).toBe('14:00 WAT');
    expect(formatTimeShort('14:00', 'Africa/Lubumbashi')).toBe('14:00 CAT');
    expect(formatTimeLong('14:00', 'Africa/Lubumbashi')).toBe(
      '14:00, heure de Lubumbashi (CAT, UTC+2)',
    );
    expect(formatDayTime('2026-11-18', null, 'Africa/Kinshasa')).toBe('2026-11-18');
    expect(formatDayTime('2026-11-18', '09:00', 'Africa/Kinshasa')).toBe('2026-11-18 à 09:00 WAT');
  });
});
