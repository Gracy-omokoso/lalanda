import { describe, expect, it } from 'vitest';

import {
  addDays,
  dependencyConflicts,
  detectCycle,
  ganttRows,
  groupMyTasks,
  isBlocked,
  isCalendarDay,
  isRank,
  kinshasaDayOf,
  rankBetween,
  type GanttTask,
  type GroupableTask,
} from './scheduling.js';

const node = (id: string, ...preds: string[]) => ({
  id,
  blockedBy: preds.map((taskId) => ({ taskId })),
});

describe('jours civils', () => {
  it('valide AAAA-MM-JJ, années bissextiles comprises', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2026-1-01')).toBe(false);
    expect(isCalendarDay(20260101)).toBe(false);
  });

  it('ajoute des jours en traversant mois et années', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('ramène un instant au jour de Kinshasa (UTC+1)', () => {
    // 23 h 30 UTC = 0 h 30 à Kinshasa, le lendemain (critère d'acceptation n° 6).
    expect(kinshasaDayOf(new Date('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
    expect(kinshasaDayOf(new Date('2026-10-29T22:59:59Z'))).toBe('2026-10-29');
  });
});

describe('detectCycle', () => {
  it('graphe vide : aucun cycle', () => {
    expect(detectCycle([])).toBeNull();
  });

  it('boucle sur soi', () => {
    expect(detectCycle([node('a')], { taskId: 'a', predecessorTaskId: 'a' })).toEqual(['a', 'a']);
  });

  it('cycle long fermé par l’arête ajoutée', () => {
    const tasks = [node('a', 'b'), node('b', 'c'), node('c', 'd'), node('d')];
    expect(detectCycle(tasks)).toBeNull();
    const cycle = detectCycle(tasks, { taskId: 'd', predecessorTaskId: 'a' });
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('diamant : pas de cycle', () => {
    const tasks = [node('a', 'b', 'c'), node('b', 'd'), node('c', 'd'), node('d')];
    expect(detectCycle(tasks)).toBeNull();
  });

  it('ignore un prédécesseur inconnu', () => {
    expect(detectCycle([node('a', 'zz')])).toBeNull();
  });

  it('tient 5 000 tâches en chaîne sans épuiser la pile', () => {
    const tasks = Array.from({ length: 5_000 }, (_, i) =>
      i === 0 ? node('t0') : node(`t${i}`, `t${i - 1}`),
    );
    expect(detectCycle(tasks)).toBeNull();
    expect(detectCycle(tasks, { taskId: 't0', predecessorTaskId: 't4999' })).not.toBeNull();
  });
});

describe('dependencyConflicts et isBlocked', () => {
  const dated = (id: string, start: string | null, due: string | null, ...preds: string[]) => ({
    ...node(id, ...preds),
    startDate: start,
    dueDate: due,
  });

  it('signale un successeur qui commence le jour de l’échéance ou avant', () => {
    const tasks = [
      dated('p', '2026-11-01', '2026-11-05'),
      dated('ok', '2026-11-06', '2026-11-08', 'p'),
      dated('meme-jour', '2026-11-05', '2026-11-08', 'p'),
      dated('jalon', null, '2026-11-04', 'p'),
      dated('sans-date', null, null, 'p'),
    ];
    expect(dependencyConflicts(tasks)).toEqual([
      { taskId: 'meme-jour', predecessorId: 'p' },
      { taskId: 'jalon', predecessorId: 'p' },
    ]);
  });

  it('bloquée tant qu’un prédécesseur connu n’est pas terminé', () => {
    const byId = new Map([
      ['p1', { done: true }],
      ['p2', { done: false }],
    ]);
    expect(isBlocked(node('t', 'p1'), byId)).toBe(false);
    expect(isBlocked(node('t', 'p1', 'p2'), byId)).toBe(true);
    expect(isBlocked(node('t', 'inconnu'), byId)).toBe(false);
  });
});

describe('rankBetween', () => {
  it('premier rang, en tête, en queue, entre deux', () => {
    const first = rankBetween(null, null);
    expect(isRank(first)).toBe(true);
    const head = rankBetween(null, first);
    const tail = rankBetween(first, null);
    const mid = rankBetween(first, tail);
    expect(head < first && first < mid && mid < tail).toBe(true);
  });

  it('refuse des bornes mal ordonnées ou mal formées', () => {
    expect(() => rankBetween('b', 'a')).toThrow(RangeError);
    expect(() => rankBetween('a', 'a')).toThrow(RangeError);
    expect(() => rankBetween('a0', null)).toThrow(RangeError);
    expect(() => rankBetween('A', null)).toThrow(RangeError);
  });

  it('1 000 insertions successives en tête, en queue et au même endroit sans collision', () => {
    for (const mode of ['head', 'tail', 'middle'] as const) {
      const ranks: string[] = [rankBetween(null, null), rankBetween(rankBetween(null, null), null)];
      for (let i = 0; i < 1_000; i += 1) {
        const sorted = [...ranks].sort();
        const r =
          mode === 'head'
            ? rankBetween(null, sorted[0]!)
            : mode === 'tail'
              ? rankBetween(sorted[sorted.length - 1]!, null)
              : rankBetween(sorted[0]!, sorted[1]!);
        expect(isRank(r)).toBe(true);
        ranks.push(r);
      }
      expect(new Set(ranks).size, mode).toBe(ranks.length);
      // L'ordre lexicographique est l'ordre d'insertion attendu.
      const sorted = [...ranks].sort();
      if (mode === 'head') expect(sorted[0]).toBe(ranks[ranks.length - 1]);
      if (mode === 'tail') expect(sorted[sorted.length - 1]).toBe(ranks[ranks.length - 1]);
    }
  });
});

describe('groupMyTasks', () => {
  const t = (id: string, dueDate: string | null, extra: Partial<GroupableTask> = {}) => ({
    id,
    done: false,
    dueDate,
    priority: 'none' as const,
    rank: 'i',
    ...extra,
  });

  it('range selon le jour fourni et exclut les tâches terminées', () => {
    const today = '2026-10-30';
    const g = groupMyTasks(
      [
        t('retard', '2026-10-29'),
        t('jour', '2026-10-30'),
        t('demain', '2026-10-31'),
        t('j7', '2026-11-06'),
        t('j8', '2026-11-07'),
        t('aucune', null),
        t('finie', '2026-10-01', { done: true }),
      ],
      today,
      1,
    );
    expect(g.overdue.map((x) => x.id)).toEqual(['retard']);
    expect(g.today.map((x) => x.id)).toEqual(['jour']);
    expect(g.next7Days.map((x) => x.id)).toEqual(['demain', 'j7']);
    expect(g.later.map((x) => x.id)).toEqual(['j8']);
    expect(g.noDate.map((x) => x.id)).toEqual(['aucune']);
    // Échéance proche (1 jour) : aujourd'hui et demain.
    expect(g.dueSoonCount).toBe(2);
  });

  it('à 23 h 30 UTC, le « jour » est déjà le lendemain à Kinshasa', () => {
    const today = kinshasaDayOf(new Date('2026-10-29T23:30:00Z'));
    const g = groupMyTasks([t('hier-utc', '2026-10-29')], today, 1);
    expect(g.overdue.map((x) => x.id)).toEqual(['hier-utc']);
  });

  it('trie par échéance, puis priorité décroissante, puis rang', () => {
    const g = groupMyTasks(
      [
        t('b', '2026-10-28', { priority: 'low', rank: 'a' }),
        t('a', '2026-10-28', { priority: 'urgent', rank: 'z' }),
        t('c', '2026-10-27'),
      ],
      '2026-10-30',
      1,
    );
    expect(g.overdue.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('ganttRows', () => {
  const g = (id: string, over: Partial<GanttTask> = {}): GanttTask => ({
    id,
    blockedBy: [],
    startDate: null,
    dueDate: null,
    parentTaskId: null,
    isMilestone: false,
    rank: 'i',
    ...over,
  });

  it('barres, losanges, sous-tâches sous leur parent, non planifiées à part', () => {
    const layout = ganttRows([
      g('b', { startDate: '2026-11-03', dueDate: '2026-11-05' }),
      g('a', { startDate: '2026-11-01', dueDate: '2026-11-02' }),
      g('a1', { parentTaskId: 'a', dueDate: '2026-11-02' }),
      g('m', { isMilestone: true, dueDate: '2026-11-10', blockedBy: [{ taskId: 'b' }] }),
      g('libre'),
    ]);
    expect(layout.rows.map((r) => [r.taskId, r.depth, r.shape])).toEqual([
      ['a', 0, 'bar'],
      ['a1', 1, 'bar'],
      ['b', 0, 'bar'],
      ['m', 0, 'milestone'],
    ]);
    const m = layout.rows.find((r) => r.taskId === 'm')!;
    expect([m.start, m.end, m.predecessorIds, m.conflict]).toEqual([
      '2026-11-10',
      '2026-11-10',
      ['b'],
      false,
    ]);
    expect(layout.unscheduled).toEqual(['libre']);
  });

  it('surligne un conflit de dates', () => {
    const layout = ganttRows([
      g('p', { startDate: '2026-11-01', dueDate: '2026-11-05' }),
      g('s', { startDate: '2026-11-04', dueDate: '2026-11-06', blockedBy: [{ taskId: 'p' }] }),
    ]);
    expect(layout.rows.find((r) => r.taskId === 's')!.conflict).toBe(true);
  });

  it('remonte au premier niveau une sous-tâche datée dont le parent ne l’est pas', () => {
    const layout = ganttRows([g('p'), g('enfant', { parentTaskId: 'p', dueDate: '2026-11-02' })]);
    expect(layout.rows.map((r) => [r.taskId, r.depth])).toEqual([['enfant', 0]]);
    expect(layout.unscheduled).toEqual(['p']);
  });
});
