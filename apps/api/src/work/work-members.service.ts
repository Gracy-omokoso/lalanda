// Membres de l'organisation vus par le module « work » — ADR-0039 § 2.
//
// Éligibilité d'une personne à un rôle du module (responsable, abonné,
// mentionné, propriétaire de projet) : membre de l'organisation ET détenteur de
// l'action requise, vérifiée par `can(rôle, action, contexte)` (jamais par un nom
// de rôle). ADR-0041 § 9.4 (A3) : le contexte porte l'écart du membre — un ajout
// rend éligible, un retrait rend inéligible.
//
//   - pas membre de l'organisation (autre organisation, identifiant forgé) → 404 ;
//   - membre, mais sans l'action → 400 avec le code métier de la règle.

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { WorkMemberRef } from '@lalanda/shared/work';
import type { Model } from 'mongoose';

import {
  MEMBER_PERMISSIONS_PROJECTION,
  memberPermissionsOf,
  type MemberPermissions,
} from '../authz/authz.service.js';
import { can, type Action, type OrgRole } from '../authz/permissions.js';
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

  /**
   * Titre et contexte effectif (droit de clôture, ajouts, retraits — ADR-0041) des
   * membres de l'organisation, par utilisateur.
   */
  async permissions(
    organizationId: string,
    userIds?: readonly string[],
  ): Promise<Map<string, MemberPermissions>> {
    const filter: Record<string, unknown> = { organizationId };
    if (userIds) filter['userId'] = { $in: [...new Set(userIds)] };
    const docs = await this.memberships
      .find(filter, { userId: 1, ...MEMBER_PERMISSIONS_PROJECTION })
      .lean()
      .exec();
    const out = new Map<string, MemberPermissions>();
    for (const d of docs) {
      const permissions = memberPermissionsOf(d);
      if (permissions) out.set(d.userId, permissions);
    }
    return out;
  }

  /** Titre et contexte d'un membre, ou `undefined` s'il n'est pas (ou plus) membre. */
  async permissionsOf(
    organizationId: string,
    userId: string,
  ): Promise<MemberPermissions | undefined> {
    return (await this.permissions(organizationId, [userId])).get(userId);
  }

  /** Rôle (titre) d'un membre, ou `undefined` s'il n'est pas (ou plus) membre. */
  async roleOf(organizationId: string, userId: string): Promise<OrgRole | undefined> {
    return (await this.permissionsOf(organizationId, userId))?.role;
  }

  /** Vrai si l'utilisateur est membre et détient EFFECTIVEMENT `action`. */
  async holds(organizationId: string, userId: string, action: Action): Promise<boolean> {
    const m = await this.permissionsOf(organizationId, userId);
    return m !== undefined && can(m.role, action, m.context);
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
    const members = await this.permissions(organizationId, userIds);
    for (const id of userIds) {
      const m = members.get(id);
      if (m === undefined) memberNotFound();
      if (!can(m.role, action, m.context)) {
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
    const members = await this.permissions(organizationId);
    const readers = [...members].filter(([, m]) => can(m.role, 'work.read', m.context));
    const refs = await this.refs(readers.map(([id]) => id));
    return readers
      .map(([id, m]) => ({
        ...WorkMembersService.refOf(refs, id),
        canUpdate: can(m.role, 'work.update', m.context),
        canManage: can(m.role, 'work.manage', m.context),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
