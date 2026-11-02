// Notes de frais — ADR-0051 § 3.1, § 6.1. ADR-0051 — H10.
//
//   GET    /hr/expense-reports                 analytics.read + portée (siennes ; équipe ;
//                                              expenses.approve, payables.pay, hr.read)
//   GET    /hr/expense-reports/:id             idem
//   POST   /hr/expense-reports                 expenses.claim (pour soi ; avec hr.manage,
//                                              pour un collaborateur sans compte)
//   PUT    /hr/expense-reports/:id             expenses.claim (brouillon, déclarant)
//   DELETE /hr/expense-reports/:id             expenses.claim (brouillon, déclarant)
//   POST   /hr/expense-reports/:id/lines/:lineId/receipt   expenses.claim ; 30 par heure ;
//                                              `multipart/form-data`, partie `file`
//   GET    /hr/expense-reports/:id/lines/:lineId/receipt   lecteurs sauf `hr.read` seul ;
//                                              téléchargement INERTE, journalisé
//   POST   /hr/expense-reports/:id/submit      expenses.claim (déclarant)
//   POST   /hr/expense-reports/:id/cancel      analytics.read : déclarant, ou
//                                              expenses.approve (motif)
//   POST   /hr/expense-reports/:id/duplicate   expenses.claim (déclarant)
//   POST   /hr/expense-reports/:id/approve     analytics.read + `expenseApprovalDecision`
//   POST   /hr/expense-reports/:id/reject      analytics.read + `expenseApprovalDecision`
//   POST   /hr/expense-reports/:id/reimburse   payables.pay + treasury.read
//   POST   /hr/expense-reports/:id/reimbursement/cancel   payables.pay + treasury.read
//   GET    /hr/expenses/summary                analytics.read + (expenses.approve ou hr.read)
//   GET    /hr/expenses/to-pay                 payables.pay
//   GET    /hr/settings/expenses               analytics.read (réglages des deux blocs)
//   PUT    /hr/settings/expenses               hr.manage (+ expenses.approve pour le circuit)
//
// Routes RELATIONNELLES (manager, soi) : `analytics.read` au guard, décision dans le
// service sur les droits EFFECTIFS et la relation (`HrScopeService`). Hors portée : 404.

import {
  ApproveExpenseBody,
  CancelExpenseBody,
  CancelReimbursementBody,
  CreateExpenseReportBody,
  EXPENSE_LIMITS,
  EXPENSE_RECEIPT_FILE_FIELD,
  ExpenseSummaryQuery,
  ListExpenseReportsQuery,
  ReimburseExpenseReportBody,
  RejectExpenseBody,
  SubmitExpenseReportBody,
  UpdateExpenseReportBody,
  UpdateHrExpensesSettingsBody,
  type ExpenseReportPage,
  type ExpenseReportView,
  type HrExpensesAdvancesSettingsView,
  type HrToPayView,
} from '@lalanda/shared/hr';
import type { ExpenseSummaryResult } from '@lalanda/engine';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ZodError } from 'zod';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { storageFailure } from '../../purchases/attachments/purchase-attachments.js';
import { invalidRequest, issuesOf } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { contentDisposition } from '../../work/work-attachments.service.js';
import type { HrActor } from '../departments/hr-departments.service.js';
import { HrScopeService } from '../scope/hr-scope.service.js';
import { forbiddenAction, unprocessable } from './hr-expenses.common.js';
import { HrExpensesSettingsService } from './hr-expenses-settings.service.js';
import { HrExpenseReportsService, classifyReceipt } from './hr-expense-reports.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

type User = { id: string };
type Perms = CurrentOrgPermissionsValue | undefined;

function actorOf(user: User, perms: Perms): HrActor {
  return { userId: user.id, role: perms?.role ?? 'unknown' };
}

/**
 * Corps refusé : une catégorie d'immobilisation ou d'emprunt est un refus MÉTIER
 * (`422 EXPENSE_LINE_CATEGORY_NOT_ALLOWED`, § 2.1) ; le reste, une erreur de forme (400).
 */
export function refuseExpenseBody(error: ZodError, message: string): never {
  const issues = issuesOf(error);
  const business = issues.find((i) => i.code === 'EXPENSE_LINE_CATEGORY_NOT_ALLOWED');
  if (business) {
    unprocessable(business.code, business.message, { issues });
  }
  invalidRequest(error, message);
}

