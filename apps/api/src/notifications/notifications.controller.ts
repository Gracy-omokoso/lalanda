// Points d'API de la boîte de notifications (ADR-0039 § 4).
//
//   GET  /notifications                    les siennes (curseur, unreadOnly)   analytics.read
//   GET  /notifications/unread-count       compteur de non lues                analytics.read
//   POST /notifications/:notificationId/read                                  analytics.read
//   POST /notifications/read-all                                              analytics.read
//   GET  /notifications/preferences        types coupés                        analytics.read
//   PUT  /notifications/preferences                                           analytics.read
//
// `analytics.read` : convention du brief du matin pour une donnée PERSONNELLE de
// l'appelant dans l'organisation active (les huit rôles la détiennent). Chaque
// notification porte en outre son `requiredAction`, revérifiée à la lecture.
// L'organisation et le destinataire viennent TOUJOURS de la session.

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

import {
  ListNotificationsQuery,
  PutNotificationPreferencesBody,
  type NotificationPageView,
  type NotificationPreferencesView,
  type NotificationView,
  type UnreadCountView,
} from '@lalanda/shared/notifications';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { NotificationsService } from './notifications.service.js';

type User = { id: string };

@Controller('notifications')
@UseGuards(AuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get()
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ): Promise<NotificationPageView> {
    const parsed = ListNotificationsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.service.list(orgId, user.id, parsed.data);
  }

  @Get('unread-count')
  @RequirePermission('analytics.read')
  async unreadCount(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<UnreadCountView> {
    return this.service.unreadCount(orgId, user.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async markAllRead(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<UnreadCountView> {
    return this.service.markAllRead(orgId, user.id);
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async markRead(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationView> {
    return this.service.markRead(orgId, user.id, notificationId);
  }

  @Get('preferences')
  @RequirePermission('analytics.read')
  async getPreferences(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
  ): Promise<NotificationPreferencesView> {
    return this.service.preferences(orgId, user.id);
  }

  @Put('preferences')
  @RequirePermission('analytics.read')
  async putPreferences(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<NotificationPreferencesView> {
    const parsed = PutNotificationPreferencesBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.service.setPreferences(orgId, user.id, parsed.data.mutedKinds);
  }
}
