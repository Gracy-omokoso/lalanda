// Calculs NON financiers du module « work » (ADR-0039 O4.3) : dépendances,
// conflits de dates, rangs du Kanban, regroupement de « Mes tâches », lignes du
// Gantt. Fonctions pures, sans horloge ni base : l'API (validation) et le web
// (Kanban, calendrier, chronologie) appellent les mêmes, pour que l'écran et le
// serveur ne divergent pas.
//
// Dates civiles `AAAA-MM-JJ` au jour de Kinshasa (UTC+1, sans heure d'été,
// ADR-0027). « Aujourd'hui » est TOUJOURS fourni par l'appelant.

import type { WorkPriority } from './constants.js';
import { WORK_PRIORITIES } from './constants.js';

// ── Jours civils ────────────────────────────────────────────────────────────

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
/** Kinshasa : UTC+1 toute l'année (ADR-0027). */
const KINSHASA_OFFSET_MS = 3_600_000;

/** Vrai pour une date civile `AAAA-MM-JJ` qui existe (1900–2999). */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY_PATTERN.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return false;
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber(day: string): number {
  const m = DAY_PATTERN.exec(day);
  if (m === null) throw new RangeError(`Date invalide : ${day}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY);
}

/** Ajoute `n` jours (négatif possible) à une date civile. */
export function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Jour civil de Kinshasa d'un instant (23 h 30 UTC → lendemain à Kinshasa). */
export function kinshasaDayOf(instant: Date): string {
  return new Date(instant.getTime() + KINSHASA_OFFSET_MS).toISOString().slice(0, 10);
}

// ── Dépendances ─────────────────────────────────────────────────────────────

/** Ce que les fonctions de dépendance lisent d'une tâche. */
export interface DependencyNode {
  id: string;
  blockedBy: readonly { taskId: string }[];
}

/**
 * Détecte un cycle dans le graphe « tâche → prédécesseurs ».
 *
 * `added`, facultatif, est l'arête qu'on s'apprête à poser (`taskId` attendrait
 * `predecessorTaskId`) : la fonction répond pour le graphe qui la contiendrait.
 * Rend le cycle trouvé (identifiants, le premier répété à la fin), ou `null`.
 * Une auto-dépendance est un cycle de longueur 1. Les prédécesseurs inconnus
 * (supprimés, autre projet) sont ignorés.
 */
export function detectCycle(
  tasks: readonly DependencyNode[],
  added?: { taskId: string; predecessorTaskId: string },
): string[] | null {
  const edges = new Map<string, string[]>();
  for (const t of tasks)
    edges.set(
      t.id,
      t.blockedBy.map((d) => d.taskId),
    );
  if (added) {
    const list = edges.get(added.taskId) ?? [];
    edges.set(added.taskId, [...list, added.predecessorTaskId]);
    if (!edges.has(added.predecessorTaskId)) edges.set(added.predecessorTaskId, []);
  }

  // Parcours en profondeur itératif : 5 000 tâches ne doivent pas épuiser la pile.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of edges.keys()) color.set(id, WHITE);

  for (const start of edges.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    const path: string[] = [start];
    color.set(start, GREY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const succ = edges.get(top.id) ?? [];
      if (top.next >= succ.length) {
        color.set(top.id, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const nextId = succ[top.next]!;
      top.next += 1;
      if (!edges.has(nextId)) continue;
      const c = color.get(nextId);
      if (c === GREY) {
        const from = path.indexOf(nextId);
        return [...path.slice(from), nextId];
      }
      if (c === WHITE) {
        color.set(nextId, GREY);
        stack.push({ id: nextId, next: 0 });
        path.push(nextId);
      }
    }
  }
  return null;
}

/** Ce que les fonctions de dates lisent d'une tâche. */
export interface DatedNode extends DependencyNode {
  startDate: string | null;
  dueDate: string | null;
}

/** Conflit de dates entre une tâche et son prédécesseur (non bloquant). */
export interface DependencyConflict {
  taskId: string;
  predecessorId: string;
}

/**
 * Conflits de dates fin → début (ADR-0039 § 2.3) : le début du successeur
 * (`startDate`, à défaut `dueDate`, cas du jalon) tombe le jour de l'échéance du
 * prédécesseur ou avant. Une tâche sans date ne produit aucun conflit. Rien
 * n'est déplacé : l'appelant rend un avertissement.
 */
export function dependencyConflicts(tasks: readonly DatedNode[]): DependencyConflict[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: DependencyConflict[] = [];
  for (const t of tasks) {
    const start = t.startDate ?? t.dueDate;
    if (start === null) continue;
    for (const dep of t.blockedBy) {
      const pred = byId.get(dep.taskId);
      if (pred === undefined || pred.dueDate === null) continue;
      if (start <= pred.dueDate) out.push({ taskId: t.id, predecessorId: pred.id });
    }
  }
  return out;
}

/**
 * Une tâche est « bloquée » si l'un de ses prédécesseurs connus n'est pas
 * terminé. Calcul de lecture, jamais stocké (ADR-0039 § 2.3).
 */
export function isBlocked(
  task: Pick<DependencyNode, 'blockedBy'>,
  tasksById: ReadonlyMap<string, { done: boolean }>,
): boolean {
  return task.blockedBy.some((d) => {
    const pred = tasksById.get(d.taskId);
    return pred !== undefined && !pred.done;
  });
}

// ── Rangs fractionnaires (Kanban, liste) ────────────────────────────────────

/**
 * Alphabet des rangs : chiffres puis minuscules, dans l'ordre des octets. Une
 * comparaison binaire (Mongo, `<` de JavaScript) suffit à trier.
 */
export const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const RANK_PATTERN = /^[0-9a-z]*[1-9a-z]$/;

/** Vrai pour un rang bien formé : non vide, alphabet fermé, sans `0` final. */
export function isRank(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1_024 && RANK_PATTERN.test(value);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? RANK_DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? RANK_DIGITS.indexOf(b[0]!) : RANK_DIGITS.length;
  if (digitB - digitA > 1) return RANK_DIGITS[Math.round((digitA + digitB) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return RANK_DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * Rang strictement compris entre `before` et `after` (`null` = extrémité).
 * `rankBetween(null, null)` donne le premier rang d'une colonne vide.
 * Lève une `RangeError` si les bornes sont mal formées ou mal ordonnées.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isRank(before)) throw new RangeError(`Rang invalide : ${before}`);
  if (after !== null && !isRank(after)) throw new RangeError(`Rang invalide : ${after}`);
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`Rangs mal ordonnés : ${before} ≥ ${after}`);
  }
  return midpoint(before ?? '', after);
}

// ── « Mes tâches » ──────────────────────────────────────────────────────────

/** Ce que le regroupement lit d'une tâche. */
export interface GroupableTask {
  id: string;
  done: boolean;
  dueDate: string | null;
  priority: WorkPriority;
  rank: string;
}

export interface MyTasksGroups<T> {
  /** Échéance avant aujourd'hui. */
  overdue: T[];
  /** Échéance aujourd'hui. */
  today: T[];
  /** Échéance dans les 7 jours qui suivent aujourd'hui. */
  next7Days: T[];
  /** Échéance au-delà. */
  later: T[];
  /** Sans échéance. */
  noDate: T[];
  /** Tâches « à échéance proche » : aujourd'hui à aujourd'hui + `dueSoonDays`. */
  dueSoonCount: number;
}

const PRIORITY_RANK = new Map(WORK_PRIORITIES.map((p, i) => [p, i]));

function compareTasks(a: GroupableTask, b: GroupableTask): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const pa = PRIORITY_RANK.get(a.priority) ?? 0;
  const pb = PRIORITY_RANK.get(b.priority) ?? 0;
  if (pa !== pb) return pb - pa;
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Regroupe les tâches NON terminées : en retard · aujourd'hui · 7 jours · plus
 * tard · sans date (ADR-0039 § 4, `GET /work/my-tasks`). `today` est le jour de
 * Kinshasa calculé par l'appelant (`kinshasaDayOf(now)`). Dans chaque groupe :
 * échéance croissante, priorité décroissante, puis rang.
 */
export function groupMyTasks<T extends GroupableTask>(
  tasks: readonly T[],
  today: string,
  dueSoonDays: number,
): MyTasksGroups<T> {
  if (!isCalendarDay(today)) throw new RangeError(`Date invalide : ${today}`);
  const in7 = addDays(today, 7);
  const soonEnd = addDays(today, Math.max(0, Math.trunc(dueSoonDays)));
  const groups: MyTasksGroups<T> = {
    overdue: [],
    today: [],
    next7Days: [],
    later: [],
    noDate: [],
    dueSoonCount: 0,
  };
  for (const t of tasks) {
    if (t.done) continue;
    const due = t.dueDate;
    if (due === null) groups.noDate.push(t);
    else if (due < today) groups.overdue.push(t);
    else if (due === today) groups.today.push(t);
    else if (due <= in7) groups.next7Days.push(t);
    else groups.later.push(t);
    if (due !== null && due >= today && due <= soonEnd) groups.dueSoonCount += 1;
  }
  for (const key of ['overdue', 'today', 'next7Days', 'later', 'noDate'] as const) {
    groups[key].sort(compareTasks);
  }
  return groups;
}

// ── Chronologie (Gantt) ─────────────────────────────────────────────────────

/** Ce que la chronologie lit d'une tâche. */
export interface GanttTask extends DatedNode {
  parentTaskId: string | null;
  isMilestone: boolean;
  rank: string;
}

export interface GanttRow {
  taskId: string;
  /** 0 pour une tâche, 1 pour une sous-tâche. */
  depth: 0 | 1;
  /** Barre début → échéance, ou losange pour un jalon. */
  shape: 'bar' | 'milestone';
  start: string;
  end: string;
  /** Prédécesseurs connus et datés, pour les flèches. */
  predecessorIds: string[];
  /** Vrai si la tâche est en conflit de dates avec l'un de ses prédécesseurs. */
  conflict: boolean;
}

export interface GanttLayout {
  rows: GanttRow[];
  /** Tâches sans aucune date : listées à part (« non planifiées »). */
  unscheduled: string[];
}

function compareByStartThenRank(a: GanttTask, b: GanttTask): number {
  const sa = a.startDate ?? a.dueDate ?? '';
  const sb = b.startDate ?? b.dueDate ?? '';
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Lignes de la chronologie : tâches de premier niveau par date de début puis
 * rang, chaque sous-tâche datée juste sous son parent. Une tâche avec une seule
 * date est une barre d'un jour ; un jalon est un losange à son échéance.
 */
export function ganttRows(tasks: readonly GanttTask[]): GanttLayout {
  const conflicts = new Set(dependencyConflicts(tasks).map((c) => c.taskId));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dated = (t: GanttTask) => t.startDate !== null || t.dueDate !== null;

  const rowOf = (t: GanttTask, depth: 0 | 1): GanttRow => {
    const end = t.dueDate ?? t.startDate!;
    const start = t.isMilestone ? end : (t.startDate ?? end);
    return {
      taskId: t.id,
      depth,
      shape: t.isMilestone ? 'milestone' : 'bar',
      start,
      end,
      predecessorIds: t.blockedBy
        .map((d) => d.taskId)
        .filter((id) => {
          const p = byId.get(id);
          return p !== undefined && dated(p);
        }),
      conflict: conflicts.has(t.id),
    };
  };

  const children = new Map<string, GanttTask[]>();
  const roots: GanttTask[] = [];
  const unscheduled: string[] = [];
  for (const t of tasks) {
    if (!dated(t)) {
      unscheduled.push(t.id);
      continue;
    }
    if (t.parentTaskId !== null && byId.has(t.parentTaskId)) {
      const list = children.get(t.parentTaskId) ?? [];
      list.push(t);
      children.set(t.parentTaskId, list);
    } else {
      roots.push(t);
    }
  }

  // Une sous-tâche datée dont le parent n'est pas daté reste visible : elle est
  // remontée au premier niveau plutôt que perdue.
  for (const [parentId, list] of children) {
    if (!dated(byId.get(parentId)!)) {
      roots.push(...list);
      children.delete(parentId);
    }
  }

  const rows: GanttRow[] = [];
  for (const root of [...roots].sort(compareByStartThenRank)) {
    rows.push(rowOf(root, 0));
    for (const child of (children.get(root.id) ?? []).sort(compareByStartThenRank)) {
      rows.push(rowOf(child, 1));
    }
  }
  return { rows, unscheduled };
}
