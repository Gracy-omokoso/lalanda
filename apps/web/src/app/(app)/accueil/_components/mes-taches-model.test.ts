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

// ADR-0044 § 6.5 (lot P3) : une approbation d'achat ouvre la demande.
describe('carte « Mes tâches » — approbation d’achat', () => {
  it('libellé « Approbation », fournisseur, lien vers la demande', () => {
    const c = carteMesTaches({
      overdue: [],
      today: [
        {
          source: 'purchases',
          id: 'purchases:o1',
          orderId: 'o1',
          requestNumber: 'DA2610-000001',
          title: 'Fournitures',
          supplierName: 'Socimex SARL',
          total: '89.35',
          currency: 'USD',
          dueDate: '2026-10-30',
          priority: 'none',
          rank: '2026-10-30T09:00:00.000Z',
          done: false,
          kindLabel: 'Approbation',
          href: '/achats/commandes/o1',
        },
      ],
    });
    expect(c.lignes[0]).toMatchObject({
      titre: 'Approbation : Fournitures',
      projet: 'Socimex SARL',
      lien: '/achats/commandes/o1',
    });
  });
});

// ADR-0045 § 6.1 (lot H3) : une absence à valider ouvre la liste « À valider ».
describe('carte « Mes tâches » — absence à valider', () => {
  it('libellé « Validation d’absence », type tel que servi, lien vers « À valider »', () => {
    const c = carteMesTaches({
      overdue: [],
      today: [
        {
          source: 'hr',
          kind: 'leave_approval',
          id: 'hr:leave:r1',
          requestId: 'r1',
          employeeName: 'Bea Kanku',
          typeLabel: 'Absence',
          start: { date: '2026-10-30', half: 'full' },
          end: { date: '2026-10-30', half: 'full' },
          days: '1',
          dueDate: '2026-10-30',
          priority: 'none',
          rank: '2026-10-29T09:00:00.000Z',
          done: false,
          kindLabel: 'Validation d’absence',
          href: '/rh/absences?vue=a-valider',
        },
      ],
    });
    expect(c.lignes[0]).toMatchObject({
      titre: 'Validation d’absence : Bea Kanku',
      projet: 'Absence',
      lien: '/rh/absences?vue=a-valider',
    });
  });
});
