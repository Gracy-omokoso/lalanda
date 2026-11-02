// ─────────────────────────────────────────────────────────────────────────────
// ACCÈS AUX FONCTIONNALITÉS PAR OFFRE (ADR-0053 § 6.3 — lot P4)
//
// Trois lecteurs, une seule décision (`featureAccessDecision`, @lalanda/shared) :
//
//   - `FeatureGuard` (API) : refuse un GESTE (écriture) hors offre, `403
//     FEATURE_NOT_IN_PLAN` avec l'offre minimale ;
//   - `GET /me/features` : ce que l'organisation active peut faire, pour que
//     l'interface EXPLIQUE au lieu de cacher ;
//   - `GET /admin/features` : la grille en lecture seule et les dérogations actives.
//
// ── Grille entièrement ouverte ───────────────────────────────────────────────
//
// La grille vient du catalogue (`DEFAULT_FEATURE_GRID`), ouverte à toutes les offres
// (docs/13 « À ARBITRER »). Tant qu'une fonctionnalité est ouverte partout, la garde
// ne lit RIEN en base (`isOpenEverywhere`) : aucune organisation ne perd d'accès,
// aucune requête ne coûte un aller-retour de plus.
//
// ── Dérogations ──────────────────────────────────────────────────────────────
//
// Geste de console : motif, échéance de 90 jours au plus, ré-authentification (route),
// conflit d'intérêts (§ 2.6), journal plateforme avec l'acteur réel, miroir
// « Équipe Lalanda » dans le journal du client (raison générique, jamais l'opérateur ni
// la note interne). Une dérogation OUVRE ; elle ne ferme jamais (voir le schéma).
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

import {
  PLATFORM_REASON_CATEGORY_LABELS,
  type PlatformReasonCategory,
} from '@lalanda/shared/platform';
import {
  DEFAULT_FEATURE_GRID,
  FEATURE_KEYS,
  FEATURE_PLAN_ORDER,
  FEATURES,
  featureAccessDecision,
  isFeatureKey,
  isFeatureOpenEverywhere,
  minimalPlanFor,
  type FeatureAccessDecision,
  type FeatureGrid,
  type FeatureKey,
  type FeatureModule,
  type MyFeaturesView,
  type Plan,
} from '@lalanda/shared/pricing';

import { AuthzService } from '../../authz/authz.service.js';
import {
  platformActionHolders,
  platformSelfDealingDecision,
} from '../../authz/platform-actions.js';
import {
  PlatformRoleAssignment,
  type PlatformRoleAssignmentDocument,
} from '../../authz/platform-role-assignment.schema.js';
import { BillingService } from '../../billing/billing.service.js';
import { PlatformAuditService } from '../../integrations/platform-audit.service.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import {
  Organization,
  type OrganizationDocument,
} from '../../organizations/organization.schema.js';
import { newPlatformEventRef, PlatformMirrorService } from '../mirror.js';
import {
  PlatformFeatureOverride,
  type PlatformFeatureOverrideDocument,
} from './feature-override.schema.js';

export interface FeatureOverrideView {
  id: string;
  targetOrganizationId: string;
  organizationName: string | null;
  feature: FeatureKey;
  reasonCategory: string;
  endsAt: string;
  createdAt: string | null;
}

export interface AdminFeaturesView {
  plans: readonly Plan[];
  features: Array<{
    key: FeatureKey;
    label: string;
    module: FeatureModule;
    apiPrefixes: readonly string[];
    plans: Record<Plan, boolean>;
    minimalPlan: Plan | null;
  }>;
  /** Cases fermées de la grille : 0 tant que docs/13 n'est pas arbitré. */
  closedCells: number;
  overrides: FeatureOverrideView[];
}

export interface FeatureOverrideInput {
  targetOrganizationId: string;
  feature: string;
  value: boolean;
  reasonCategory: PlatformReasonCategory;
  internalNote: string;
  endsAt: string;
}

@Injectable()
export class FeatureAccessService {
  private grid: FeatureGrid = DEFAULT_FEATURE_GRID;

