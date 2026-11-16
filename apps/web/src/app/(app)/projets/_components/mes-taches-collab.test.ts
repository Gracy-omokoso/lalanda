import type { MyTaskItem, MyTasksView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import { cochableDansMesTaches, sectionsCollaboration } from './mes-taches-model';

const item = (i: number, over: Partial<MyTaskItem> = {}): MyTaskItem => ({
  ...tache({ id: oid(i), dueDate: null }),
  projectName: 'Chantier',
  ...over,
});

const base: MyTasksView = {
  asOf: '2026-11-16',
  overdue: [],
  today: [],
  next7Days: [],
  later: [],
  noDate: [],
  dueSoonCount: 0,
  truncated: false,
};

describe('Mes tâches — ADR-0076', () => {
  it('« À valider » puis « Je collabore », sections vides ou absentes masquées', () => {
    expect(sectionsCollaboration(base)).toEqual([]);
    const v = { ...base, toApprove: [item(1)], collaborating: [] };
    const s = sectionsCollaboration(v);
    expect(s.map((x) => x.titre)).toEqual(['À valider']);
    expect(s[0]!.items[0]!.source).toBe('work');
    expect(sectionsCollaboration({ ...v, collaborating: [item(2)] }).map((x) => x.cle)).toEqual([
      'toApprove',
      'collaborating',
    ]);
  });

  it('une tâche à valider non approuvée ne se coche pas', () => {
    const a = { required: true, approverUserId: null, pendingApproverUserId: null };
    expect(cochableDansMesTaches({ approval: null })).toBe(true);
    expect(cochableDansMesTaches({ approval: { ...a, state: 'none' } })).toBe(false);
    expect(cochableDansMesTaches({ approval: { ...a, state: 'approved' } })).toBe(true);
  });
});