@Controller('hr')
@RequireFeature('hr') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class HrExpenseReportsController {
  constructor(
    @Inject(HrExpenseReportsService) private readonly reports: HrExpenseReportsService,
    @Inject(HrExpensesSettingsService) private readonly settings: HrExpensesSettingsService,
    @Inject(HrScopeService) private readonly scope: HrScopeService,
  ) {}

  @Get('expense-reports')
  @RequirePermission('analytics.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<ExpenseReportPage> {
    const parsed = ListExpenseReportsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.list(orgId, viewer, parsed.data);
  }

  @Get('expense-reports/:reportId')
  @RequirePermission('analytics.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
  ): Promise<ExpenseReportView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.get(orgId, viewer, reportId);
  }

  @Post('expense-reports')
  @RequirePermission('expenses.claim')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = CreateExpenseReportBody.safeParse(body);
    if (!parsed.success) refuseExpenseBody(parsed.error, 'Note de frais invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.create(orgId, viewer, parsed.data, actorOf(user, perms));
  }

  @Put('expense-reports/:reportId')
  @RequirePermission('expenses.claim')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = UpdateExpenseReportBody.safeParse(body);
    if (!parsed.success) refuseExpenseBody(parsed.error, 'Note de frais invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.update(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Delete('expense-reports/:reportId')
  @HttpCode(204)
  @RequirePermission('expenses.claim')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
  ): Promise<void> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    await this.reports.remove(orgId, viewer, reportId, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/lines/:lineId/receipt')
  @HttpCode(201)
  @RequirePermission('expenses.claim')
  @Throttle({ default: { ttl: 3_600_000, limit: EXPENSE_LIMITS.receiptUploadsPerHour } })
  @UseGuards(UserThrottlerGuard)
  // Guards d'abord (droits, débit), puis lecture du formulaire EN MÉMOIRE, bornée.
  @UseInterceptors(
    FileInterceptor(EXPENSE_RECEIPT_FILE_FIELD, {
      limits: {
        fileSize: EXPENSE_LIMITS.receiptPdfMaxBytes,
        files: 1,
        fields: 2,
        fieldSize: 200,
        parts: 3,
      },
    }),
  )
  async uploadReceipt(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Param('lineId') lineId: string,
    @UploadedFile() upload: { buffer: Buffer } | undefined,
  ): Promise<ExpenseReportView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    await this.reports.assertCanUpload(orgId, viewer, reportId, lineId);
    const file = classifyReceipt(upload);
    try {
      return await this.reports.uploadReceipt(
        orgId,
        viewer,
        reportId,
        lineId,
        file,
        actorOf(user, perms),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get('expense-reports/:reportId/lines/:lineId/receipt')
  @RequirePermission('analytics.read')
  async downloadReceipt(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Param('lineId') lineId: string,
    @Res() res: Response,
  ): Promise<void> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    let found;
    try {
      found = await this.reports.downloadReceipt(
        orgId,
        viewer,
        reportId,
        lineId,
        actorOf(user, perms),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
    // TOUJOURS en téléchargement, en-têtes inertes, jamais en cache.
    res
      .status(200)
      .set({
        'Content-Type': found.contentType,
        'Content-Length': String(found.body.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': contentDisposition('attachment', found.fileName),
        'Cache-Control': 'private, no-store',
      })
      .end(found.body);
  }

  @Post('expense-reports/:reportId/submit')
  @HttpCode(200)
  @RequirePermission('expenses.claim')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = SubmitExpenseReportBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.submit(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/cancel')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = CancelExpenseBody.safeParse(body ?? {});
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.cancel(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/duplicate')
  @HttpCode(201)
  @RequirePermission('expenses.claim')
  async duplicate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
  ): Promise<ExpenseReportView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.duplicate(orgId, viewer, reportId, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/approve')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = ApproveExpenseBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.approve(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/reject')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = RejectExpenseBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Un refus porte un commentaire.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.reject(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/reimburse')
  @HttpCode(200)
  @RequirePermission('payables.pay', 'treasury.read')
  async reimburse(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = ReimburseExpenseReportBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Remboursement invalide.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.reimburse(orgId, viewer, reportId, parsed.data, actorOf(user, perms));
  }

  @Post('expense-reports/:reportId/reimbursement/cancel')
  @HttpCode(200)
  @RequirePermission('payables.pay', 'treasury.read')
  async cancelReimbursement(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<ExpenseReportView> {
    const parsed = CancelReimbursementBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Une annulation porte un motif.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.cancelReimbursement(
      orgId,
      viewer,
      reportId,
      parsed.data,
      actorOf(user, perms),
    );
  }

  @Get('expenses/summary')
  @RequirePermission('analytics.read')
  async summary(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Query() query: unknown,
  ): Promise<ExpenseSummaryResult> {
    const parsed = ExpenseSummaryQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres du résumé invalides.');
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.summary(orgId, viewer, parsed.data);
  }

  @Get('expenses/to-pay')
  @RequirePermission('payables.pay')
  async toPay(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
  ): Promise<HrToPayView> {
    const viewer = await this.scope.viewerOf(orgId, user.id, perms);
    return this.reports.toPay(orgId, viewer);
  }

  @Get('settings/expenses')
  @RequirePermission('analytics.read')
  async getSettings(@CurrentOrgId() orgId: string): Promise<HrExpensesAdvancesSettingsView> {
    return this.settings.view(orgId);
  }

  @Put('settings/expenses')
  @RequirePermission('hr.manage')
  async putSettings(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgPermissions() perms: Perms,
    @Body() body: unknown,
  ): Promise<HrExpensesAdvancesSettingsView> {
    const parsed = UpdateHrExpensesSettingsBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error, 'Réglages des notes de frais invalides.');
    if (parsed.data.approvalFlow !== undefined) {
      const viewer = await this.scope.viewerOf(orgId, user.id, perms);
      if (!viewer.actions.has('expenses.approve')) {
        forbiddenAction(
          'expenses.approve',
          viewer.role,
          'Changer le circuit des notes de frais exige de les valider soi-même.',
        );
      }
    }
    return this.settings.updateExpenses(orgId, parsed.data, actorOf(user, perms));
  }
}
