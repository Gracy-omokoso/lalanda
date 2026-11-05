import { describe, expect, it } from 'vitest';

import {
  CreateProjectFromPlanBody,
  WorkPlanTasksSchema,
  planCycle,
  planProblems,
  sprintCalendar,
  type WorkPlanTask,
} from './plan.js';

const t = (ref: string, over: Partial<WorkPlanTask> = {}): WorkPlanTask => ({
  ref,
  title: ref,
  ...over,
});

describe('plan de projet commun (ADR-0062, ADR-0063)', () => {
  it('un plan simple est créable', () => {
    expect(
      planProblems([t('A'), t('B', { dependsOn: ['A'] }), t('C', { parentRef: 'A' })]),
    ).toEqual([]);
  });

  it('références en double, dépendance ou parent inconnus', () => {
    const codes = planProblems([t('A'), t('A'), t('B', { dependsOn: ['Z'], parentRef: 'Y' })]).map(
      (p) => p.code,
    );
    expect(codes).toEqual([
      'WORK_PLAN_REF_DUPLICATE',
      'WORK_PLAN_REF_UNKNOWN',
      'WORK_PLAN_REF_UNKNOWN',
    ]);
  });

  it('un seul niveau de sous-tâches ; un jalon sans sous-tâche, daté, sans début', () => {
    const codes = planProblems([
      t('A'),
      t('B', { parentRef: 'A' }),
      t('C', { parentRef: 'B' }),
      t('J', { isMilestone: true, startDate: '2026-01-01' }),
    ]).map((p) => p.code);
    expect(codes).toEqual([
      'WORK_SUBTASK_DEPTH',
      'WORK_MILESTONE_HAS_START',
      'WORK_MILESTONE_NEEDS_DATE',
    ]);
  });

  it('cycle détecté', () => {
    const tasks = [t('A', { dependsOn: ['B'] }), t('B', { dependsOn: ['A'] })];
    expect(planCycle(tasks)).not.toBeNull();
    expect(planProblems(tasks).map((p) => p.code)).toContain('WORK_DEPENDENCY_CYCLE');
    expect(WorkPlanTasksSchema.safeParse(tasks).success).toBe(false);
  });

  it('corps de création : strict, au moins une tâche', () => {
    const project = { name: 'P', kind: 'internal' };
    expect(CreateProjectFromPlanBody.safeParse({ origin: 'ai', project, tasks: [] }).success).toBe(
      false,
    );
    expect(
      CreateProjectFromPlanBody.safeParse({
        origin: 'ai',
        project,
        tasks: [{ ref: 'T1', title: 'x' }],
      }).success,
    ).toBe(true);
    expect(
      CreateProjectFromPlanBody.safeParse({
        origin: 'ai',
        project,
        tasks: [{ ref: 'T1', title: 'x', foo: 1 }],
      }).success,
    ).toBe(false);
  });

  it('sprints : semaines entières, le dernier coupé à la date butoir', () => {
    expect(sprintCalendar('2026-11-02', '2026-11-20', 1).map((s) => s.endDate)).toEqual([
      '2026-11-08',
      '2026-11-15',
      '2026-11-20',
    ]);
    expect(sprintCalendar('2026-11-02', '2026-11-01', 1)).toEqual([]);
  });
});
