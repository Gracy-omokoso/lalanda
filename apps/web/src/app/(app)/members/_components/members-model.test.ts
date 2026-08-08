// Ce que la page Membres a le droit d'AFFICHER (S20a).
//
// Le serveur reste seul juge des droits; ces tests fixent la traduction de ses
// drapeaux en interface, et surtout les deux endroits où une erreur se voit :
// une commande offerte alors qu'elle échouera, et un refus sans explication.

import { describe, expect, it } from 'vitest';

import type { MemberView, RoleOption } from '@/lib/api';

import {
  afficheDroitCloture,
  ciblesDeTransfert,
  codeErreur,
  messageErreur,
  nomAffiche,
  raisonNonModifiable,
  raisonNonRevocable,
  roleParDefaut,
  rolesProposables,
  sousTitre,
} from './members-model.js';

function membre(over: Partial<MemberView> = {}): MemberView {
  return {
    userId: '65f0aa11bb22cc33dd44ee55',
    email: 'kabila@exemple.cd',
    name: 'Joséphine Kabila',
    role: 'analyst',
    roleLabel: 'Analyste',
    canClosePeriods: false,
    acceptedAt: '2026-08-01T10:00:00.000Z',
    isLastOwner: false,
    manageable: true,
    ...over,
  };
}

function option(over: Partial<RoleOption> = {}): RoleOption {
  return { value: 'viewer', label: 'Lecteur', description: '', grantable: true, ...over };
}

describe('identité affichée', () => {
  it('préfère le nom, puis l’email', () => {
    expect(nomAffiche(membre())).toBe('Joséphine Kabila');
    expect(nomAffiche(membre({ name: null }))).toBe('kabila@exemple.cd');
    expect(nomAffiche(membre({ name: '   ' }))).toBe('kabila@exemple.cd');
  });

  it('reste affichable quand le compte n’existe plus', () => {
    // La membership a survécu à l'utilisateur : c'est précisément la ligne
    // qu'un propriétaire veut pouvoir révoquer. L'effacer la rendrait
    // irrattrapable depuis l'interface.
    const orphelin = membre({ name: null, email: null });
    expect(nomAffiche(orphelin)).toContain('Compte supprimé');
    expect(nomAffiche(orphelin)).toContain('44ee55');
  });

  it('n’affiche l’email en sous-titre que s’il n’est pas déjà le titre', () => {
    expect(sousTitre(membre())).toBe('kabila@exemple.cd');
    expect(sousTitre(membre({ name: null }))).toBeNull();
    expect(sousTitre(membre({ email: null }))).toBeNull();
  });
});

describe('R1 — protection du dernier propriétaire visible dans l’UI', () => {
  it('interdit rétrogradation ET révocation, avec une raison actionnable', () => {
    const dernier = membre({ role: 'owner', roleLabel: 'Propriétaire', isLastOwner: true });
    expect(raisonNonModifiable(dernier)).toMatch(/transférez la propriété/i);
    expect(raisonNonRevocable(dernier)).not.toBeNull();
  });

  it('laisse faire dès qu’un second propriétaire existe', () => {
    const proprio = membre({ role: 'owner', roleLabel: 'Propriétaire', isLastOwner: false });
    expect(raisonNonModifiable(proprio)).toBeNull();
    expect(raisonNonRevocable(proprio)).toBeNull();
  });
});

describe('R7 — ne pas offrir ce que le serveur refusera', () => {
  it('bloque l’action sur un membre plus puissant que l’acteur', () => {
    const horsPortee = membre({ role: 'owner', manageable: false });
    expect(raisonNonModifiable(horsPortee)).toMatch(/droits que vous n’avez pas/);
    expect(raisonNonRevocable(horsPortee)).toMatch(/droits que vous n’avez pas/);
  });

  it('ne propose que les rôles que l’acteur peut attribuer', () => {
    const options = [
      option({ value: 'owner', grantable: false }),
      option({ value: 'admin', grantable: true }),
      option({ value: 'viewer', grantable: true }),
    ];
    expect(rolesProposables(options).map((o) => o.value)).toEqual(['admin', 'viewer']);
  });
});

describe('rôle par défaut à l’invitation', () => {
  it('propose le moindre privilège quand il est disponible', () => {
    // Un défaut généreux finit attribué à chaque invitation expédiée sans lire
    // le formulaire.
    const options = [option({ value: 'admin' }), option({ value: 'viewer' })];
    expect(roleParDefaut(options)).toBe('viewer');
  });

  it('retombe sur le moins puissant des rôles restants', () => {
    // `ASSIGNABLE_ORG_ROLES` suit l'ordre de privilège décroissant d'ADR-0012.
    const options = [option({ value: 'admin' }), option({ value: 'accountant' })];
    expect(roleParDefaut(options)).toBe('accountant');
  });

  it('n’invente aucun rôle quand l’acteur ne peut rien attribuer', () => {
    expect(roleParDefaut([option({ value: 'viewer', grantable: false })])).toBeNull();
    expect(roleParDefaut([])).toBeNull();
  });
});

describe('droit conditionnel de clôture (case ⚙)', () => {
  it('n’est proposé qu’au Comptable', () => {
    expect(afficheDroitCloture(membre({ role: 'accountant' }))).toBe(true);
    for (const role of ['owner', 'admin', 'finance_director', 'analyst', 'viewer'] as const) {
      expect(afficheDroitCloture(membre({ role })), role).toBe(false);
    }
  });
});

describe('cibles de transfert de propriété', () => {
  it('exclut l’acteur et les propriétaires déjà en place', () => {
    const moi = membre({ userId: 'moi', role: 'owner' });
    const autreProprio = membre({ userId: 'p2', role: 'owner' });
    const admin = membre({ userId: 'a1', role: 'admin' });
    expect(ciblesDeTransfert([moi, autreProprio, admin], 'moi').map((m) => m.userId)).toEqual([
      'a1',
    ]);
  });
});

describe('messages de refus', () => {
  function erreur(code: string): Error & { detail: unknown } {
    const e = new Error('Conflict') as Error & { detail: unknown };
    e.detail = { code };
    return e;
  }

  it('traduit les codes métier en consigne actionnable', () => {
    expect(codeErreur(erreur('LAST_OWNER'))).toBe('LAST_OWNER');
    expect(messageErreur(erreur('LAST_OWNER'), 'repli')).toMatch(/transférez la propriété/i);
    expect(messageErreur(erreur('ROLE_ESCALATION'), 'repli')).toMatch(/plus étendu que le vôtre/);
    expect(messageErreur(erreur('ROLE_NOT_ASSIGNABLE'), 'repli')).toMatch(/Chef de projet/);
  });

  it('préfère le message du serveur à un repli générique pour un code inconnu', () => {
    // « Une erreur est survenue » n'aide personne à corriger quoi que ce soit.
    expect(messageErreur(erreur('TOUT_NEUF'), 'repli')).toBe('Conflict');
  });

  it('retombe sur le repli quand il n’y a ni code ni message', () => {
    expect(messageErreur({}, 'repli')).toBe('repli');
    expect(messageErreur(new Error(''), 'repli')).toBe('repli');
    expect(codeErreur(null)).toBeNull();
    expect(codeErreur(new Error('sans detail'))).toBeNull();
  });
});
