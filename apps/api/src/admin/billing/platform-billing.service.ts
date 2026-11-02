// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE DES ABONNEMENTS ET PAIEMENTS MANUELS (ADR-0053 § 6.2 — lot P3)
//
// Ce que fait ce service, et rien d'autre :
//
//   - LIRE des métadonnées d'abonnement (offre, état, échéances, moyen) et la file des
//     dépôts manuels : jamais un contenu d'organisation ;
//   - DÉCIDER d'un dépôt manuel (confirmer, refuser) au nom de la plateforme ;
//   - OCTROYER une offre sans paiement, avec une seconde personne au-delà de 90 jours ou
//     pour l'offre Expert (§ 5.3), et la RETIRER.
//
// Chaque geste écrit DEUX traces : le journal PLATEFORME (acteur réel, rôles RELUS,
// note interne) et, s'il touche le client, le miroir « Équipe Lalanda » dans SON journal
// (message client et référence, jamais l'opérateur — fuite F3 fermée).
//
// Ce qu'il ne fait PAS : encaisser, appeler un prestataire de paiement, émettre une
// pièce (reçu, facture) — ADR-0047 n'est pas tranché.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { PlatformReasonCategory } from '@lalanda/shared/platform';

import { platformGrantDecision } from '../../authz/platform-actions.js';
import { BillingRuleError, BillingService } from '../../billing/billing.service.js';
import type { Plan } from '../../billing/entitlements.js';
import { effectivePlanAt } from '../../billing/subscription-lifecycle.js';
import { isSubscriptionStatus, type SubscriptionStatus } from '../../billing/subscription-state.js';
import { Subscription, type SubscriptionDocument } from '../../billing/subscription.schema.js';
import { PlatformAuditService } from '../../integrations/platform-audit.service.js';
import {
  Organization,
  type OrganizationDocument,
} from '../../organizations/organization.schema.js';
import type { ManualPaymentRequestDocument } from '../../payments/manual-payment.schema.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { AdminService, type AdminActor } from '../admin.service.js';
import { newPlatformEventRef, PlatformMirrorService } from '../mirror.js';
import {
  PlanGrant,
  PLAN_GRANT_SCHEMA_VERSION,
  type PlanGrantDocument,
} from './plan-grant.schema.js';
import {
  isPlanGrantOpen,
  planGrantPeriod,
  planGrantPhase,
  type PlanGrantPhase,
} from './plan-grants.js';

// ── Vues servies à la console (métadonnées seulement) ─────────────────────────

export interface AdminSubscriptionView {
  organizationId: string;
  organizationName: string | null;
  plan: Plan;
  effectivePlan: Plan;
  status: SubscriptionStatus;
  billingInterval: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  provider: string | null;
  grant: { plan: Plan; endsAt: string | null } | null;
  updatedAt: string | null;
}

