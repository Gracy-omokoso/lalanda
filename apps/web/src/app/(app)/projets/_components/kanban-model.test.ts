import { DEFAULT_WORK_COLUMNS, isRank } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { oid, tache } from './fixtures.test-helpers';
import {
  appliquerDeplacement,
  colonnesKanban,
  indexDepot,
  lignesListe,
  optionsDeplacement,
  placer,
  recalculerBlocages,
  remplacerTache,
} from './kanban-model';

const COLS = [...DEFAULT_WORK_COLUMNS];
const a = tache({ id: oid(1), rank: 'c', number: 1 });
const b = tache({ id: oid(2), rank: 'f', number: 2 });
const c = tache({ id: oid(3), rank: 'p', number: 3 });
const d = tache({
  id: oid(4),
  rank: 'm',
  number: 4,
  columnKey: 'doing',
  columnCategory: 'in_progress',
});
const sous = tache({ id: oid(5), rank: 'a', number: 5, parentTaskId: oid(1) });

describe('colonnesKanban', () => {
  it('colonnes propres au projet, premier niveau seulement, triées par rang', () => {
    const cols = colonnesKanban(COLS, [c, a, d, b, sous]);
    expect(cols.map((x) => x.column.key)).toEqual(['todo', 'doing', 'review', 'done']);
    expect(cols[0]!.taches.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(cols[1]!.taches.map((t) => t.id)).toEqual([d.id]);
  });
  it('une tâche à colonne inconnue reste visible (même catégorie)', () => {
    const perdue = tache({ id: oid(6), columnKey: 'ancienne', columnCategory: 'done' });
    expect(colonnesKanban(COLS, [perdue])[3]!.taches).toHaveLength(1);
  });
});

describe('lignesListe', () => {
  it('ordre des colonnes, rang, sous-tâche sous son parent', () => {
    const l = lignesListe(COLS, [d, c, sous, a, b]);
    expect(l.map((x) => [x.task.id, x.profondeur])).toEqual([
      [a.id, 0],
      [sous.id, 1],
      [b.id, 0],
      [c.id, 0],
      [d.id, 0],
    ]);
  });
  it('sous-tâche orpheline (parent filtré) au premier niveau', () => {
    expect(lignesListe(COLS, [sous]).map((x) => x.profondeur)).toEqual([0]);
  });
});

describe('placer — corps du déplacement et rang optimiste', () => {
  const todo = [a, b, c];
  it('entre deux cartes : voisines au-dessus et en dessous', () => {
    const p = placer(d, 'todo', todo, 1)!;
    expect(p.corps).toEqual({
      columnKey: 'todo',
      expectedRevision: 1,
      afterTaskId: a.id,
      beforeTaskId: b.id,
    });
    expect(p.rang > a.rank && p.rang < b.rank).toBe(true);
    expect(isRank(p.rang)).toBe(true);
  });
  it('en tête et en fin de colonne', () => {
    expect(placer(d, 'todo', todo, 0)!.corps).toEqual({
      columnKey: 'todo',
      expectedRevision: 1,
      beforeTaskId: a.id,
    });
    const fin = placer(d, 'todo', todo, 3)!;
    expect(fin.corps.afterTaskId).toBe(c.id);
    expect(fin.corps.beforeTaskId).toBeUndefined();
    expect(fin.rang > c.rank).toBe(true);
  });
  it('colonne vide', () => {
    const p = placer(a, 'review', [], 0)!;
    expect(p.corps).toEqual({ columnKey: 'review', expectedRevision: 1 });
    expect(isRank(p.rang)).toBe(true);
  });
  it('même place : rien à envoyer', () => {
    expect(placer(b, 'todo', todo, 1)).toBeNull();
  });
  it('dans la même colonne, la tâche déplacée n’est pas sa propre voisine', () => {
    const p = placer(a, 'todo', todo, 2)!;
    expect(p.corps.afterTaskId).toBe(c.id);
    expect(p.corps.beforeTaskId).toBeUndefined();
  });
  it('indexDepot : déposer avant une carte, ou en fin', () => {
    expect(indexDepot(todo, a.id, c.id)).toBe(1);
    expect(indexDepot(todo, d.id, b.id)).toBe(1);
    expect(indexDepot(todo, d.id, null)).toBe(3);
  });
});

describe('mises à jour locales', () => {
  it('done suit la catégorie de la colonne', () => {
    const t = appliquerDeplacement([a, b], a.id, COLS[3]!, 'z');
    expect(t[0]).toMatchObject({
      columnKey: 'done',
      done: true,
      columnCategory: 'done',
      rank: 'z',
    });
    expect(t[1]).toBe(b);
  });
  it('remplacerTache remplace ou ajoute', () => {
    const neuf = { ...a, title: 'Neuf' };
    expect(remplacerTache([a, b], neuf)[0]!.title).toBe('Neuf');
    expect(remplacerTache([a], b)).toHaveLength(2);
  });
  it('recalculerBlocages : bloquée tant qu’un prédécesseur n’est pas terminé', () => {
    const succ = tache({ id: oid(7), blockedBy: [{ taskId: a.id, type: 'finish_to_start' }] });
    expect(recalculerBlocages([a, succ])[1]!.blocked).toBe(true);
    expect(
      recalculerBlocages([
        { ...a, done: true },
        { ...succ, blocked: true },
      ])[1]!.blocked,
    ).toBe(false);
  });
});

describe('menu clavier « Déplacer vers… »', () => {
  it('monter, descendre, puis les autres colonnes en fin', () => {
    const cols = colonnesKanban(COLS, [a, b, c, d]);
    const o = optionsDeplacement(cols, b);
    expect(o.map((x) => x.id)).toEqual([
      'monter',
      'descendre',
      'colonne:doing',
      'colonne:review',
      'colonne:done',
    ]);
    expect(o[0]).toMatchObject({ columnKey: 'todo', index: 0 });
    expect(o[1]).toMatchObject({ columnKey: 'todo', index: 2 });
    expect(o[2]).toMatchObject({ label: 'Vers « En cours »', index: 1 });
  });
  it('première carte : pas de « Monter » ; dernière : pas de « Descendre »', () => {
    const cols = colonnesKanban(COLS, [a, b]);
    expect(optionsDeplacement(cols, a).map((x) => x.id)).not.toContain('monter');
    expect(optionsDeplacement(cols, b).map((x) => x.id)).not.toContain('descendre');
  });
  it('les gestes du menu produisent un vrai déplacement', () => {
    const cols = colonnesKanban(COLS, [a, b, c]);
    const desc = optionsDeplacement(cols, a).find((x) => x.id === 'descendre')!;
    const p = placer(a, desc.columnKey, cols[0]!.taches, desc.index)!;
    expect(p.corps.afterTaskId).toBe(b.id);
    expect(p.corps.beforeTaskId).toBe(c.id);
  });
});
