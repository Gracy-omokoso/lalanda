// Réglages RH — ADR-0045 § 3.3. ADR-0045 — H2 (lecture et valeurs par défaut).
//
//   GET /hr/settings            hr.read
//   PUT /hr/settings            hr.manage                  (ADR-0045 — H3)
//   PUT /hr/settings/approval   leave.approve ET hr.manage (ADR-0045 — H3) : changer
//                               le circuit ou l'approbateur unique, c'est changer qui
//                               valide — il faut être soi-même validateur (motif
//                               d'ADR-0044 § 3.7). `leave.approve` est déclarée EN
//                               PREMIER : le refus la nomme.

import {
  UpdateHrApprovalSettingsBody,
  UpdateHrSettingsBody,
  type HrSettingsView,
} from '@lalanda/shared/hr';
import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrSettingsService } from './hr-settings.service.js';

@Controller('hr/settings')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrSettingsController {
  constructor(@Inject(HrSettingsService) private readonly settings: HrSettingsService) {}

  @Get()
  @RequirePermission('hr.read')
  async get(@CurrentOrgId() orgId: string): Promise<HrSettingsView> {
    return this.settings.view(orgId);
  }

  // ADR-0045 — H3
  @Put()
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<HrSettingsView> {
    const parsed = UpdateHrSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages RH : saisie invalide.');
    return this.settings.update(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }

  // ADR-0045 — H3
  @Put('approval')
  @RequirePermission('leave.approve', 'hr.manage')
  async updateApproval(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<HrSettingsView> {
    const parsed = UpdateHrApprovalSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Circuit de validation : saisie invalide.');
    return this.settings.updateApproval(orgId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }
}
