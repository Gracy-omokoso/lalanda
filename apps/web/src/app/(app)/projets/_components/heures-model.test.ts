// ADR-0080 : heures de début et d'échéance dans les écrans Projets.

import type { WorkTaskDetail } from '@lalanda/shared/work';
import { afterEach, describe, expect, it } from 'vitest';

import { descriptionBarre } from './gantt-model';
import { oid, tache } from './fixtures.test-helpers';
import { tonDate } from './liste-model';
import {
  aujourdhui,
  definirFuseau,
  etatEcheance,
  formatHeure,
  formatHeureLongue,
  formatJourHeure,
  fuseauCourant,
  heureActuelle,
} from './projets-model';
import { diffTache, formulaireTache } from './taches-model';

afterEach(() => definirFuseau('Africa/Kinshasa'));

function detail(p: Partial<WorkTaskDetail> = {}): WorkTaskDetail {
  return {
    ...tache({
      id: oid(1),
      title: 'Titre',
      revision: 4,
      startDate: '2026-11-01',
      dueDate: '2026-11-05',
    }),
    description: null,
    completedBy: null,
    followers: [],
    subtasks: [],
    predecessors: [],
    successors: [],
    commentCount: 0,
    attachmentCount: 0,
    source: null,
    billing: null,
    createdBy: oid(9),
    createdAt: '2026-10-29T00:00:00.000Z',
    ...p,
  };
}

describe('fuseau de l’organisation', () => {
  it('Kinshasa par défaut ; Lubumbashi décale « aujourd’hui » et l’heure', () => {
    const now = new Date('2026-11-18T22:30:00Z');
    expect(fuseauCourant()).toBe('Africa/Kinshasa');
    expect(aujourdhui(now)).toBe('2026-11-18');
    expect(heureActuelle(now)).toBe('23:30');
    definirFuseau('Africa/Lubumbashi');
    expect(aujourdhui(now)).toBe('2026-11-19');
    expect(heureActuelle(now)).toBe('00:30');
  });

  it('une valeur absente ne change rien, une valeur inconnue retombe sur Kinshasa', () => {
    definirFuseau('Africa/Lubumbashi');
    definirFuseau(undefined);
    expect(fuseauCourant()).toBe('Africa/Lubumbashi');
    definirFuseau('Europe/Paris');
    expect(fuseauCourant()).toBe('Africa/Kinshasa');
  });

  it('affichage : l’abréviation du fuseau suit l’heure', () => {
    expect(formatHeure('14:00')).toBe('14:00 WAT');
    expect(formatJourHeure('2026-11-03', '14:00')).toBe('3 nov. 2026 · 14:00 WAT');
    expect(formatJourHeure('2026-11-03', null)).toBe('3 nov. 2026');
    definirFuseau('Africa/Lubumbashi');
    expect(formatHeure('14:00')).toBe('14:00 CAT');
    expect(formatHeureLongue('14:00')).toBe('14:00, heure de Lubumbashi (CAT, UTC+2)');
  });
});

describe('retard à l’heure', () => {
  // Un jour fixe loin d'aujourd'hui : l'horloge réelle n'intervient pas.
  const t = { done: false, dueDate: '2030-01-15', dueTime: '10:00' };

  it('sans heure courante (jour qui n’est pas aujourd’hui) : la règle du jour', () => {
    expect(etatEcheance(t, '2030-01-15', 3, undefined)).toBe('aujourdhui');
    expect(tonDate(t, '2030-01-15')).toBe('aujourdhui');
  });

  it('heure atteinte : en retard ; avant : aujourd’hui', () => {
    expect(etatEcheance(t, '2030-01-15', 3, '10:00')).toBe('en_retard');
    expect(etatEcheance(t, '2030-01-15', 3, '09:59')).toBe('aujourdhui');
    expect(tonDate(t, '2030-01-15', '11:00')).toBe('retard');
    // Sans heure posée : jamais en retard le jour même.
    expect(tonDate({ ...t, dueTime: null }, '2030-01-15', '23:59')).toBe('aujourdhui');
  });
});

describe('panneau de tâche', () => {
  it('rien de modifié : rien à envoyer, heures comprises', () => {
    const d = detail({ dueTime: '17:00' });
    expect(diffTache(d, formulaireTache(d))).toBeNull();
  });

  it('poser une heure d’échéance', () => {
    const d = detail();
    expect(diffTache(d, { ...formulaireTache(d), dueTime: '17:30' })).toEqual({
      dueTime: '17:30',
      expectedRevision: 4,
    });
  });

  it('effacer le jour efface l’heure ; jamais d’heure sans jour', () => {
    const d = detail({ startTime: '08:00', dueTime: '17:00' });
    expect(diffTache(d, { ...formulaireTache(d), startDate: '' })).toEqual({
      startDate: null,
      startTime: null,
      expectedRevision: 4,
    });
    const sansJour = detail({ dueDate: null });
    expect(diffTache(sansJour, { ...formulaireTache(sansJour), dueTime: '09:00' })).toBeNull();
  });
});

describe('chronologie', () => {
  it('la description d’une barre porte les heures', () => {
    expect(
      descriptionBarre(
        { number: 3, title: 'Remise', done: false },
        {
          shape: 'bar',
          start: '2026-11-18',
          end: '2026-11-18',
          startTime: '08:00',
          endTime: '17:00',
          conflict: false,
        },
      ),
    ).toBe('#3 Remise, du 18 nov. 2026 · 08:00 WAT au 18 nov. 2026 · 17:00 WAT');
  });
});
