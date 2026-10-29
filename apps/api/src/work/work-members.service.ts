// Membres de l'organisation vus par le module « work » — ADR-0039 § 2.
//
// Éligibilité d'une personne à un rôle du module (responsable, abonné,
// mentionné, propriétaire de projet) : membre de l'organisation ET détenteur de
// l'action requise, vérifiée par `can(rôle, action)` (jamais par un nom de rôle).
//
//   - pas membre de l'organisation (autre organisation, identifiant forgé) → 404 ;
//   - membre, mais sans l'action → 400 avec le code métier de la règle.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { WorkMemberRef } from '@lalanda/shared/work';
import type { Model } from 'mongoose';

import {
  can,
  NO_OVERRIDES,
  normalizeOrgRole,
  type Action,
  type OrgRole,
} from '../authz/permissions.js';
import { MembersService } from '../organizations/members.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { invalid, memberNotFound } from './work.common.js';

/** Membre de l'organisation et ce qu'il peut faire dans le module. */
export interface WorkMemberView extends WorkMemberRef {
  /** Peut être responsable d'une tâche (`work.update`). */
  canUpdate: boolean;
  /** Peut gérer les projets (`work.manage`). */
  canManage: boolean;
}

const FORMER_MEMBER = 'Ancien membre';

@Injectable()
export class WorkMembersService {
  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  /** Rôles des membres de l'organisation, par utilisateur. */
  async roles(organizationId: string, userIds?: readonly string[]): Promise<Map<string, OrgRole>> {
    const filter: Record<string, unknown> = { organizationId };
    if (userIds) filter['userId'] = { $in: [...new Set(userIds)] };
    const docs = await this.memberships.find(filter, { userId: 1, role: 1 }).lean().exec();
    const out = new Map<string, OrgRole>();
    for (const d of docs) {
      const role = normalizeOrgRole(d.role);
      if (role) out.set(d.userId, role);
    }
    return out;
  }

  /** Rôle d'un membre, ou `undefined` s'il n'est pas (ou plus) membre. */
  async roleOf(organizationId: string, userId: string): Promise<OrgRole | undefined> {
    return (await this.roles(organizationId, [userId])).get(userId);
  }

  /** Vrai si l'utilisateur est membre et détient `action`. */
  async holds(organizationId: string, userId: string, action: Action): Promise<boolean> {
    const role = await this.roleOf(organizationId, userId);
    return role !== undefined && can(role, action, NO_OVERRIDES);
  }

  /** Noms courants (nom, à défaut e-mail) ; un inconnu devient « Ancien membre ». */
  async refs(userIds: readonly (string | null | undefined)[]): Promise<Map<string, WorkMemberRef>> {
    const ids = [...new Set(userIds.filter((u): u is string => typeof u === 'string'))];
    const identities = await this.members.identitiesOf(ids);
    const out = new Map<string, WorkMemberRef>();
    for (const id of ids) {
      const who = identities.get(id);
      out.set(id, { userId: id, name: who?.name ?? who?.email ?? FORMER_MEMBER });
    }
    return out;
  }

  /** Référence d'un utilisateur (toujours définie). */
  static refOf(refs: Map<string, WorkMemberRef>, id: string): WorkMemberRef {
    return refs.get(id) ?? { userId: id, name: FORMER_MEMBER };
  }

  /**
   * Vérifie que chaque utilisateur est membre (404 sinon) et détient `action`
   * (400 `code` sinon). `path` nomme le champ fautif.
   */
  async requireEligible(
    organizationId: string,
    userIds: readonly string[],
    action: Action,
    code: string,
    path: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const roles = await this.roles(organizationId, userIds);
    for (const id of userIds) {
      const role = roles.get(id);
      if (role === undefined) memberNotFound();
      if (!can(role, action, NO_OVERRIDES)) {
        invalid(path, code, 'Ce membre ne détient pas les droits requis pour ce rôle.');
      }
    }
  }

  /** Vérifie l'appartenance seule (404 sinon). */
  async requireMember(organizationId: string, userId: string): Promise<OrgRole> {
    const role = await this.roleOf(organizationId, userId);
    if (role === undefined) memberNotFound();
    return role;
  }

  /** Membres détenant `work.read` (sélecteurs de responsable et mentions). */
  async list(organizationId: string): Promise<WorkMemberView[]> {
    const roles = await this.roles(organizationId);
    const readers = [...roles].filter(([, r]) => can(r, 'work.read', NO_OVERRIDES));
    const refs = await this.refs(readers.map(([id]) => id));
    return readers
      .map(([id, role]) => ({
        ...WorkMembersService.refOf(refs, id),
        canUpdate: can(role, 'work.update', NO_OVERRIDES),
        canManage: can(role, 'work.manage', NO_OVERRIDES),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
