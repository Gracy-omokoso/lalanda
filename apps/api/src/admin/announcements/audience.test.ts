import { describe, expect, it } from 'vitest';

import {
  audienceRoles,
  isAllAudience,
  selectAudience,
  unknownOrgRoles,
  type AudienceMembership,
  type AudienceOrganization,
  type AudienceUser,
} from './audience.js';

const ORGS: AudienceOrganization[] = [
  { id: 'cd-pro', pays: 'CD', plan: 'pro', status: 'active' },
  { id: 'cd-free', pays: 'CD', plan: 'free', status: 'canceled' },
  { id: 'fr-pro', pays: 'FR', plan: 'pro', status: 'trialing' },
];
const M = (userId: string, organizationId: string, role = 'owner'): AudienceMembership => ({
  userId,
  organizationId,
  role,
});
const MEMBERSHIPS: AudienceMembership[] = [
  M('a', 'cd-pro'),
  M('b', 'cd-pro', 'viewer'),
  M('c', 'cd-free'),
  M('d', 'fr-pro'),
  M('e', 'fr-pro', 'accountant'),
  M('e', 'cd-pro', 'accountant'),
  M('bloque', 'cd-pro'),
];
const U = (id: string, createdAt = '2026-01-01', disabled = false): AudienceUser => ({
  id,
  createdAt: new Date(createdAt),
  disabledAt: disabled ? new Date('2026-10-01') : null,
});
const USERS: AudienceUser[] = [
  U('a'),
  U('b', '2026-10-15'),
  U('c'),
  U('d'),
  U('e'),
  U('bloque', '2026-01-01', true),
  U('sans-organisation'),
];
const sel = (filter: Parameters<typeof selectAudience>[0]['filter']) =>
  selectAudience({ filter, organizations: ORGS, memberships: MEMBERSHIPS, users: USERS });

describe('catégories de destinataires (ADR-0053 § 6.6)', () => {
  it('filtre vide : tous les comptes actifs membres d’une organisation, sans bloqué ni doublon', () => {
    expect(isAllAudience({})).toBe(true);
    expect(sel({})).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('Propriétaires d’organisations `pro` au Congo — et personne d’autre', () => {
    expect(sel({ ownersOnly: true, plans: ['pro'], countries: ['CD'] })).toEqual(['a']);
  });

  it('par état d’abonnement, par rôle, par date d’inscription (ET)', () => {
    expect(sel({ subscriptionStatuses: ['trialing'] })).toEqual(['d', 'e']);
    expect(sel({ orgRoles: ['accountant'] })).toEqual(['e']);
    expect(sel({ signedUpAfter: '2026-10-01T00:00:00.000Z' })).toEqual(['b']);
    expect(sel({ signedUpBefore: '2026-10-01T00:00:00.000Z', countries: ['FR'] })).toEqual([
      'd',
      'e',
    ]);
  });

  it('Propriétaires ET rôles nommés : intersection', () => {
    expect(audienceRoles({ ownersOnly: true, orgRoles: ['viewer'] })).toEqual([]);
    expect(sel({ ownersOnly: true, orgRoles: ['viewer'] })).toEqual([]);
    expect(audienceRoles({})).toBeNull();
  });

  it('un rôle hors vocabulaire est signalé', () => {
    expect(unknownOrgRoles({ orgRoles: ['owner', 'pirate'] })).toEqual(['pirate']);
  });
});
