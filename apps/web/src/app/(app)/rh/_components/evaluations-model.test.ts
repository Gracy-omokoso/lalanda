import { describe, expect, it } from 'vitest';

import {
  MENTION_AUCUNE_NOTE,
  PHRASE_CLOTURE_INTERDITE,
  PHRASE_OBJECTIF_SOI,
  accesEvaluations,
  etapesOffertes,
  gestesObjectif,
  libelleCible,
  rolesSur,
  sectionsEditables,
  sectionsLisibles,
  valeursEchelle,
} from './evaluations-model';

const moi = { employeeId: 'e-moi', userId: 'u-moi' };
const revue = {
  id: 'r1',
  cycleId: 'c1',
  employeeId: 'e-b',
  reviewerUserId: 'u-a',
  status: 'not_started' as const,
  revision: 1,
};

describe('ADR-0051 H16 — accès aux évaluations', () => {
  it('`performance.read` effectif, ou la personne concernée ; personne d’autre', () => {
    expect(accesEvaluations(['performance.read'], [])).toBe('performance');
    expect(accesEvaluations(['hr.read', 'hr.manage', 'hr.sensitive.read'], [])).toBe('aucun');
    expect(accesEvaluations(['leave.request'], [revue])).toBe('personne');
  });

  it('l’écran rappelle qu’aucune note n’est calculée', () => {
    expect(MENTION_AUCUNE_NOTE).toMatch(/Aucune note n’est calculée/);
  });
});

describe('ADR-0051 H16 — lecture et écriture par section (miroir de l’API)', () => {
  it('l’évalué ne lit l’appréciation qu’une fois partagée', () => {
    const r = rolesSur({ ...revue, employeeId: 'e-moi' }, moi, []);
    expect(r.self).toBe(true);
    expect(sectionsLisibles(r, 'manager_submitted')).toEqual(['selfAssessment', 'employeeComment']);
    expect(sectionsLisibles(r, 'shared')).toContain('managerAssessment');
  });

  it('la note RH est réservée à `performance.read`', () => {
    const evaluateur = rolesSur({ ...revue, reviewerUserId: 'u-moi' }, moi, []);
    expect(sectionsLisibles(evaluateur, 'closed')).not.toContain('hrNote');
    const rh = rolesSur(revue, moi, ['performance.read']);
    expect(sectionsLisibles(rh, 'not_started')).toContain('hrNote');
  });

  it('rédaction : auto-évaluation avant, appréciation de l’évaluateur, commentaire après partage', () => {
    const self = rolesSur({ ...revue, employeeId: 'e-moi' }, moi, []);
    expect(sectionsEditables(self, 'not_started', true)).toEqual(['selfAssessment']);
    expect(sectionsEditables(self, 'not_started', false)).toEqual([]);
    expect(sectionsEditables(self, 'shared', true)).toEqual(['employeeComment']);
    const evaluateur = rolesSur({ ...revue, reviewerUserId: 'u-moi' }, moi, []);
    expect(sectionsEditables(evaluateur, 'self_submitted', true)).toEqual(['managerAssessment']);
    expect(sectionsEditables(evaluateur, 'shared', true)).toEqual([]);
  });
});

describe('ADR-0051 H16 — étapes et séparation', () => {
  const gestion = ['performance.read', 'hr.manage'] as const;

  it('l’évaluateur ne clôt pas : la phrase le dit, aucun bouton', () => {
    const evaluateur = rolesSur({ ...revue, reviewerUserId: 'u-moi' }, moi, [...gestion]);
    const e = etapesOffertes({ status: 'acknowledged' }, evaluateur, [...gestion], true);
    expect(e.etapes.map((x) => x.etape)).not.toContain('close');
    expect(e.phrase).toBe(PHRASE_CLOTURE_INTERDITE);
  });

  it('une autre personne des RH clôt, avec la mention « non signée » si besoin', () => {
    const rh = rolesSur(revue, moi, [...gestion]);
    expect(etapesOffertes({ status: 'shared' }, rh, [...gestion], true).etapes).toEqual([
      { etape: 'close', libelle: 'Clôturer (non signée)' },
    ]);
  });

  it('l’évaluateur attend l’auto-évaluation quand la campagne la prévoit', () => {
    const evaluateur = rolesSur({ ...revue, reviewerUserId: 'u-moi' }, moi, []);
    expect(etapesOffertes({ status: 'not_started' }, evaluateur, [], true).etapes).toEqual([]);
    expect(
      etapesOffertes({ status: 'not_started' }, evaluateur, [], false).etapes.map((x) => x.etape),
    ).toEqual(['submit-manager']);
  });
});

describe('ADR-0051 H16 — objectifs', () => {
  it('on ne valide pas son propre objectif ; le manager le peut', () => {
    const soi = gestesObjectif({ status: 'proposed', employeeId: 'e-moi' }, moi, [], []);
    expect(soi.valider).toBe(false);
    expect(soi.phrase).toBe(PHRASE_OBJECTIF_SOI);
    expect(soi.avancer).toBe(true);
    const manager = gestesObjectif({ status: 'proposed', employeeId: 'e-b' }, moi, [], ['e-b']);
    expect(manager.valider).toBe(true);
    const horsChaine = gestesObjectif({ status: 'proposed', employeeId: 'e-c' }, moi, [], []);
    expect(horsChaine.valider).toBe(false);
  });

  it('cible et échelle : des valeurs saisies, jamais calculées', () => {
    expect(libelleCible({ kind: 'number', value: '12.5', unit: 'clients' })).toBe('12,5 clients');
    expect(libelleCible(null)).toBeNull();
    expect(valeursEchelle({ min: 1, max: 3, labels: ['Faible', 'Bien'] })).toEqual([
      { valeur: 1, libelle: '1 — Faible' },
      { valeur: 2, libelle: '2 — Bien' },
      { valeur: 3, libelle: '3' },
    ]);
  });
});
