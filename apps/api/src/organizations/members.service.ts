// Gestion des membres d'une organisation (S20a, ADR-0012 §6 R1 et R7).
//
// Deux invariants sont défendus ici, et nulle part ailleurs :
//
//   R1 — une organisation a EN PERMANENCE au moins un `owner`;
//   R7 — personne n'attribue un rôle plus puissant que le sien.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import { memberPermissionsEnabled, overridesOf } from '../authz/authz.service.js';
import {
  canGrantRole,
  effectiveActions,
  isAssignableRole,
  normalizeOrgRole,
  potentialEffectiveActions,
  validateOverrides,
  type Action,
  type OrgPermissionContext,
  type OrgRole,
} from '../authz/permissions.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';
import {
  assertPermissionsWritable,
  inTransaction,
  overrideViolationToHttp,
  permissionsDisabled,
  revisionFilter,
  revisionOf,
  sameState,
  sortActions,
  staleRevision,
  stateOf,
  storedOverridesOf,
  type PermissionsState,
} from './member-permissions.js';
import {
  MEMBERSHIP_SCHEMA_VERSION,
  Membership,
  type MembershipDocument,
} from './membership.schema.js';

export interface MemberRow {
  userId: string;
  role: OrgRole;
  canClosePeriods: boolean;
  acceptedAt: Date | null;
  /** ADR-0041 § 6 — ajouts (vides interrupteur éteint : ce que la garde applique). */
  grants: Action[];
  /** ADR-0041 § 6 — retraits. */
  revokes: Action[];
  /** ADR-0041 § 6 — droits effectifs. */
  effective: Action[];
  /** ADR-0041 G8 — révision des autorisations. */
  permissionsRevision: number;
}

/** Identité affichable d'un membre — hors membership, donc toujours faillible. */
export interface MemberIdentity {
  email: string | null;
  name: string | null;
}

/** Droits de l'acteur tels que résolus par `PermissionsGuard` (ADR-0041 § 9.3). */
export interface ActorPermissions {
  role: OrgRole;
  context: OrgPermissionContext;
}

/**
 * ADR-0041 G1 — l'acteur peut-il agir sur ce membre ? Interrupteur allumé :
 * l'ensemble potentiel de la cible (case ⚙ comptée) est inclus dans les droits
 * effectifs de l'acteur. Éteint : R7 par titre, comme avant.
 */
export function canManageMember(
  actor: ActorPermissions,
  target: { role: OrgRole; context: OrgPermissionContext },
): boolean {
  if (!memberPermissionsEnabled()) return canGrantRole(actor.role, target.role);
  const held = new Set(effectiveActions(actor.role, actor.context));
  return potentialEffectiveActions(target.role, target.context).every((a) => held.has(a));
}

/** Titre de la notification « Vos autorisations ont changé » (décision ouverte n° 10). */
export const PERMISSIONS_CHANGED_TITLE = 'Vos autorisations ont changé';

