// Statut déclaré d'un projet — ADR-0076 § 5.
//
//   GET  /work/projects/:projectId/status-updates   work.read   (historique, 50 derniers)
//   POST /work/projects/:projectId/status-updates   work.update + gestion du projet
//
// Un projet hors portée répond 404 (`WorkVisibilityGuard`).

import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { PostWorkProjectStatusBody, type WorkProjectStatusView } from '@lalanda/shared/work';

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
import { WorkIdPipe, workActorOf } from './work.common.js';
import { WorkProjectStatusService } from './work-project-status.service.js';
import { WorkVisibilityGuard } from './work-visibility.guard.js';

type User = { id: string };

@Controller('work/projects')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkProjectStatusController {
  constructor(
    @Inject(WorkProjectStatusService) private readonly statuses: WorkProjectStatusService,
  ) {}

  @Get(':projectId/status-updates')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<{ items: WorkProjectStatusView[] }> {
    return this.statuses.list(orgId, projectId);
  }

  @Post(':projectId/status-updates')
  @RequirePermission('work.update')
  async post(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectStatusView> {
    const parsed = PostWorkProjectStatusBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.statuses.post(orgId, projectId, parsed.data, workActorOf(user, perms));
  }
}
