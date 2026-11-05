// Équipes — ADR-0060 § 2 et § 6.
//
//   GET    /hr/teams                              hr.read
//   GET    /hr/teams/candidates                   hr.read  (membres proposés : nom seulement)
//   GET    /hr/teams/:teamId                      hr.read
//   POST   /hr/teams                              hr.manage
//   PUT    /hr/teams/:teamId                      hr.manage (révision attendue)
//   POST   /hr/teams/:teamId/members              hr.manage
//   DELETE /hr/teams/:teamId/members/:userId      hr.manage
//   DELETE /hr/teams/:teamId                      hr.manage
//
// Lecture large (`hr.read`) ; gestion par les rôles RH et de direction (`hr.manage`).
// Les Projets lisent les équipes par `GET /work/teams` (`work.read`). Une équipe
// d'une autre organisation répond 404.

import {
  AddTeamMembersBody,
  CreateTeamBody,
  UpdateTeamBody,
  type TeamListView,
  type TeamMemberView,
  type TeamView,
} from '@lalanda/shared/hr';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrTeamsService, type TeamActor } from './hr-teams.service.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): TeamActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('hr/teams')
@RequireFeature('hr') // ADR-0053 — P4, comme les autres routes RH
@UseGuards(AuthGuard, PermissionsGuard)
export class HrTeamsController {
  constructor(@Inject(HrTeamsService) private readonly teams: HrTeamsService) {}

  @Get()
  @RequirePermission('hr.read')
  async list(@CurrentOrgId() orgId: string): Promise<TeamListView> {
    return this.teams.list(orgId);
  }

  /** Membres de l'organisation proposés (nom seulement, ni e-mail ni rôle). */
  @Get('candidates')
  @RequirePermission('hr.read')
  async candidates(@CurrentOrgId() orgId: string): Promise<{ items: TeamMemberView[] }> {
    return { items: await this.teams.candidates(orgId) };
  }

  @Get(':teamId')
  @RequirePermission('hr.read')
  async get(@CurrentOrgId() orgId: string, @Param('teamId') teamId: string): Promise<TeamView> {
    return this.teams.get(orgId, teamId);
  }

  @Post()
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<TeamView> {
    const parsed = CreateTeamBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.teams.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put(':teamId')
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<TeamView> {
    const parsed = UpdateTeamBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.teams.update(orgId, teamId, parsed.data, actorOf(user, role));
  }

  @Post(':teamId/members')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async addMembers(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<TeamView> {
    const parsed = AddTeamMembersBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.teams.addMembers(orgId, teamId, parsed.data, actorOf(user, role));
  }

  @Delete(':teamId/members/:userId')
  @RequirePermission('hr.manage')
  async removeMember(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ): Promise<TeamView> {
    return this.teams.removeMember(orgId, teamId, userId, actorOf(user, role));
  }

  @Delete(':teamId')
  @HttpCode(204)
  @RequirePermission('hr.manage')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('teamId') teamId: string,
  ): Promise<void> {
    await this.teams.remove(orgId, teamId, actorOf(user, role));
  }
}