@Injectable()
export class MembersService {
  private readonly logger = new Logger('Members');
  private readonly notifications: NotificationsPort;

  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null = null,
  ) {
    this.notifications = port ?? noNotifications;
  }

  async list(organizationId: string): Promise<MemberRow[]> {
    const docs = await this.memberships.find({ organizationId }).sort({ createdAt: 1 }).exec();
    return docs.map((d) => this.rowOf(d));
  }

  /**
   * Change le rôle d'un membre — et, ADR-0041 § 3, EFFACE son écart (décision
   * ouverte n° 1). Le même appel peut porter un nouvel écart, validé contre le
   * nouveau titre et écrit atomiquement.
   *
   * Ordre des contrôles, du moins coûteux au plus coûteux, et surtout du plus
   * général au plus spécifique :
   *   1. le rôle cible est-il attribuable en S20a ? (`project_manager` ne l'est pas)
   *   2. l'acteur a-t-il le droit d'attribuer CE rôle ? (R7, sur ses droits effectifs)
   *   3. la cible existe-t-elle ? la révision attendue est-elle la bonne ?
   *   4. G1 : la cible n'est-elle pas plus puissante que l'acteur ?
   *   5. le nouvel écart (G1 à G5, dépendances) ;
   *   6. R1 : l'écriture laisse-t-elle au moins un propriétaire ?
   */
  async changeRole(input: {
    organizationId: string;
    actorUserId: string;
    actor: ActorPermissions;
    targetUserId: string;
    role: OrgRole;
    grants?: Action[];
    revokes?: Action[];
    expectedRevision?: number;
    reason?: string;
  }): Promise<MemberRow> {
    const enabled = memberPermissionsEnabled();
    const requestedGrants = input.grants ?? [];
    const requestedRevokes = input.revokes ?? [];
    assertPermissionsWritable(requestedGrants, requestedRevokes);
    this.assertAssignable(input.role);
    this.assertNoEscalation(input.actor, input.role);

    const current = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!current) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });
    const revision = revisionOf(current);
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw staleRevision(revision);
    }

    const previousRole = normalizeOrgRole(current.role) ?? 'viewer';
    const overridesRequested = input.grants !== undefined || input.revokes !== undefined;
    if (previousRole === input.role && !overridesRequested) {
      // Idempotent : rejouer la même écriture ne doit pas déclencher R1 ni un
      // événement d'audit en double.
      return this.rowOf(current);
    }

    /**
     * R7 s'applique aussi à la RÉTROGRADATION : un acteur ne peut pas toucher à
     * un membre plus puissant que lui. Sans ce contrôle, un `admin` pourrait
     * rétrograder un `owner` en `viewer` — il n'aurait pas pu le nommer, il ne
     * doit pas pouvoir le défaire. ADR-0041 G1 : jugé sur l'ensemble potentiel de
     * la cible, écart compris.
     */
    if (!canManageMember(input.actor, { role: previousRole, context: this.contextOf(current) })) {
      throw this.escalation(input.actor.role, previousRole);
    }

    const before = this.storedStateOf(current);
    // Case ⚙ : un rôle qui n'est plus comptable perd le droit conditionnel — le
    // laisser traîner le réactiverait silencieusement à la prochaine promotion.
    let canClosePeriods = input.role === 'accountant' ? current.canClosePeriods === true : false;
    let grants: Action[] = [];
    let revokes: Action[] = [];
    if (enabled) {
      const split = this.splitCloseRight(input.role, requestedGrants, requestedRevokes);
      if (split.canClosePeriods !== undefined) canClosePeriods = split.canClosePeriods;
      const verdict = validateOverrides({
        actorRole: input.actor.role,
        actorCtx: input.actor.context,
        targetRole: input.role,
        grants: split.grants,
        revokes: split.revokes,
        // G2 : son propre titre se change selon les règles actuelles (R7, R1) ;
        // s'attribuer un écart, jamais.
        actorIsTarget:
          input.actorUserId === input.targetUserId &&
          (requestedGrants.length > 0 || requestedRevokes.length > 0),
      });
      if (!verdict.ok) throw overrideViolationToHttp(verdict);
      grants = [...verdict.grants];
      revokes = [...verdict.revokes];
    }
    const after = stateOf({ role: input.role, grants, revokes, canClosePeriods });
    if (sameState(before, after)) return this.rowOf(current);

    const droppedOverrides = {
      grants: before.grants,
      revokes: before.revokes,
      canClosePeriods: before.canClosePeriods && !after.canClosePeriods,
    };

    const updated = await this.withLastOwnerGuard(input.organizationId, async (session) => {
      const doc = await this.writeState(current, revision, after, session);
      await this.audit.recordStrict(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          actorRole: input.actor.role,
          action: 'member.role_changed',
          targetType: 'membership',
          targetId: input.targetUserId,
          metadata: { from: previousRole, to: input.role, droppedOverrides },
        },
        { session },
      );
      await this.recordPermissionsChanged(
        input.organizationId,
        input.actorUserId,
        input.actor.role,
        input.targetUserId,
        before,
        after,
        input.reason,
        session,
      );
      return doc;
    });

    await this.notifyPermissionsChanged(input.organizationId, input.actorUserId, updated);
    return this.rowOf(updated);
  }

  /**
   * ADR-0041 § 6 — `PATCH …/members/:userId/permissions` : remplace l'écart ENTIER
   * (pas de fusion). Pour un Comptable, `period.close` écrit `canClosePeriods`.
   */
  async setPermissions(input: {
    organizationId: string;
    actorUserId: string;
    actor: ActorPermissions;
    targetUserId: string;
    grants: Action[];
    revokes: Action[];
    expectedRevision: number;
    reason?: string;
  }): Promise<MemberRow> {
    // Interrupteur éteint : la route d'écriture des écarts refuse explicitement,
    // même pour un écart vide (elle n'a pas d'autre objet).
    if (!memberPermissionsEnabled()) throw permissionsDisabled();
    // G2 avant toute lecture : se viser soi-même est refusé quoi qu'il en soit.
    if (input.actorUserId === input.targetUserId) {
      throw overrideViolationToHttp({ code: 'SELF_PERMISSIONS_FORBIDDEN' });
    }

    const current = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!current) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });
    const revision = revisionOf(current);
    if (input.expectedRevision !== revision) throw staleRevision(revision);

    const role = normalizeOrgRole(current.role) ?? 'viewer';
    const split = this.splitCloseRight(role, input.grants, input.revokes);
    const verdict = validateOverrides({
      actorRole: input.actor.role,
      actorCtx: input.actor.context,
      targetRole: role,
      targetCtxBefore: this.contextOf(current),
      grants: split.grants,
      revokes: split.revokes,
      actorIsTarget: false,
    });
    if (!verdict.ok) throw overrideViolationToHttp(verdict);

    const before = this.storedStateOf(current);
    const after = stateOf({
      role,
      grants: verdict.grants,
      revokes: verdict.revokes,
      canClosePeriods: split.canClosePeriods ?? current.canClosePeriods === true,
    });
    if (sameState(before, after)) return this.rowOf(current);

    const updated = await inTransaction(this.connection, async (session) => {
      const doc = await this.writeState(current, revision, after, session);
      await this.recordPermissionsChanged(
        input.organizationId,
        input.actorUserId,
        input.actor.role,
        input.targetUserId,
        before,
        after,
        input.reason,
        session,
      );
      return doc;
    });

    await this.notifyPermissionsChanged(input.organizationId, input.actorUserId, updated);
    return this.rowOf(updated);
  }

  /**
   * Accorde ou retire le droit conditionnel `canClosePeriods` (case ⚙).
   * Réservé aux rôles détenant `organization.manage`, contrôlé par le guard.
   * N'a de sens que pour un `accountant` : le drapeau ne lève qu'une case
   * `conditional`, et `accountant` est la seule ligne qui en porte une.
   *
   * ADR-0041 : conservé (compatibilité N-1), soumis à G2 (jamais sur soi-même) et,
   * interrupteur allumé, à G1 ; journalisé strictement, révision incrémentée.
   */
  async setCanClosePeriods(input: {
    organizationId: string;
    actorUserId: string;
    actor: ActorPermissions;
    targetUserId: string;
    value: boolean;
    expectedRevision?: number;
  }): Promise<MemberRow> {
    if (input.actorUserId === input.targetUserId) {
      throw overrideViolationToHttp({ code: 'SELF_PERMISSIONS_FORBIDDEN' });
    }
    const member = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!member) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });

    const role = normalizeOrgRole(member.role) ?? 'viewer';
    if (role !== 'accountant') {
      throw new BadRequestException({
        code: 'CONDITIONAL_RIGHT_NOT_APPLICABLE',
        message: `Le droit de clôture ne s'accorde qu'à un Comptable (rôle actuel : ${role}).`,
      });
    }
    const revision = revisionOf(member);
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw staleRevision(revision);
    }
    if (
      memberPermissionsEnabled() &&
      !canManageMember(input.actor, { role, context: this.contextOf(member) })
    ) {
      throw overrideViolationToHttp({
        code: 'PERMISSION_ESCALATION',
        actions: ['period.close'],
      });
    }

    const before = this.storedStateOf(member);
    const after = stateOf({
      role,
      grants: before.grants,
      revokes: before.revokes,
      canClosePeriods: input.value,
    });
    if (sameState(before, after)) return this.rowOf(member);

    const updated = await inTransaction(this.connection, async (session) => {
      const doc = await this.writeState(member, revision, after, session);
      await this.audit.recordStrict(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          actorRole: input.actor.role,
          action: 'member.close_right_changed',
          targetType: 'membership',
          targetId: input.targetUserId,
          metadata: { value: input.value },
        },
        { session },
      );
      await this.recordPermissionsChanged(
        input.organizationId,
        input.actorUserId,
        input.actor.role,
        input.targetUserId,
        before,
        after,
        undefined,
        session,
      );
      return doc;
    });

    await this.notifyPermissionsChanged(input.organizationId, input.actorUserId, updated);
    return this.rowOf(updated);
  }

  /** Révoque un membre. R1 : le dernier propriétaire n'est pas révocable. */
  async revoke(input: {
    organizationId: string;
    actorUserId: string;
    actor: ActorPermissions;
    targetUserId: string;
  }): Promise<void> {
    const member = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!member) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });

    const role = normalizeOrgRole(member.role) ?? 'viewer';
    if (!canManageMember(input.actor, { role, context: this.contextOf(member) })) {
      throw this.escalation(input.actor.role, role);
    }

    await this.withLastOwnerGuard(input.organizationId, async (session) => {
      await this.memberships.deleteOne({ _id: member._id }, { session }).exec();
    });

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actor.role,
      action: 'member.revoked',
      targetType: 'membership',
      targetId: input.targetUserId,
      metadata: { role },
    });
  }

  /**
   * Transfert de propriété — promotion de la cible ET rétrogradation de l'acteur
   * dans la MÊME transaction (ADR-0012 §6 R1).
   *
   * Jamais deux appels : « je te promeus » puis « je me rétrograde » laisse, entre
   * les deux, une fenêtre où l'organisation a deux propriétaires (bénin) et, si le
   * second appel échoue, un état durablement faux. L'inverse — se rétrograder
   * d'abord — laisse une fenêtre à zéro propriétaire, qui déclencherait R1.
   *
   * L'acteur devient `admin` : le rôle le plus proche de ce qu'il perd (il garde
   * la gestion des membres et des projets, il perd l'abonnement et la validation).
   *
   * ADR-0041 § 3 : l'écart des DEUX personnes est effacé (la cible devient `owner`,
   * non personnalisable — G3 ; l'ancien propriétaire devient `admin` sans écart),
   * journalisé strictement dans la transaction, révisions incrémentées.
   */
  async transferOwnership(input: {
    organizationId: string;
    actorUserId: string;
    targetUserId: string;
  }): Promise<{ previousOwner: MemberRow; newOwner: MemberRow }> {
    if (input.actorUserId === input.targetUserId) {
      throw new BadRequestException({ code: 'CANNOT_TRANSFER_TO_SELF' });
    }

    const [actor, target] = await Promise.all([
      this.memberships
        .findOne({ organizationId: input.organizationId, userId: input.actorUserId })
        .exec(),
      this.memberships
        .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
        .exec(),
    ]);
    if (!actor) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });
    if (!target) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });
    if (normalizeOrgRole(actor.role) !== 'owner') {
      throw new ForbiddenException({ code: 'OWNER_ROLE_REQUIRED' });
    }

    const targetBefore = this.storedStateOf(target);
    const actorBefore = this.storedStateOf(actor);
    const targetAfter = stateOf({ role: 'owner', grants: [], revokes: [], canClosePeriods: false });
    const actorAfter = stateOf({ role: 'admin', grants: [], revokes: [], canClosePeriods: false });
    const targetRevision = revisionOf(target);
    const actorRevision = revisionOf(actor);

    const [newOwner, previousOwner] = await inTransaction(this.connection, async (session) => {
      const t = await this.writeState(target, targetRevision, targetAfter, session);
      const a = await this.writeState(actor, actorRevision, actorAfter, session);

      // R1 dans la même transaction : la promotion précède la rétrogradation, le
      // compte ne peut pas tomber à zéro — la vérification est là pour attraper
      // une future modification de cet ordre, pas le code actuel.
      const owners = await this.memberships
        .countDocuments({ organizationId: input.organizationId, role: 'owner' })
        .session(session ?? null)
        .exec();
      if (owners < 1) throw new ConflictException({ code: 'LAST_OWNER' });

      await this.audit.recordStrict(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          actorRole: 'owner',
          action: 'organization.ownership_transferred',
          targetType: 'membership',
          targetId: input.targetUserId,
          metadata: { from: input.actorUserId, to: input.targetUserId },
        },
        { session },
      );
      await this.recordPermissionsChanged(
        input.organizationId,
        input.actorUserId,
        'owner',
        input.targetUserId,
        targetBefore,
        targetAfter,
        undefined,
        session,
      );
      await this.recordPermissionsChanged(
        input.organizationId,
        input.actorUserId,
        'owner',
        input.actorUserId,
        actorBefore,
        actorAfter,
        undefined,
        session,
      );
      return [t, a] as const;
    });

    await this.notifyPermissionsChanged(input.organizationId, input.actorUserId, newOwner);
    return { previousOwner: this.rowOf(previousOwner), newOwner: this.rowOf(newOwner) };
  }

  // ── Écart (ADR-0041) ────────────────────────────────────────────────────────

  /** Contexte de DÉCISION d'une appartenance (écart vide interrupteur éteint). */
  contextOf(d: MembershipDocument): OrgPermissionContext {
    const { grants, revokes } = overridesOf(d);
    return { canClosePeriods: d.canClosePeriods === true, grants, revokes };
  }

  /** État STOCKÉ, pour l'audit (avant / après). */
  private storedStateOf(d: MembershipDocument): PermissionsState {
    const { grants, revokes } = storedOverridesOf(d);
    return stateOf({
      role: normalizeOrgRole(d.role) ?? 'viewer',
      grants,
      revokes,
      canClosePeriods: d.canClosePeriods === true,
    });
  }

  /**
   * § 1 : pour un Comptable, `period.close` dans l'écart demandé désigne la case ⚙,
   * stockée dans `canClosePeriods`, jamais dans `grants`/`revokes`. Absente des deux
   * listes, la case garde sa valeur. Pour tout autre rôle, les listes passent telles
   * quelles (un `period.close` y est un ajout ordinaire).
   */
  private splitCloseRight(
    role: OrgRole,
    grants: readonly Action[],
    revokes: readonly Action[],
  ): { grants: Action[]; revokes: Action[]; canClosePeriods?: boolean } {
    if (role !== 'accountant') return { grants: [...grants], revokes: [...revokes] };
    const inGrants = grants.includes('period.close');
    const inRevokes = revokes.includes('period.close');
    if (inGrants && inRevokes) {
      throw overrideViolationToHttp({
        code: 'PERMISSION_OVERRIDE_REDUNDANT',
        actions: ['period.close'],
      });
    }
    return {
      grants: grants.filter((a) => a !== 'period.close'),
      revokes: revokes.filter((a) => a !== 'period.close'),
      ...(inGrants ? { canClosePeriods: true } : inRevokes ? { canClosePeriods: false } : {}),
    };
  }

  /**
   * Écrit l'état (titre, écart, case ⚙) SI la révision n'a pas bougé, et
   * l'incrémente (G8). Deux écritures concurrentes sur la même révision : la
   * seconde ne trouve plus le document → `409 STALE_REVISION`.
   */
  private async writeState(
    doc: MembershipDocument,
    expectedRevision: number,
    state: PermissionsState,
    session: ClientSession | undefined,
  ): Promise<MembershipDocument> {
    const updated = await this.memberships
      .findOneAndUpdate(
        { _id: doc._id, ...revisionFilter(expectedRevision) },
        {
          $set: {
            role: state.role,
            grants: state.grants,
            revokes: state.revokes,
            canClosePeriods: state.canClosePeriods,
            permissionsRevision: expectedRevision + 1,
            _schemaVersion: MEMBERSHIP_SCHEMA_VERSION,
          },
        },
        { new: true, session: session ?? null },
      )
      .exec();
    if (!updated) {
      const fresh = await this.memberships
        .findById(doc._id)
        .session(session ?? null)
        .exec();
      throw staleRevision(fresh ? revisionOf(fresh) : expectedRevision);
    }
    return updated;
  }

  /** G7 — `member.permissions_changed`, STRICT, dans la transaction de l'écriture. */
  private async recordPermissionsChanged(
    organizationId: string,
    actorUserId: string,
    actorRole: OrgRole,
    targetUserId: string,
    before: PermissionsState,
    after: PermissionsState,
    reason: string | undefined,
    session: ClientSession | undefined,
  ): Promise<void> {
    if (sameState(before, after)) return;
    await this.audit.recordStrict(
      {
        organizationId,
        actorUserId,
        actorRole,
        action: 'member.permissions_changed',
        targetType: 'membership',
        targetId: targetUserId,
        metadata: {
          before,
          after,
          ...(reason !== undefined && reason.trim() !== '' ? { reason: reason.trim() } : {}),
        },
      },
      session ? { session } : {},
    );
  }

  /**
   * G8 / décision ouverte n° 10 — « Vos autorisations ont changé », sans détail,
   * lien vers le compte. Émise APRÈS la transaction (contrat du port : une
   * notification perdue ne défait jamais l'écriture), interrupteur allumé seulement.
   * L'auteur n'est jamais notifié de son propre geste (port).
   */
  private async notifyPermissionsChanged(
    organizationId: string,
    actorUserId: string,
    target: MembershipDocument,
  ): Promise<void> {
    if (!memberPermissionsEnabled()) return;
    try {
      await this.notifications.notify({
        organizationId,
        recipientUserId: target.userId,
        kind: 'organization.permissions_changed',
        requiredAction: 'analytics.read',
        source: { module: 'organization', entityType: 'membership', entityId: target.userId },
        title: PERMISSIONS_CHANGED_TITLE,
        href: '/compte',
        actorUserId,
        dedupeKey: `organization.permissions_changed:${target.userId}:${revisionOf(target)}`,
      });
    } catch (err) {
      this.logger.warn(
        `notification impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Invariants ──────────────────────────────────────────────────────────────

  private assertAssignable(role: OrgRole): void {
    if (!isAssignableRole(role)) {
      throw new ConflictException({
        code: 'ROLE_NOT_ASSIGNABLE',
        message:
          `Le rôle « ${role} » n'est pas attribuable : il ne prend son sens qu'avec ` +
          "des assignations de projet, qui n'existent pas encore.",
      });
    }
  }

  /**
   * R7 sur le TITRE attribué (décision ouverte n° 5) : interrupteur allumé, jugé sur
   * les droits effectifs de l'acteur ; éteint, sur la ligne de son rôle, comme avant.
   */
  private assertNoEscalation(actor: ActorPermissions, targetRole: OrgRole): void {
    const ok = memberPermissionsEnabled()
      ? canGrantRole(actor.role, targetRole, actor.context)
      : canGrantRole(actor.role, targetRole);
    if (!ok) throw this.escalation(actor.role, targetRole);
  }

  private escalation(actorRole: OrgRole, targetRole: OrgRole): ForbiddenException {
    return new ForbiddenException({
      code: 'ROLE_ESCALATION',
      message:
        `Un « ${actorRole} » ne peut pas attribuer ni modifier le rôle « ${targetRole} », ` +
        'qui détient des actions qu’il ne possède pas lui-même.',
    });
  }

  /**
   * Exécute une écriture puis RECOMPTE les propriétaires **dans la même
   * transaction**, et avorte si le compte tombe à zéro → `409 LAST_OWNER`.
   *
   * Le recomptage POST-écriture est ce qui protège de la course « deux
   * rétrogradations concurrentes voient chacune deux propriétaires » : chaque
   * transaction observe le résultat de sa propre écriture, et le conflit d'écriture
   * MongoDB force le rejeu de la perdante, qui verra alors un seul propriétaire.
   * Un contrôle PRÉ-écriture (« y a-t-il plus d'un owner ? ») laisserait passer
   * les deux.
   */
  private async withLastOwnerGuard<T>(
    organizationId: string,
    write: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> {
    return inTransaction(this.connection, async (session) => {
      const result = await write(session);
      const owners = await this.memberships
        .countDocuments({ organizationId, role: 'owner' })
        .session(session ?? null)
        .exec();
      if (owners < 1) {
        throw new ConflictException({
          code: 'LAST_OWNER',
          message:
            "Cette organisation doit conserver au moins un propriétaire. Transférez d'abord " +
            'la propriété à un autre membre.',
        });
      }
      return result;
    });
  }

  /**
   * Email et nom des membres, lus dans la collection `user` de better-auth.
   *
   * La membership ne stocke qu'un `userId` : sans cette jointure la page Membres
   * afficherait des identifiants Mongo, sur lesquels personne ne peut décider
   * d'un changement de rôle ou d'une révocation.
   *
   * Une seule requête `$in` pour toute la liste, et une identité MANQUANTE n'est
   * pas une erreur : la clé est simplement absente de la Map et l'appelant
   * retombe sur l'identifiant. Un utilisateur supprimé dont la membership a
   * survécu doit rester visible — c'est précisément la ligne qu'on veut pouvoir
   * révoquer.
   */
  async identitiesOf(userIds: readonly string[]): Promise<Map<string, MemberIdentity>> {
    const out = new Map<string, MemberIdentity>();
    const db = this.connection.db;
    if (!db || userIds.length === 0) return out;

    const { ObjectId } = await import('mongodb');
    const ids = userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    if (ids.length === 0) return out;

    const docs = await db
      .collection('user')
      .find({ _id: { $in: ids } }, { projection: { email: 1, name: 1 } })
      .toArray();

    for (const doc of docs) {
      const email = typeof doc['email'] === 'string' ? doc['email'] : null;
      const name =
        typeof doc['name'] === 'string' && doc['name'].trim() !== '' ? doc['name'] : null;
      out.set(String(doc['_id']), { email, name });
    }
    return out;
  }

  rowOf(d: MembershipDocument): MemberRow {
    const role = normalizeOrgRole(d.role) ?? 'viewer';
    const context = this.contextOf(d);
    return {
      userId: d.userId,
      role,
      canClosePeriods: d.canClosePeriods === true,
      acceptedAt: d.acceptedAt ?? null,
      grants: sortActions(context.grants ?? []),
      revokes: sortActions(context.revokes ?? []),
      effective: effectiveActions(role, context),
      permissionsRevision: revisionOf(d),
    };
  }
}
