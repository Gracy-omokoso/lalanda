// Réglage des matricules — ADR-0068 § 2.
//
//   GET /hr/settings/numbering   hr.read
//   PUT /hr/settings/numbering   hr.manage

import { UpdateEmployeeNumberingBody, type EmployeeNumberingView } from '@lalanda/shared/hr';
import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrNumberingService } from './hr-numbering.service.js';

@Controller('hr/settings/numbering')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrNumberingController {
  constructor(@Inject(HrNumberingService) private readonly numbering: HrNumberingService) {}

  @Get()
  @RequirePermission('hr.read')
  async get(@CurrentOrgId() orgId: string): Promise<EmployeeNumberingView> {
    return this.numbering.view(orgId);
  }

  @Put()
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<EmployeeNumberingView> {
    const parsed = UpdateEmployeeNumberingBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglage des matricules invalide.');
    return this.numbering.update(orgId, parsed.data, { userId: user.id, role: role ?? 'unknown' });
  }
}
