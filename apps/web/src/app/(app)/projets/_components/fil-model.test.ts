import type { WorkActivityView, WorkCommentView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { filTache } from './fil-model';

const ann = { userId: 'a'.repeat(24), name: 'Ann' };

function com(id: string, createdAt: string): WorkCommentView {
  return { id, createdAt, author: ann, body: 'x', mentions: [] } as unknown as WorkCommentView;
}
function act(id: string, at: string, kind: WorkActivityView['kind']): WorkActivityView {
  return { id, at, kind, actor: ann, data: {}, projectId: 'p', taskId: 't' };
}

describe('filTache', () => {
  it('fusionne commentaires et activité, du plus ancien au plus récent, sans redites', () => {
    const fil = filTache(
      [com('c1', '2026-11-02T10:00:00Z')],
      [
        act('a2', '2026-11-03T10:00:00Z', 'task.completed'),
        act('a1', '2026-11-01T10:00:00Z', 'task.created'),
        act('a3', '2026-11-02T10:00:00Z', 'comment.added'),
      ],
    );
    expect(fil.map((e) => e.id)).toEqual(['a-a1', 'c-c1', 'a-a2']);
  });
  it('vide', () => {
    expect(filTache([], [])).toEqual([]);
  });
});
