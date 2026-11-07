// Compte Lalanda d'un collaborateur — ADR-0068 § 1.
//
//   GET  /hr/employees/:employeeId/account             hr.read
//   POST /hr/employees/:employeeId/invitation          hr.manage + members.invite
//   POST /hr/employees/:employeeId/invitation/resend   hr.manage + members.invite
//   POST /hr/employees/:employeeId/invitation/cancel   hr.manage + members.invite
//
// Fiche d'une autre organisation → 404. Le jeton d'invitation n'est jamais renvoyé ici.

import type { EmployeeAccountView, EmployeeInvitationResult } from '@lalanda/shared/hr';
import { Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import {
  HrEmployeeInvitationsService,
  type HrInviteActor,
} from './hr-employee-invitations.service.js';

type User = { id: string; name?: string | null };

const inviter = (user: User, role: OrgRole | undefined): HrInviteActor => ({
  userId: user.id,
  role: role ?? 'unknown',
  name: user.name ?? null,
  // La route exige `members.invite` : le guard l'a vérifié.
  canInvite: true,
});

@Controller('hr/employees/:employeeId')
@RequireFeature('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrEmployeeAccountController {
  constructor(
    @Inject(HrEmployeeInvitationsService)
    private readonly invitations: HrEmployeeInvitationsService,
  ) {}

  @Get('account')
  @RequirePermission('hr.read')
  async account(
    @CurrentOrgId() orgId: string,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeAccountView> {
    return this.invitations.account(orgId, employeeId);
  }

  @Post('invitation')
  @HttpCode(200)
  @RequirePermission('hr.manage', 'members.invite')
  async invite(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeInvitationResult> {
    return this.invitations.invite(orgId, employeeId, inviter(user, role));
  }

  @Post('invitation/resend')
  @HttpCode(200)
  @RequirePermission('hr.manage', 'members.invite')
  async resend(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeInvitationResult> {
    return this.invitations.resend(orgId, employeeId, inviter(user, role));
  }

  @Post('invitation/cancel')
  @HttpCode(204)
  @RequirePermission('hr.manage', 'members.invite')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('employeeId') employeeId: string,
  ): Promise<void> {
    await this.invitations.cancel(orgId, employeeId, inviter(user, role));
  }
}
