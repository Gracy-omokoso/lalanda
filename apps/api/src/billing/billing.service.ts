import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { PLAN_ENTITLEMENTS, type Entitlements, type Plan } from './entitlements.js';
import { Subscription, type SubscriptionDocument } from './subscription.schema.js';

/**
 * Service abonnements (S16b).
 * Résout le plan effectif d'une organisation et ses entitlements.
 * Pas d'endpoint public de changement de plan : `setPlan` est interne
 * (seed, support, tests) en attendant l'intégration paiement.
 */
@Injectable()
export class BillingService {
  constructor(
    @InjectModel(Subscription.name) private readonly model: Model<SubscriptionDocument>,
  ) {}

  /** Plan effectif — org sans document Subscription (ou non active) = `free`. */
  async getPlan(organizationId: string): Promise<Plan> {
    const sub = await this.model.findOne({ organizationId }).lean().exec();
    if (!sub || sub.status !== 'active') return 'free';
    return sub.plan;
  }

  /** Plan + entitlements associés, en une seule lecture. */
  async getPlanEntitlements(
    organizationId: string,
  ): Promise<{ plan: Plan; entitlements: Entitlements }> {
    const plan = await this.getPlan(organizationId);
    return { plan, entitlements: PLAN_ENTITLEMENTS[plan] };
  }

  /**
   * Change le plan d'une organisation (upsert idempotent).
   * Interne uniquement — aucun contrôleur ne l'expose tant que le paiement
   * n'est pas intégré (docs/13 : transitions pilotées par événements vérifiés).
   */
  async setPlan(organizationId: string, plan: Plan): Promise<SubscriptionDocument> {
    return this.model
      .findOneAndUpdate(
        { organizationId },
        { $set: { plan, status: 'active' }, $setOnInsert: { _schemaVersion: 1 } },
        { new: true, upsert: true },
      )
      .exec();
  }
}
