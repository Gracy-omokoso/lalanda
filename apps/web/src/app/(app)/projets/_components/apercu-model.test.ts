import { describe, expect, it } from 'vitest';

import { libellesSemaines, phraseSante, pourcentTermine } from './apercu-model';
import { ONGLET_DEFAUT, ongletDEntree, ongletsVisibles } from './onglets-projet';

describe('apercu-model', () => {
  it('phrase du statut, avec ses raisons', () => {
    expect(phraseSante({ status: 'on_track', reasons: [] })).toBe(
      'En bonne voie : aucune tâche en retard.',
    );
    expect(phraseSante({ status: 'at_risk', reasons: ['OVERDUE_TASKS'] })).toBe(
      'À risque : des tâches sont en retard.',
    );
  });
  it('libellés des semaines et pourcentage', () => {
    const l = libellesSemaines({ weeks: [{ weekStart: '2026-11-02', done: 1, total: 2 }] });
    expect(l).toEqual({ courts: ['2/11'], complets: ['Semaine du 2 nov. 2026'] });
    expect(pourcentTermine({ open: 1, done: 3, overdue: 0, unassigned: 0, milestones: 0 })).toBe(
      75,
    );
    expect(pourcentTermine({ open: 0, done: 0, overdue: 0, unassigned: 0, milestones: 0 })).toBe(0);
  });
});

describe('onglets du projet (ADR-0057)', () => {
  it('Aperçu par défaut ; un lien de tâche mène à la Liste', () => {
    expect(ONGLET_DEFAUT).toBe('apercu');
    expect(ongletDEntree({})).toBe('apercu');
    expect(ongletDEntree({ tache: 'abc' })).toBe('liste');
    expect(ongletDEntree({ tache: '' })).toBe('apercu');
  });
  it('ordre façon Asana, segments conservés, droits respectés', () => {
    expect(ongletsVisibles(['work.read']).map((o) => o.label)).toEqual([
      'Aperçu',
      'Liste',
      'Tableau',
      'Chronologie',
      'Calendrier',
    ]);
    const tous = ongletsVisibles(['work.read', 'docs.read', 'treasury.read', 'work.manage']);
    expect(tous.map((o) => o.segment)).toEqual([
      'apercu',
      'liste',
      'kanban',
      'chronologie',
      'calendrier',
      'documents',
      'marge',
      'reglages',
    ]);
  });
});