export interface AdminManualPaymentView {
  reference: string;
  organizationId: string;
  organizationName: string | null;
  plan: string;
  interval: string;
  amountDueCents: number;
  currency: string;
  method: string;
  status: ManualPaymentRequestDocument['status'];
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

export interface AdminPlanGrantView {
  id: string;
  targetOrganizationId: string;
  organizationName: string | null;
  plan: Plan;
  reasonCategory: string;
  clientMessage: string;
  internalNote: string;
  startsAt: string;
  endsAt: string | null;
  status: PlanGrantDocument['status'];
  phase: PlanGrantPhase;
  grantedBy: string;
  approvedBy: string | null;
  soleApprover: boolean;
  soleOperator: boolean;
  revokedAt: string | null;
  createdAt: string;
}

export interface ManualDecisionInput {
  note: string;
  clientMessage?: string;
}

export interface PlanGrantCreateInput {
  targetOrganizationId: string;
  plan: Plan;
  reasonCategory: PlatformReasonCategory;
  clientMessage: string;
  internalNote: string;
  startsAt?: string;
  endsAt?: string;
}

const LIST_MAX = 200;

@Injectable()
export class PlatformBillingService {
  constructor(
    @InjectModel(PlanGrant.name) private readonly grants: Model<PlanGrantDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(PlatformMirrorService) private readonly mirrors: PlatformMirrorService,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  // ── Abonnements ────────────────────────────────────────────────────────────

  async listSubscriptions(
    filter: { status?: string; limit?: number },
    now: Date = new Date(),
  ): Promise<AdminSubscriptionView[]> {
    const query: Record<string, unknown> = {};
    if (filter.status !== undefined && filter.status !== '') {
      if (!isSubscriptionStatus(filter.status)) {
        throw new BadRequestException({ code: 'INVALID_STATUS', message: 'État inconnu.' });
      }
      query['status'] = filter.status;
    }
    const docs = await this.subscriptions
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(clampLimit(filter.limit))
      .exec();
    const names = await this.namesOf(docs.map((d) => d.organizationId));
    return docs.map((d) => ({
      organizationId: d.organizationId,
      organizationName: names.get(d.organizationId) ?? null,
      plan: d.plan,
      effectivePlan: effectivePlanAt(d, now),
      status: d.status,
      billingInterval: d.billingInterval ?? 'month',
      trialEndsAt: iso(d.trialEndsAt),
      currentPeriodEnd: iso(d.currentPeriodEnd),
      graceEndsAt: iso(d.graceEndsAt),
      provider: d.provider ?? null,
      grant: d.grantPlan ? { plan: d.grantPlan, endsAt: iso(d.grantEndsAt) } : null,
      updatedAt: iso((d as unknown as { updatedAt?: Date }).updatedAt),
    }));
  }

  // ── Paiements manuels ──────────────────────────────────────────────────────

  async listManualPayments(filter: {
    status?: string;
    limit?: number;
  }): Promise<AdminManualPaymentView[]> {
    const statuses = ['pending', 'confirmed', 'rejected', 'expired'] as const;
    let status: (typeof statuses)[number] | undefined;
    if (filter.status !== undefined && filter.status !== '') {
      if (!(statuses as readonly string[]).includes(filter.status)) {
        throw new BadRequestException({ code: 'INVALID_STATUS', message: 'État inconnu.' });
      }
      status = filter.status as (typeof statuses)[number];
    }
    const rows = await this.payments.listManualRequests(
      status ? { status } : {},
      clampLimit(filter.limit),
    );
    const names = await this.namesOf(rows.map((r) => r.organizationId));
    return rows.map((r) => ({
      reference: r.reference,
      organizationId: r.organizationId,
      organizationName: names.get(r.organizationId) ?? null,
      plan: r.plan,
      interval: r.interval,
      amountDueCents: r.amountDueCents,
      currency: r.currency,
      method: r.method,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      decidedAt: iso(r.decidedAt),
    }));
  }

  /** Confirme un dépôt reçu : rôle réel au journal plateforme, miroir côté client. */
  async confirmManualPayment(
    reference: string,
    input: ManualDecisionInput,
    actor: AdminActor,
  ): Promise<{ confirmed: true; organizationId: string; plan: Plan }> {
    const organizationId = await this.organizationOfRequest(reference);
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.confirm',
      'platform.billing.confirm',
      organizationId,
      actor,
    );
    const outcome = await this.decide(() =>
      this.payments.confirmManualPayment({
        reference,
        adminUserId: actor.userId,
        note: input.note,
      }),
    );
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.manual_payment.confirmed',
      targetType: 'organization',
      targetId: outcome.organizationId,
      metadata: {
        reference,
        plan: outcome.plan,
        interval: outcome.interval,
        amountDueCents: outcome.amountDueCents,
        currency: outcome.currency,
        method: outcome.method,
        internalNote: input.note,
        clientMessage: input.clientMessage ?? null,
        ref,
        soleOperator,
      },
    });
    await this.mirrors.mirror({
      organizationId: outcome.organizationId,
      action: 'platform.billing.manual_payment_confirmed',
      targetType: 'organization',
      targetId: outcome.organizationId,
      platformEventRef: ref,
      clientMessage: input.clientMessage ?? null,
      soleOperator,
      facts: { reference, plan: outcome.plan },
    });
    return { confirmed: true, organizationId: outcome.organizationId, plan: outcome.plan };
  }

  /** Refuse un dépôt : désormais JOURNALISÉ (F3), des deux côtés. */
  async rejectManualPayment(
    reference: string,
    input: ManualDecisionInput,
    actor: AdminActor,
  ): Promise<{ rejected: true; organizationId: string }> {
    const organizationId = await this.organizationOfRequest(reference);
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.confirm',
      'platform.billing.confirm',
      organizationId,
      actor,
    );
    const outcome = await this.decide(() =>
      this.payments.rejectManualPayment({ reference, adminUserId: actor.userId, note: input.note }),
    );
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.manual_payment.rejected',
      targetType: 'organization',
      targetId: outcome.organizationId,
      metadata: {
        reference,
        plan: outcome.plan,
        amountDueCents: outcome.amountDueCents,
        currency: outcome.currency,
        method: outcome.method,
        internalNote: input.note,
        clientMessage: input.clientMessage ?? null,
        ref,
        soleOperator,
      },
    });
    await this.mirrors.mirror({
      organizationId: outcome.organizationId,
      action: 'platform.billing.manual_payment_rejected',
      targetType: 'organization',
      targetId: outcome.organizationId,
      platformEventRef: ref,
      clientMessage: input.clientMessage ?? null,
      soleOperator,
      facts: { reference, plan: outcome.plan },
    });
    return { rejected: true, organizationId: outcome.organizationId };
  }

  /** Balayage des essais et grâces échus (commodité, § 6.2) — journalisé. */
  async sweep(actor: AdminActor): Promise<{ scanned: number; changed: number }> {
    const result = await this.billing.sweep();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.sweep',
      targetType: 'platform',
      targetId: 'subscriptions',
      metadata: { scanned: result.scanned, changed: result.changed },
    });
    return result;
  }

  // ── Octrois manuels ────────────────────────────────────────────────────────

  async listGrants(
    filter: { organizationId?: string; limit?: number },
    now: Date = new Date(),
  ): Promise<AdminPlanGrantView[]> {
    const query: Record<string, unknown> = {};
    if (filter.organizationId) query['targetOrganizationId'] = filter.organizationId;
    const docs = await this.grants
      .find(query)
      .sort({ createdAt: -1 })
      .limit(clampLimit(filter.limit))
      .exec();
    const names = await this.namesOf(docs.map((d) => d.targetOrganizationId));
    return docs.map((d) => this.view(d, names.get(d.targetOrganizationId) ?? null, now));
  }

  /**
   * Prépare un octroi. Actif tout de suite s'il ne demande pas de seconde personne (ou
   * si l'auteur est le seul détenteur, marqué) ; sinon `pending_approval`.
   */
  async createGrant(input: PlanGrantCreateInput, actor: AdminActor): Promise<AdminPlanGrantView> {
    const now = new Date();
    const period = planGrantPeriod({
      plan: input.plan,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      now,
    });
    if (!period.ok) {
      throw new BadRequestException({
        code: period.code,
        message:
          period.code === 'GRANT_PLAN_INVALID'
            ? 'Un octroi accorde une offre payante : pour revenir au gratuit, retirez l’octroi.'
            : 'Période invalide : la fin suit le début et n’est pas passée.',
      });
    }
    const org = await this.orgOrThrow(input.targetOrganizationId);
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.grant',
      'platform.billing.grant',
      input.targetOrganizationId,
      actor,
    );
    await this.assertNoOpenGrant(input.targetOrganizationId, now);

    const decision = platformGrantDecision({
      plan: input.plan,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      requestedBy: actor.userId,
      approverUserId: null,
      holdersCount: await this.admin.effectiveHoldersCount('platform.billing.grant'),
    });
    // À la création, l'approbateur est nul : la décision ne peut pas refuser.
    if (!decision.ok) throw new ConflictException({ code: decision.code });

    const doc = await this.grants.create({
      targetOrganizationId: input.targetOrganizationId,
      plan: input.plan,
      reasonCategory: input.reasonCategory,
      clientMessage: input.clientMessage,
      internalNote: input.internalNote,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      status: decision.status,
      grantedBy: actor.userId,
      approvedBy: null,
      approvedAt: null,
      soleApprover: decision.status === 'active' ? decision.soleApprover : false,
      soleOperator,
      _schemaVersion: PLAN_GRANT_SCHEMA_VERSION,
    });

    if (doc.status === 'active') {
      await this.activate(doc, actor, now);
    } else {
      await this.audit.record({
        actorUserId: actor.userId,
        actorRole: actor.platformRole,
        action: 'billing.plan_grant.requested',
        targetType: 'organization',
        targetId: doc.targetOrganizationId,
        metadata: this.auditFacts(doc),
      });
    }
    return this.view(doc, org.name, now);
  }

  /** Approbation par une SECONDE personne détentrice de `platform.billing.grant`. */
  async approveGrant(
    id: string,
    input: { internalNote?: string },
    actor: AdminActor,
  ): Promise<AdminPlanGrantView> {
    const now = new Date();
    const doc = await this.grantOrThrow(id);
    if (doc.status !== 'pending_approval') {
      throw new ConflictException({
        code: 'GRANT_NOT_PENDING',
        message: 'Cet octroi n’attend aucune approbation.',
      });
    }
    if (doc.endsAt && doc.endsAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'GRANT_PERIOD_INVALID',
        message: 'L’échéance de cet octroi est passée : retirez-le et préparez-en un autre.',
      });
    }
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.grant',
      'platform.billing.grant',
      doc.targetOrganizationId,
      actor,
    );
    const decision = platformGrantDecision({
      plan: doc.plan,
      startsAt: doc.startsAt,
      endsAt: doc.endsAt,
      requestedBy: doc.grantedBy,
      approverUserId: actor.userId,
      holdersCount: await this.admin.effectiveHoldersCount('platform.billing.grant'),
    });
    if (!decision.ok) {
      throw new ConflictException({
        code: decision.code,
        message: 'L’auteur d’un octroi ne l’approuve pas : une seconde personne est requise.',
      });
    }
    if (decision.status !== 'active') throw new ConflictException({ code: 'GRANT_NOT_PENDING' });

    doc.status = 'active';
    doc.approvedBy = actor.userId;
    doc.approvedAt = now;
    doc.soleApprover = decision.soleApprover;
    doc.soleOperator = doc.soleOperator || soleOperator;
    await doc.save();
    await this.activate(doc, actor, now, input.internalNote ?? null);
    const org = await this.orgs
      .findById(doc.targetOrganizationId)
      .select({ name: 1 })
      .lean()
      .exec();
    return this.view(doc, org?.name ?? null, now);
  }

  /**
   * Retire un octroi : en vigueur ou programmé, l'abonnement le perd (miroir côté
   * client) ; en attente, la demande est annulée (rien n'avait touché le client).
   */
  async revokeGrant(
    id: string,
    input: { internalNote: string; clientMessage: string },
    actor: AdminActor,
  ): Promise<AdminPlanGrantView> {
    const now = new Date();
    const doc = await this.grantOrThrow(id);
    if (doc.status === 'revoked') {
      throw new ConflictException({
        code: 'GRANT_ALREADY_REVOKED',
        message: 'Cet octroi est déjà retiré.',
      });
    }
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.grant',
      'platform.billing.grant',
      doc.targetOrganizationId,
      actor,
    );
    const wasActive = doc.status === 'active';
    doc.status = 'revoked';
    doc.revokedAt = now;
    doc.revokedBy = actor.userId;
    doc.revokeNote = input.internalNote;
    await doc.save();

    const ref = newPlatformEventRef();
    if (wasActive) {
      await this.billing.clearPlanGrant({
        organizationId: doc.targetOrganizationId,
        grantId: String(doc._id),
        now,
      });
    }
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: wasActive ? 'billing.plan_grant.revoked' : 'billing.plan_grant.canceled',
      targetType: 'organization',
      targetId: doc.targetOrganizationId,
      metadata: {
        ...this.auditFacts(doc),
        revokeNote: input.internalNote,
        revokeClientMessage: input.clientMessage,
        ref,
        soleOperator,
      },
    });
    if (wasActive) {
      await this.mirrors.mirror({
        organizationId: doc.targetOrganizationId,
        action: 'platform.billing.plan_grant_revoked',
        targetType: 'organization',
        targetId: doc.targetOrganizationId,
        platformEventRef: ref,
        clientMessage: input.clientMessage,
        soleOperator,
        facts: { plan: doc.plan },
      });
    }
    const org = await this.orgs
      .findById(doc.targetOrganizationId)
      .select({ name: 1 })
      .lean()
      .exec();
    return this.view(doc, org?.name ?? null, now);
  }

  /** Octroi OUVERT d'une organisation (en attente, programmé ou en vigueur), ou `null`. */
  async openGrantOf(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<PlanGrantDocument | null> {
    const docs = await this.grants
      .find({
        targetOrganizationId: organizationId,
        status: { $in: ['active', 'pending_approval'] },
      })
      .sort({ createdAt: -1 })
      .exec();
    return docs.find((d) => isPlanGrantOpen(d, now)) ?? null;
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  /** Pose l'octroi sur l'abonnement (`plan.granted`), journal plateforme et miroir. */
  private async activate(
    doc: PlanGrantDocument,
    actor: AdminActor,
    now: Date,
    approvalNote: string | null = null,
  ): Promise<void> {
    await this.billing.applyPlanGrant({
      organizationId: doc.targetOrganizationId,
      grantId: String(doc._id),
      plan: doc.plan,
      startsAt: doc.startsAt,
      endsAt: doc.endsAt,
      now,
    });
    const ref = newPlatformEventRef();
    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.plan_granted',
      targetType: 'organization',
      targetId: doc.targetOrganizationId,
      metadata: { ...this.auditFacts(doc), approvalNote, ref },
    });
    await this.mirrors.mirror({
      organizationId: doc.targetOrganizationId,
      action: 'platform.billing.plan_granted',
      targetType: 'organization',
      targetId: doc.targetOrganizationId,
      platformEventRef: ref,
      clientMessage: doc.clientMessage,
      soleOperator: doc.soleOperator || doc.soleApprover,
      facts: {
        plan: doc.plan,
        startsAt: doc.startsAt.toISOString(),
        endsAt: iso(doc.endsAt),
      },
    });
  }

  private auditFacts(doc: PlanGrantDocument): Record<string, string | boolean | null> {
    return {
      grantId: String(doc._id),
      plan: doc.plan,
      reasonCategory: doc.reasonCategory,
      clientMessage: doc.clientMessage,
      internalNote: doc.internalNote,
      startsAt: doc.startsAt.toISOString(),
      endsAt: iso(doc.endsAt),
      status: doc.status,
      grantedBy: doc.grantedBy,
      approvedBy: doc.approvedBy,
      soleApprover: doc.soleApprover,
      soleOperator: doc.soleOperator,
    };
  }

  private async assertNoOpenGrant(organizationId: string, now: Date): Promise<void> {
    const open = await this.grants
      .find({
        targetOrganizationId: organizationId,
        status: { $in: ['active', 'pending_approval'] },
      })
      .exec();
    if (open.some((g) => isPlanGrantOpen(g, now))) {
      throw new ConflictException({
        code: 'GRANT_ALREADY_OPEN',
        message:
          'Un octroi est déjà en cours ou en attente : retirez-le avant d’en poser un autre.',
      });
    }
  }

  private async organizationOfRequest(reference: string): Promise<string> {
    const request = await this.payments.findManualRequest(reference);
    if (!request) {
      throw new NotFoundException({
        code: 'MANUAL_REQUEST_NOT_FOUND',
        message: 'Référence de paiement inconnue.',
      });
    }
    return request.organizationId;
  }

  /** Traduit les refus métier du circuit de paiement en réponses HTTP stables. */
  private async decide<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BillingRuleError) {
        if (error.code === 'MANUAL_REQUEST_NOT_FOUND') {
          throw new NotFoundException({ code: error.code, message: error.message });
        }
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  private view(
    doc: PlanGrantDocument,
    organizationName: string | null,
    now: Date,
  ): AdminPlanGrantView {
    return {
      id: String(doc._id),
      targetOrganizationId: doc.targetOrganizationId,
      organizationName,
      plan: doc.plan,
      reasonCategory: doc.reasonCategory,
      clientMessage: doc.clientMessage,
      internalNote: doc.internalNote,
      startsAt: doc.startsAt.toISOString(),
      endsAt: iso(doc.endsAt),
      status: doc.status,
      phase: planGrantPhase(doc, now),
      grantedBy: doc.grantedBy,
      approvedBy: doc.approvedBy ?? null,
      soleApprover: doc.soleApprover === true,
      soleOperator: doc.soleOperator === true,
      revokedAt: iso(doc.revokedAt),
      createdAt: doc.createdAt.toISOString(),
    };
  }

  private async grantOrThrow(id: string): Promise<PlanGrantDocument> {
    const doc = await this.grants
      .findById(id)
      .exec()
      .catch(() => null);
    if (!doc) throw new NotFoundException({ code: 'GRANT_NOT_FOUND' });
    return doc;
  }

  private async orgOrThrow(id: string): Promise<OrganizationDocument> {
    const doc = await this.orgs
      .findById(id)
      .exec()
      .catch(() => null);
    if (!doc) throw new NotFoundException({ code: 'ORG_NOT_FOUND' });
    return doc;
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter((id) => /^[0-9a-f]{24}$/i.test(id));
    if (unique.length === 0) return new Map();
    const rows = await this.orgs
      .find({ _id: { $in: unique } })
      .select({ name: 1 })
      .lean()
      .exec();
    return new Map(rows.map((r) => [String(r._id), String(r.name ?? '')]));
  }
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit), 1), LIST_MAX);
}
