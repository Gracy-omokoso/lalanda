// Matricule d'un collaborateur — ADR-0068 § 2.
//
//   POST /hr/employees/:employeeId/employee-number/auto   hr.manage (fiche sans matricule)
//   PUT  /hr/employees/:employeeId/employee-number        hr.sensitive.read + hr.manage
//        (droit RH administrateur : correction d'un matricule posé, motif, audit strict)

import {
  ChangeEmployeeNumberBody,
  EmployeeRevisionBody,
  type EmployeeView,
} from '@lalanda/shared/hr';
import { Body, Controller, HttpCode, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrEmployeesService } from './hr-employees.service.js';

@Controller('hr/employees/:employeeId/employee-number')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrEmployeeNumbersController {
  constructor(@Inject(HrEmployeesService) private readonly employees: HrEmployeesService) {}

  @Post('auto')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async auto(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = EmployeeRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.assignAutoNumber(orgId, employeeId, parsed.data.expectedRevision, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }

  @Put()
  @RequirePermission('hr.sensitive.read', 'hr.manage')
  async change(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = ChangeEmployeeNumberBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.changeNumber(orgId, employeeId, parsed.data, {
      userId: user.id,
      role: role ?? 'unknown',
    });
  }
}
