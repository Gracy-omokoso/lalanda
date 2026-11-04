import type { WorkColumn } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import {
  TEINTES_AVATAR,
  groupesListe,
  initiales,
  pileAvatars,
  teinteAvatar,
  tonDate,
} from './liste-model';

const cols: WorkColumn[] = [
  { key: 'todo', label: 'À faire', category: 'todo' },
  { key: 'doing', label: 'En cours', category: 'in_progress' },
  { key: 'done', label: 'Terminé', category: 'done' },
];

describe('groupesListe', () => {
  it('un groupe par colonne, même vide, dans l’ordre du projet', () => {
    const g = groupesListe(cols, []);
    expect(g.map((x) => [x.column.key, x.total])).toEqual([
      ['todo', 0],
      ['doing', 0],
      ['done', 0],
    ]);
  });

  it('rang dans le groupe, sous-tâches sous leur parent, compteurs de premier niveau', () => {
    const a = tache({ id: oid(1), rank: 'b' });
    const b = tache({ id: oid(2), rank: 'a' });
    const s = tache({ id: oid(3), parentTaskId: oid(1), rank: 'a', columnKey: 'done' });
    const d = tache({
      id: oid(4),
      columnKey: 'done',
      columnCategory: 'done',
      done: true,
    });
    const g = groupesListe(cols, [a, b, s, d]);
    expect(g[0]!.lignes.map((l) => [l.task.id, l.profondeur])).toEqual([
      [oid(2), 0],
      [oid(1), 0],
      [oid(3), 1],
    ]);
    expect(g[0]!.total).toBe(2);
    expect(g[2]).toMatchObject({ total: 1, terminees: 1 });
  });

  it('sous-tâche orpheline (parent filtré) : au premier niveau de sa colonne', () => {
    const s = tache({ id: oid(5), parentTaskId: oid(99), columnKey: 'doing' });
    expect(groupesListe(cols, [s])[1]!.lignes).toEqual([{ task: s, profondeur: 0 }]);
  });

  it('colonne disparue : première colonne de même catégorie', () => {
    const t = tache({ id: oid(6), columnKey: 'ancienne', columnCategory: 'in_progress' });
    expect(groupesListe(cols, [t])[1]!.total).toBe(1);
  });
});

describe('avatars', () => {
  it('teinte stable et dans la palette', () => {
    expect(teinteAvatar('abc')).toBe(teinteAvatar('abc'));
    expect(TEINTES_AVATAR).toContain(teinteAvatar(oid(42)));
  });
  it('initiales', () => {
    expect(initiales('Marie-Claire Ngalula')).toBe('MN');
    expect(initiales('kevin')).toBe('K');
    expect(initiales('  ')).toBe('?');
  });
  it('pile : les premiers, puis le reste', () => {
    expect(pileAvatars([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ montres: [1, 2, 3, 4, 5], reste: 2 });
    expect(pileAvatars([1], 5)).toEqual({ montres: [1], reste: 0 });
  });
});

describe('tonDate', () => {
  const today = '2026-11-04';
  it('rouge en retard, vert aujourd’hui et demain, neutre sinon', () => {
    expect(tonDate({ done: false, dueDate: '2026-11-03' }, today)).toBe('retard');
    expect(tonDate({ done: false, dueDate: today }, today)).toBe('aujourdhui');
    expect(tonDate({ done: false, dueDate: '2026-11-05' }, today)).toBe('demain');
    expect(tonDate({ done: false, dueDate: '2026-11-30' }, today)).toBe('normal');
  });
  it('terminée : jamais en retard ; sans date : rien', () => {
    expect(tonDate({ done: true, dueDate: '2026-01-01' }, today)).toBe('terminee');
    expect(tonDate({ done: false, dueDate: null }, today)).toBeNull();
  });
  it('passage de mois', () => {
    expect(tonDate({ done: false, dueDate: '2026-12-01' }, '2026-11-30')).toBe('demain');
  });
});
