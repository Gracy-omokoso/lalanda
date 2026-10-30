// Collaborateurs, « moi », « mon équipe », organigramme — ADR-0045 § 3.1. ADR-0045 — H2.
//
//   GET  /hr/employees?q=&status=&departmentId=&managerId=&cursor=   hr.read
//   POST /hr/employees                                              hr.manage
//   POST /hr/employees/from-members                                 hr.manage
//   GET  /hr/employees/:employeeId          analytics.read + portée (hr.read, soi, manager)
//   PUT  /hr/employees/:employeeId                                  hr.manage
//   POST /hr/employees/:employeeId/exit · /reinstate                hr.manage
//   POST /hr/employees/:employeeId/anonymize          hr.sensitive.read + hr.manage
//   GET  /hr/me · /hr/team                                          analytics.read
//   GET  /hr/org-chart?view=departments|reporting      analytics.read + § 3.1
//
// Routes RELATIONNELLES : `analytics.read` au guard, portée décidée par le moteur
// (`hrViewerScope`) sur les droits EFFECTIFS ; hors portée → 404.

import {
  AnonymizeEmployeeBody,
  CreateEmployeeBody,
  CreateEmployeesFromMembersBody,
  EmployeeRevisionBody,
  ExitEmployeeBody,
  ListEmployeesQuery,
  OrgChartQuery,
  UpdateEmployeeBody,
  type EmployeeDetailView,
  type EmployeeExitResult,
  type EmployeePage,
  type EmployeeView,
  type EmployeesFromMembersResult,
  type HrMeView,
  type HrTeamView,
  type OrgChartView,
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
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrPrivateService } from '../private/hr-private.service.js';
import { employeeNotFound } from '../scope/hr-errors.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrLeaveService } from '../leave/hr-leave.service.js';
import { HrEmployeesService } from './hr-employees.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): HrActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrEmployeesController {
  constructor(
    @Inject(HrEmployeesService) private readonly employees: HrEmployeesService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
    @Inject(HrPrivateService) private readonly privates: HrPrivateService,
    // ADR-0045 — H3
    @Inject(HrLeaveService) private readonly leave: HrLeaveService,
  ) {}

  @Get('employees')
  @RequirePermission('hr.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<EmployeePage> {
    const parsed = ListEmployeesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.employees.list(orgId, parsed.data);
  }

  @Post('employees')
  @RequirePermission('hr.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = CreateEmployeeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.create(orgId, parsed.data, actorOf(user, role));
  }

  // Déclarée AVANT `:employeeId` : « from-members » n'est pas un identifiant.
  @Post('employees/from-members')
  @RequirePermission('hr.manage')
  async fromMembers(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<EmployeesFromMembersResult> {
    const parsed = CreateEmployeesFromMembersBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.fromMembers(orgId, parsed.data.userIds, actorOf(user, role));
  }

  @Get('employees/:employeeId')
  @RequirePermission('analytics.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeDetailView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    const relation = this.scope.relationTo(viewer, employeeId);
    if (relation === null) employeeNotFound();
    const employee = viewer.byId.get(employeeId)!;
    const canSeeSensitive =
      employee.status !== 'anonymized' &&
      (viewer.actions.has('hr.sensitive.read') || viewer.scope.selfEmployeeId === employeeId);
    return {
      employee: (
        await this.employees.withNames(orgId, [
          this.employees.view(employee, viewer.actions.has('hr.read')),
        ])
      )[0]!,
      private: canSeeSensitive ? await this.privates.summary(orgId, employeeId) : null,
      viewer: {
        relation,
        canManage: viewer.actions.has('hr.manage'),
        canSeeSensitive,
      },
    };
  }

  @Put('employees/:employeeId')
  @RequirePermission('hr.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = UpdateEmployeeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.update(orgId, employeeId, parsed.data, actorOf(user, role));
  }

  @Post('employees/:employeeId/exit')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async exit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeExitResult> {
    const parsed = ExitEmployeeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.exit(orgId, employeeId, parsed.data, actorOf(user, role));
  }

  @Post('employees/:employeeId/reinstate')
  @HttpCode(200)
  @RequirePermission('hr.manage')
  async reinstate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = EmployeeRevisionBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.reinstate(
      orgId,
      employeeId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post('employees/:employeeId/anonymize')
  @HttpCode(200)
  @RequirePermission('hr.sensitive.read', 'hr.manage')
  async anonymize(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeeView> {
    const parsed = AnonymizeEmployeeBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.employees.anonymize(
      orgId,
      employeeId,
      parsed.data.expectedRevision,
      actorOf(user, role),
    );
  }

  @Get('me')
  @RequirePermission('analytics.read')
  async me(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<HrMeView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    // ADR-0045 — H3 : mes soldes et mes demandes (§ 3.1).
    return this.leave.completeMe(orgId, viewer, await this.employees.me(viewer));
  }

  @Get('team')
  @RequirePermission('analytics.read')
  async team(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<HrTeamView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    // ADR-0045 — H3 : soldes et absences de l'équipe (§ 3.1), type masqué si confidentiel.
    return this.leave.completeTeam(orgId, viewer, await this.employees.team(orgId, viewer));
  }

  @Get('org-chart')
  @RequirePermission('analytics.read')
  async orgChart(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<OrgChartView> {
    const parsed = OrgChartQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.employees.orgChart(orgId, viewer, parsed.data.view);
  }
}
