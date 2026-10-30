// Types d'absence — ADR-0045 § 2.5, § 3.2. ADR-0045 — H3.
//
//   GET  /hr/leave-types                 analytics.read (nom, unité, confidentialité ;
//                                        politique servie avec hr.read)
//   POST /hr/leave-types                 hr.manage
//   PUT  /hr/leave-types/:typeId         hr.manage
//   POST /hr/leave-types/:typeId/archive hr.manage

import {
  CreateLeaveTypeBody,
  LeaveTypeRevisionBody,
  ListLeaveTypesQuery,
  UpdateLeaveTypeBody,
  type LeaveTypeListView,
  type LeaveTypeView,
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
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { can } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrLeaveTypesService } from './hr-leave-types.service.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('hr/leave-types')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrLeaveTypesController {
  constructor(@Inject(HrLeaveTypesService) private readonly types: HrLeaveTypesService) {}

  @Get()
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LeaveTypeListView> {
    const parsed = ListLeaveTypesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const withPolicy = perms !== undefined && can(perms.role, 'hr.read', perms.context);
    return this.types.list(orgId, parsed.data, withPolicy);
  }

  @Post()
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<LeaveTypeView> {
    const parsed = CreateLeaveTypeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Type d’absence invalide.');
    return this.types.create(orgId, parsed.data, actorOf(user, perms));
  }

  @Put(':typeId')
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('typeId') typeId: string,
    @Body() body: unknown,
  ): Promise<LeaveTypeView> {
    const parsed = UpdateLeaveTypeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Type d’absence invalide.');
    return this.types.update(orgId, typeId, parsed.data, actorOf(user, perms));
  }

  @Post(':typeId/archive')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('typeId') typeId: string,
    @Body() body: unknown,
  ): Promise<LeaveTypeView> {
    const parsed = LeaveTypeRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.types.archive(orgId, typeId, parsed.data.expectedRevision, actorOf(user, perms));
  }
}
