// Résolution des rôles (S20a). Le service ne décide rien : il RÉSOUT le rôle
// d'organisation et les rôles plateforme d'un utilisateur. La décision est prise
// par `permissions.ts` (matrice) et appliquée par `PermissionsGuard`.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import {
  isOrgRole,
  normalizeOrgRole,
  type Action,
  type OrgRole,
  type PlatformRole,
} from './permissions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from './platform-role-assignment.schema.js';

@Injectable()
export class AuthzService {
  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(PlatformRoleAssignment.name)
    private readonly platformRoles: Model<PlatformRoleAssignmentDocument>,
  ) {}

  /**
   * Rôle d'organisation d'un utilisateur, ou `undefined` s'il n'est pas membre.
   *
   * Tolère les documents non encore migrés (`owner` / `member`) : la migration
   * 20260808-0001 les réécrit, mais l'API ne doit pas s'effondrer si elle tourne
   * avant elle (compatibilité N-1, docs/24 règle 3).
   */
  async roleOf(userId: string, organizationId: string): Promise<OrgRole | undefined> {
    const membership = await this.memberships
      .findOne({ userId, organizationId })
      .select({ role: 1 })
      .lean()
      .exec();
    if (!membership) return undefined;
    return normalizeOrgRole(membership.role);
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

  /** Nombre de `proprietaire` d'une organisation — socle de la règle du dernier propriétaire. */
  async countOwners(organizationId: string): Promise<number> {
    return this.memberships
      .countDocuments({ organizationId, role: { $in: ['proprietaire', 'owner'] } })
      .exec();
  }
}

/** Forme du refus renvoyée au client : `403 { code, action, role }` (docs/12 → S20a). */
export interface ForbiddenPayload {
  code: 'FORBIDDEN';
  action: string;
  role: string | null;
  message: string;
}

export function forbidden(action: Action | string, role: OrgRole | string | null): ForbiddenPayload {
  return {
    code: 'FORBIDDEN',
    action: String(action),
    role: role === null ? null : String(role),
    message: `Action « ${String(action)} » refusée pour le rôle « ${role ?? 'aucun'} ».`,
  };
}

/** Ré-export utilitaire pour les gardes et contrôleurs. */
export { isOrgRole };
