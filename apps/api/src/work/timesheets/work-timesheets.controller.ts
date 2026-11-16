// Feuille de temps hebdomadaire en lecture — ADR-0045 § 3.3, § 6.3. ADR-0045 — H5.
//
//   GET  /work/timesheets?userId=&week=   work.read (soi) ; autrui : work.manage ou manager
//   ADR-0077 § 4 — validation hebdomadaire (garde `work.read`, décision dans le service) :
//   POST /work/timesheets/submit           le membre, pour lui-même
//   POST /work/timesheets/approve          manager du membre, ou work.manage (jamais soi)
//   POST /work/timesheets/return           idem, motif obligatoire
//   POST /work/timesheets/reopen           idem, motif obligatoire, tracé
//   GET  /work/timesheets/pending          semaines soumises que l'appelant peut valider
//
// La décision « autrui » est prise dans le service (droits effectifs, relation de
// manager du moteur RH). Rien n'est relié à la paie (ADR-0070).

import {
  DecideTimesheetBody,
  DecideTimesheetWithReasonBody,
  SubmitTimesheetBody,
  WeeklyTimesheetQuery,
  type PendingTimesheetView,
  type TimesheetApprovalView,
  type WeeklyTimesheetView,
} from '@lalanda/shared/work';
import { Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { workActorOf } from '../work.common.js';
import { WorkTimesheetsService } from './work-timesheets.service.js';
import { WorkTimesheetApprovalsService } from './work-timesheet-approvals.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { WorkVisibilityGuard } from '../work-visibility.guard.js';

@Controller('work/timesheets')
@RequireFeature('run_work') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkTimesheetsController {
  constructor(
    @Inject(WorkTimesheetsService) private readonly timesheets: WorkTimesheetsService,
    @Inject(WorkTimesheetApprovalsService)
    private readonly approvals: WorkTimesheetApprovalsService,
  ) {}

  /** ADR-0077 § 4 : semaines soumises que l'appelant peut valider. */
  @Get('pending')
  @RequirePermission('work.read')
  async pending(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
  ): Promise<{ items: PendingTimesheetView[] }> {
    return { items: await this.approvals.pending(orgId, workActorOf(user, perms)) };
  }

  @Post('submit')
  @HttpCode(200)
  @RequirePermission('work.read')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<TimesheetApprovalView> {
    const parsed = SubmitTimesheetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.approvals.submit(orgId, parsed.data, workActorOf(user, perms));
  }

  @Post('approve')
  @HttpCode(200)
  @RequirePermission('work.read')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<TimesheetApprovalView> {
    const parsed = DecideTimesheetBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.approvals.approve(orgId, parsed.data, workActorOf(user, perms));
  }

  @Post('return')
  @HttpCode(200)
  @RequirePermission('work.read')
  async returnWeek(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<TimesheetApprovalView> {
    const parsed = DecideTimesheetWithReasonBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.approvals.returnWeek(orgId, parsed.data, workActorOf(user, perms));
  }

  @Post('reopen')
  @HttpCode(200)
  @RequirePermission('work.read')
  async reopen(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<TimesheetApprovalView> {
    const parsed = DecideTimesheetWithReasonBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.approvals.reopen(orgId, parsed.data, workActorOf(user, perms));
  }

  @Get()
  @RequirePermission('work.read')
  async weekly(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: { id: string },
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<WeeklyTimesheetView> {
    const parsed = WeeklyTimesheetQuery.safeParse(query);
    if (!parsed.success)
      invalidRequest(parsed.error, 'Paramètres de la feuille de temps invalides.');
    return this.timesheets.weekly(orgId, parsed.data, workActorOf(user, perms));
  }
}
