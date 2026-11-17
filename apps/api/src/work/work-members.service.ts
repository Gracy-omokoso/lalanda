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

import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { WorkMemberRef, WorkProjectRole } from '@lalanda/shared/work';
import { Types, type Connection, type Model } from 'mongoose';

import {
  MEMBER_PERMISSIONS_PROJECTION,
  memberPermissionsOf,
  type MemberPermissions,
} from '../authz/authz.service.js';
import { can, type Action, type OrgRole } from '../authz/permissions.js';
import { MembersService } from '../organizations/members.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import {
  isLeadEligibleRole,
  seesProjectAudience,
  type WorkProjectAudience,
} from './work-access.js';
import { invalid, memberNotFound } from './work.common.js';

/** Membre de l'organisation et ce qu'il peut faire dans le module. */
export interface WorkMemberView extends WorkMemberRef {
  /** Peut être responsable d'une tâche (`work.update`). */
  canUpdate: boolean;
  /** Peut gérer les projets (`work.manage`). */
  canManage: boolean;
  /**
   * ADR-0066 § 3 : voit le projet demandé (`GET /work/members?projectId=`). Absent sans
   * projet. Un responsable doit voir le projet de sa tâche.
   */
  seesProject?: boolean;
  /** ADR-0076 § 1 : peut être Chef de projet ou Adjoint (interne, `work.update`). */
  canLead?: boolean;
  /** ADR-0076 § 1 : rôle dans le projet demandé (`?projectId=`). */
  projectRole?: WorkProjectRole;
}

const FORMER_MEMBER = 'Ancien membre';

@Injectable()
export class WorkMembersService {
  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Inject(MembersService) private readonly members: MembersService,
    // ADR-0078 : noms des comptes externes (contact client, consultant), lecture seule.
    @Optional() @InjectConnection() private readonly connection: Connection | null = null,
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

  /**
   * Noms courants (nom, à défaut e-mail) ; un inconnu devient « Ancien membre ».
   * ADR-0078 : avec `organizationId`, un identifiant inconnu des comptes internes est
   * cherché parmi les comptes externes DE CETTE organisation seulement.
   */
  async refs(
    userIds: readonly (string | null | undefined)[],
    organizationId?: string,
  ): Promise<Map<string, WorkMemberRef>> {
    const ids = [...new Set(userIds.filter((u): u is string => typeof u === 'string'))];
    const identities = await this.members.identitiesOf(ids);
    const out = new Map<string, WorkMemberRef>();
    const unknown: string[] = [];
    for (const id of ids) {
      const who = identities.get(id);
      if (!who) unknown.push(id);
      out.set(id, { userId: id, name: who?.name ?? who?.email ?? FORMER_MEMBER });
    }
    // ADR-0078 : un identifiant inconnu des comptes internes peut être un compte externe.
    if (organizationId) {
      for (const [id, ext] of await this.externalNames(organizationId, unknown)) out.set(id, ext);
    }
    return out;
  }

  /** Noms des comptes externes (`work_external_accounts`) parmi ces identifiants. */
  private async externalNames(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, WorkMemberRef>> {
    const valid = ids.filter((id) => /^[0-9a-f]{24}$/i.test(id));
    if (valid.length === 0 || !this.connection) return new Map();
    const docs = await this.connection
      .collection('work_external_accounts')
      .find(
        { organizationId, _id: { $in: valid.map((id) => new Types.ObjectId(id)) } },
        { projection: { name: 1, kind: 1 } },
      )
      .toArray();
    return new Map(
      docs.map((d) => {
        const id = String(d['_id']);
        const kind = d['kind'] === 'consultant' ? 'consultant' : 'client';
        return [id, { userId: id, name: String(d['name'] ?? FORMER_MEMBER), external: kind }];
      }),
    );
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

  /**
   * ADR-0076 § 1 : Chef de projet ou Adjoint — membre (404 sinon), `work.update` et rôle
   * interne (ni Invité externe, ni Stagiaire) ; sinon 400 `WORK_PROJECT_LEAD_NOT_ELIGIBLE`.
   */
  async requireLeadEligible(organizationId: string, userId: string, path: string): Promise<void> {
    const m = await this.permissionsOf(organizationId, userId);
    if (m === undefined) memberNotFound();
    if (!can(m.role, 'work.update', m.context) || !isLeadEligibleRole(m.role)) {
      invalid(
        path,
        'WORK_PROJECT_LEAD_NOT_ELIGIBLE',
        'Un chef de projet ou un adjoint est un membre interne qui peut modifier les tâches (ni Invité externe, ni Stagiaire).',
      );
    }
  }

  /** Vérifie l'appartenance seule (404 sinon). */
  async requireMember(organizationId: string, userId: string): Promise<OrgRole> {
    const role = await this.roleOf(organizationId, userId);
    if (role === undefined) memberNotFound();
    return role;
  }

  /** Membres détenant `work.read` (sélecteurs de responsable et mentions). */
  async list(organizationId: string, audience?: WorkProjectAudience): Promise<WorkMemberView[]> {
    const members = await this.permissions(organizationId);
    const readers = [...members].filter(([, m]) => can(m.role, 'work.read', m.context));
    const refs = await this.refs(readers.map(([id]) => id));
    return readers
      .map(([id, m]) => ({
        ...WorkMembersService.refOf(refs, id),
        canUpdate: can(m.role, 'work.update', m.context),
        canManage: can(m.role, 'work.manage', m.context),
        canLead: can(m.role, 'work.update', m.context) && isLeadEligibleRole(m.role),
        ...(audience
          ? {
              seesProject: seesProjectAudience(
                { userId: id, role: m.role, context: m.context },
                audience,
              ),
              projectRole: audience.roles?.get(id) ?? ('none' as const),
            }
          : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
