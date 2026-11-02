// Objectifs individuels — ADR-0051 § 6.3. ADR-0051 — H15.
//
//   GET  /hr/goals?employeeId=&from=&to=&status=   analytics.read ; soi, chaîne, performance.read
//   POST /hr/goals                                 analytics.read ; soi (proposer), chaîne ou
//                                                   performance.read + hr.manage (poser)
//   PUT  /hr/goals/:id                             idem
//   POST /hr/goals/:id/agree · …/close             chaîne ou performance.read + hr.manage ;
//                                                   jamais le collaborateur pour lui-même
//   POST /hr/goals/:id/progress                    soi, chaîne, performance.read + hr.manage
//
// Routes RELATIONNELLES (`analytics.read` au guard), décision dans le service sur les
// droits EFFECTIFS et la relation. Hors portée : 404. Éteint : `409 HR_FEATURE_DISABLED`.

import {
  CloseGoalBody,
  CreateGoalBody,
  GoalProgressBody,
  UpdateGoalBody,
} from '@lalanda/shared/hr';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import {
  HrGoalsService,
  AgreeGoalBody,
  ListGoalsQuery,
  type GoalView,
} from './hr-goals.service.js';
import { HrPerformanceAccess, parse, type PerformanceViewer } from './hr-performance-access.js';
import { RequireFeature } from '../../billing/feature.guard.js';

type User = { id: string };

@Controller('hr/goals')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrGoalsController {
  constructor(
    @Inject(HrGoalsService) private readonly goals: HrGoalsService,
    @Inject(HrPerformanceAccess) private readonly access: HrPerformanceAccess,
  ) {}

  private viewer(
    orgId: string,
    user: User,
    role: OrgRole | undefined,
    perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<PerformanceViewer> {
    return this.access.viewerOf(orgId, user.id, role, perms);
  }

  @Get()
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<{ items: GoalView[] }> {
    const q = parse(ListGoalsQuery, query);
    const pv = await this.viewer(orgId, user, role, perms);
    return { items: await this.goals.list(orgId, pv, q) };
  }

  @Post()
  @RequirePermission('analytics.read')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<GoalView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.goals.create(orgId, pv, parse(CreateGoalBody, body));
  }

  @Put(':id')
  @RequirePermission('analytics.read')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.goals.update(orgId, pv, id, parse(UpdateGoalBody, body));
  }

  @Post(':id/agree')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async agree(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.goals.agree(orgId, pv, id, parse(AgreeGoalBody, body));
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async close(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.goals.close(orgId, pv, id, parse(CloseGoalBody, body));
  }

  @Post(':id/progress')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async progress(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    const pv = await this.viewer(orgId, user, role, perms);
    return this.goals.progress(orgId, pv, id, parse(GoalProgressBody, body));
  }
}
