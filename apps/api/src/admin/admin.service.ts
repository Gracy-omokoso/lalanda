// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE L'ESPACE ADMIN PLATEFORME (S21b)
//
// Agrégats, organisations, utilisateurs. Trois principes tenus ici :
//
// 1. AUCUNE DONNÉE FINANCIÈRE CLIENTE. Le tableau de bord compte des projets et
//    des plans validés; il ne lit ni un montant, ni une hypothèse, ni un
//    résultat. ADR-0012 §4 range tout le contenu client en `delegated` : un
//    compteur n'a pas besoin d'y toucher, et lui en donner l'habitude ouvrirait
//    la porte au reste.
//
// 2. LES TROIS INTERDITS ABSOLUS N'EXISTENT PAS ICI. `plan.approve`,
//    `period.close` et `report.export` sont refusés à tous les rôles plateforme,
//    super-administrateur compris (ADR-0012 §4). Aucune méthode de ce fichier ne
//    les approche, et un test de couverture vérifie qu'aucune route `/admin` ne
//    les déclare.
//
// 3. LA COLLECTION `user` APPARTIENT À BETTER-AUTH. On la lit par le driver
//    natif — jamais par un modèle Mongoose qui imposerait un schéma à une
//    collection dont on n'est pas propriétaire (même raisonnement que
//    `members.service.ts` et `platform-role-assignment.schema.ts`).
// ─────────────────────────────────────────────────────────────────────────────

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { BillingService } from '../billing/billing.service.js';
import { PLANS, type Plan } from '../billing/entitlements.js';
import { isPlatformRole, PLATFORM_ROLE_LABELS, type PlatformRole } from '../authz/permissions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from '../authz/platform-role-assignment.schema.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import { AiUsageService } from './ai-usage.service.js';
import {
  OrganizationSuspension,
  type OrganizationSuspensionDocument,
} from './organization-suspension.schema.js';

export interface PlatformOverview {
  organizations: { total: number; suspended: number };
  users: { total: number; withPlatformRole: number };
  projects: { total: number };
  approvedPlans: { total: number };
  /** Appels IA des 30 derniers jours, ventilés : seuls les `llm` sont facturés. */
  aiCalls: { last30Days: { llm: number; fallback: number; total: number } };
  plans: Record<Plan, number>;
}

export interface AdminOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  pays: string;
  ownerId: string;
  plan: Plan;
  memberCount: number;
  projectCount: number;
  suspended: boolean;
  suspendedReason: string | null;
  createdAt: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  platformRoles: Array<{ role: PlatformRole; label: string; expiresAt: string | null }>;
  organizationCount: number;
  disabledAt: string | null;
  createdAt: string | null;
}

export interface AdminActor {
  userId: string;
  platformRole: string;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(PlatformRoleAssignment.name)
    private readonly platformRoles: Model<PlatformRoleAssignmentDocument>,
    @InjectModel(OrganizationSuspension.name)
    private readonly suspensions: Model<OrganizationSuspensionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  // ── Tableau de bord ────────────────────────────────────────────────────────

  async overview(): Promise<PlatformOverview> {
    const db = this.connection.db;
    const since = new Date(Date.now() - 30 * 24 * 3600_000);

    const [orgTotal, suspended, projectTotal, approvedPlans, roleRows, aiCalls] = await Promise.all(
      [
        this.orgs.countDocuments({}).exec(),
        this.suspensions.countDocuments({ liftedAt: null }).exec(),
        db ? db.collection('projects').countDocuments({}) : Promise.resolve(0),
        // Un plan `superseded` a bien été validé un jour : le compteur porte sur
        // l'acte de validation, pas sur le nombre de plans encore courants.
        db ? db.collection('financial_plans').countDocuments({}) : Promise.resolve(0),
        this.platformRoles.find({ revokedAt: null }).select({ userId: 1 }).lean().exec(),
        this.aiUsage.countSince(since),
      ],
    );

    const userTotal = db ? await db.collection('user').countDocuments({}) : 0;

    // Répartition par plan : une organisation sans document `Subscription` est
    // `free` (règle de `BillingService.getPlan`). Compter les seuls documents
    // existants sous-estimerait donc systématiquement le plan gratuit.
    const plans: Record<Plan, number> = { free: 0, pro: 0, business: 0 };
    const subs = db
      ? await db
          .collection('subscriptions')
          .find({ status: 'active' }, { projection: { plan: 1 } })
          .toArray()
      : [];
    for (const sub of subs) {
      const plan = String(sub['plan']) as Plan;
      if (PLANS.includes(plan)) plans[plan] += 1;
    }
    plans.free = Math.max(orgTotal - (plans.pro + plans.business), 0);

    return {
      organizations: { total: orgTotal, suspended },
      users: { total: userTotal, withPlatformRole: new Set(roleRows.map((r) => r.userId)).size },
      projects: { total: projectTotal },
      approvedPlans: { total: approvedPlans },
      aiCalls: { last30Days: aiCalls },
      plans,
    };
  }

