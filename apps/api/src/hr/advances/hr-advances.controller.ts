// Avances au personnel — ADR-0051 § 3.2, § 3.3, § 4, § 6.1. ADR-0051 — H10.
//
//   GET  /hr/advances                         analytics.read + portée (§ 4 : une avance sur
//                                             salaire n'existe pas pour le manager ni pour
//                                             `hr.read` seul)
//   GET  /hr/advances/:id                     idem
//   POST /hr/advances                         expenses.claim
//   PUT  /hr/advances/:id                     expenses.claim (brouillon, demandeur)
//   POST /hr/advances/:id/submit              expenses.claim (demandeur)
//   POST /hr/advances/:id/cancel              analytics.read : demandeur, ou validateur (motif)
//   POST /hr/advances/:id/approve · …/reject  analytics.read + `expenseApprovalDecision`
//                                             (avance sur salaire : `expenses.approve` ET
//                                             `hr.sensitive.read`, étape `finance` seule)
//   POST /hr/advances/:id/disburse            payables.pay + treasury.read
//   POST /hr/advances/:id/disbursement/cancel payables.pay + treasury.read
//   POST /hr/advances/:id/settlements         analytics.read + selon la nature (§ 3.3) :
//                                             retour d'espèces `payables.pay` ; déclaration
//                                             sur la paie `expenses.approve` +
//                                             `hr.sensitive.read` ; abandon `expenses.approve`
//   POST /hr/advances/:id/reveal-reason       analytics.read : bénéficiaire, ou
//                                             `expenses.approve` + `hr.sensitive.read` ;
//                                             audit STRICT écrit avant
//   PUT  /hr/settings/advances                expenses.approve + hr.manage

import {
  ApproveExpenseBody,
  CancelDisbursementBody,
  CancelExpenseBody,
  CreateAdvanceBody,
  CreateAdvanceSettlementBody,
  DisburseAdvanceBody,
  ListAdvancesQuery,
  RejectExpenseBody,
  SubmitAdvanceBody,
  UpdateAdvanceBody,
  UpdateHrAdvancesSettingsBody,
  type AdvancePage,
  type AdvanceReasonView,
  type AdvanceView,
  type HrExpensesAdvancesSettingsView,
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
import { invalidRequest } from '../../sales/sales.errors.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrExpensesSettingsService } from '../expenses/hr-expenses-settings.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { HrAdvancesService } from './hr-advances.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

@Controller('hr')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrAdvancesController {
  constructor(
    @Inject(HrAdvancesService) private readonly advances: HrAdvancesService,
    @Inject(HrExpensesSettingsService) private readonly settings: HrExpensesSettingsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('advances')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<AdvancePage> {
    const parsed = ListAdvancesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.list(orgId, viewer, parsed.data);
  }

  @Get('advances/:advanceId')
  @RequirePermission('analytics.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
  ): Promise<AdvanceView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.get(orgId, viewer, advanceId);
  }

  @Post('advances')
  @RequirePermission('expenses.claim')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = CreateAdvanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande d’avance invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.create(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Put('advances/:advanceId')
  @RequirePermission('expenses.claim')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = UpdateAdvanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Demande d’avance invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.update(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/submit')
  @HttpCode(200)
  @RequirePermission('expenses.claim')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = SubmitAdvanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.submit(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/cancel')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = CancelExpenseBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.cancel(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/approve')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = ApproveExpenseBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.approve(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/reject')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = RejectExpenseBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un refus porte un commentaire.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.reject(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/disburse')
  @HttpCode(200)
  @RequirePermission('payables.pay', 'treasury.read')
  async disburse(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = DisburseAdvanceBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Versement invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.disburse(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/disbursement/cancel')
  @HttpCode(200)
  @RequirePermission('payables.pay', 'treasury.read')
  async cancelDisbursement(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = CancelDisbursementBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Une annulation porte un motif.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.cancelDisbursement(
      orgId,
      viewer,
      advanceId,
      parsed.data,
      actorOf(user, perms),
    );
  }

  @Post('advances/:advanceId/settlements')
  @HttpCode(201)
  @RequirePermission('analytics.read')
  async settle(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
    @Body() body: unknown,
  ): Promise<AdvanceView> {
    const parsed = CreateAdvanceSettlementBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Régularisation invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.addSettlement(orgId, viewer, advanceId, parsed.data, actorOf(user, perms));
  }

  @Post('advances/:advanceId/reveal-reason')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async revealReason(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('advanceId') advanceId: string,
  ): Promise<AdvanceReasonView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.advances.revealReason(orgId, viewer, advanceId, actorOf(user, perms));
  }

  @Put('settings/advances')
  // `expenses.approve` EN PREMIER : le 403 la nomme pour tout rôle refusé.
  @RequirePermission('expenses.approve', 'hr.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<HrExpensesAdvancesSettingsView> {
    const parsed = UpdateHrAdvancesSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages des avances invalides.');
    return this.settings.updateAdvances(orgId, parsed.data, actorOf(user, perms));
  }
}
