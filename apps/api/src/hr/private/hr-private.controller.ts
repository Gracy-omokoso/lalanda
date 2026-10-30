// Données sensibles du collaborateur — ADR-0045 § 2.4, § 3.1. ADR-0045 — H2.
//
//   GET  /hr/employees/:employeeId/private            analytics.read ; hr.sensitive.read ou soi
//   PUT  /hr/employees/:employeeId/private/:section   hr.sensitive.read + hr.manage
//   POST /hr/employees/:employeeId/private/reveal     analytics.read ; hr.sensitive.read ou soi
//
// La lecture (masquée ou en clair) est RELATIONNELLE : le collaborateur voit ses
// propres données (droit d'accès, décision ouverte n° 4), d'où `analytics.read` au
// guard et la décision ici, sur les droits EFFECTIFS. Un lecteur qui voit la fiche
// sans `hr.sensitive.read` reçoit 403 ; hors portée, 404. `hr.sensitive.read` est
// interdit à la plateforme même sous accès délégué (`PLATFORM_FORBIDDEN_ACTIONS`).

import {
  RevealPrivateBody,
  isHrPrivateField,
  updatePrivateSectionBody,
  type EmployeePrivateRevealView,
  type EmployeePrivateSummary,
  type HrPrivateSections,
} from '@lalanda/shared/hr';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
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
import { conflict, invalidRequest } from '../../sales/sales.errors.js';
import { HrEmployeesService } from '../employees/hr-employees.service.js';
import { employeeNotFound, sensitiveForbidden } from '../scope/hr-errors.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrPrivateService } from './hr-private.service.js';

type User = { id: string };

@Controller('hr/employees/:employeeId/private')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrPrivateController {
  constructor(
    @Inject(HrPrivateService) private readonly privates: HrPrivateService,
    @Inject(HrEmployeesService) private readonly employees: HrEmployeesService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  /** `true` si l'appelant lit pour lui-même ; lève 404 ou 403 s'il n'a pas le droit. */
  private async access(
    orgId: string,
    userId: string,
    perms: CurrentOrgPermissionsValue | undefined,
    employeeId: string,
  ): Promise<{ self: boolean }> {
    const viewer = await this.scope.viewerOf(orgId, userId, perms);
    const employee = viewer.byId.get(employeeId);
    if (!employee || employee.status === 'anonymized') employeeNotFound();
    const self = viewer.scope.selfEmployeeId === employeeId;
    if (viewer.actions.has('hr.sensitive.read')) return { self };
    if (self) return { self: true };
    if (this.scope.relationTo(viewer, employeeId) !== null) sensitiveForbidden(viewer.role);
    employeeNotFound();
  }

  @Get()
  @RequirePermission('analytics.read')
  async summary(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeePrivateSummary> {
    await this.access(orgId, user.id, perms, employeeId);
    return this.privates.summary(orgId, employeeId);
  }

  // Déclarée AVANT `:section` : « reveal » n'est pas une section.
  @Post('reveal')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reveal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('employeeId') employeeId: string,
    @Body() body: unknown,
  ): Promise<EmployeePrivateRevealView> {
    const { self } = await this.access(orgId, user.id, perms, employeeId);
    const parsed = RevealPrivateBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.privates.reveal(orgId, employeeId, parsed.data.sections, {
      userId: user.id,
      role: role ?? 'unknown',
      self,
    });
  }

  @Put(':section')
  @RequirePermission('hr.sensitive.read', 'hr.manage')
  async write(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
    @Param('section') section: string,
    @Body() body: unknown,
  ): Promise<EmployeePrivateSummary> {
    if (!isHrPrivateField(section)) {
      throw new BadRequestException({
        code: 'HR_PRIVATE_SECTION_UNKNOWN',
        message: 'Section inconnue.',
      });
    }
    const employee = await this.employees.requireOwn(orgId, employeeId);
    if (employee.status === 'anonymized') {
      conflict('EMPLOYEE_ANONYMIZED', 'Ce dossier a été anonymisé : il ne se modifie plus.');
    }
    const parsed = updatePrivateSectionBody(section).safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.privates.write(
      orgId,
      employee,
      section,
      parsed.data.data as HrPrivateSections[typeof section] | null,
      parsed.data.expectedRevision,
      { userId: user.id, role: role ?? 'unknown' },
    );
  }
}