  constructor(
    @InjectModel(PlatformFeatureOverride.name)
    private readonly overrides: Model<PlatformFeatureOverrideDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Organization.name) private readonly organizations: Model<OrganizationDocument>,
    @InjectModel(PlatformRoleAssignment.name)
    private readonly platformRoles: Model<PlatformRoleAssignmentDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(PlatformMirrorService) private readonly mirrors: PlatformMirrorService,
  ) {}

  // ── Grille ─────────────────────────────────────────────────────────────────

  currentGrid(): FeatureGrid {
    return this.grid;
  }

  /**
   * Remplace la grille — TESTS SEULEMENT (critère 18 : « une grille de test fermant
   * `crm` à `free` »). Refusé en production : la grille d'un déploiement est celle
   * du catalogue, revue et versionnée. `null` rétablit la grille du catalogue.
   */
  replaceGridForTesting(grid: FeatureGrid | null): void {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('La grille des fonctionnalités ne se remplace pas en production.');
    }
    this.grid = grid ?? DEFAULT_FEATURE_GRID;
  }

  /** Chemin rapide de la garde : aucune lecture en base si la case est ouverte partout. */
  isOpenEverywhere(feature: FeatureKey): boolean {
    return isFeatureOpenEverywhere(this.grid, feature);
  }

  // ── Décision ───────────────────────────────────────────────────────────────

  async decide(
    organizationId: string,
    feature: FeatureKey,
    now: Date = new Date(),
  ): Promise<FeatureAccessDecision> {
    if (this.isOpenEverywhere(feature)) return { allowed: true, source: 'plan' };
    const plan = await this.billing.getPlan(organizationId, now);
    if (this.grid[feature][plan]) return { allowed: true, source: 'plan' };
    const override = await this.activeOverride(organizationId, feature, now);
    return featureAccessDecision({
      grid: this.grid,
      feature,
      plan,
      overrideEndsAt: override?.endsAt ?? null,
      now,
    });
  }

  private async activeOverride(
    organizationId: string,
    feature: FeatureKey,
    now: Date,
  ): Promise<{ endsAt: Date; reasonCategory: string } | null> {
    const doc = await this.overrides
      .findOne({
        targetOrganizationId: organizationId,
        feature,
        value: true,
        revokedAt: null,
        endsAt: { $gt: now },
      })
      .sort({ endsAt: -1 })
      .lean()
      .exec();
    return doc ? { endsAt: doc.endsAt, reasonCategory: doc.reasonCategory } : null;
  }

  /** `GET /me/features` : effet et raison générique, jamais l'opérateur ni la note. */
  async myFeatures(organizationId: string, now: Date = new Date()): Promise<MyFeaturesView> {
    const plan = await this.billing.getPlan(organizationId, now);
    const active = await this.overrides
      .find({
        targetOrganizationId: organizationId,
        value: true,
        revokedAt: null,
        endsAt: { $gt: now },
      })
      .sort({ endsAt: -1 })
      .lean()
      .exec();
    const parFonction = new Map<string, { endsAt: Date; reasonCategory: string }>();
    for (const o of active) if (!parFonction.has(o.feature)) parFonction.set(o.feature, o);

    return {
      plan,
      features: FEATURE_KEYS.map((key) => {
        const def = FEATURES[key];
        const override = parFonction.get(key) ?? null;
        const decision = featureAccessDecision({
          grid: this.grid,
          feature: key,
          plan,
          overrideEndsAt: override?.endsAt ?? null,
          now,
        });
        const status = !decision.allowed
          ? ('not_in_plan' as const)
          : decision.source === 'override'
            ? ('override' as const)
            : ('included' as const);
        return {
          key,
          label: def.label,
          module: def.module,
          status,
          minimalPlan: minimalPlanFor(this.grid, key),
          overrideEndsAt: status === 'override' ? override!.endsAt.toISOString() : null,
          overrideReason: status === 'override' ? genericReason(override!.reasonCategory) : null,
        };
      }),
    };
  }

  // ── Console ────────────────────────────────────────────────────────────────

  async adminView(now: Date = new Date()): Promise<AdminFeaturesView> {
    const features = FEATURE_KEYS.map((key) => {
      const def = FEATURES[key];
      return {
        key,
        label: def.label,
        module: def.module,
        apiPrefixes: def.apiPrefixes,
        plans: { ...this.grid[key] },
        minimalPlan: minimalPlanFor(this.grid, key),
      };
    });
    const closedCells = features.reduce(
      (n, f) => n + FEATURE_PLAN_ORDER.filter((p) => !f.plans[p]).length,
      0,
    );
    const docs = await this.overrides
      .find({ revokedAt: null, endsAt: { $gt: now } })
      .sort({ endsAt: 1 })
      .limit(500)
      .lean()
      .exec();
    return { plans: FEATURE_PLAN_ORDER, features, closedCells, overrides: await this.views(docs) };
  }

  async grant(input: FeatureOverrideInput, actorUserId: string): Promise<FeatureOverrideView> {
    if (!isFeatureKey(input.feature)) {
      throw new BadRequestException({
        code: 'UNKNOWN_FEATURE',
        message: `Fonctionnalité inconnue : ${input.feature}.`,
      });
    }
    if (input.value !== true) {
      throw new BadRequestException({
        code: 'OVERRIDE_VALUE_UNSUPPORTED',
        message:
          'Une dérogation ouvre une fonctionnalité ; la fermer appartient à la grille des offres (docs/13).',
      });
    }
    const feature = input.feature;
    const orgId = input.targetOrganizationId;
    const org = await this.organizations.findById(orgId).select({ _id: 1 }).lean().exec();
    if (!org) {
      throw new NotFoundException({ code: 'ORG_NOT_FOUND', message: 'Organisation inconnue.' });
    }
    const { soleOperator } = await this.assertNoSelfDealing(orgId, actorUserId);

    const doc = await this.overrides.create({
      targetOrganizationId: orgId,
      feature,
      value: true,
      reasonCategory: input.reasonCategory,
      internalNote: input.internalNote,
      endsAt: new Date(input.endsAt),
      grantedBy: actorUserId,
      revokedAt: null,
      revokedBy: null,
      _schemaVersion: 1,
    });

    const ref = newPlatformEventRef();
    const endsAt = doc.endsAt.toISOString();
    await this.audit.record({
      actorUserId,
      actorRole: await this.rolesOf(actorUserId),
      action: 'feature.override_granted',
      targetType: 'organization',
      targetId: orgId,
      metadata: {
        overrideId: String(doc._id),
        feature,
        endsAt,
        reasonCategory: input.reasonCategory,
        internalNote: input.internalNote,
        ref,
        soleOperator,
      },
    });
    await this.mirrors.mirror({
      organizationId: orgId,
      action: 'platform.feature.override_granted',
      targetType: 'organization',
      targetId: orgId,
      platformEventRef: ref,
      clientMessage: null,
      soleOperator,
      facts: { feature, endsAt, reason: genericReason(input.reasonCategory) },
    });
    return (await this.views([doc.toObject()]))[0]!;
  }

  async revoke(
    overrideId: string,
    internalNote: string,
    actorUserId: string,
  ): Promise<FeatureOverrideView> {
    const doc = /^[0-9a-f]{24}$/i.test(overrideId)
      ? await this.overrides.findById(overrideId).exec()
      : null;
    if (!doc || doc.revokedAt !== null) {
      throw new NotFoundException({
        code: 'OVERRIDE_NOT_FOUND',
        message: 'Dérogation inconnue ou déjà levée.',
      });
    }
    const orgId = doc.targetOrganizationId;
    const { soleOperator } = await this.assertNoSelfDealing(orgId, actorUserId);
    doc.revokedAt = new Date();
    doc.revokedBy = actorUserId;
    await doc.save();

    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId,
      actorRole: await this.rolesOf(actorUserId),
      action: 'feature.override_revoked',
      targetType: 'organization',
      targetId: orgId,
      metadata: { overrideId, feature: doc.feature, internalNote, ref, soleOperator },
    });
    await this.mirrors.mirror({
      organizationId: orgId,
      action: 'platform.feature.override_revoked',
      targetType: 'organization',
      targetId: orgId,
      platformEventRef: ref,
      clientMessage: null,
      soleOperator,
      facts: { feature: doc.feature },
    });
    return (await this.views([doc.toObject()]))[0]!;
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  private async views(
    docs: Array<PlatformFeatureOverride & { _id: unknown; createdAt?: Date }>,
  ): Promise<FeatureOverrideView[]> {
    const ids = [...new Set(docs.map((d) => d.targetOrganizationId))];
    const orgs = await this.organizations
      .find({ _id: { $in: ids } })
      .select({ name: 1 })
      .lean()
      .exec();
    const noms = new Map(orgs.map((o) => [String(o._id), String(o.name)]));
    return docs
      .filter((d) => isFeatureKey(d.feature))
      .map((d) => ({
        id: String(d._id),
        targetOrganizationId: d.targetOrganizationId,
        organizationName: noms.get(d.targetOrganizationId) ?? null,
        feature: d.feature as FeatureKey,
        reasonCategory: d.reasonCategory,
        endsAt: new Date(d.endsAt).toISOString(),
        createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      }));
  }

  /** Rôles RÉELLEMENT détenus, comme `AdminController.actorOf` (jamais déduits de la route). */
  private async rolesOf(userId: string): Promise<string> {
    return (await this.authz.platformRolesOf(userId)).join(',') || 'aucun';
  }

  /**
   * § 2.6 — un opérateur MEMBRE de l'organisation cible n'accorde ni ne lève de
   * dérogation (`409 PLATFORM_SELF_DEALING`) ; seul détenteur : permis, marqué.
   * Même règle et même décompte que `AdminService.assertNoSelfDealing` (P2).
   */
  private async assertNoSelfDealing(
    orgId: string,
    actorUserId: string,
  ): Promise<{ soleOperator: boolean }> {
    const isMember =
      (await this.memberships
        .countDocuments({ userId: actorUserId, organizationId: orgId })
        .exec()) > 0;
    const decision = platformSelfDealingDecision({
      gesture: 'features.override',
      actorIsMemberOfTarget: isMember,
      holdersCount: isMember ? await this.effectiveHoldersCount() : 0,
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

  private async effectiveHoldersCount(): Promise<number> {
    const now = new Date();
    const userIds: string[] = await this.platformRoles
      .distinct('userId', {
        role: { $in: platformActionHolders('platform.features.override') },
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
}

/** Raison GÉNÉRIQUE servie au client : le libellé de la catégorie, rien d'autre. */
function genericReason(category: string): string {
  return (
    PLATFORM_REASON_CATEGORY_LABELS[category as PlatformReasonCategory] ??
    PLATFORM_REASON_CATEGORY_LABELS.other
  );
}
