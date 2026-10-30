// Services — ADR-0045 § 3.1. ADR-0045 — H2.
//
//   GET  /hr/departments?active=true|false|all   hr.read
//   POST /hr/departments                         hr.manage
//   PUT  /hr/departments/:departmentId           hr.manage
//   POST /hr/departments/:departmentId/archive   hr.manage
//
// Un service d'une autre organisation répond 404.

import {
  CreateDepartmentBody,
  DepartmentRevisionBody,
  ListDepartmentsQuery,
  UpdateDepartmentBody,
  type DepartmentListView,
  type DepartmentView,
} from '@lalanda/shared/hr';
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

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { HrDepartmentsService, type HrActor } from './hr-departments.service.js';

function actorOf(user: { id: string }, role: OrgRole | undefined): HrActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('hr/departments')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrDepartmentsController {
  constructor(@Inject(HrDepartmentsService) private readonly departments: HrDepartmentsService) {}

  @Get()
  @RequirePermission('hr.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<DepartmentListView> {
    const parsed = ListDepartmentsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.departments.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<DepartmentView> {
    const parsed = CreateDepartmentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.departments.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put(':departmentId')
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<DepartmentView> {
    const parsed = UpdateDepartmentBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.departments.update(orgId, departmentId, parsed.data, actorOf(user, role));
  }

  @Post(':departmentId/archive')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<DepartmentView> {
    const parsed = DepartmentRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.departments.archive(
      orgId,
      departmentId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }
}
