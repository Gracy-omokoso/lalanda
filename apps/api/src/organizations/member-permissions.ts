// ADR-0041 — A4 : outils communs aux routes qui ÉCRIVENT un écart (membres et
// invitations). La DÉCISION reste dans `authz/permissions.ts` (`validateOverrides`) ;
// ce fichier traduit ses refus en réponses HTTP, lit l'écart STOCKÉ (pour l'audit) et
// exécute une écriture dans une transaction.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type HttpException,
} from '@nestjs/common';
import type { ClientSession, Connection } from 'mongoose';

import { memberPermissionsEnabled, overridesOf } from '../authz/authz.service.js';
import {
  ACTIONS,
  effectiveActions,
  type Action,
  type OrgRole,
  type OverrideViolation,
} from '../authz/permissions.js';

/** État des autorisations d'un membre, tel que journalisé (G7 : `before` et `after`). */
export interface PermissionsState {
  role: OrgRole;
  grants: Action[];
  revokes: Action[];
  canClosePeriods: boolean;
  effective: Action[];
  // Signature d'index : la forme est une valeur de métadonnée d'audit.
  [key: string]: string | boolean | string[];
}

/**
 * Écart STOCKÉ d'une appartenance ou d'une invitation, que l'interrupteur soit
 * allumé ou non. L'audit décrit ce qui est en base ; la DÉCISION, elle, lit
 * `overridesOf()` (qui rend un écart vide interrupteur éteint).
 */
export function storedOverridesOf(doc: { grants?: unknown; revokes?: unknown } | null): {
  grants: Action[];
  revokes: Action[];
} {
  const raw = overridesOf(doc, { MEMBER_PERMISSIONS_ENABLED: 'true' } as NodeJS.ProcessEnv);
  return { grants: sortActions(raw.grants), revokes: sortActions(raw.revokes) };
}

export function sortActions(actions: Iterable<Action>): Action[] {
  const set = new Set(actions);
  return ACTIONS.filter((a) => set.has(a));
}

export function revisionOf(doc: { permissionsRevision?: unknown }): number {
  return typeof doc.permissionsRevision === 'number' ? doc.permissionsRevision : 0;
}

/** Filtre Mongo « la révision vaut encore `expected` » (absente = 0, aucune migration). */
export function revisionFilter(expected: number): Record<string, unknown> {
  return expected === 0
    ? { $or: [{ permissionsRevision: 0 }, { permissionsRevision: { $exists: false } }] }
    : { permissionsRevision: expected };
}

export function stateOf(input: {
  role: OrgRole;
  grants: readonly Action[];
  revokes: readonly Action[];
  canClosePeriods: boolean;
}): PermissionsState {
  const grants = sortActions(input.grants);
  const revokes = sortActions(input.revokes);
  return {
    role: input.role,
    grants,
    revokes,
    canClosePeriods: input.canClosePeriods,
    effective: effectiveActions(input.role, {
      canClosePeriods: input.canClosePeriods,
      grants,
      revokes,
    }),
  };
}

export function sameState(a: PermissionsState, b: PermissionsState): boolean {
  return (
    a.role === b.role &&
    a.canClosePeriods === b.canClosePeriods &&
    a.grants.join(',') === b.grants.join(',') &&
    a.revokes.join(',') === b.revokes.join(',')
  );
}

/**
 * Interrupteur éteint : toute écriture d'un écart NON VIDE est refusée
 * explicitement (ADR-0041 § 9.1 — l'écriture reste derrière l'interrupteur tant
 * que toutes les instances et le lot A3 ne lisent pas les écarts). Un écart vide
 * reste accepté : il ne change rien à ce que l'application décide.
 */
export function assertPermissionsWritable(
  grants: readonly Action[],
  revokes: readonly Action[],
): void {
  if (memberPermissionsEnabled()) return;
  if (grants.length === 0 && revokes.length === 0) return;
  throw permissionsDisabled();
}

export function permissionsDisabled(): ConflictException {
  return new ConflictException({
    code: 'MEMBER_PERMISSIONS_DISABLED',
    message:
      "La personnalisation des autorisations n'est pas encore activée sur cette instance. " +
      'Seul le titre peut être attribué.',
  });
}

export function staleRevision(current: number): ConflictException {
  return new ConflictException({
    code: 'STALE_REVISION',
    currentRevision: current,
    message: 'Les autorisations de ce membre ont été modifiées entre-temps. Rechargez sa fiche.',
  });
}

/** Refus typé de `validateOverrides` → réponse HTTP (codes d'ADR-0041 § 6). */
export function overrideViolationToHttp(v: OverrideViolation): HttpException {
  switch (v.code) {
    case 'SELF_PERMISSIONS_FORBIDDEN':
      return new ForbiddenException({
        code: v.code,
        message: 'Vous ne pouvez pas modifier vos propres autorisations.',
      });
    case 'OWNER_PERMISSIONS_FIXED':
      return new ConflictException({
        code: v.code,
        message: "Les autorisations d'un Propriétaire ne se personnalisent pas.",
      });
    case 'PERMISSION_NOT_DELEGABLE':
      return new BadRequestException({
        code: v.code,
        actions: v.actions,
        message: 'Autorisation réservée au Propriétaire.',
      });
    case 'PERMISSION_OVERRIDE_REDUNDANT':
      return new BadRequestException({
        code: v.code,
        actions: v.actions,
        message: 'Ajout ou retrait sans objet par rapport au titre.',
      });
    case 'PERMISSION_ESCALATION':
      return new ForbiddenException({
        code: v.code,
        actions: v.actions,
        message: 'Vous ne pouvez accorder ni modifier que des autorisations que vous détenez.',
      });
    case 'SOD_CONFLICT':
      return new ConflictException({
        code: v.code,
        pair: v.pair,
        message: 'Ces deux autorisations sont incompatibles (séparation des tâches).',
      });
    case 'PERMISSION_DEPENDENCY_MISSING':
      return new BadRequestException({
        code: v.code,
        action: v.action,
        missing: v.missing,
        message: 'Une autorisation exige une autre autorisation absente.',
      });
  }
}

/**
 * Transaction Mongoose, avec le même repli que `MembersService` historiquement :
 * sur un `mongod` autonome (poste de développement), l'écriture s'exécute sans
 * transaction. La production (Atlas) et la CI (replica set) en ont une.
 */
export async function inTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  let session: ClientSession;
  try {
    session = await connection.startSession();
  } catch {
    return fn(undefined);
  }
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (isTransactionUnsupported(err)) return fn(undefined);
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Topologie sans replica set. MongoDB renvoie `IllegalOperation` (20) avec un
 * message explicite; le driver peut aussi lever `MongoServerError` sans code
 * exploitable. On teste donc le message.
 */
function isTransactionUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Transaction numbers are only allowed on a replica set') ||
    message.includes('Transactions are not supported') ||
    message.includes('does not support transactions')
  );
}
