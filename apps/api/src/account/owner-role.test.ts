// Résolution défensive du rôle propriétaire (S20b — ADR-0012 §7).
//
// Ces tests fixent le contrat que la refonte RBAC ne doit pas casser en silence :
// après migration des slugs (`member` → `finance_director`, sept nouveaux rôles),
// `owner` reste `owner` et rien d'autre n'est propriétaire.

import { describe, expect, it } from 'vitest';

import { OWNER_ROLE, isOwnerRole } from './owner-role.js';

describe('isOwnerRole (S20b)', () => {
  it('reconnaît le slug propriétaire', () => {
    expect(isOwnerRole(OWNER_ROLE)).toBe(true);
    expect(isOwnerRole('owner')).toBe(true);
  });

  it('ne reconnaît AUCUN des sept autres rôles d’organisation d’ADR-0012', () => {
    // Si l'un d'eux passait pour propriétaire, un compte pourrait être supprimé
    // en laissant une organisation sans personne pour la gouverner.
    for (const role of [
      'admin',
      'finance_director',
      'accountant',
      'analyst',
      'project_manager',
      'advisor',
      'viewer',
    ]) {
      expect(isOwnerRole(role)).toBe(false);
    }
  });

  it('ne confond pas les rôles PLATEFORME avec le rôle propriétaire d’organisation', () => {
    // Les deux espaces de noms cohabitent (ADR-0012 §2) ; le préfixe est ce qui
    // les sépare, et il doit suffire.
    for (const role of ['platform_super_admin', 'platform_admin', 'platform_billing']) {
      expect(isOwnerRole(role)).toBe(false);
    }
  });

  it('reste vrai malgré une casse ou des espaces inattendus venus de la base', () => {
    // La valeur vient d'un document Mongo, pas d'un type TypeScript : mieux vaut
    // refuser une suppression de trop que d'en autoriser une de trop.
    for (const role of ['Owner', 'OWNER', ' owner ', 'owner\n']) {
      expect(isOwnerRole(role)).toBe(true);
    }
  });

  it('traite comme non-propriétaire toute valeur absente ou non textuelle', () => {
    for (const value of [null, undefined, '', '   ', 0, 1, {}, [], true]) {
      expect(isOwnerRole(value)).toBe(false);
    }
  });

  it('n’accepte pas un rôle qui CONTIENT « owner » sans en être un', () => {
    for (const role of ['co_owner', 'owner_delegate', 'not-owner']) {
      expect(isOwnerRole(role)).toBe(false);
    }
  });
});
