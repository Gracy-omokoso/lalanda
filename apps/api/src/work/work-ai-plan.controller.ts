// Construction d'un plan par l'IA et création depuis un plan relu — ADR-0063 § 5.
//
//   POST /work/ai/plan          work.manage  proposition de l'IA (quota IA, rien n'est créé)
//   POST /work/plans/projects   work.manage  créer le projet relu (créateur commun, ADR-0062)
//
// Organisation active seulement ; aucun identifiant d'organisation dans le corps.

import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CreateProjectFromPlanBody,
  WorkAiPlanRequestBody,
  type WorkAiPlanDraft,
  type WorkPlanApplyResult,
} from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { UserThrottlerGuard } from '../security/user-throttler.guard.js';
import { workActorOf } from './work.common.js';
import { WorkAiPlanService } from './work-ai-plan.service.js';

type User = { id: string };

/** Propositions par heure et par utilisateur (en plus du quota mensuel de l'organisation). */
export const AI_PLANS_PER_HOUR = 20;

@Controller('work')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkAiPlanController {
  constructor(@Inject(WorkAiPlanService) private readonly plans: WorkAiPlanService) {}

  @Post('ai/plan')
  @HttpCode(200)
  @RequirePermission('work.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: AI_PLANS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async propose(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkAiPlanDraft> {
    const parsed = WorkAiPlanRequestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.plans.generate(orgId, parsed.data, workActorOf(user, perms));
  }

  @Post('plans/projects')
  @HttpCode(201)
  @RequirePermission('work.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkPlanApplyResult> {
    const parsed = CreateProjectFromPlanBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Plan invalide.');
    const { project, tasks, origin, aiDraftId } = parsed.data;
    return this.plans.createFromPlan(
      orgId,
      project,
      tasks,
      workActorOf(user, perms),
      origin,
      aiDraftId,
    );
  }
}
