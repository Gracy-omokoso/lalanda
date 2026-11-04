// Fil d'une tâche façon Asana (ADR-0057) : commentaires ET activité, dans
// l'ordre chronologique (le plus ancien en haut, la zone de commentaire en bas).
// Logique pure, testée sans DOM.

import type { WorkActivityView, WorkCommentView } from '@lalanda/shared/work';

export type ElementFil =
  | { type: 'commentaire'; id: string; at: string; commentaire: WorkCommentView }
  | { type: 'activite'; id: string; at: string; activite: WorkActivityView };

/** Activités redites par un commentaire visible : on ne les répète pas. */
const REDITES = new Set(['comment.added', 'comment.edited']);

export function filTache(
  commentaires: readonly WorkCommentView[],
  activites: readonly WorkActivityView[],
): ElementFil[] {
  const fil: ElementFil[] = [
    ...commentaires.map((c): ElementFil => ({
      type: 'commentaire',
      id: `c-${c.id}`,
      at: c.createdAt,
      commentaire: c,
    })),
    ...activites
      .filter((a) => !REDITES.has(a.kind))
      .map((a): ElementFil => ({ type: 'activite', id: `a-${a.id}`, at: a.at, activite: a })),
  ];
  return fil.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id.localeCompare(y.id)));
}
