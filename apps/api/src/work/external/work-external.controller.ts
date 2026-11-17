// Membres externes côté ERP — ADR-0078.
//
//   GET    /work/projects/:projectId/external-members              work.read
//   POST   /work/projects/:projectId/external-members              work.update (gestion du projet)
//   PUT    /work/projects/:projectId/external-members/:accountId   work.update (gestion du projet)
//   DELETE /work/projects/:projectId/external-members/:accountId   work.update (gestion du projet)
//   GET    /work/external-accounts                                 work.manage
//   PUT    /work/external-accounts/:accountId                      work.manage
//   POST   /work/external-accounts/:accountId/close                work.manage
//   GET    /work/external-accounts/:accountId/rates                work.read + purchase.read
//   POST   /work/external-accounts/:accountId/rates                work.manage + purchase.manage
//   DELETE /work/external-accounts/:accountId/rates/:rateId        work.manage + purchase.manage
//   GET    /work/external-accounts/:accountId/time-recap(.csv)     work.read + purchase.read
//   GET    /work/suppliers/:supplierId/consultants                 work.read + purchase.read
//   GET    /work/tasks/:taskId/external                            work.read
//   PUT    /work/tasks/:taskId/client-settings                     work.update (gestion du projet)
//   POST   /work/tasks/:taskId/client-approval/reset               work.update (gestion du projet)
//   GET    /work/guests/:userId/projects                           work.manage
//   POST   /work/guests/:userId/convert                            work.manage

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CloseExternalAccountBody,
  ConsultantRecapQuery,
  ConvertGuestBody,
  InviteExternalMemberBody,
  PutTaskExternalSettingsBody,
  ResetClientApprovalBody,
  SetConsultantRateBody,
  UpdateExternalAccountBody,
  UpdateExternalMemberBody,
  type ConsultantRecapView,
  type SupplierConsultantsView,
  type WorkExternalAccountView,
  type WorkExternalMemberView,
  type WorkExternalMembersView,
  type WorkMemberRateView,
  type WorkTaskExternalView,
} from '@lalanda/shared/work';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { RequireFeature } from '../../billing/feature.guard.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { WorkIdPipe, workActorOf } from '../work.common.js';
import { WorkVisibilityGuard } from '../work-visibility.guard.js';
import { WorkExternalMembersService } from './work-external-members.service.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

@Controller('work')
@RequireFeature('run_work')
@UseGuards(AuthGuard, PermissionsGuard, WorkVisibilityGuard)
export class WorkExternalController {
  constructor(
    @Inject(WorkExternalMembersService) private readonly externals: WorkExternalMembersService,
  ) {}

  // ── Membres externes d'un projet ─────────────────────────────────────────

  @Get('projects/:projectId/external-members')
  @RequirePermission('work.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('projectId', WorkIdPipe) projectId: string,
  ): Promise<WorkExternalMembersView> {
    return this.externals.listForProject(orgId, projectId, workActorOf(user, perms));
  }

  @Post('projects/:projectId/external-members')
  @RequirePermission('work.update')
  async invite(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Body() body: unknown,
  ): Promise<WorkExternalMemberView> {
    const parsed = InviteExternalMemberBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.invite(orgId, projectId, parsed.data, workActorOf(user, perms));
  }

  @Put('projects/:projectId/external-members/:accountId')
  @RequirePermission('work.update')
  async updateMember(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Body() body: unknown,
  ): Promise<WorkExternalMemberView> {
    const parsed = UpdateExternalMemberBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.updateMember(
      orgId,
      projectId,
      accountId,
      parsed.data,
      workActorOf(user, perms),
    );
  }

  @Delete('projects/:projectId/external-members/:accountId')
  @HttpCode(204)
  @RequirePermission('work.update')
  async removeMember(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('projectId', WorkIdPipe) projectId: string,
    @Param('accountId', WorkIdPipe) accountId: string,
  ): Promise<void> {
    await this.externals.removeMember(orgId, projectId, accountId, workActorOf(user, perms));
  }

  // ── Comptes externes ─────────────────────────────────────────────────────

  @Get('external-accounts')
  @RequirePermission('work.manage')
  async accounts(@CurrentOrgId() orgId: string): Promise<{ items: WorkExternalAccountView[] }> {
    return this.externals.listAccounts(orgId);
  }

  @Put('external-accounts/:accountId')
  @RequirePermission('work.manage')
  async updateAccount(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Body() body: unknown,
  ): Promise<WorkExternalAccountView> {
    const parsed = UpdateExternalAccountBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.updateAccount(orgId, accountId, parsed.data, workActorOf(user, perms));
  }

