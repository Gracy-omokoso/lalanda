import type { MyTaskItem } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { tache } from '../../projets/_components/fixtures.test-helpers';

import { MAX_TACHES_ACCUEIL, carteMesTaches, carteVisible } from './mes-taches-model';

function item(id: string, dueDate: string | null): MyTaskItem {
  return {
    ...tache({ id, title: `Tâche ${id}`, dueDate, projectId: 'p1' }),
    projectName: 'Chantier',
  };
}

describe('carte « Mes tâches » de l’Accueil (ADR-0039 § 6.5)', () => {
  it('n’apparaît qu’avec work.read', () => {
    expect(carteVisible(null)).toBe(false);
    expect(carteVisible(['analytics.read'])).toBe(false);
    expect(carteVisible(['analytics.read', 'work.read'])).toBe(true);
  });

  it('compte en retard et du jour, liste les retards d’abord', () => {
    const c = carteMesTaches({
      overdue: [item('a', '2026-10-28')],
      today: [item('b', '2026-10-29')],
    });
    expect(c.enRetard).toBe(1);
    expect(c.aujourdhui).toBe(1);
    expect(c.lignes.map((l) => l.id)).toEqual(['a', 'b']);
    expect(c.lignes[0]).toMatchObject({
      echeance: 'En retard · 28 oct.',
      enRetard: true,
      projet: 'Chantier',
      lien: '/projets/p1/liste?tache=a',
    });
    expect(c.lignes[1]).toMatchObject({ echeance: 'Aujourd’hui', enRetard: false });
    expect(c.autres).toBe(0);
  });

  it('cinq premières seulement, le reste compté', () => {
    const overdue = Array.from({ length: 4 }, (_, i) => item(`r${i}`, '2026-10-20'));
    const today = Array.from({ length: 3 }, (_, i) => item(`j${i}`, '2026-10-29'));
    const c = carteMesTaches({ overdue, today });
    expect(c.lignes).toHaveLength(MAX_TACHES_ACCUEIL);
    expect(c.lignes.map((l) => l.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'j0']);
    expect(c.autres).toBe(2);
  });

  it('rien à faire : aucune ligne, zéro partout', () => {
    expect(carteMesTaches({ overdue: [], today: [] })).toEqual({
      enRetard: 0,
      aujourdhui: 0,
      lignes: [],
      autres: 0,
    });
  });
});
