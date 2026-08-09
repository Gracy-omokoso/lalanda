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
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../authz/audit.service.js';
import {
  canGrantRole,
  isAssignableRole,
  normalizeOrgRole,
  type OrgRole,
} from '../authz/permissions.js';
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
}

/** Identité affichable d'un membre — hors membership, donc toujours faillible. */
export interface MemberIdentity {
  email: string | null;
  name: string | null;
}

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(organizationId: string): Promise<MemberRow[]> {
    const docs = await this.memberships.find({ organizationId }).sort({ createdAt: 1 }).exec();
    return docs.map((d) => ({
      userId: d.userId,
      role: normalizeOrgRole(d.role) ?? 'viewer',
      canClosePeriods: d.canClosePeriods === true,
      acceptedAt: d.acceptedAt ?? null,
    }));
  }

  /**
   * Change le rôle d'un membre.
   *
   * Ordre des contrôles, du moins coûteux au plus coûteux, et surtout du plus
   * général au plus spécifique :
   *   1. le rôle cible est-il attribuable en S20a ? (`project_manager` ne l'est pas)
   *   2. l'acteur a-t-il le droit d'attribuer CE rôle ? (R7)
   *   3. la cible existe-t-elle ?
   *   4. R1 : l'écriture laisse-t-elle au moins un propriétaire ?
   */
  async changeRole(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: OrgRole;
    targetUserId: string;
    role: OrgRole;
  }): Promise<MemberRow> {
    this.assertAssignable(input.role);
    this.assertNoEscalation(input.actorRole, input.role);

    const current = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!current) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });

    const previousRole = normalizeOrgRole(current.role) ?? 'viewer';
    if (previousRole === input.role) {
      // Idempotent : rejouer la même écriture ne doit pas déclencher R1 ni un
      // événement d'audit en double.
      return this.rowOf(current);
    }

    /**
     * R7 s'applique aussi à la RÉTROGRADATION : un acteur ne peut pas toucher à
     * un membre plus puissant que lui. Sans ce contrôle, un `admin` pourrait
     * rétrograder un `owner` en `viewer` — il n'aurait pas pu le nommer, il ne
     * doit pas pouvoir le défaire.
     */
    this.assertNoEscalation(input.actorRole, previousRole);

    const updated = await this.withLastOwnerGuard(input.organizationId, async (session) => {
      current.role = input.role;
      current._schemaVersion = MEMBERSHIP_SCHEMA_VERSION;
      // Un rôle qui n'est plus comptable perd le droit conditionnel : le laisser
      // traîner le réactiverait silencieusement à la prochaine promotion.
      if (input.role !== 'accountant') current.canClosePeriods = false;
      await current.save({ session });
      return current;
    });

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'member.role_changed',
      targetType: 'membership',
      targetId: input.targetUserId,
      metadata: { from: previousRole, to: input.role },
    });

    return this.rowOf(updated);
  }

  /**
   * Accorde ou retire le droit conditionnel `canClosePeriods` (case ⚙).
   * Réservé aux rôles détenant `organization.manage`, contrôlé par le guard.
   * N'a de sens que pour un `accountant` : le drapeau ne lève qu'une case
   * `conditional`, et `accountant` est la seule ligne qui en porte une.
   */
  async setCanClosePeriods(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: OrgRole;
    targetUserId: string;
    value: boolean;
  }): Promise<MemberRow> {
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

    member.canClosePeriods = input.value;
    await member.save();

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'member.close_right_changed',
      targetType: 'membership',
      targetId: input.targetUserId,
      metadata: { value: input.value },
    });

    return this.rowOf(member);
  }

  /** Révoque un membre. R1 : le dernier propriétaire n'est pas révocable. */
  async revoke(input: {
    organizationId: string;
    actorUserId: string;
    actorRole: OrgRole;
    targetUserId: string;
  }): Promise<void> {
    const member = await this.memberships
      .findOne({ organizationId: input.organizationId, userId: input.targetUserId })
      .exec();
    if (!member) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND' });

    const role = normalizeOrgRole(member.role) ?? 'viewer';
    this.assertNoEscalation(input.actorRole, role);

    await this.withLastOwnerGuard(input.organizationId, async (session) => {
      await this.memberships.deleteOne({ _id: member._id }, { session }).exec();
    });

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
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

    await this.inTransaction(async (session) => {
      target.role = 'owner';
      target._schemaVersion = MEMBERSHIP_SCHEMA_VERSION;
      target.canClosePeriods = false;
      await target.save({ session });

      actor.role = 'admin';
      actor._schemaVersion = MEMBERSHIP_SCHEMA_VERSION;
      await actor.save({ session });

      // R1 dans la même transaction : la promotion précède la rétrogradation, le
      // compte ne peut pas tomber à zéro — la vérification est là pour attraper
      // une future modification de cet ordre, pas le code actuel.
      const owners = await this.memberships
        .countDocuments({ organizationId: input.organizationId, role: 'owner' })
        .session(session ?? null)
        .exec();
      if (owners < 1) throw new ConflictException({ code: 'LAST_OWNER' });
    });

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: 'owner',
      action: 'organization.ownership_transferred',
      targetType: 'membership',
      targetId: input.targetUserId,
      metadata: { from: input.actorUserId, to: input.targetUserId },
    });

    return { previousOwner: this.rowOf(actor), newOwner: this.rowOf(target) };
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

  private assertNoEscalation(actorRole: OrgRole, targetRole: OrgRole): void {
    if (!canGrantRole(actorRole, targetRole)) {
      throw new ForbiddenException({
        code: 'ROLE_ESCALATION',
        message:
          `Un « ${actorRole} » ne peut pas attribuer ni modifier le rôle « ${targetRole} », ` +
          'qui détient des actions qu’il ne possède pas lui-même.',
      });
    }
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
    return this.inTransaction(async (session) => {
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
   * Transaction Mongoose, avec repli documenté sur une exécution simple.
   *
   * Les transactions exigent un replica set (la CI en fournit un depuis S19a, et
   * la production tourne sur Atlas). Un poste de développement branché sur un
   * `mongod` autonome n'en a pas : plutôt que de rendre la gestion des membres
   * inutilisable en local, on retombe sur une exécution non transactionnelle.
   *
   * Ce que le repli coûte, explicitement : la protection R1 devient vulnérable à
   * une course entre deux rétrogradations SIMULTANÉES du dernier propriétaire.
   * Le contrôle post-écriture reste fait, la fenêtre est de l'ordre de la
   * milliseconde, et l'environnement concerné n'a pas d'utilisateurs concurrents.
   * On ne masque JAMAIS ce repli en production : il ne se déclenche que sur
   * l'erreur précise « transactions non supportées par la topologie ».
   */
  private async inTransaction<T>(
    fn: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> {
    let session: ClientSession;
    try {
      session = await this.connection.startSession();
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

  private rowOf(d: MembershipDocument): MemberRow {
    return {
      userId: d.userId,
      role: normalizeOrgRole(d.role) ?? 'viewer',
      canClosePeriods: d.canClosePeriods === true,
      acceptedAt: d.acceptedAt ?? null,
    };
  }
}

/**
 * Topologie sans replica set. MongoDB renvoie `IllegalOperation` (20) avec un
 * message explicite; le driver peut aussi lever `MongoServerError` sans code
 * exploitable. On teste donc le message, ce qui est fragile — mais l'alternative
 * (sonder la topologie au démarrage) rendrait le service dépendant d'un état
 * global pour un cas de confort local.
 */
function isTransactionUnsupported(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Transaction numbers are only allowed on a replica set') ||
    message.includes('Transactions are not supported') ||
    message.includes('does not support transactions')
  );
}
