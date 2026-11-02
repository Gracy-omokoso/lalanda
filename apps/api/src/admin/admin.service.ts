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

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

// ADR-0053 — P2
import {
  PLATFORM_LIMITS,
  type PlatformReasonCategory,
  type PlatformSuspensionMode,
  type PlatformViewReason,
} from '@lalanda/shared/platform';

import { BillingService } from '../billing/billing.service.js';
import { PLANS, type Plan } from '../billing/entitlements.js';
import { isPlatformRole, PLATFORM_ROLE_LABELS, type PlatformRole } from '../authz/permissions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from '../authz/platform-role-assignment.schema.js';
import {
  platformActionHolders,
  platformRoleGrantDecision,
  platformSelfDealingDecision,
  type PlatformAction,
  type PlatformSelfDealingGesture,
} from '../authz/platform-actions.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import { AiUsageService } from './ai-usage.service.js';
import {
  OrganizationSuspension,
  type OrganizationSuspensionDocument,
} from './organization-suspension.schema.js';
import { newPlatformEventRef, PlatformMirrorService } from './mirror.js';

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
  /** ADR-0053 — P2 : effet de la suspension active, `null` sans suspension. */
  suspensionMode: PlatformSuspensionMode | null;
  createdAt: string;
}

/**
 * Fiche détaillée d'une organisation (ADR-0053 § 2.6) : métadonnées seulement, plus
 * l'adresse du Propriétaire (contact). Aucun montant, aucun contenu.
 */
export interface AdminOrganizationDetail extends AdminOrganizationSummary {
  ownerEmail: string | null;
  suspension: {
    reasonCategory: string | null;
    clientMessage: string | null;
    internalNote: string | null;
    mode: PlatformSuspensionMode;
    suspendedAt: string;
  } | null;
}

/** Fiche détaillée d'un compte : ses appartenances (nom d'organisation, rôle). */
export interface AdminUserDetail extends AdminUserSummary {
  organizations: Array<{ id: string; name: string; role: string }>;
  blockedReasonCategory: string | null;
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
    // ADR-0053 — P2
    @Inject(PlatformMirrorService) private readonly mirrors: PlatformMirrorService,
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
    // Dérivé de `PLANS` et non écrit à la main : la grille est passée de trois à
    // cinq offres, et un littéral aurait laissé `cabinet` et `expert` invisibles
    // dans la console sans qu'aucun test ne s'en plaigne.
    const plans: Record<Plan, number> = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<
      Plan,
      number
    >;
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
    // `free` est le reste : toute organisation sans abonnement actif y retombe,
    // quels que soient les paliers payants existants.
    const paid = PLANS.filter((p) => p !== 'free').reduce((n, p) => n + plans[p], 0);
    plans.free = Math.max(orgTotal - paid, 0);

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

