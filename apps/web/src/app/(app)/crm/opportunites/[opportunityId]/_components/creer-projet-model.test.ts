// Encadré « Créer le projet » (ADR-0040 — C7 § 6.4) : ce que ces tests protègent,
// c'est qu'il ne paraisse jamais hors d'une opportunité gagnée, que le bouton soit
// réservé à `work.manage`, et qu'un doublon mène au projet existant.

import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import { etatCreerProjet, lienProjet, suiteRefus } from './creer-projet-model';

const DIRECTION: OrgAction[] = ['crm.read', 'crm.manage', 'work.read', 'work.manage'];
const COMMERCIAL: OrgAction[] = ['crm.read', 'crm.manage', 'work.read', 'work.update'];
const ID = '64b7f0c2a1b2c3d4e5f60718';

describe('etatCreerProjet', () => {
  it('caché hors d’une opportunité gagnée, ou sans droits connus', () => {
    for (const status of ['open', 'lost']) {
      expect(etatCreerProjet({ status, actions: DIRECTION, projectId: null })).toEqual({
        genre: 'cache',
      });
    }
    expect(etatCreerProjet({ status: 'won', actions: null, projectId: null })).toEqual({
      genre: 'cache',
    });
  });

  it('work.manage : chargement, puis créer ou ouvrir', () => {
    expect(etatCreerProjet({ status: 'won', actions: DIRECTION, projectId: undefined })).toEqual({
      genre: 'chargement',
    });
    expect(etatCreerProjet({ status: 'won', actions: DIRECTION, projectId: null })).toEqual({
      genre: 'creer',
    });
    expect(etatCreerProjet({ status: 'won', actions: DIRECTION, projectId: ID })).toEqual({
      genre: 'ouvrir',
      projectId: ID,
    });
  });

  it('sans work.manage : jamais de bouton « Créer », la phrase ou le lien', () => {
    expect(etatCreerProjet({ status: 'won', actions: COMMERCIAL, projectId: null })).toEqual({
      genre: 'demander',
    });
    expect(etatCreerProjet({ status: 'won', actions: COMMERCIAL, projectId: ID })).toEqual({
      genre: 'ouvrir',
      projectId: ID,
    });
    expect(etatCreerProjet({ status: 'won', actions: ['crm.read'], projectId: undefined })).toEqual(
      { genre: 'demander' },
    );
  });
});

describe('suiteRefus', () => {
  it('un doublon mène au projet existant', () => {
    expect(suiteRefus('WORK_PROJECT_EXISTS_FOR_OPPORTUNITY', { projectId: ID })).toEqual({
      projectId: ID,
    });
    expect(suiteRefus('WORK_PROJECT_EXISTS_FOR_QUOTE', { projectId: ID })).toEqual({
      projectId: ID,
    });
  });

  it('les autres refus donnent un message', () => {
    expect(suiteRefus('WORK_OPPORTUNITY_NOT_WON', {})).toHaveProperty('message');
    expect(suiteRefus('WORK_PROJECT_EXISTS_FOR_OPPORTUNITY', {})).toEqual({
      message: 'Le projet n’a pas pu être créé.',
    });
    expect(suiteRefus(null, {})).toEqual({ message: 'Le projet n’a pas pu être créé.' });
  });

  it('lien du projet encodé', () => {
    expect(lienProjet('a/b')).toBe('/projets/a%2Fb');
  });
});
