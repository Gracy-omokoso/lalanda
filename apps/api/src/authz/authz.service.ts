// Résolution des rôles (S20a, ADR-0012). Le service ne DÉCIDE rien : il résout le
// rôle d'organisation, ses conditions, et les rôles plateforme d'un utilisateur.
// La décision appartient à `permissions.ts`; l'application, à `PermissionsGuard`.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import {
  APPROVER_ROLES,
  normalizeOrgRole,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
  type PlatformRole,
} from './permissions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from './platform-role-assignment.schema.js';

/** Rôle d'un principal dans une organisation, avec ses conditions (cases ⚙). */
export interface ResolvedOrgRole {
  role: OrgRole;
  context: OrgPermissionContext;
}

@Injectable()
export class AuthzService {
  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(PlatformRoleAssignment.name)
    private readonly platformRoles: Model<PlatformRoleAssignmentDocument>,
  ) {}

  /**
   * Rôle d'organisation d'un utilisateur et ses droits conditionnels, ou
   * `undefined` s'il n'est pas membre.
   *
   * Tolère les documents non encore migrés (`member`) : la migration
   * 20260808-0001 les réécrit, mais l'API ne doit pas s'effondrer si elle tourne
   * avant elle (compatibilité N-1, docs/24 règle 3).
   */
  async resolveOrgRole(
    userId: string,
    organizationId: string,
  ): Promise<ResolvedOrgRole | undefined> {
    const membership = await this.memberships
      .findOne({ userId, organizationId })
      .select({ role: 1, canClosePeriods: 1 })
      .lean()
      .exec();
    if (!membership) return undefined;
    const role = normalizeOrgRole(membership.role);
    if (role === undefined) return undefined;
    return { role, context: { canClosePeriods: membership.canClosePeriods === true } };
  }

  /** Raccourci lorsque seules les conditions n'importent pas. */
  async roleOf(userId: string, organizationId: string): Promise<OrgRole | undefined> {
    return (await this.resolveOrgRole(userId, organizationId))?.role;
  }

  /** Rôles plateforme actifs (non révoqués, non expirés) d'un utilisateur. */
  async platformRolesOf(userId: string): Promise<PlatformRole[]> {
    const now = new Date();
    const rows = await this.platformRoles
      .find({
        userId,
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .select({ role: 1 })
      .lean()
      .exec();
    return rows.map((r) => r.role);
  }

  /**
   * Nombre de propriétaires d'une organisation — socle de la règle R1
   * (« une organisation a en permanence au moins un `owner` »).
   *
   * Interroge directement le slug `owner`, sans passer par `normalizeOrgRole` :
   * `owner` a la même valeur avant et après la migration, et un ancien `member`
   * devient `finance_director`, jamais `owner`. Un comptage en base est donc
   * exact sur une base migrée comme sur une base qui ne l'est pas encore.
   */
  async countOwners(organizationId: string): Promise<number> {
    return this.memberships.countDocuments({ organizationId, role: 'owner' }).exec();
  }

  /**
   * Nombre de principaux détenant `plan.approve` dans une organisation — sert à
   * décider si une auto-approbation relève de l'échappatoire `soleApprover`
   * (R2, ADR-0012 §6) ou d'un refus `SELF_APPROVAL_FORBIDDEN`.
   */
  async countApprovers(organizationId: string): Promise<number> {
    return this.memberships
      .countDocuments({ organizationId, role: { $in: [...APPROVER_ROLES] } })
      .exec();
  }
}

/** Forme du refus renvoyée au client : `403 { code, action, role }` (docs/16). */
export interface ForbiddenPayload {
  code: 'FORBIDDEN';
  action: string;
  role: string | null;
  message: string;
}

export function forbidden(
  action: Action | string,
  role: OrgRole | string | null,
): ForbiddenPayload {
  return {
    code: 'FORBIDDEN',
    action: String(action),
    role: role === null ? null : String(role),
    message: `Action « ${String(action)} » refusée pour le rôle « ${role ?? 'aucun'} ».`,
  };
}
