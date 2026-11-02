// ─────────────────────────────────────────────────────────────────────────────
// CATÉGORIES DE DESTINATAIRES D'UNE ANNONCE (ADR-0053 § 6.6 — lot P6)
//
// Fonctions PURES : elles reçoivent des métadonnées déjà lues (organisations, offre et
// état d'abonnement, appartenances, comptes) et rendent l'ensemble des personnes visées.
// Aucune ne lit le contenu d'une organisation. Critères combinés en ET ; un filtre vide
// vaut « tous les comptes actifs » (non bloqués, membres d'au moins une organisation).
// ─────────────────────────────────────────────────────────────────────────────

import type { AudienceFilter } from '@lalanda/shared/platform';

import { isOrgRole } from '../../authz/permissions.js';

export interface AudienceOrganization {
  id: string;
  pays: string;
  /** Offre EFFECTIVE (octroi compris) ; `free` sans abonnement. */
  plan: string;
  /** État d'abonnement ; `canceled` sans abonnement (comme `BillingService`). */
  status: string;
}

export interface AudienceMembership {
  userId: string;
  organizationId: string;
  role: string;
}

export interface AudienceUser {
  id: string;
  createdAt: Date | null;
  disabledAt: Date | null;
}

/** Le filtre ne vise-t-il aucune catégorie (« tous les comptes actifs ») ? */
export function isAllAudience(filter: AudienceFilter): boolean {
  return Object.values(filter).every((v) => v === undefined);
}

/** Le filtre porte-t-il un critère d'ORGANISATION (offre, état, pays) ? */
export function hasOrganizationCriteria(filter: AudienceFilter): boolean {
  return Boolean(filter.plans || filter.subscriptionStatuses || filter.countries);
}

/** Rôles d'organisation inconnus du vocabulaire (le schéma partagé ne juge que la forme). */
export function unknownOrgRoles(filter: AudienceFilter): string[] {
  return (filter.orgRoles ?? []).filter((r) => !isOrgRole(r));
}

/** Rôles retenus : Propriétaires seulement, rôles nommés, ou leur intersection. `null` = tous. */
export function audienceRoles(filter: AudienceFilter): string[] | null {
  if (filter.ownersOnly && filter.orgRoles) return filter.orgRoles.filter((r) => r === 'owner');
  if (filter.ownersOnly) return ['owner'];
  return filter.orgRoles ?? null;
}

export function organizationMatches(org: AudienceOrganization, filter: AudienceFilter): boolean {
  if (filter.countries && !filter.countries.includes(org.pays.toUpperCase())) return false;
  if (filter.plans && !(filter.plans as readonly string[]).includes(org.plan)) return false;
  if (
    filter.subscriptionStatuses &&
    !(filter.subscriptionStatuses as readonly string[]).includes(org.status)
  ) {
    return false;
  }
  return true;
}

export function userMatches(user: AudienceUser, filter: AudienceFilter): boolean {
  if (user.disabledAt !== null) return false;
  if (filter.signedUpAfter || filter.signedUpBefore) {
    if (user.createdAt === null) return false;
    const t = user.createdAt.getTime();
    if (filter.signedUpAfter && t < new Date(filter.signedUpAfter).getTime()) return false;
    if (filter.signedUpBefore && t >= new Date(filter.signedUpBefore).getTime()) return false;
  }
  return true;
}

/**
 * Personnes visées, triées et sans doublon. Une personne membre de plusieurs
 * organisations visées n'est comptée qu'une fois ; une personne inconnue de `users`
 * (compte supprimé) est écartée.
 */
export function selectAudience(input: {
  filter: AudienceFilter;
  organizations: readonly AudienceOrganization[];
  memberships: readonly AudienceMembership[];
  users: readonly AudienceUser[];
}): string[] {
  const { filter } = input;
  const orgs = new Set(
    input.organizations.filter((o) => organizationMatches(o, filter)).map((o) => o.id),
  );
  const roles = audienceRoles(filter);
  const candidates = new Set(
    input.memberships
      .filter((m) => orgs.has(m.organizationId))
      .filter((m) => roles === null || roles.includes(m.role))
      .map((m) => m.userId),
  );
  return input.users
    .filter((u) => candidates.has(u.id) && userMatches(u, filter))
    .map((u) => u.id)
    .filter((id, i, all) => all.indexOf(id) === i)
    .sort();
}
