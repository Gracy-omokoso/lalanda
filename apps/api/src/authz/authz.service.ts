// Résolution des rôles (S20a, ADR-0012). Le service ne DÉCIDE rien : il résout le
// rôle d'organisation, ses conditions, et les rôles plateforme d'un utilisateur.
// La décision appartient à `permissions.ts`; l'application, à `PermissionsGuard`.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import {
  ORG_ROLES,
  ORG_PERMISSION_MATRIX,
  isAction,
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
  /**
   * Conditions et écart du membre (ADR-0041) : `canClosePeriods`, `grants`, `revokes`.
   * Toute décision sur ce membre passe par ce contexte, jamais par le rôle seul.
   */
  context: OrgPermissionContext;
  /**
   * ADR-0041 G8 — révision des autorisations de l'appartenance (0 si absente).
   * **Règle** : tout cache futur de permissions DOIT porter cette révision dans sa
   * clé ; aujourd'hui il n'en existe aucun, le guard relit l'appartenance à chaque
   * requête (testé dans `authz.service.test.ts`).
   */
  permissionsRevision: number;
}

/** Écart d'un membre ou d'une invitation par rapport à son titre (ADR-0041 § 1). */
export interface MemberOverrides {
  grants: Action[];
  revokes: Action[];
}

/**
 * ADR-0041 § 9.1 — interrupteur `MEMBER_PERMISSIONS_ENABLED`, ÉTEINT par défaut.
 *
 * L'ADR l'allume seulement quand toutes les instances lisent les écarts ET que le
 * lot A3 (appelants qui décident encore par rôle) est fusionné. Tant qu'il est
 * éteint, la lecture elle-même traite tout écart stocké comme vide : sinon le guard
 * appliquerait un retrait que les décisions par rôle d'A3 ignoreraient encore — un
 * état incohérent. Éteint, l'application se comporte exactement comme avant ADR-0041.
 *
 * Lu à chaque appel (pas de mémoïsation) : les tests l'allument et l'éteignent.
 */
export function memberPermissionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['MEMBER_PERMISSIONS_ENABLED'] === 'true';
}

const NO_MEMBER_OVERRIDES: Readonly<MemberOverrides> = Object.freeze({ grants: [], revokes: [] });

function cleanActions(value: unknown): Action[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isAction))];
}

/**
 * ADR-0041 § 9.1 — l'unique lecture de l'écart d'une appartenance ou d'une invitation.
 *
 * Les lectures `.lean()` n'appliquent pas les valeurs par défaut du schéma : un
 * document antérieur à ADR-0041 n'a ni `grants` ni `revokes`, et vaut exactement son
 * titre (aucune migration). Une valeur inconnue (action retirée du vocabulaire) est
 * ignorée plutôt que de faire échouer la requête. Interrupteur éteint : écart vide.
 */
