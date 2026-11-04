// Sections « façon Asana » de Mes tâches (ADR-0058 § 3) : semaine civile de
// Kinshasa, cas limites de minuit et de fin de semaine.

import {
  groupMyTasks,
  kinshasaDayOf,
  type MyTasksView,
  type WorkMyTaskItem,
} from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import { SECTIONS_MES_TACHES, sectionsMesTaches } from './mes-taches-model';

const item = (i: number, dueDate: string | null): WorkMyTaskItem => ({
  ...tache({ id: oid(i), dueDate }),
  projectName: 'Chantier',
  source: 'work',
});

/** Vue telle que le serveur la rend, au jour `asOf`. */
function vue(asOf: string, items: WorkMyTaskItem[]): MyTasksView {
  return { asOf, ...groupMyTasks(items, asOf, 1), truncated: false };
}

const ids = (l: readonly { id: string }[]): string[] => l.map((e) => e.id);

describe('sectionsMesTaches', () => {
  it('cinq sections, dans l’ordre d’Asana', () => {
    expect(SECTIONS_MES_TACHES.map((s) => s.titre)).toEqual([
      'En retard',
      'Aujourd’hui',
      'Cette semaine',
      'Plus tard',
      'Sans échéance',
    ]);
  });

  it('un mercredi : jeudi→dimanche dans « Cette semaine », lundi suivant « Plus tard »', () => {
    const v = vue('2026-11-04', [
      item(1, '2026-11-03'),
      item(2, '2026-11-04'),
      item(3, '2026-11-05'),
      item(4, '2026-11-08'),
      item(5, '2026-11-09'),
      item(6, '2026-12-20'),
      item(7, null),
    ]);
    const s = sectionsMesTaches(v);
    expect(ids(s.overdue)).toEqual([oid(1)]);
    expect(ids(s.today)).toEqual([oid(2)]);
    expect(ids(s.thisWeek)).toEqual([oid(3), oid(4)]);
    expect(ids(s.later)).toEqual([oid(5), oid(6)]);
    expect(ids(s.noDate)).toEqual([oid(7)]);
  });

  it('un dimanche : « Cette semaine » est vide, tout l’avenir est « Plus tard »', () => {
    const s = sectionsMesTaches(vue('2026-11-08', [item(1, '2026-11-09'), item(2, '2026-11-10')]));
    expect(s.thisWeek).toEqual([]);
    expect(ids(s.later)).toEqual([oid(1), oid(2)]);
  });

  it('un lundi : jusqu’au dimanche suivant dans « Cette semaine »', () => {
    const s = sectionsMesTaches(vue('2026-11-09', [item(1, '2026-11-15'), item(2, '2026-11-16')]));
    expect(ids(s.thisWeek)).toEqual([oid(1)]);
    expect(ids(s.later)).toEqual([oid(2)]);
  });

  it('minuit à Kinshasa : dimanche 23 h 30 UTC est déjà lundi', () => {
    const asOf = kinshasaDayOf(new Date('2026-11-08T23:30:00Z'));
    expect(asOf).toBe('2026-11-09');
    const s = sectionsMesTaches(
      vue(asOf, [item(1, '2026-11-08'), item(2, '2026-11-09'), item(3, '2026-11-15')]),
    );
    expect(ids(s.overdue)).toEqual([oid(1)]);
    expect(ids(s.today)).toEqual([oid(2)]);
    expect(ids(s.thisWeek)).toEqual([oid(3)]);
  });

  it('juste avant minuit à Kinshasa (22 h 59 UTC) : encore dimanche', () => {
    const asOf = kinshasaDayOf(new Date('2026-11-08T22:59:00Z'));
    expect(asOf).toBe('2026-11-08');
    const s = sectionsMesTaches(vue(asOf, [item(1, '2026-11-08'), item(2, '2026-11-09')]));
    expect(ids(s.today)).toEqual([oid(1)]);
    expect(ids(s.later)).toEqual([oid(2)]);
  });

  it('semaine à cheval sur deux années', () => {
    const s = sectionsMesTaches(vue('2026-12-30', [item(1, '2027-01-03'), item(2, '2027-01-04')]));
    expect(ids(s.thisWeek)).toEqual([oid(1)]);
    expect(ids(s.later)).toEqual([oid(2)]);
  });

  it('les tâches terminées ne figurent nulle part', () => {
    const fait = { ...item(1, '2026-11-05'), done: true };
    const s = sectionsMesTaches(vue('2026-11-04', [fait]));
    expect(Object.values(s).flat()).toEqual([]);
  });
});
