// Mes notifications des Projets — ADR-0061 § 2.
//
//   GET /work/notification-preferences   work.read   (préférences de l'APPELANT)
//   PUT /work/notification-preferences   work.read   (révision attendue ; 0 = premier enregistrement)
//
// Donnée personnelle : chacun ne lit et n'écrit que les siennes, dans l'organisation
// active. `work.read` suffit : quiconque reçoit des notifications des Projets les règle.

import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import {
  PutWorkNotificationPreferencesBody,
  type WorkNotificationPreferencesView,
} from '@lalanda/shared/work';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { WorkNotificationPreferencesService } from './work-notification-preferences.service.js';

@Controller('work/notification-preferences')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkNotificationPreferencesController {
  constructor(
    @Inject(WorkNotificationPreferencesService)
    private readonly prefs: WorkNotificationPreferencesService,
  ) {}

  @Get()
  @RequirePermission('work.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
  ): Promise<WorkNotificationPreferencesView> {
    return this.prefs.get(orgId, user.id);
  }

  @Put()
  @RequirePermission('work.read')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @Body() body: unknown,
  ): Promise<WorkNotificationPreferencesView> {
    const parsed = PutWorkNotificationPreferencesBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.prefs.put(orgId, user.id, parsed.data);
  }
}
