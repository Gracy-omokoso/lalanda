// Connexion Slack de l'organisation — ADR-0064 § 2 et § 9.
//
//   GET    /work/slack                 work.read            état de la connexion (écran)
//   POST   /work/slack/connect         organization.manage  adresse d'autorisation Slack
//   DELETE /work/slack                 organization.manage  révoque et supprime le jeton
//   GET    /work/slack/channels        work.manage          canaux publics (sélecteur)
//
// Sous `/work` : la fonction d'offre `run_work` s'applique (ADR-0053 — P4). Toutes ces
// routes agissent sur l'organisation ACTIVE de l'appelant : aucun identifiant
// d'organisation n'est accepté en paramètre.

import type {
  SlackChannelOption,
  SlackConnectStart,
  SlackConnectionView,
} from '@lalanda/shared/work';
import { Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { can } from '../authz/permissions.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { SlackConnectionsService } from './slack-connections.service.js';

type User = { id: string };

@Controller('work/slack')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkSlackController {
  constructor(@Inject(SlackConnectionsService) private readonly slack: SlackConnectionsService) {}

  @Get()
  @RequirePermission('work.read')
  async view(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<SlackConnectionView> {
    const canManage = perms !== undefined && can(perms.role, 'organization.manage', perms.context);
    return this.slack.view(orgId, canManage);
  }

  @Post('connect')
  @HttpCode(200)
  @RequirePermission('organization.manage')
  async connect(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<SlackConnectStart> {
    return this.slack.startConnect(orgId, user.id);
  }

  @Delete()
  @RequirePermission('organization.manage')
  async disconnect(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<SlackConnectionView> {
    return this.slack.disconnect(orgId, { userId: user.id, role: perms?.role ?? 'unknown' });
  }

  @Get('channels')
  @RequirePermission('work.manage')
  async channels(@CurrentOrgId() orgId: string): Promise<{ items: SlackChannelOption[] }> {
    return { items: await this.slack.listChannels(orgId) };
  }
}
