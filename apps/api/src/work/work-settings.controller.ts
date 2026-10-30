// Réglages du module « work » — ADR-0039 § 4.
//
//   GET /work/settings   work.read
//   PUT /work/settings   work.manage (révision attendue ; 0 = premier enregistrement)

import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { PutWorkSettingsBody, type WorkSettingsView } from '@lalanda/shared/work';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { invalidRequest } from '../sales/sales.errors.js';
import { workActorOf } from './work.common.js';
import { WorkSettingsService } from './work-settings.service.js';

@Controller('work/settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkSettingsController {
  constructor(@Inject(WorkSettingsService) private readonly settings: WorkSettingsService) {}

  @Get()
  @RequirePermission('work.read')
  async get(@CurrentOrgId() orgId: string): Promise<WorkSettingsView> {
    return this.settings.get(orgId);
  }

  @Put()
  @RequirePermission('work.manage')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<WorkSettingsView> {
    const parsed = PutWorkSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.settings.put(orgId, parsed.data, workActorOf(user, perms));
  }
}
