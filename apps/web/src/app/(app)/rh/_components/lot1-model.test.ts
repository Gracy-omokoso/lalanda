import { describe, expect, it } from 'vitest';

import {
  caseInvitation,
  corpsChangementPoste,
  corpsPoste,
  libelleEtatCompte,
  libelleManagerImport,
  optionPoste,
  peutChangerDePoste,
  peutCorrigerMatricule,
  peutInviterSurLalanda,
} from './lot1-model';

describe('lot 1 RH — règles d’écran (ADR-0068)', () => {
  it('inviter exige `members.invite` en plus de `hr.manage`', () => {
    expect(peutInviterSurLalanda(['hr.manage'])).toBe(false);
    expect(peutInviterSurLalanda(['hr.manage', 'members.invite'])).toBe(true);
    expect(peutInviterSurLalanda(null)).toBe(false);
  });
  it('corriger un matricule : droit RH administrateur', () => {
    expect(peutCorrigerMatricule(['hr.manage'])).toBe(false);
    expect(peutCorrigerMatricule(['hr.manage', 'hr.sensitive.read'])).toBe(true);
  });
  it('case cochée par défaut dès qu’un e-mail est saisi, sauf si décochée', () => {
    expect(caseInvitation('', null)).toEqual({ visible: false, cochee: false });
    expect(caseInvitation('a@b.cd', null)).toEqual({ visible: true, cochee: true });
    expect(caseInvitation('a@b.cd', false)).toEqual({ visible: true, cochee: false });
  });
  it('poste choisi → corps de l’API', () => {
    expect(corpsPoste('')).toBeUndefined();
    expect(corpsPoste('new')).toEqual({ mode: 'new' });
    expect(corpsPoste('pos:abc')).toEqual({ mode: 'replacement', positionId: 'abc' });
    expect(
      optionPoste({ positionNumber: 'POS-001', title: 'Chauffeur', departmentName: null }),
    ).toBe('POS-001 — Chauffeur');
  });
  it('état du compte', () => {
    expect(libelleEtatCompte({ state: 'none', userId: null, invitation: null }).texte).toBe(
      'Sans compte Lalanda',
    );
    expect(libelleEtatCompte({ state: 'linked', userId: 'u', invitation: null }).ton).toBe(
      'success',
    );
  });
});

describe('changement de poste (amendement du 8 nov. 2026)', () => {
  it('réservé au gestionnaire RH, fiche active qui a un poste', () => {
    expect(peutChangerDePoste(['hr.manage'], { status: 'active', positionId: 'p' })).toBe(true);
    expect(peutChangerDePoste(['hr.manage'], { status: 'active', positionId: null })).toBe(false);
    expect(peutChangerDePoste(['hr.manage'], { status: 'exited', positionId: 'p' })).toBe(false);
    expect(peutChangerDePoste(['hr.read'], { status: 'active', positionId: 'p' })).toBe(false);
  });
  it('corps envoyé à l’API', () => {
    const base = { expectedRevision: 3, effectiveDate: '', jobTitle: '  ' };
    expect(corpsChangementPoste({ ...base, choix: '' })).toBeNull();
    expect(corpsChangementPoste({ ...base, choix: 'new' })).toEqual({
      expectedRevision: 3,
      position: { mode: 'new' },
    });
    expect(
      corpsChangementPoste({
        expectedRevision: 3,
        choix: 'pos:abc',
        effectiveDate: '2026-11-09',
        jobTitle: ' Chef comptable ',
      }),
    ).toEqual({
      expectedRevision: 3,
      position: { mode: 'replacement', positionId: 'abc' },
      effectiveDate: '2026-11-09',
      jobTitle: 'Chef comptable',
    });
  });
});

describe('manager à l’import (amendement du 8 nov. 2026)', () => {
  it('libellé de la colonne Manager', () => {
    expect(
      libelleManagerImport({
        managerRef: 'GF-0001',
        manager: { kind: 'existing', employeeId: 'e', displayName: 'Aline Mbuyi' },
      }),
    ).toBe('Aline Mbuyi');
    expect(libelleManagerImport({ managerRef: 'a@b.cd', manager: { kind: 'row', row: 4 } })).toBe(
      'Ligne 4 du fichier',
    );
    expect(libelleManagerImport({ managerRef: null, manager: { kind: 'none' } })).toBe('—');
    expect(libelleManagerImport({ managerRef: 'X', manager: { kind: 'none' } })).toBe('X');
  });
});
