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
import { WorkClockService } from './work-clock.service.js';
import { WorkSettingsService } from './work-settings.service.js';
import { RequireFeature } from '../billing/feature.guard.js';
import { WorkVisibilityGuard } from './work-visibility.guard.js';

@Controller('work/settings')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkSettingsController {
  constructor(
    @Inject(WorkSettingsService) private readonly settings: WorkSettingsService,
    // ADR-0080 : le fuseau de l'organisation accompagne les réglages (lecture seule ici).
    @Inject(WorkClockService) private readonly clock: WorkClockService,
  ) {}

  @Get()
  @RequirePermission('work.read')
  async get(@CurrentOrgId() orgId: string): Promise<WorkSettingsView> {
    const [settings, timeZone] = await Promise.all([
      this.settings.get(orgId),
      this.clock.timeZoneOf(orgId),
    ]);
    return { ...settings, timeZone };
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
    const [settings, timeZone] = await Promise.all([
      this.settings.put(orgId, parsed.data, workActorOf(user, perms)),
      this.clock.timeZoneOf(orgId),
    ]);
    return { ...settings, timeZone };
  }
}
