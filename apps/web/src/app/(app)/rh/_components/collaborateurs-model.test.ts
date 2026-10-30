import { describe, expect, it } from 'vitest';

import { HR_DEFAULT_CONTRACT_TYPES } from '@lalanda/shared/hr';

import { employe } from './fixtures.test-utils';
import {
  FILTRES_COLLABORATEURS_INITIAUX,
  ONGLETS_FICHE,
  ONGLETS_FICHE_PREVUS,
  formCollaborateur,
  libelleContrat,
  lignesDossier,
  managersProposes,
  ongletActif,
  requeteCollaborateurs,
  typesContrat,
  validerCollaborateur,
} from './collaborateurs-model';

const types = HR_DEFAULT_CONTRACT_TYPES;

describe('liste des collaborateurs', () => {
  it('requête : actifs par défaut, recherche bornée, curseur', () => {
    expect(requeteCollaborateurs(FILTRES_COLLABORATEURS_INITIAUX, null)).toEqual({
      status: 'active',
      limit: 50,
    });
    expect(requeteCollaborateurs({ q: '  awa ', statut: '', departmentId: 'd1' }, 'c2')).toEqual({
      q: 'awa',
      departmentId: 'd1',
      cursor: 'c2',
      limit: 50,
    });
  });

  it('types de contrat : ceux des réglages, sinon ceux proposés à l’activation', () => {
    expect(typesContrat(null)).toBe(HR_DEFAULT_CONTRACT_TYPES);
    const propres = [{ key: 'cdi', label: 'CDI maison', hasEndDate: false, active: true }];
    expect(typesContrat(propres)).toBe(propres);
    expect(libelleContrat({ contractType: 'fixed_term' }, types)).toBe('CDD');
    expect(libelleContrat({ contractType: 'x', contractTypeLabel: 'Servi' }, types)).toBe('Servi');
  });
});

describe('formulaire de fiche (dossier non sensible)', () => {
  const base = formCollaborateur(null, 'permanent', '2026-10-30');

  it('requis : prénom, nom, poste, date d’entrée', () => {
    const r = validerCollaborateur({ ...base, startDate: '' }, types);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual([
        'firstName',
        'jobTitle',
        'lastName',
        'startDate',
      ]);
    }
  });

  it('un CDD porte une fin de contrat ; les dates suivent l’entrée', () => {
    const r = validerCollaborateur(
      {
        ...base,
        firstName: 'Awa',
        lastName: 'M',
        jobTitle: 'Chauffeur',
        contractType: 'fixed_term',
        probationEndDate: '2026-01-01',
      },
      types,
    );
    expect(!r.ok && r.erreurs.contractEndDate).toMatch(/CDD/);
    expect(!r.ok && r.erreurs.probationEndDate).toMatch(/précéder/);
  });

  it('corps propre : vides → null, aucun champ sensible', () => {
    const r = validerCollaborateur(
      {
        ...base,
        firstName: ' Awa ',
        lastName: 'Mbuyi',
        jobTitle: 'Chauffeur',
        workEmail: 'a@b.cd',
      },
      types,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.corps.firstName).toBe('Awa');
      expect(r.corps.departmentId).toBeNull();
      expect(r.corps.workEmail).toBe('a@b.cd');
      for (const sensible of ['salary', 'compensation', 'bankDetails', 'identity', 'birthDate']) {
        expect(sensible in r.corps).toBe(false);
      }
    }
  });

  it('e-mail et téléphone vérifiés ; jamais son propre manager', () => {
    const r = validerCollaborateur(
      {
        ...base,
        firstName: 'A',
        lastName: 'B',
        jobTitle: 'C',
        workEmail: 'pas-un-mail',
        workPhone: 'abc',
        managerEmployeeId: 'e1',
      },
      types,
      'e1',
    );
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual([
      'managerEmployeeId',
      'workEmail',
      'workPhone',
    ]);
  });

  it('managers proposés : actifs, sauf soi', () => {
    const m = managersProposes(
      [
        employe({ id: 'e1' }),
        employe({ id: 'e2', firstName: 'Jean' }),
        employe({ id: 'e3', status: 'exited' }),
      ],
      'e1',
    );
    expect(m.map((x) => x.id)).toEqual(['e2']);
  });
});

describe('fiche', () => {
  it('onglets livrés seulement ; les onglets sensibles attendent H7', () => {
    expect(ONGLETS_FICHE.map((o) => o.id)).toEqual(['dossier', 'absences']);
    const prevus: readonly string[] = ONGLETS_FICHE_PREVUS;
    expect(ONGLETS_FICHE.every((o) => prevus.includes(o.id))).toBe(true);
    expect(ONGLETS_FICHE.map((o) => o.id)).not.toContain('sensible');
  });

  it('onglet allumé par le chemin', () => {
    const base = '/rh/collaborateurs/e1';
    expect(ongletActif(base, base)).toBe('dossier');
    expect(ongletActif(`${base}/absences`, base)).toBe('absences');
    expect(ongletActif(`${base}/inconnu`, base)).toBe('dossier');
  });

  it('dossier : lignes non sensibles, compte relié dit sans identifiant', () => {
    const lignes = lignesDossier(
      employe({ contractType: 'fixed_term', contractEndDate: '2027-01-15' }),
      types,
    );
    expect(lignes).toContainEqual(['Type de contrat', 'CDD']);
    expect(lignes).toContainEqual(['Fin de contrat', '15 janv. 2027']);
    expect(lignes).toContainEqual(['Compte Lalanda', 'Relié à un membre']);
    expect(lignes.map(([k]) => k).join(' ')).not.toMatch(/salaire|banc|identité|naissance/i);
  });
});