  @Post('external-accounts/:accountId/close')
  @RequirePermission('work.manage')
  async closeAccount(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Body() body: unknown,
  ): Promise<WorkExternalAccountView> {
    const parsed = CloseExternalAccountBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.closeAccount(orgId, accountId, workActorOf(user, perms));
  }

  // ── Taux d'achat et récapitulatif d'un consultant ────────────────────────

  @Get('external-accounts/:accountId/rates')
  @RequirePermission('work.read', 'purchase.read')
  async rates(
    @CurrentOrgId() orgId: string,
    @Param('accountId', WorkIdPipe) accountId: string,
  ): Promise<{ items: WorkMemberRateView[] }> {
    return this.externals.listRates(orgId, accountId);
  }

  @Post('external-accounts/:accountId/rates')
  @RequirePermission('work.manage', 'purchase.manage')
  async setRate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Body() body: unknown,
  ): Promise<WorkMemberRateView> {
    const parsed = SetConsultantRateBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.setRate(orgId, accountId, parsed.data, workActorOf(user, perms));
  }

  @Delete('external-accounts/:accountId/rates/:rateId')
  @HttpCode(204)
  @RequirePermission('work.manage', 'purchase.manage')
  async removeRate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Param('rateId', WorkIdPipe) rateId: string,
  ): Promise<void> {
    await this.externals.removeRate(orgId, accountId, rateId, workActorOf(user, perms));
  }

  @Get('external-accounts/:accountId/time-recap')
  @RequirePermission('work.read', 'purchase.read')
  async recap(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Query() query: unknown,
  ): Promise<ConsultantRecapView> {
    const parsed = ConsultantRecapQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.externals.recap(orgId, accountId, parsed.data, workActorOf(user, perms));
  }

  @Get('external-accounts/:accountId/time-recap.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="recapitulatif-temps-consultant.csv"')
  @Header('cache-control', 'no-store')
  @RequirePermission('work.read', 'purchase.read')
  async recapCsv(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('accountId', WorkIdPipe) accountId: string,
    @Query() query: unknown,
  ): Promise<string> {
    const parsed = ConsultantRecapQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.externals.recapCsv(orgId, accountId, parsed.data, workActorOf(user, perms));
  }

  @Get('suppliers/:supplierId/consultants')
  @RequirePermission('work.read', 'purchase.read')
  async supplierConsultants(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('supplierId', WorkIdPipe) supplierId: string,
    @Query() query: unknown,
  ): Promise<SupplierConsultantsView> {
    const parsed = ConsultantRecapQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.externals.supplierConsultants(
      orgId,
      supplierId,
      parsed.data,
      workActorOf(user, perms),
    );
  }

  // ── Réglages externes d'une tâche ────────────────────────────────────────

  @Get('tasks/:taskId/external')
  @RequirePermission('work.read')
  async taskExternal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('taskId', WorkIdPipe) taskId: string,
  ): Promise<WorkTaskExternalView> {
    return this.externals.taskExternal(orgId, taskId, workActorOf(user, perms));
  }

  @Put('tasks/:taskId/client-settings')
  @RequirePermission('work.update')
  async putTaskExternal(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskExternalView> {
    const parsed = PutTaskExternalSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.putTaskExternal(orgId, taskId, parsed.data, workActorOf(user, perms));
  }

  @Post('tasks/:taskId/client-approval/reset')
  @RequirePermission('work.update')
  async resetClientApproval(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('taskId', WorkIdPipe) taskId: string,
    @Body() body: unknown,
  ): Promise<WorkTaskExternalView> {
    const parsed = ResetClientApprovalBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.resetClientApproval(orgId, taskId, parsed.data, workActorOf(user, perms));
  }

  // ── Conversion d'un Invité externe ───────────────────────────────────────

  @Get('guests/:userId/projects')
  @RequirePermission('work.manage')
  async guestProjects(
    @CurrentOrgId() orgId: string,
    @Param('userId', WorkIdPipe) userId: string,
  ): Promise<{
    items: { projectId: string; name: string; kind: string; customerId: string | null }[];
  }> {
    return this.externals.guestProjects(orgId, userId);
  }

  @Post('guests/:userId/convert')
  @RequirePermission('work.manage')
  async convertGuest(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('userId', WorkIdPipe) userId: string,
    @Body() body: unknown,
  ): Promise<WorkExternalAccountView> {
    const parsed = ConvertGuestBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.externals.convertGuest(orgId, userId, parsed.data, workActorOf(user, perms));
  }
}
