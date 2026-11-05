import type { WorkPortfolioProject, WorkPortfolioView } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import {
  cartesPortefeuille,
  etatVide,
  filtrerProjets,
  raisonSante,
  statutAffiche,
  texteAvancement,
} from './portefeuille-model';

const projet = (p: Partial<WorkPortfolioProject>): WorkPortfolioProject => ({
  id: 'p1',
  name: 'Lancement boutique',
  kind: 'client',
  status: 'active',
  color: 'teal',
  health: 'on_track',
  customerName: 'Société Éléphant',
  owner: null,
  dueDate: '2026-11-30',
  totalTaskCount: 4,
  doneTaskCount: 1,
  overdueTaskCount: 0,
  overdueMilestoneCount: 0,
  progressPercent: 25,
  members: [],
  memberCount: 0,
  mine: false,
  visibility: 'organization',
  updatedAt: '2026-11-04T10:00:00.000Z',
  ...p,
});

describe('statut affiché', () => {
  it('santé écrite et ton de la pastille', () => {
    expect(statutAffiche(projet({}))).toEqual({ libelle: 'En bonne voie', ton: 'ok' });
    expect(statutAffiche(projet({ health: 'at_risk' }))).toEqual({
      libelle: 'À risque',
      ton: 'wait',
    });
    expect(statutAffiche(projet({ health: 'late' }))).toEqual({
      libelle: 'En retard',
      ton: 'late',
    });
  });
  it('fermé : terminé ou archivé ; en pause signalé', () => {
    expect(statutAffiche(projet({ health: 'closed', status: 'completed' })).libelle).toBe(
      'Terminé',
    );
    expect(statutAffiche(projet({ health: 'closed', status: 'archived' })).libelle).toBe('Archivé');
    expect(statutAffiche(projet({ status: 'on_hold' })).libelle).toBe('En bonne voie · en pause');
  });
  it('raison écrite', () => {
    expect(raisonSante(projet({ health: 'at_risk', overdueMilestoneCount: 1 }))).toBe(
      '1 jalon en retard.',
    );
    expect(raisonSante(projet({ health: 'at_risk', overdueTaskCount: 4 }))).toBe(
      '4 tâches en retard.',
    );
  });
});

describe('avancement, recherche, chiffres, états vides', () => {
  it('avancement', () => {
    expect(texteAvancement(projet({}))).toBe('1/4 · 25 %');
    expect(texteAvancement(projet({ totalTaskCount: 0, doneTaskCount: 0 }))).toBe('Aucune tâche');
  });
  it('recherche sans accents sur le nom et le client', () => {
    const items = [projet({}), projet({ id: 'p2', name: 'Interne RH', customerName: null })];
    expect(filtrerProjets(items, 'elephant').map((p) => p.id)).toEqual(['p1']);
    expect(filtrerProjets(items, '  ').length).toBe(2);
    expect(filtrerProjets(items, 'rh').map((p) => p.id)).toEqual(['p2']);
  });
  it('trois cartes, alerte sur les retards', () => {
    const v: WorkPortfolioView = {
      asOf: '2026-11-04',
      scope: 'all',
      stats: { activeProjects: 6, overdueTasks: 3, completedThisWeek: 5, weekStart: '2026-11-02' },
      items: [],
      truncated: false,
    };
    const c = cartesPortefeuille(v);
    expect(c.map((x) => x.valeur)).toEqual(['6', '3', '5']);
    expect(c[1]!.alerte).toBe(true);
  });
  it('état vide selon le filtre', () => {
    expect(etatVide('all', '', true).creer).toBe(true);
    expect(etatVide('all', '', false).creer).toBe(false);
    expect(etatVide('archived', '', true).titre).toBe('Aucun projet archivé');
    expect(etatVide('mine', 'x', true).titre).toBe('Aucun projet ne correspond');
  });
});
