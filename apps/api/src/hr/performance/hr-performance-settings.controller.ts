// Réglages des objectifs et évaluations — ADR-0051 § 2.7. ADR-0051 — H15.
//
//   GET /hr/settings/performance   analytics.read : savoir si la fonction est active (écran,
//                                  « Mes tâches ») ; aucune donnée de personne
//   PUT /hr/settings/performance   hr.manage (`performance.*`, `retention.reviewsYearsAfterExit`)
//
// Défauts : éteint, manager direct seul, aucune purge.

import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { parse } from './hr-performance-access.js';
import {
  HrPerformanceSettingsService,
  UpdatePerformanceSettingsBody,
  type HrPerformanceSettingsView,
} from './hr-performance-settings.service.js';

@Controller('hr/settings/performance')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrPerformanceSettingsController {
  constructor(
    @Inject(HrPerformanceSettingsService) private readonly settings: HrPerformanceSettingsService,
  ) {}

  @Get()
  @RequirePermission('analytics.read')
  async get(@CurrentOrgId() orgId: string): Promise<HrPerformanceSettingsView> {
    return this.settings.view(orgId);
  }

  @Put()
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<HrPerformanceSettingsView> {
    return this.settings.update(orgId, parse(UpdatePerformanceSettingsBody, body), {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }
}
