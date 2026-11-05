// Membres d'un projet et équipes proposées — ADR-0060 § 4 et § 6.
//
//   GET    /work/teams                                         work.read   (sélecteur)
//   GET    /work/projects/:projectId/members                   work.read
//   POST   /work/projects/:projectId/members                   work.manage (utilisateurs, équipes)
//   DELETE /work/projects/:projectId/members/users/:userId     work.manage
//   DELETE /work/projects/:projectId/members/teams/:teamId     work.manage
//
// Un projet hors de la portée de l'appelant (privé, non membre) répond 404
// (`WorkVisibilityGuard`), comme un projet d'une autre organisation.

import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import {
  AddProjectMembersBody,
  type WorkProjectMembersView,
  type WorkTeamRef,
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
import { WorkIdPipe, workActorOf } from './work.common.js';
import { WorkProjectMembersService } from './work-project-members.service.js';
import { WorkVisibilityGuard } from './work-visibility.guard.js';

type User = { id: string };

@Controller('work')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkProjectMembersController {
  constructor(
    @Inject(WorkProjectMembersService) private readonly members: WorkProjectMembersService,
  ) {}

  @Get('teams')
  @RequirePermission('work.read')
  async teams(@CurrentOrgId() orgId: string): Promise<{ items: WorkTeamRef[] }> {
    return { items: await this.members.listTeams(orgId) };
  }

  @Get('projects/:projectId/members')
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<WorkProjectMembersView> {
    return this.members.get(orgId, projectId, workActorOf(user, perms));
  }

  @Post('projects/:projectId/members')
  @RequirePermission('work.manage')
  async add(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectMembersView> {
    const parsed = AddProjectMembersBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.members.add(orgId, projectId, parsed.data, workActorOf(user, perms));
  }

  @Delete('projects/:projectId/members/users/:userId')
  @RequirePermission('work.manage')
  async removeUser(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Param('userId') userId: string,
  ): Promise<WorkProjectMembersView> {
    return this.members.removeUser(orgId, projectId, userId, workActorOf(user, perms));
  }

  @Delete('projects/:projectId/members/teams/:teamId')
  @RequirePermission('work.manage')
  async removeTeam(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Param('teamId', WorkIdPipe) teamId: string,
  ): Promise<WorkProjectMembersView> {
    return this.members.removeTeam(orgId, projectId, teamId, workActorOf(user, perms));
  }
}
