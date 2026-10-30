// Demandes d'absence, validations, soldes, grand livre — ADR-0045 § 3.2. ADR-0045 — H3.
//
//   POST /hr/leave-requests                    leave.request (pour soi) ; hr.manage pour autrui
//   GET  /hr/leave-requests                    analytics.read + portée (soi, équipe, hr.read)
//   POST /hr/leave-requests/:id/approve        analytics.read + séparation des tâches
//   POST /hr/leave-requests/:id/reject         analytics.read + séparation des tâches
//   POST /hr/leave-requests/:id/cancel         analytics.read + demandeur ou hr.manage
//   GET  /hr/leave-approvals/pending           analytics.read (ce que l'appelant peut valider)
//   GET  /hr/leave-balances                    analytics.read + portée (soi, équipe, hr.read)
//   GET  /hr/leave-ledger                      analytics.read + portée (soi, hr.read)
//   POST /hr/leave-ledger                      hr.manage
//
// Routes RELATIONNELLES : le manager n'a besoin d'aucune action, la relation suffit
// (§ 4.3) ; la décision est prise dans le service par `leaveApprovalDecision` et par
// la portée du moteur (`hrViewerScope`) sur les droits EFFECTIFS.

import {
  ApproveLeaveRequestBody,
  CancelLeaveRequestBody,
  CreateLeaveLedgerEntryBody,
  CreateLeaveRequestBody,
  LeaveBalancesQuery,
  ListLeaveLedgerQuery,
  ListLeaveRequestsQuery,
  PendingApprovalsQuery,
  RejectLeaveRequestBody,
  type LeaveBalancesView,
  type LeaveLedgerEntryView,
  type LeaveLedgerView,
  type LeaveRequestPage,
  type LeaveRequestView,
} from '@lalanda/shared/hr';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
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
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrLeaveService } from './hr-leave.service.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('hr')
@UseGuards(AuthGuard, PermissionsGuard)
export class HrLeaveController {
  constructor(
    @Inject(HrLeaveService) private readonly leave: HrLeaveService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Post('leave-requests')
  @RequirePermission('leave.request')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<LeaveRequestView> {
    const parsed = CreateLeaveRequestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande d’absence invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.leave.create(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Get('leave-requests')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LeaveRequestPage> {
    const parsed = ListLeaveRequestsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.leave.list(orgId, await this.scope.viewerOf(orgId, user.id, perms), parsed.data);
  }

  @Post('leave-requests/:requestId/approve')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ): Promise<LeaveRequestView> {
    const parsed = ApproveLeaveRequestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.leave.approve(orgId, viewer, requestId, parsed.data, actorOf(user, perms));
  }

  @Post('leave-requests/:requestId/reject')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ): Promise<LeaveRequestView> {
    const parsed = RejectLeaveRequestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un refus porte un commentaire.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.leave.reject(orgId, viewer, requestId, parsed.data, actorOf(user, perms));
  }

  @Post('leave-requests/:requestId/cancel')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ): Promise<LeaveRequestView> {
    const parsed = CancelLeaveRequestBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.leave.cancel(orgId, viewer, requestId, parsed.data, actorOf(user, perms));
  }

  @Get('leave-approvals/pending')
  @RequirePermission('analytics.read')
  async pending(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LeaveRequestPage> {
    const parsed = PendingApprovalsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.leave.pending(orgId, await this.scope.viewerOf(orgId, user.id, perms), parsed.data);
  }

  @Get('leave-balances')
  @RequirePermission('analytics.read')
  async balances(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LeaveBalancesView> {
    const parsed = LeaveBalancesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.leave.balances(
      orgId,
      await this.scope.viewerOf(orgId, user.id, perms),
      parsed.data,
    );
  }

  @Get('leave-ledger')
  @RequirePermission('analytics.read')
  async ledger(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<LeaveLedgerView> {
    const parsed = ListLeaveLedgerQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.leave.ledgerList(
      orgId,
      await this.scope.viewerOf(orgId, user.id, perms),
      parsed.data,
    );
  }

  @Post('leave-ledger')
  @RequirePermission('hr.manage')
  async adjust(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<LeaveLedgerEntryView> {
    const parsed = CreateLeaveLedgerEntryBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Mouvement de solde invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.leave.adjust(orgId, viewer, parsed.data, actorOf(user, perms));
  }
}
