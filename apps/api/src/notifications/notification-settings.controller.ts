// Réglages, état des canaux, tests et journal d'envoi des notifications — ADR-0079.
//
//   GET  /notifications/settings                     mes réglages (mode, surcharges…)    analytics.read
//   PUT  /notifications/settings                     (révision attendue)                 analytics.read
//   GET  /notifications/organization-settings        défauts et obligations              analytics.read
//   PUT  /notifications/organization-settings                                            organization.manage
//   GET  /notifications/channels                     état de mes canaux                  analytics.read
//   POST /notifications/test                         « M'envoyer un test » (5 / heure)   analytics.read
//   GET  /notifications/deliveries                   mon journal d'envoi                 analytics.read
//   GET  /notifications/deliveries/organization      journal de l'organisation           organization.manage
//
// `analytics.read` : convention de la boîte (donnée PERSONNELLE de l'appelant dans
// l'organisation active, les rôles la détiennent tous). L'organisation et la personne
// viennent TOUJOURS de la session : aucune route ne lit ni n'écrit les réglages d'un
// autre. Le journal de l'organisation ne montre ni titre ni contenu.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ListNotificationDeliveriesQuery,
  NOTIFICATION_SETTINGS_LIMITS,
  PutNotificationOrgSettingsBody,
  PutNotificationSettingsBody,
  SendNotificationTestBody,
  type NotificationChannelsView,
  type NotificationDeliveriesPageView,
  type NotificationOrgSettingsView,
  type NotificationSettingsView,
  type NotificationTestView,
} from '@lalanda/shared/notifications';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { can } from '../authz/permissions.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { NotificationDeliveriesService } from './notification-deliveries.service.js';
import { NotificationDispatcher } from './notification-dispatcher.js';
import { NotificationSettingsService } from './notification-settings.service.js';
import { NotificationsService } from './notifications.service.js';

type User = { id: string };

@Controller('notifications')
@UseGuards(AuthGuard, PermissionsGuard)
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
    @Inject(NotificationDispatcher) private readonly dispatcher: NotificationDispatcher,
    @Inject(NotificationDeliveriesService)
    private readonly deliveries: NotificationDeliveriesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get('settings')
  @RequirePermission('analytics.read')
  async getSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<NotificationSettingsView> {
    return this.settings.view(orgId, user.id);
  }

  @Put('settings')
  @RequirePermission('analytics.read')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<NotificationSettingsView> {
    const parsed = PutNotificationSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.settings.put(orgId, user.id, parsed.data);
  }

  @Get('organization-settings')
  @RequirePermission('analytics.read')
  async getOrgSettings(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<NotificationOrgSettingsView> {
    const canManage = !!perms && can(perms.role, 'organization.manage', perms.context);
    return this.settings.orgView(orgId, canManage);
  }

  @Put('organization-settings')
  @RequirePermission('organization.manage')
  async putOrgSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<NotificationOrgSettingsView> {
    const parsed = PutNotificationOrgSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.settings.putOrg(orgId, parsed.data, user.id);
  }

  @Get('channels')
  @RequirePermission('analytics.read')
  async channels(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<NotificationChannelsView> {
    return this.dispatcher.channels(orgId, user.id);
  }

  @Post('test')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async test(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<NotificationTestView> {
    const parsed = SendNotificationTestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    if (
      (await this.deliveries.testsLastHour(orgId, user.id, new Date())) >=
      NOTIFICATION_SETTINGS_LIMITS.testsPerHour
    ) {
      throw new HttpException(
        {
          code: 'NOTIFICATION_TEST_RATE_LIMITED',
          message: 'Cinq tests par heure au plus : réessayez un peu plus tard.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.dispatcher.sendTest(orgId, user.id, parsed.data.channel, (i) =>
      this.notifications.emit(i),
    );
  }

  @Get('deliveries')
  @RequirePermission('analytics.read')
  async myDeliveries(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ): Promise<NotificationDeliveriesPageView> {
    const parsed = ListNotificationDeliveriesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.deliveries.list({ organizationId: orgId, userId: user.id }, parsed.data);
  }

  @Get('deliveries/organization')
  @RequirePermission('organization.manage')
  async orgDeliveries(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<NotificationDeliveriesPageView> {
    const parsed = ListNotificationDeliveriesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.deliveries.list({ organizationId: orgId }, parsed.data, async (ids) => {
      const who = await this.dispatcher.identitiesOf(ids);
      return new Map(ids.map((id) => [id, who.get(id)?.name ?? who.get(id)?.email ?? 'Membre']));
    });
  }
}
