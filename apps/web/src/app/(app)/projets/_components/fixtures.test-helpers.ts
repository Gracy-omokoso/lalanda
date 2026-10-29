// Fabrique de tâches pour les tests des modèles (aucun appel réseau).

import type { WorkTaskView } from '@lalanda/shared/work';

let n = 0;

/** Identifiant Mongo factice (24 hexadécimaux) à partir d'un petit entier. */
export function oid(i: number): string {
  return i.toString(16).padStart(24, '0');
}

export function tache(partiel: Partial<WorkTaskView> & { id: string }): WorkTaskView {
  n += 1;
  return {
    projectId: oid(999),
    number: n,
    parentTaskId: null,
    title: `Tâche ${n}`,
    columnKey: 'todo',
    columnCategory: 'todo',
    done: false,
    completedAt: null,
    rank: 'm',
    assignee: null,
    priority: 'none',
    labelKeys: [],
    startDate: null,
    dueDate: null,
    isMilestone: false,
    blockedBy: [],
    blocked: false,
    loggedMinutes: 0,
    estimateMinutes: null,
    subtaskCount: 0,
    doneSubtaskCount: 0,
    revision: 1,
    updatedAt: '2026-10-29T00:00:00.000Z',
    ...partiel,
  };
}
