// Canal Slack d'un projet — ADR-0064 § 3.
//
//   GET /work/projects/:projectId/slack-channel   work.read
//   PUT /work/projects/:projectId/slack-channel   work.manage  (`channelId: null` retire)
//
// Sous la garde de visibilité du module (ADR-0060) : un projet hors de portée répond
// 404, comme un projet d'une autre organisation.

import {
  PutWorkProjectSlackChannelBody,
  type WorkProjectSlackChannelView,
} from '@lalanda/shared/work';
import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';

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
import { SlackProjectChannelsService } from '../slack/slack-project-channels.service.js';
import { WorkIdPipe, actorCan, workActorOf } from './work.common.js';
import { WorkProjectsService } from './work-projects.service.js';
import { WorkVisibilityGuard } from './work-visibility.guard.js';

type User = { id: string };

@Controller('work/projects/:projectId/slack-channel')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkSlackChannelController {
  constructor(
    @Inject(SlackProjectChannelsService) private readonly channels: SlackProjectChannelsService,
    @Inject(WorkProjectsService) private readonly projects: WorkProjectsService,
  ) {}

  private async ref(orgId: string, projectId: string) {
    const p = await this.projects.requireOwn(orgId, projectId);
    return { organizationId: orgId, projectId, visibility: p.visibility ?? 'organization' };
  }

  @Get()
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<WorkProjectSlackChannelView> {
    return this.channels.get(
      await this.ref(orgId, projectId),
      actorCan(workActorOf(user, perms), 'work.manage'),
    );
  }

  @Put()
  @RequirePermission('work.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkProjectSlackChannelView> {
    const parsed = PutWorkProjectSlackChannelBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.channels.put(await this.ref(orgId, projectId), parsed.data, {
      userId: user.id,
      role: perms?.role ?? 'unknown',
    });
  }
}
