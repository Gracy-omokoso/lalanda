import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { Project, type ProjectDocument } from '../projects/project.schema.js';
import { BillingService } from './billing.service.js';
import type { Entitlements, Plan } from './entitlements.js';

export interface SubscriptionView {
  plan: Plan;
  entitlements: Entitlements;
  usage: { projects: number };
}

/**
 * Lecture de l'abonnement de l'organisation active (S16b).
 * `GET /organizations/current/subscription` — « current » = org résolue par le
 * guard (cookie `active_org_id` ou org primaire), cohérent avec le reste de l'API.
 */
@Controller('organizations')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @InjectModel(Project.name) private readonly projects: Model<ProjectDocument>,
  ) {}

  @Get('current/subscription')
  async current(@CurrentOrgId() orgId: string): Promise<SubscriptionView> {
    const [{ plan, entitlements }, projectCount] = await Promise.all([
      this.billing.getPlanEntitlements(orgId),
      this.projects.countDocuments({ organizationId: orgId }).exec(),
    ]);
    return { plan, entitlements, usage: { projects: projectCount } };
  }
}
