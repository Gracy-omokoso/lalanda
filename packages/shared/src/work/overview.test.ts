import { describe, expect, it } from 'vitest';

import {
  computeWorkProjectOverview,
  mondayOf,
  overviewHealth,
  type WorkOverviewTaskInput,
} from './overview.js';

const now = new Date('2026-11-04T10:00:00Z'); // mercredi, Kinshasa
const ann = { userId: 'a'.repeat(24), name: 'Ann' };
const bob = { userId: 'b'.repeat(24), name: 'Bob' };

let n = 0;
function t(p: Partial<WorkOverviewTaskInput>): WorkOverviewTaskInput {
  n += 1;
  return {
    id: `t${n}`,
    number: n,
    title: `Tâche ${n}`,
    parentTaskId: null,
    done: false,
    completedAt: null,
    createdAt: new Date('2026-10-01T08:00:00Z'),
    dueDate: null,
    isMilestone: false,
    assignee: null,
    ...p,
  };
}

describe('mondayOf', () => {
  it('ramène au lundi', () => {
    expect(mondayOf('2026-11-04')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
  });
});

describe('overviewHealth', () => {
  const base = { status: 'active', projectDueDate: null, today: '2026-11-04' };
  it('en bonne voie sans retard', () => {
    expect(overviewHealth({ ...base, open: 5, done: 5, overdue: 0 }).status).toBe('on_track');
    expect(overviewHealth({ ...base, open: 0, done: 0, overdue: 0 }).status).toBe('on_track');
  });
  it('à risque dès une tâche en retard', () => {
    const h = overviewHealth({ ...base, open: 10, done: 0, overdue: 1 });
    expect(h).toEqual({ status: 'at_risk', reasons: ['OVERDUE_TASKS'] });
  });
  it('à risque : échéance du projet dans 7 jours et moins de 75 % terminé', () => {
    const h = overviewHealth({
      ...base,
      projectDueDate: '2026-11-10',
      open: 3,
      done: 6,
      overdue: 0,
    });
    expect(h.reasons).toEqual(['PROJECT_DUE_SOON']);
    expect(
      overviewHealth({ ...base, projectDueDate: '2026-11-10', open: 2, done: 6, overdue: 0 })
        .status,
    ).toBe('on_track');
  });
  it('en retard : échéance passée avec des tâches ouvertes, ou ≥ 3 retards et ≥ 25 %', () => {
    expect(
      overviewHealth({ ...base, projectDueDate: '2026-11-03', open: 1, done: 9, overdue: 0 })
        .reasons,
    ).toEqual(['PROJECT_DUE_PASSED']);
    expect(overviewHealth({ ...base, open: 12, done: 0, overdue: 3 }).status).toBe('off_track');
    expect(overviewHealth({ ...base, open: 13, done: 0, overdue: 3 }).status).toBe('at_risk');
  });
  it('un projet terminé est en bonne voie', () => {
    expect(
      overviewHealth({
        status: 'completed',
        projectDueDate: '2026-01-01',
        today: '2026-11-04',
        open: 4,
        done: 0,
        overdue: 4,
      }).status,
    ).toBe('on_track');
  });
});

describe('computeWorkProjectOverview', () => {
  it('compte les tâches de premier niveau, la charge, les retards, les jalons et la courbe', () => {
    const parent = t({ assignee: ann, dueDate: '2026-11-01' });
    const tasks = [
      parent,
      t({ parentTaskId: parent.id, dueDate: '2026-10-01' }), // sous-tâche : hors chiffres
      t({ assignee: ann, dueDate: '2026-11-10' }),
      t({ assignee: bob, dueDate: '2026-10-20' }),
      t({}),
      t({ done: true, completedAt: new Date('2026-10-28T12:00:00Z') }),
      t({
        done: true,
        completedAt: new Date('2026-11-03T12:00:00Z'),
        createdAt: new Date('2026-11-02T08:00:00Z'),
      }),
      t({ isMilestone: true, dueDate: '2026-11-20', assignee: bob }),
      t({ isMilestone: true, dueDate: '2026-11-05' }),
    ];
    const o = computeWorkProjectOverview({
      projectId: 'p',
      status: 'active',
      projectDueDate: '2026-12-31',
      tasks,
      commentTaskIds: [parent.id, parent.id, tasks[1]!.id],
      now,
    });
    expect(o.today).toBe('2026-11-04');
    expect(o.totals).toEqual({ open: 6, done: 2, overdue: 2, unassigned: 2, milestones: 2 });
    expect(o.overdueTasks.map((x) => x.taskId)).toEqual([tasks[3]!.id, parent.id]);
    expect(o.openByAssignee.map((x) => [x.assignee?.name ?? null, x.open, x.overdue])).toEqual([
      ['Ann', 2, 1],
      ['Bob', 2, 1],
      [null, 2, 0],
    ]);
    expect(o.upcomingMilestones.map((x) => x.dueDate)).toEqual(['2026-11-05', '2026-11-20']);
    expect(o.weeks).toHaveLength(8);
    expect(o.weeks.at(-1)).toEqual({ weekStart: '2026-11-02', done: 2, total: 8 });
    expect(o.weeks.at(-2)).toEqual({ weekStart: '2026-10-26', done: 1, total: 7 });
    expect(o.commentCounts).toEqual({ [parent.id]: 2, [tasks[1]!.id]: 1 });
    expect(o.health.status).toBe('at_risk');
  });
});