  // ── Organisations ──────────────────────────────────────────────────────────

  async listOrganizations(query: {
    q?: string;
    limit?: number;
  }): Promise<AdminOrganizationSummary[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const filter: Record<string, unknown> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegExp(query.q), 'i');
      filter['$or'] = [{ name: rx }, { slug: rx }];
    }
    const docs = await this.orgs.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
    return Promise.all(docs.map((d) => this.summarizeOrganization(d)));
  }

  async getOrganization(orgId: string): Promise<AdminOrganizationSummary> {
    const doc = await this.orgs
      .findById(orgId)
      .exec()
      .catch(() => null);
    if (!doc) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return this.summarizeOrganization(doc);
  }

  private async summarizeOrganization(
    doc: OrganizationDocument,
  ): Promise<AdminOrganizationSummary> {
    const id = String(doc._id);
    const db = this.connection.db;
    const [plan, memberCount, projectCount, suspension] = await Promise.all([
      this.billing.getPlan(id),
      this.memberships.countDocuments({ organizationId: id }).exec(),
      db ? db.collection('projects').countDocuments({ organizationId: id }) : Promise.resolve(0),
      this.suspensions.findOne({ organizationId: id, liftedAt: null }).lean().exec(),
    ]);
    return {
      id,
      name: doc.name,
      slug: doc.slug,
      type: doc.type,
      pays: doc.pays,
      ownerId: doc.ownerId,
      plan,
      memberCount,
      projectCount,
      suspended: Boolean(suspension),
      suspendedReason: suspension?.reason ?? null,
      createdAt: new Date((doc as unknown as { createdAt: Date }).createdAt).toISOString(),
    };
  }

  /**
   * Change le plan d'une organisation.
   *
   * `BillingService.setPlan` existe depuis S16b et était resté INTERNE, faute de
   * chemin d'appel légitime : « aucun endpoint public de changement de plan tant
   * que le paiement n'est pas intégré ». `/admin` est ce chemin — un opérateur
   * plateforme, tracé, sous `billing.manage`. Ce n'est pas un contournement du
   * paiement : c'est l'octroi manuel qui existait déjà en base, rendu visible.
   */
  async setPlan(orgId: string, plan: Plan, actor: AdminActor): Promise<AdminOrganizationSummary> {
    if (!PLANS.includes(plan)) {
      throw new BadRequestException({ code: 'UNKNOWN_PLAN', message: `Plan inconnu : ${plan}.` });
    }
    const org = await this.orgs
      .findById(orgId)
      .exec()
      .catch(() => null);
    if (!org) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });

    const previous = await this.billing.getPlan(orgId);
    await this.billing.setPlan(orgId, plan);
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'organization.plan_changed',
      targetType: 'organization',
      targetId: orgId,
      metadata: { from: previous, to: plan },
    });
    return this.summarizeOrganization(org);
  }

  /**
   * Suspend une organisation : décision enregistrée, motif obligatoire, sessions
   * des membres révoquées, trace d'audit.
   *
   * Voir `organization-suspension.schema.ts` pour ce que la suspension NE fait
   * pas : elle déconnecte, elle ne verrouille pas la reconnexion.
   */
  async suspendOrganization(
    orgId: string,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminOrganizationSummary> {
    const org = await this.orgs
      .findById(orgId)
      .exec()
      .catch(() => null);
    if (!org) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });

    const existing = await this.suspensions
      .findOne({ organizationId: orgId, liftedAt: null })
      .exec();
    if (!existing) {
      await this.suspensions.create({
        organizationId: orgId,
        reason,
        suspendedBy: actor.userId,
        suspendedAt: new Date(),
        liftedAt: null,
        liftedBy: null,
        _schemaVersion: 1,
      });
    }

    const revoked = await this.revokeSessionsOfOrganization(orgId);
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'organization.suspended',
      targetType: 'organization',
      targetId: orgId,
      metadata: { reason, revokedSessions: revoked },
    });
    return this.summarizeOrganization(org);
  }

  async liftSuspension(orgId: string, actor: AdminActor): Promise<AdminOrganizationSummary> {
    const org = await this.orgs
      .findById(orgId)
      .exec()
      .catch(() => null);
    if (!org) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    await this.suspensions
      .updateOne(
        { organizationId: orgId, liftedAt: null },
        { $set: { liftedAt: new Date(), liftedBy: actor.userId } },
      )
      .exec();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'organization.suspension_lifted',
      targetType: 'organization',
      targetId: orgId,
      metadata: {},
    });
    return this.summarizeOrganization(org);
  }

  // ── Utilisateurs ───────────────────────────────────────────────────────────

  async searchUsers(query: { q?: string; limit?: number }): Promise<AdminUserSummary[]> {
    const db = this.connection.db;
    if (!db) return [];
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const filter: Record<string, unknown> = {};
    if (query.q) {
      const rx = new RegExp(escapeRegExp(query.q), 'i');
      filter['$or'] = [{ email: rx }, { name: rx }];
    }
    const rows = await db
      .collection('user')
      .find(filter, { projection: { email: 1, name: 1, createdAt: 1, disabledAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const ids = rows.map((r) => String(r._id));
    const [roleRows, memberships] = await Promise.all([
      this.platformRoles
        .find({ userId: { $in: ids }, revokedAt: null })
        .lean()
        .exec(),
      this.memberships
        .find({ userId: { $in: ids } })
        .select({ userId: 1 })
        .lean()
        .exec(),
    ]);

    const rolesByUser = new Map<string, AdminUserSummary['platformRoles']>();
    for (const r of roleRows) {
      const list = rolesByUser.get(r.userId) ?? [];
      list.push({
        role: r.role,
        label: PLATFORM_ROLE_LABELS[r.role],
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
      });
      rolesByUser.set(r.userId, list);
    }
    const orgCount = new Map<string, number>();
    for (const m of memberships) {
      orgCount.set(m.userId, (orgCount.get(m.userId) ?? 0) + 1);
    }

    return rows.map((r) => {
      const id = String(r._id);
      return {
        id,
        email: String(r['email'] ?? ''),
        name: (r['name'] as string | null) ?? null,
        platformRoles: rolesByUser.get(id) ?? [],
        organizationCount: orgCount.get(id) ?? 0,
        disabledAt: r['disabledAt'] ? new Date(r['disabledAt'] as Date).toISOString() : null,
        createdAt: r['createdAt'] ? new Date(r['createdAt'] as Date).toISOString() : null,
      };
    });
  }

  /**
   * Attribue un rôle plateforme.
   *
   * Aucune vérification d'escalade n'est faite : la route est réservée au
   * `platform_super_admin`, qui détient déjà le rôle le plus élevé. La règle R7
   * (« on n'attribue que ce qu'on détient », ADR-0012 §6) porte sur les rôles
   * d'ORGANISATION et n'a pas d'équivalent plateforme dans l'ADR. Le jour où un
   * `platform_admin` pourra attribuer des rôles, il faudra en écrire une.
   */
  async grantPlatformRole(
    userId: string,
    role: string,
    input: { reason?: string; expiresAt?: string },
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    if (!isPlatformRole(role)) {
      throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: `Rôle inconnu : ${role}.` });
    }
    await this.assertUserExists(userId);

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date d’expiration invalide.',
      });
    }
    await this.platformRoles
      .findOneAndUpdate(
        { userId, role },
        {
          $set: {
            grantedBy: actor.userId,
            reason: input.reason ?? null,
            expiresAt,
            revokedAt: null,
          },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true, new: true },
      )
      .exec();

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'platform_role.granted',
      targetType: 'user',
      targetId: userId,
      metadata: {
        role,
        reason: input.reason ?? null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    });
    return this.userOrThrow(userId);
  }

  async revokePlatformRole(
    userId: string,
    role: string,
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    if (!isPlatformRole(role)) {
      throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: `Rôle inconnu : ${role}.` });
    }
    if (userId === actor.userId && role === 'platform_super_admin') {
      // Se retirer soi-même le super-administrateur peut laisser la plateforme
      // SANS AUCUN super-administrateur, donc sans personne pour en nommer un —
      // même famille de règle que R1 sur le dernier propriétaire (docs/12). La
      // reprise passerait par une écriture manuelle en base.
      throw new BadRequestException({
        code: 'SELF_DEMOTION_FORBIDDEN',
        message:
          'Un super-administrateur ne peut pas se retirer son propre rôle : un autre ' +
          'super-administrateur doit le faire.',
      });
    }
    await this.platformRoles
      .updateOne({ userId, role, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'platform_role.revoked',
      targetType: 'user',
      targetId: userId,
      metadata: { role },
    });
    return this.userOrThrow(userId);
  }

  /**
   * Désactive un compte : marque `disabledAt` et révoque toutes ses sessions.
   *
   * LIMITE CONNUE, à ne pas confondre avec « fait » : rien n'empêche l'utilisateur
   * de se reconnecter. Le refus au moment de la connexion se déciderait dans
   * `AuthGuard` (`apps/api/src/auth/`), hors du périmètre de ce lot. Ce qui est
   * livré aujourd'hui déconnecte immédiatement et laisse une trace; le verrou
   * complet tient en une lecture de `disabledAt` dans le guard, et il est
   * documenté comme restant dans docs/17 § Implémenté (S21b).
   */
  async setUserDisabled(
    userId: string,
    disabled: boolean,
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    if (userId === actor.userId && disabled) {
      throw new BadRequestException({
        code: 'SELF_DISABLE_FORBIDDEN',
        message: 'Un administrateur ne peut pas désactiver son propre compte.',
      });
    }
    const db = await this.assertUserExists(userId);
    const { ObjectId } = await import('mongodb');
    await db
      .collection('user')
      .updateOne(
        { _id: new ObjectId(userId) },
        { $set: { disabledAt: disabled ? new Date() : null } },
      );

    const revoked = disabled ? await this.revokeSessionsOfUser(userId) : 0;
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: disabled ? 'user.disabled' : 'user.enabled',
      targetType: 'user',
      targetId: userId,
      metadata: { revokedSessions: revoked },
    });
    return this.userOrThrow(userId);
  }

  // ── Utilitaires ────────────────────────────────────────────────────────────

  private async assertUserExists(userId: string): Promise<NonNullable<Connection['db']>> {
    const db = this.connection.db;
    if (!db) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const { ObjectId } = await import('mongodb');
    let oid: InstanceType<typeof ObjectId>;
    try {
      oid = new ObjectId(userId);
    } catch {
      throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    }
    const exists = await db.collection('user').findOne({ _id: oid }, { projection: { _id: 1 } });
    if (!exists) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    return db;
  }

  private async userOrThrow(userId: string): Promise<AdminUserSummary> {
    const db = this.connection.db;
    if (!db) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const { ObjectId } = await import('mongodb');
    const row = await db.collection('user').findOne({ _id: new ObjectId(userId) });
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const [found] = await this.searchUsers({ q: String(row['email']), limit: 1 });
    if (found) return found;
    throw new NotFoundException({ code: 'USER_NOT_FOUND' });
  }

  /** Sessions better-auth d'un utilisateur — `session.userId` est un ObjectId. */
  private async revokeSessionsOfUser(userId: string): Promise<number> {
    const db = this.connection.db;
    if (!db) return 0;
    const { ObjectId } = await import('mongodb');
    const res = await db.collection('session').deleteMany({ userId: new ObjectId(userId) });
    return res.deletedCount ?? 0;
  }

  private async revokeSessionsOfOrganization(orgId: string): Promise<number> {
    const members = await this.memberships
      .find({ organizationId: orgId })
      .select({ userId: 1 })
      .lean()
      .exec();
    let total = 0;
    for (const m of members) total += await this.revokeSessionsOfUser(m.userId);
    return total;
  }
}

/** Échappe une saisie utilisateur avant construction d'une `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}
