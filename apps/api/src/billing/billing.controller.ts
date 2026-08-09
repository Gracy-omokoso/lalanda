// ─────────────────────────────────────────────────────────────────────────────
// ROUTES D'ABONNEMENT (S16b → S22b)
//
// `GET /organizations/current/subscription` existait en S16b et reste
// COMPATIBLE : `{ plan, entitlements, usage }` sont toujours là, aux mêmes
// emplacements. Les champs de cycle de vie sont ajoutés à côté. Le web S16b
// continue de fonctionner sans modification — une rupture de contrat sur la
// route qui décide de l'accès payant n'aurait aucune justification.
//
// `plan` répond désormais le plan EFFECTIF (celui auquel le client a droit
// aujourd'hui) et non le plan souscrit. C'est un changement de sémantique, pas
// de forme, et c'est le bon sens de lecture : une organisation Business
// suspendue pour impayé doit être vue comme `free` par tout ce qui applique une
// limite. `subscribedPlan` porte l'autre valeur pour l'affichage.
//
// Toutes les mutations exigent `billing.manage` (docs/12) : c'est l'action que
// la matrice réserve au propriétaire et à l'administrateur. Un analyste ne
// résilie pas l'abonnement de son organisation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { Project, type ProjectDocument } from '../projects/project.schema.js';
import { BillingService, toConflict, type SubscriptionState } from './billing.service.js';
import { PLANS, type Entitlements, type Plan } from './entitlements.js';
import {
  BILLING_CURRENCY,
  GRACE_DAYS,
  PLAN_PRICES,
  TRIAL_DAYS,
  isBillingInterval,
  isSellable,
  type BillingInterval,
} from './pricing-catalog.js';
import { planRank } from './pricing-catalog.js';

/**
 * Vue d'abonnement. Le préfixe S16b (`plan`, `entitlements`, `usage`) est
 * conservé tel quel — voir l'en-tête de ce fichier.
 */
export interface SubscriptionView {
  plan: Plan;
  entitlements: Entitlements;
  usage: { projects: number };
  // ── S22b ────────────────────────────────────────────────────────────────
  subscribedPlan: Plan;
  status: SubscriptionState['status'];
  billingInterval: BillingInterval;
  paidAccess: boolean;
  trial: {
    /** Essai déjà consommé — une seule période par organisation (docs/13). */
    used: boolean;
    endsAt: string | null;
    daysLeft: number | null;
    /** L'organisation peut-elle démarrer un essai maintenant ? */
    eligible: boolean;
    days: number;
  };
  currentPeriodEnd: string | null;
  grace: { endsAt: string | null; daysLeft: number | null; days: number };
  pendingChange: { plan: Plan; interval: BillingInterval; effectiveAt: string | null } | null;
  provider: string | null;
  notice: SubscriptionState['notice'];
}

interface PlanChangeBody {
  plan?: unknown;
  interval?: unknown;
}

