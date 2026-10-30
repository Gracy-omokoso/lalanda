import { describe, expect, it } from 'vitest';

import type { HrOrgChartResponse } from '@/lib/api-hr';

import {
  arbreOrganigramme,
  noeudsVisibles,
  ouvertsInitiaux,
  tousLesParents,
  toucheArbre,
} from './organigramme-model';

const people = [
  { id: 'a', name: 'Awa', jobTitle: 'Directrice', departmentName: 'Direction' },
  { id: 'b', name: 'Bruno', jobTitle: 'Comptable', departmentName: 'Finance' },
  { id: 'c', name: 'Céline', jobTitle: 'Caissière', departmentName: 'Finance' },
];

const hierarchie: HrOrgChartResponse = {
  view: 'reporting',
  headcount: 3,
  people,
  roots: [
    {
      employeeId: 'a',
      departmentId: null,
      directReports: 1,
      totalReports: 2,
      children: [
        {
          employeeId: 'b',
          departmentId: 'f',
          directReports: 1,
          totalReports: 1,
          children: [
            { employeeId: 'c', departmentId: 'f', directReports: 0, totalReports: 0, children: [] },
          ],
        },
      ],
    },
  ],
};

const services: HrOrgChartResponse = {
  view: 'departments',
  headcount: 3,
  people,
  unassignedEmployeeIds: ['a'],
  roots: [
    {
      departmentId: 'f',
      name: 'Finance',
      headEmployeeId: 'b',
      employeeIds: ['c', 'b'],
      headcount: 2,
      totalHeadcount: 2,
      children: [],
    },
  ],
};

describe('organigramme', () => {
  it('ligne hiérarchique : nom, poste, service, effectifs du moteur', () => {
    const [a] = arbreOrganigramme(hierarchie);
    expect(a!.titre).toBe('Awa');
    expect(a!.detail).toBe('Directrice · Direction · encadre 1 en direct, 2 en tout');
    expect(a!.enfants[0]!.detail).toBe('Comptable · Finance · encadre 1 personne');
    expect(a!.lien).toBeNull();
  });

  it('liens vers les fiches seulement si l’appelant peut les ouvrir', () => {
    const [a] = arbreOrganigramme(hierarchie, (id) => `/rh/collaborateurs/${id}`);
    expect(a!.lien).toBe('/rh/collaborateurs/a');
  });

  it('par services : responsable, effectif, membres par nom, « Sans service »', () => {
    const r = arbreOrganigramme(services);
    expect(r.map((n) => n.titre)).toEqual(['Finance', 'Sans service']);
    expect(r[0]!.detail).toBe('Responsable : Bruno · 2 personnes');
    expect(r[0]!.enfants.map((n) => n.titre)).toEqual(['Bruno', 'Céline']);
    expect(r[1]!.enfants.map((n) => n.titre)).toEqual(['Awa']);
  });

  it('nœuds visibles selon les dépliés, avec niveau et position ARIA', () => {
    const r = arbreOrganigramme(hierarchie);
    const v = noeudsVisibles(r, ouvertsInitiaux(r));
    expect(v.map((x) => [x.noeud.titre, x.niveau, x.position, x.freres])).toEqual([
      ['Awa', 1, 1, 1],
      ['Bruno', 2, 1, 1],
    ]);
    expect(noeudsVisibles(r, tousLesParents(r))).toHaveLength(3);
  });

  it('clavier : flèches, droite déplie puis descend, gauche replie puis remonte, Début, Fin', () => {
    const r = arbreOrganigramme(hierarchie);
    let etat = { focus: 'p:a' as string | null, ouverts: new Set<string>() };
    const appui = (k: string): void => {
      etat = toucheArbre(k, noeudsVisibles(r, etat.ouverts), etat) ?? etat;
    };
    appui('ArrowDown');
    expect(etat.focus).toBe('p:a');
    appui('ArrowRight');
    expect(etat.ouverts.has('p:a')).toBe(true);
    appui('ArrowRight');
    expect(etat.focus).toBe('p:b');
    appui('ArrowRight');
    appui('ArrowDown');
    expect(etat.focus).toBe('p:c');
    appui('ArrowLeft');
    expect(etat.focus).toBe('p:b');
    appui('ArrowLeft');
    expect(etat.ouverts.has('p:b')).toBe(false);
    appui('Home');
    expect(etat.focus).toBe('p:a');
    appui('End');
    expect(etat.focus).toBe('p:b');
    appui('*');
    expect(toucheArbre('a', noeudsVisibles(r, etat.ouverts), etat)).toBeNull();
  });
});
