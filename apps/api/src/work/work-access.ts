// Visibilité des projets — règles pures (ADR-0060 § 3 et § 5).
//
// Un appelant voit un projet quand :
//
//   - son rôle est LIMITÉ AUX PROJETS DONT IL EST MEMBRE (`isProjectScopedRole`) :
//     seulement les projets dont il est responsable, membre direct ou membre d'une
//     équipe ajoutée — quelle que soit la visibilité ;
//   - sinon, il détient `organization.manage` (direction : Propriétaire, Administrateur)
//     → tous les projets de l'organisation ;
//   - sinon, le projet est `organization`, OU il en est responsable, membre direct ou
//     membre d'une équipe ajoutée.
//
// Ce fichier ne lit pas la base : `WorkAccessService` calcule la PORTÉE (ensemble
// autorisé ou ensemble refusé d'identifiants) et ces fonctions la traduisent en
// filtres Mongo. Tout point d'entrée de lecture applique la portée côté serveur ; un
// projet hors portée répond 404, comme un projet d'une autre organisation.

import { Types } from 'mongoose';

import { PROJECT_SCOPED_ROLES, SELF_ASSIGN_ONLY_ROLES } from '../authz/permissions.js';

/**
 * Rôle « limité aux projets dont il est membre » : `PROJECT_SCOPED_ROLES` d'ADR-0059
 * (aujourd'hui l'Invité externe, `guest`).
 */
export function isProjectScopedRole(role: string): boolean {
  return (PROJECT_SCOPED_ROLES as readonly string[]).includes(role);
}

/**
 * Rôle qui n'assigne une tâche qu'à lui-même : `SELF_ASSIGN_ONLY_ROLES` d'ADR-0066 § 2
 * (aujourd'hui le Stagiaire, `intern`). `undefined` (accès délégué) : non concerné.
 */
export function isSelfAssignOnlyRole(role: string | undefined): boolean {
  return role !== undefined && (SELF_ASSIGN_ONLY_ROLES as readonly string[]).includes(role);
}

/**
 * Portée d'un appelant :
 *   - `all`   : aucun filtre (direction) ;
 *   - `deny`  : tout sauf ces projets (projets privés dont il n'est pas membre) ;
 *   - `allow` : seulement ces projets (rôle limité aux projets dont il est membre).
 */
export type WorkProjectScope =
  | { kind: 'all' }
  | { kind: 'deny'; ids: readonly string[] }
  | { kind: 'allow'; ids: readonly string[] };

/** Libellé d'un projet privé hors portée, quand une ligne doit rester comptée. */
export const PRIVATE_PROJECT_LABEL = 'Projet privé';

export const ALL_PROJECTS: WorkProjectScope = { kind: 'all' };

/** Le projet est-il dans la portée ? */
export function inScope(scope: WorkProjectScope, projectId: string): boolean {
  if (scope.kind === 'all') return true;
  const has = scope.ids.includes(projectId.toLowerCase());
  return scope.kind === 'allow' ? has : !has;
}

/** Filtre sur `work_projects._id` (vide : aucune restriction). */
export function projectDocFilter(scope: WorkProjectScope): Record<string, unknown> {
  if (scope.kind === 'all') return {};
  const ids = scope.ids.map((id) => new Types.ObjectId(id));
  if (scope.kind === 'allow') return { _id: { $in: ids } };
  return ids.length === 0 ? {} : { _id: { $nin: ids } };
}

/**
 * Filtre sur un champ `projectId` en chaîne (tâches, commentaires, pièces, temps,
 * historique, notifications : `source.projectId`). Vide : aucune restriction.
 */
export function projectIdFilter(
  scope: WorkProjectScope,
  field = 'projectId',
): Record<string, unknown> {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'allow') return { [field]: { $in: [...scope.ids] } };
  return scope.ids.length === 0 ? {} : { [field]: { $nin: [...scope.ids] } };
}

/** Condition Mongo « l'utilisateur appartient au projet » (responsable, membre, équipe). */
export function membershipClauses(
  userId: string,
  teamIds: readonly string[],
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [{ ownerUserId: userId }, { memberUserIds: userId }];
  if (teamIds.length > 0) clauses.push({ memberTeamIds: { $in: [...teamIds] } });
  return clauses;
}
