import type { MyTaskItem, MyTasksView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import { aPlat, appliquerTache, GROUPES_MES_TACHES, totalMesTaches } from './mes-taches-model';

const item = (i: number, dueDate: string | null): MyTaskItem => ({
  ...tache({ id: oid(i), dueDate }),
  projectName: 'Chantier',
});

const vue: MyTasksView = {
  asOf: '2026-10-29',
  overdue: [item(1, '2026-10-20')],
  today: [item(2, '2026-10-29')],
  next7Days: [item(3, '2026-11-02')],
  later: [],
  noDate: [item(4, null)],
  dueSoonCount: 1,
};

describe('Mes tâches', () => {
  it('cinq groupes dans l’ordre de l’ADR', () => {
    expect(GROUPES_MES_TACHES.map((g) => g.cle)).toEqual([
      'overdue',
      'today',
      'next7Days',
      'later',
      'noDate',
    ]);
  });
  it('terminer une tâche la retire et garde le nom du projet des autres', () => {
    const t = { ...vue.today[0]!, done: true };
    const v = appliquerTache(vue, t, 1);
    expect(v.today).toEqual([]);
    expect(totalMesTaches(v)).toBe(3);
    expect(aPlat(v).every((x) => x.projectName === 'Chantier')).toBe(true);
    expect(v.asOf).toBe('2026-10-29');
  });
  it('changer l’échéance reclasse au jour du serveur', () => {
    const t = { ...vue.noDate[0]!, dueDate: '2026-10-01' };
    const v = appliquerTache(vue, t, 1);
    expect(v.overdue.map((x) => x.id)).toEqual([oid(4), oid(1)]);
  });
});
