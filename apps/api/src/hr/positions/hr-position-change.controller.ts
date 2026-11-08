// Changement de poste d'un collaborateur — ADR-0068, amendement du 8 nov. 2026.
//
//   POST /hr/employees/:employeeId/position-change   hr.manage
//
// Fiche ou poste d'une autre organisation → 404. Le matricule ne change jamais.

import { ChangeEmployeePositionBody, type EmployeeView } from '@lalanda/shared/hr';
import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrPositionChangeService } from './hr-position-change.service.js';

@Controller('hr/employees/:employeeId')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrPositionChangeController {
  constructor(@Inject(HrPositionChangeService) private readonly changes: HrPositionChangeService) {}

  @Post('position-change')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async change(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = ChangeEmployeePositionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.changes.change(orgId, employeeId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }
}