@Controller('organizations')
@UseGuards(AuthGuard, PermissionsGuard)
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @InjectModel(Project.name) private readonly projects: Model<ProjectDocument>,
  ) {}

  @Get('current/subscription')
  @RequirePermission('analytics.read')
  async current(@CurrentOrgId() orgId: string): Promise<SubscriptionView> {
    const [state, projectCount] = await Promise.all([
      this.billing.getState(orgId),
      this.projects.countDocuments({ organizationId: orgId }).exec(),
    ]);
    return toView(state, projectCount);
  }

  /**
   * Démarre l'essai de 14 jours SANS CARTE (docs/13 § Essai).
   *
   * Aucun moyen de paiement n'est demandé, aucun fournisseur n'est appelé :
   * c'est une écriture locale. C'est ce qui rend l'essai réellement sans
   * friction — et ce qui impose que l'expiration soit gérée sans ordonnanceur
   * (voir `BillingService`).
   */
  @Post('current/subscription/trial')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async startTrial(
    @CurrentOrgId() orgId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionView> {
    try {
      const state = await this.billing.startTrial({
        organizationId: orgId,
        actorUserId: req.user?.id ?? 'unknown',
        actorRole: req.orgRole ?? 'unknown',
      });
      const projectCount = await this.projects.countDocuments({ organizationId: orgId }).exec();
      return toView(state, projectCount);
    } catch (error) {
      throw toConflict(error) ?? error;
    }
  }

  /**
   * Chiffre un changement de plan sans rien encaisser.
   *
   * Séparé du paiement pour une raison de fond : le client doit voir le montant
   * AVANT d'être envoyé chez un fournisseur. Un tunnel qui annonce « 9 USD » et
   * facture un prorata de 6,40 USD sans l'avoir dit produit des litiges, même
   * quand le calcul est juste.
   */
  @Get('current/subscription/quote')
  @RequirePermission('billing.manage')
  async quote(
    @CurrentOrgId() orgId: string,
    @Query('plan') planParam: string,
    @Query('interval') intervalParam: string,
  ): Promise<{
    plan: Plan;
    interval: BillingInterval;
    direction: string;
    effect: string;
    amountDueCents: number;
    creditCents: number;
    carriedCreditCents: number;
    currency: string;
    taxIncluded: false;
    effectiveAt: string | null;
  }> {
    const plan = asPlan(planParam);
    const interval = isBillingInterval(intervalParam) ? intervalParam : null;
    if (!plan || !interval) {
      throw new ConflictException({ code: 'INVALID_PLAN_OR_INTERVAL' });
    }

    try {
      const { proration, amountDueCents, state } = await this.billing.quotePlanChange({
        organizationId: orgId,
        targetPlan: plan,
        targetInterval: interval,
      });
      return {
        plan,
        interval,
        direction: proration.direction,
        effect: proration.effect,
        amountDueCents,
        creditCents: proration.creditCents,
        carriedCreditCents: proration.carriedCreditCents,
        currency: BILLING_CURRENCY,
        // Hors taxes — la fiscalité de la vente numérique n'est pas arbitrée
        // (docs/13 § Validation commerciale requise). Le dire est obligatoire.
        taxIncluded: false,
        effectiveAt:
          proration.effect === 'period_end'
            ? (state.currentPeriodEnd?.toISOString() ?? null)
            : null,
      };
    } catch (error) {
      throw toConflict(error) ?? error;
    }
  }

  /**
   * Programme une BAISSE de gamme à l'échéance (docs/13).
   *
   * Une montée en gamme n'est PAS acceptée ici : elle exige un paiement, donc
   * elle passe par `POST /payments/checkout`. Laisser cette route accorder une
   * montée en gamme donnerait un plan Business à qui sait envoyer un POST.
   */
  @Post('current/subscription/plan')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async changePlan(
    @CurrentOrgId() orgId: string,
    @Body() body: PlanChangeBody,
    @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionView> {
    const plan = asPlan(body?.plan);
    const interval = isBillingInterval(body?.interval)
      ? (body.interval as BillingInterval)
      : 'month';
    if (!plan) throw new ConflictException({ code: 'INVALID_PLAN_OR_INTERVAL' });
    if (plan !== 'free' && !isSellable(plan, interval)) {
      throw new ConflictException({ code: 'PLAN_NOT_SELLABLE' });
    }

    const state = await this.billing.getState(orgId);
    if (planRank(plan) > planRank(state.effectivePlan)) {
      throw new ConflictException({
        code: 'UPGRADE_REQUIRES_PAYMENT',
        message: 'Une montée en gamme passe par le tunnel de paiement.',
      });
    }

    try {
      const next = await this.billing.schedulePlanChange({
        organizationId: orgId,
        targetPlan: plan,
        targetInterval: interval,
        actorUserId: req.user?.id ?? 'unknown',
        actorRole: req.orgRole ?? 'unknown',
      });
      const projectCount = await this.projects.countDocuments({ organizationId: orgId }).exec();
      return toView(next, projectCount);
    } catch (error) {
      throw toConflict(error) ?? error;
    }
  }

  /**
   * Résilie. AUCUNE donnée n'est supprimée (docs/13 § Essai : « aucune
   * suppression immédiate ») — seul l'accès aux fonctions payantes cesse.
   */
  @Post('current/subscription/cancel')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  async cancel(
    @CurrentOrgId() orgId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SubscriptionView> {
    try {
      const state = await this.billing.cancel({
        organizationId: orgId,
        actorUserId: req.user?.id ?? 'unknown',
        actorRole: req.orgRole ?? 'unknown',
      });
      const projectCount = await this.projects.countDocuments({ organizationId: orgId }).exec();
      return toView(state, projectCount);
    } catch (error) {
      throw toConflict(error) ?? error;
    }
  }
}

function asPlan(value: unknown): Plan | null {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value)
    ? (value as Plan)
    : null;
}

function toView(state: SubscriptionState, projectCount: number): SubscriptionView {
  return {
    plan: state.effectivePlan,
    entitlements: state.entitlements,
    usage: { projects: projectCount },
    subscribedPlan: state.plan,
    status: state.status,
    billingInterval: state.billingInterval,
    paidAccess: state.paidAccess,
    trial: {
      used: state.trialUsed,
      endsAt: state.trialEndsAt?.toISOString() ?? null,
      daysLeft: state.trialDaysLeft,
      // Éligible = essai jamais consommé ET aucun abonnement en cours. Calculé
      // côté API : l'interface ne doit pas déduire une règle antifraude.
      eligible: !state.trialUsed && (state.status === 'canceled' || state.status === 'suspended'),
      days: TRIAL_DAYS,
    },
    currentPeriodEnd: state.currentPeriodEnd?.toISOString() ?? null,
    grace: {
      endsAt: state.graceEndsAt?.toISOString() ?? null,
      daysLeft: state.graceDaysLeft,
      days: GRACE_DAYS,
    },
    pendingChange: state.pendingPlan
      ? {
          plan: state.pendingPlan,
          interval: state.pendingInterval ?? 'month',
          effectiveAt: state.pendingPlanEffectiveAt?.toISOString() ?? null,
        }
      : null,
    provider: state.provider,
    notice: state.notice,
  };
}

/** Catalogue public — réexporté pour la page tarifs (aucune donnée sensible). */
export const PUBLIC_PRICE_TABLE = PLAN_PRICES;
