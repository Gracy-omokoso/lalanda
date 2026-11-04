// Aperçu d'un projet — ADR-0057.
//
//   GET /work/projects/:projectId/overview   work.read
//
// Santé (En bonne voie / À risque / En retard), avancement, tâches ouvertes par
// responsable, courbe d'avancement sur 8 semaines, jalons à venir, tâches en
// retard et compteurs de commentaires. Un projet d'une autre organisation : 404.

import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { WorkProjectOverview } from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { WorkIdPipe } from './work.common.js';
import { WorkOverviewService } from './work-overview.service.js';

@Controller('work/projects')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkOverviewController {
  constructor(@Inject(WorkOverviewService) private readonly overviews: WorkOverviewService) {}

  @Get(':projectId/overview')
  @RequirePermission('work.read')
  async overview(
    @CurrentOrgId() orgId: string,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<WorkProjectOverview> {
    return this.overviews.overview(orgId, projectId);
  }
}
