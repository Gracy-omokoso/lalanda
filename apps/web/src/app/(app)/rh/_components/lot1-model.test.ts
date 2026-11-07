import { describe, expect, it } from 'vitest';

import {
  caseInvitation,
  corpsPoste,
  libelleEtatCompte,
  optionPoste,
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