export function overridesOf(
  doc: { grants?: unknown; revokes?: unknown } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MemberOverrides {
  if (!doc || !memberPermissionsEnabled(env)) {
    return { grants: [...NO_MEMBER_OVERRIDES.grants], revokes: [...NO_MEMBER_OVERRIDES.revokes] };
  }
  return { grants: cleanActions(doc.grants), revokes: cleanActions(doc.revokes) };
}

/**
 * Filtre Mongo des appartenances qui DÉTIENNENT effectivement `action` dans une
 * organisation (ADR-0041 § 9.3) : rôle qui l'a (case non `deny`) sans retrait, ou
 * ajout. Une case ⚙ (`conditional`) n'est détenue qu'avec `canClosePeriods`.
 * Interrupteur éteint : par rôle seulement, comme avant.
 */
export function holdersFilter(
  organizationId: string,
  action: Action,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const native = ORG_ROLES.filter((r) => {
    const cell = ORG_PERMISSION_MATRIX[r][action];
    return cell !== 'deny' && cell !== 'conditional';
  });
  const conditional = ORG_ROLES.filter((r) => ORG_PERMISSION_MATRIX[r][action] === 'conditional');
  const byRole: Record<string, unknown>[] = [];
  if (native.length > 0) byRole.push({ role: { $in: native } });
  if (conditional.length > 0) byRole.push({ role: { $in: conditional }, canClosePeriods: true });

  if (!memberPermissionsEnabled(env)) {
    return { organizationId, $or: byRole.length > 0 ? byRole : [{ _id: null }] };
  }
  return {
    organizationId,
    $or: [...byRole.map((f) => ({ ...f, revokes: { $ne: action } })), { grants: action }],
  };
}

/**
 * ADR-0041 § 9.4 (A3) — projection minimale d'une appartenance pour décider de ses
 * droits EFFECTIFS hors requête (destinataires, éligibilité, tâches planifiées).
 */
export const MEMBER_PERMISSIONS_PROJECTION = Object.freeze({
  role: 1,
  canClosePeriods: 1,
  grants: 1,
  revokes: 1,
} as const);

/** Titre et contexte (droit de clôture, ajouts, retraits) d'un membre. */
export interface MemberPermissions {
  role: OrgRole;
  context: OrgPermissionContext;
}

/**
 * ADR-0041 § 9.4 (A3) — titre et contexte effectif d'une appartenance lue en base
 * (`.lean()` accepté), ou `undefined` si absente ou de rôle inconnu. Même calcul que
 * `resolveOrgRole` (qui s'appuie dessus) : écart vide, contexte identique à celui
 * d'avant ADR-0041 ; interrupteur éteint, l'écart stocké est ignoré (`overridesOf`).
 */
export function memberPermissionsOf(
  doc:
    | { role?: unknown; canClosePeriods?: unknown; grants?: unknown; revokes?: unknown }
    | null
    | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MemberPermissions | undefined {
  if (!doc) return undefined;
  const role = normalizeOrgRole(doc.role);
  if (role === undefined) return undefined;
  const { grants, revokes } = overridesOf(doc, env);
  const context: OrgPermissionContext = { canClosePeriods: doc.canClosePeriods === true };
  // Écart vide : contexte identique à celui d'avant ADR-0041 (aucune clé de plus).
  if (grants.length > 0) context.grants = grants;
  if (revokes.length > 0) context.revokes = revokes;
  return { role, context };
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
      .select({ role: 1, canClosePeriods: 1, grants: 1, revokes: 1, permissionsRevision: 1 })
      .lean()
      .exec();
    const permissions = memberPermissionsOf(membership);
    if (!membership || !permissions) return undefined;
    const { role, context } = permissions;
    const revision = (membership as { permissionsRevision?: unknown }).permissionsRevision;
    return {
      role,
      context,
      permissionsRevision: typeof revision === 'number' ? revision : 0,
    };
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
   * Nombre de principaux détenant EFFECTIVEMENT `plan.approve` dans une organisation
   * — sert à décider si une auto-approbation relève de l'échappatoire `soleApprover`
   * (R2, ADR-0012 §6) ou d'un refus `SELF_APPROVAL_FORBIDDEN`.
   *
   * ADR-0041 G4 : détenteurs effectifs (rôle approbateur sans retrait, ou ajout),
   * plus les rôles seuls — sinon un Directeur financier privé de `plan.approve`
   * bloquerait à tort l'auto-approbation marquée du Propriétaire, et un Lecteur
   * ayant reçu `plan.approve` ne fermerait pas l'échappatoire.
   */
  async countApprovers(organizationId: string): Promise<number> {
    // `APPROVER_ROLES` (lignes non `deny`) et `holdersFilter` (cases `allow*`) désignent
    // les mêmes rôles : `plan.approve` n'a aucune case ⚙. Vérifié par le test unitaire.
    return this.memberships.countDocuments(holdersFilter(organizationId, 'plan.approve')).exec();
  }

  /**
   * ADR-0041 § 9.3 — identifiants des utilisateurs qui détiennent effectivement
   * `action` dans l'organisation. Pour tout destinataire « qui détient X » (alertes,
   * notifications) : jamais une recherche par rôle.
   */
  async holdersOf(organizationId: string, action: Action): Promise<string[]> {
    const rows = await this.memberships
      .find(holdersFilter(organizationId, action))
      .select({ userId: 1 })
      .lean()
      .exec();
    return rows.map((r) => r.userId);
  }
}

/**
 * Forme du refus renvoyée au client : `403 { code, action, role, customized }`
 * (docs/16, ADR-0041 § 6). `action` nomme l'action manquante ; `customized` vaut
 * `true` quand le refus vient d'un RETRAIT propre à ce membre, pour que l'écran dise
 * « autorisation retirée à votre compte » plutôt que « votre rôle ne le permet pas ».
 */
export interface ForbiddenPayload {
  code: 'FORBIDDEN';
  action: string;
  role: string | null;
  customized: boolean;
  message: string;
}

export function forbidden(
  action: Action | string,
  role: OrgRole | string | null,
  customized = false,
): ForbiddenPayload {
  return {
    code: 'FORBIDDEN',
    action: String(action),
    role: role === null ? null : String(role),
    customized,
    message: customized
      ? `Autorisation « ${String(action)} » retirée à votre compte.`
      : `Action « ${String(action)} » refusée pour le rôle « ${role ?? 'aucun'} ».`,
  };
}