  /**
   * ADR-0053 § 2.6 : sans recherche, la PREMIÈRE page seulement ; au-delà (`limit` au-delà
   * de la page par défaut), la recherche est obligatoire (`400 SEARCH_REQUIRED`).
   */
  async listOrganizations(query: {
    q?: string;
    limit?: number;
  }): Promise<AdminOrganizationSummary[]> {
    const q = query.q?.trim() ?? '';
    if (q.length > 0 && q.length < PLATFORM_LIMITS.searchMinLength) {
      throw searchRequired();
    }
    if (q.length === 0 && (query.limit ?? FIRST_PAGE) > FIRST_PAGE) throw searchRequired();
    const limit = Math.min(Math.max(query.limit ?? FIRST_PAGE, 1), 200);
    const filter: Record<string, unknown> = {};
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      filter['$or'] = [{ name: rx }, { slug: rx }];
    }
    const docs = await this.orgs.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
    return Promise.all(docs.map((d) => this.summarizeOrganization(d)));
  }

  async getOrganization(orgId: string): Promise<AdminOrganizationSummary> {
    return this.summarizeOrganization(await this.orgOrThrow(orgId));
  }

  /**
   * Fiche détaillée — lecture JOURNALISÉE avec son motif (`platform.organization.viewed`,
   * § 2.6, critère 7).
   */
  async viewOrganization(
    orgId: string,
    reason: PlatformViewReason,
    actor: AdminActor,
  ): Promise<AdminOrganizationDetail> {
    const org = await this.orgOrThrow(orgId);
    const [summary, suspension, ownerEmail] = await Promise.all([
      this.summarizeOrganization(org),
      this.suspensions.findOne({ organizationId: orgId, liftedAt: null }).lean().exec(),
      this.emailOf(org.ownerId),
    ]);
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'platform.organization.viewed',
      targetType: 'organization',
      targetId: orgId,
      metadata: { reason },
    });
    return {
      ...summary,
      ownerEmail,
      suspension: suspension
        ? {
            reasonCategory: suspension.reasonCategory ?? null,
            clientMessage: suspension.clientMessage ?? null,
            internalNote: suspension.internalNote ?? suspension.reason ?? null,
            mode: suspensionModeOf(suspension.mode),
            suspendedAt: new Date(suspension.suspendedAt).toISOString(),
          }
        : null,
    };
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
      suspensionMode: suspension ? suspensionModeOf(suspension.mode) : null,
      createdAt: new Date((doc as unknown as { createdAt: Date }).createdAt).toISOString(),
    };
  }

  // ADR-0053 — P3 : l'ancien `setPlan` (changement direct, remis `active` sans trace) a
  // disparu ; la route historique passe par les octrois (`billing/platform-billing.service.ts`).

  /**
   * Suspend une organisation (ADR-0053 § 6.1) : catégorie, message client, note
   * interne, mode. L'effet est appliqué par `PermissionsGuard` sur toute route
   * d'organisation qui la vise ; les sessions des membres NE sont PLUS révoquées (un
   * membre garde ses autres organisations).
   */
  async suspendOrganization(
    orgId: string,
    input: {
      reasonCategory: PlatformReasonCategory;
      clientMessage: string;
      internalNote: string;
      mode: PlatformSuspensionMode;
    },
    actor: AdminActor,
  ): Promise<AdminOrganizationSummary> {
    const org = await this.orgOrThrow(orgId);
    const { soleOperator } = await this.assertNoSelfDealing(
      'orgs.suspend',
      'platform.orgs.suspend',
      orgId,
      actor,
    );
    const existing = await this.suspensions
      .findOne({ organizationId: orgId, liftedAt: null })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException({
        code: 'ORGANIZATION_ALREADY_SUSPENDED',
        message: 'Cette organisation est déjà suspendue.',
      });
    }
    await this.suspensions.create({
      organizationId: orgId,
      reason: input.internalNote,
      reasonCategory: input.reasonCategory,
      clientMessage: input.clientMessage,
      internalNote: input.internalNote,
      mode: input.mode,
      suspendedBy: actor.userId,
      suspendedAt: new Date(),
      liftedAt: null,
      liftedBy: null,
      _schemaVersion: 2,
    });

    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'organization.suspended',
      targetType: 'organization',
      targetId: orgId,
      metadata: {
        reasonCategory: input.reasonCategory,
        internalNote: input.internalNote,
        clientMessage: input.clientMessage,
        mode: input.mode,
        ref,
        soleOperator,
      },
    });
    await this.mirrors.mirror({
      organizationId: orgId,
      action: 'platform.organization.suspended',
      targetType: 'organization',
      targetId: orgId,
      platformEventRef: ref,
      clientMessage: input.clientMessage,
      soleOperator,
      facts: { mode: input.mode },
    });
    return this.summarizeOrganization(org);
  }

  /** Rétablit une organisation : motif et message client obligatoires (§ 6.1). */
  async liftSuspension(
    orgId: string,
    input: { liftReason: string; liftedClientMessage: string },
    actor: AdminActor,
  ): Promise<AdminOrganizationSummary> {
    const org = await this.orgOrThrow(orgId);
    const { soleOperator } = await this.assertNoSelfDealing(
      'orgs.restore',
      'platform.orgs.suspend',
      orgId,
      actor,
    );
    const res = await this.suspensions
      .updateOne(
        { organizationId: orgId, liftedAt: null },
        {
          $set: {
            liftedAt: new Date(),
            liftedBy: actor.userId,
            liftReason: input.liftReason,
            liftedClientMessage: input.liftedClientMessage,
          },
        },
      )
      .exec();
    if (res.modifiedCount === 0) {
      throw new ConflictException({
        code: 'ORGANIZATION_NOT_SUSPENDED',
        message: 'Cette organisation n’est pas suspendue.',
      });
    }
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'organization.suspension_lifted',
      targetType: 'organization',
      targetId: orgId,
      metadata: {
        liftReason: input.liftReason,
        clientMessage: input.liftedClientMessage,
        ref,
        soleOperator,
      },
    });
    await this.mirrors.mirror({
      organizationId: orgId,
      action: 'platform.organization.restored',
      targetType: 'organization',
      targetId: orgId,
      platformEventRef: ref,
      clientMessage: input.liftedClientMessage,
      soleOperator,
    });
    return this.summarizeOrganization(org);
  }

  // ── Utilisateurs ───────────────────────────────────────────────────────────

  /**
   * Recherche de comptes. La RECHERCHE OBLIGATOIRE (`q` de trois caractères au moins,
   * ADR-0053 § 2.6, F8) est jugée par le contrôleur ; ce service sert aussi la relecture
   * interne d'un compte par son adresse exacte (`userOrThrow`).
   */
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
    return this.summarizeUsers(rows);
  }

  private async summarizeUsers(rows: Array<Record<string, unknown>>): Promise<AdminUserSummary[]> {
    const ids = rows.map((r) => String(r['_id']));
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
      const id = String(r['_id']);
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

  /** Fiche détaillée d'un compte — lecture journalisée (`platform.user.viewed`). */
  async viewUser(
    userId: string,
    reason: PlatformViewReason,
    actor: AdminActor,
  ): Promise<AdminUserDetail> {
    const row = await this.userRowOrThrow(userId);
    const [summary] = await this.summarizeUsers([row]);
    const memberships = await this.memberships
      .find({ userId })
      .select({ organizationId: 1, role: 1 })
      .lean()
      .exec();
    const orgDocs = await this.orgs
      .find({ _id: { $in: memberships.map((m) => m.organizationId) } })
      .select({ name: 1 })
      .lean()
      .exec()
      .catch(() => []);
    const names = new Map(orgDocs.map((o) => [String(o._id), String(o.name)]));
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'platform.user.viewed',
      targetType: 'user',
      targetId: userId,
      metadata: { reason },
    });
    return {
      ...summary!,
      organizations: memberships.map((m) => ({
        id: m.organizationId,
        name: names.get(m.organizationId) ?? '',
        role: String(m.role),
      })),
      blockedReasonCategory: (row['disabledReasonCategory'] as string | null | undefined) ?? null,
    };
  }

  /**
   * Attribue un rôle plateforme (§ 5.3) : jamais à soi-même (`409 SELF_GRANT_FORBIDDEN`),
   * jamais à une adresse non vérifiée (`409 EMAIL_NOT_VERIFIED`, § 2.4) ; motif et
   * échéance du Support jugés par le schéma partagé.
   */
  async grantPlatformRole(
    userId: string,
    role: string,
    input: { reason: string; expiresAt?: string },
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    if (!isPlatformRole(role)) {
      throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: `Rôle inconnu : ${role}.` });
    }
    const self = platformRoleGrantDecision({ actorUserId: actor.userId, targetUserId: userId });
    if (!self.ok) {
      throw new ConflictException({
        code: self.code,
        message: 'Un opérateur ne s’attribue pas lui-même un rôle plateforme.',
      });
    }
    const row = await this.userRowOrThrow(userId);
    if (row['emailVerified'] !== true) {
      throw new ConflictException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'L’attributaire doit d’abord vérifier son adresse e-mail.',
      });
    }

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
            reason: input.reason,
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
        reason: input.reason,
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
   * Bloque un compte (ADR-0053 § 6.1) : catégorie et note interne obligatoires, sessions
   * révoquées, et — c'est la correction de F5 — connexion REFUSÉE ensuite :
   * `AuthGuard`, `PlatformAuthGuard` et le crochet better-auth de création de session
   * lisent `disabledAt` (`403 ACCOUNT_BLOCKED`). Miroir « Équipe Lalanda » dans le
   * journal de chacune de ses organisations.
   */
  async blockUser(
    userId: string,
    input: { reasonCategory: PlatformReasonCategory; internalNote: string },
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    if (userId === actor.userId) {
      throw new BadRequestException({
        code: 'SELF_DISABLE_FORBIDDEN',
        message: 'Un opérateur ne peut pas bloquer son propre compte.',
      });
    }
    const row = await this.userRowOrThrow(userId);
    if (row['disabledAt'] != null) {
      throw new ConflictException({
        code: 'ACCOUNT_ALREADY_BLOCKED',
        message: 'Ce compte est déjà bloqué.',
      });
    }
    const db = this.connection.db!;
    await db.collection('user').updateOne(
      { _id: row['_id'] as never },
      {
        $set: {
          disabledAt: new Date(),
          disabledReasonCategory: input.reasonCategory,
          disabledInternalNote: input.internalNote,
          disabledBy: actor.userId,
        },
      },
    );
    const revoked = await this.revokeSessionsOfUser(userId);
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'user.disabled',
      targetType: 'user',
      targetId: userId,
      metadata: {
        reasonCategory: input.reasonCategory,
        internalNote: input.internalNote,
        revokedSessions: revoked,
        ref,
      },
    });
    await this.mirrorToMemberships(userId, 'platform.member.blocked', ref);
    return this.userOrThrow(userId);
  }

  /** Débloque un compte : note interne obligatoire, comme pour bloquer (§ 5.3). */
  async unblockUser(
    userId: string,
    input: { internalNote: string },
    actor: AdminActor,
  ): Promise<AdminUserSummary> {
    const row = await this.userRowOrThrow(userId);
    if (row['disabledAt'] == null) {
      throw new ConflictException({
        code: 'ACCOUNT_NOT_BLOCKED',
        message: 'Ce compte n’est pas bloqué.',
      });
    }
    const db = this.connection.db!;
    await db.collection('user').updateOne(
      { _id: row['_id'] as never },
      {
        $set: { disabledAt: null },
        $unset: { disabledReasonCategory: '', disabledInternalNote: '', disabledBy: '' },
      },
    );
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'user.enabled',
      targetType: 'user',
      targetId: userId,
      metadata: { internalNote: input.internalNote, ref },
    });
    await this.mirrorToMemberships(userId, 'platform.member.unblocked', ref);
    return this.userOrThrow(userId);
  }

  // ── Séparation des tâches (ADR-0053 § 2.6) ─────────────────────────────────

  /**
   * `409 PLATFORM_SELF_DEALING` si l'opérateur est MEMBRE de l'organisation cible et
   * qu'un autre détenteur effectif de l'action existe ; seul détenteur : permis, marqué.
   */
  // ADR-0053 — P3 : public, réutilisé par la console des abonnements.
  async assertNoSelfDealing(
    gesture: PlatformSelfDealingGesture,
    action: PlatformAction,
    orgId: string,
    actor: AdminActor,
  ): Promise<{ soleOperator: boolean }> {
    const isMember =
      (await this.memberships
        .countDocuments({ userId: actor.userId, organizationId: orgId })
        .exec()) > 0;
    const decision = platformSelfDealingDecision({
      gesture,
      actorIsMemberOfTarget: isMember,
      holdersCount: isMember ? await this.effectiveHoldersCount(action) : 0,
    });
    if (!decision.ok) {
      throw new ConflictException({
        code: decision.code,
        message:
          'Vous êtes membre de cette organisation : un autre opérateur doit accomplir ce geste.',
      });
    }
    return { soleOperator: decision.soleOperator };
  }

  /**
   * Détenteurs EFFECTIFS d'une action plateforme : personnes distinctes dont un rôle
   * détenteur n'est ni révoqué ni expiré, et dont le compte n'est pas bloqué.
   */
  // ADR-0053 — P3 : public, réutilisé par les octrois manuels.
  async effectiveHoldersCount(action: PlatformAction): Promise<number> {
    const now = new Date();
    const userIds: string[] = await this.platformRoles
      .distinct('userId', {
        role: { $in: platformActionHolders(action) },
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .exec();
    const db = this.connection.db;
    if (!db || userIds.length === 0) return userIds.length;
    const { ObjectId } = await import('mongodb');
    const oids = userIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const blocked = await db
      .collection('user')
      .countDocuments({ _id: { $in: oids }, disabledAt: { $ne: null } });
    return userIds.length - blocked;
  }

  private async mirrorToMemberships(userId: string, action: string, ref: string): Promise<void> {
    const memberships = await this.memberships
      .find({ userId })
      .select({ organizationId: 1 })
      .lean()
      .exec();
    for (const m of memberships) {
      await this.mirrors.mirror({
        organizationId: m.organizationId,
        action,
        targetType: 'user',
        targetId: userId,
        platformEventRef: ref,
      });
    }
  }

  // ── Utilitaires ────────────────────────────────────────────────────────────

  private async orgOrThrow(orgId: string): Promise<OrganizationDocument> {
    const doc = await this.orgs
      .findById(orgId)
      .exec()
      .catch(() => null);
    if (!doc) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return doc;
  }

  private async emailOf(userId: string): Promise<string | null> {
    const db = this.connection.db;
    if (!db) return null;
    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(userId)) return null;
    const row = await db
      .collection('user')
      .findOne({ _id: new ObjectId(userId) }, { projection: { email: 1 } });
    return row ? String(row['email'] ?? '') || null : null;
  }

  private async userRowOrThrow(userId: string): Promise<Record<string, unknown>> {
    const db = this.connection.db;
    if (!db) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(userId)) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    const row = await db.collection('user').findOne({ _id: new ObjectId(userId) });
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    return row as Record<string, unknown>;
  }

  private async userOrThrow(userId: string): Promise<AdminUserSummary> {
    const row = await this.userRowOrThrow(userId);
    const [found] = await this.summarizeUsers([row]);
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
}

/** Première page des organisations, lisible sans recherche (§ 2.6). */
const FIRST_PAGE = 50;

function searchRequired(): BadRequestException {
  return new BadRequestException({
    code: 'SEARCH_REQUIRED',
    message: `Recherche : ${PLATFORM_LIMITS.searchMinLength} caractères au moins.`,
  });
}

/** Mode d'une suspension ; une suspension antérieure à P2 (sans mode) vaut `read_only`. */
function suspensionModeOf(mode: unknown): PlatformSuspensionMode {
  return mode === 'full' ? 'full' : 'read_only';
}

/** Échappe une saisie utilisateur avant construction d'une `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
}
