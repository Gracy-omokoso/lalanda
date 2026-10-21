// Encaissements et règlement des factures — ADR-0031 § 4.
//
// `sales.read` pour lire, `sales.receipt` pour enregistrer, modifier et annuler un
// encaissement, `sales.manage` pour poser l'échéance d'une facture. Organisation
// active seulement ; une ressource d'une autre organisation répond 404.

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
import { invalidRequest } from '../sales.errors.js';
import type { InvoiceActor } from '../invoices/invoice.types.js';
import {
  CancelReceiptSchema,
  DueDateBodySchema,
  ListReceiptsQuerySchema,
  PutReceiptSchema,
  ReceiptBodySchema,
  SettlementsQuerySchema,
  SummaryQuerySchema,
} from './receipts.dto.js';
import { ReceiptsService, type ReceiptView, type ReceiptsSummary } from './receipts.service.js';
import { SettlementsService, type SettlementView } from './settlements.service.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(user: User, role: OrgRole | undefined): InvoiceActor {
  const name = user.name?.trim();
  return { userId: user.id, name: name ? name : user.email, role: role ?? 'unknown' };
}

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
  ) {}

  @Get('receipts')
  @RequirePermission('sales.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<{ items: ReceiptView[] }> {
    const parsed = ListReceiptsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return { items: await this.receipts.list(orgId, parsed.data) };
  }

  @Get('receipts/summary')
  @RequirePermission('sales.read')
  async summary(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<ReceiptsSummary> {
    const parsed = SummaryQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    return this.receipts.summary(orgId, parsed.data.from, parsed.data.to);
  }

  @Get('receipts/:receiptId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('receiptId') receiptId: string,
  ): Promise<ReceiptView> {
    return this.receipts.get(orgId, receiptId);
  }

  @Post('receipts')
  @RequirePermission('sales.receipt')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<ReceiptView> {
    const parsed = ReceiptBodySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.receipts.create(orgId, parsed.data, actorOf(user, role));
  }

  @Put('receipts/:receiptId')
  @RequirePermission('sales.receipt')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('receiptId') receiptId: string,
    @Body() body: unknown,
  ): Promise<ReceiptView> {
    const parsed = PutReceiptSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.receipts.update(
      orgId,
      receiptId,
      parsed.data.expectedRevision,
      parsed.data.receipt,
      actorOf(user, role),
    );
  }

  @Post('receipts/:receiptId/cancel')
  @HttpCode(200)
  @RequirePermission('sales.receipt')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('receiptId') receiptId: string,
    @Body() body: unknown,
  ): Promise<ReceiptView> {
    const parsed = CancelReceiptSchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.receipts.cancel(
      orgId,
      receiptId,
      parsed.data.expectedRevision,
      parsed.data.reason,
      actorOf(user, role),
    );
  }

  @Get('settlements')
  @RequirePermission('sales.read')
  async settlementsList(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<{ items: SettlementView[] }> {
    const parsed = SettlementsQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres invalides.');
    const items = parsed.data.invoiceIds
      ? await this.settlements.byIds(orgId, parsed.data.invoiceIds)
      : await this.settlements.open(orgId, parsed.data.currency);
    return { items };
  }

  @Get('settlements/:invoiceId')
  @RequirePermission('sales.read')
  async settlement(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<SettlementView> {
    return this.settlements.one(orgId, invoiceId);
  }

  @Put('settlements/:invoiceId/due-date')
  @RequirePermission('sales.manage')
  async dueDate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SettlementView> {
    const parsed = DueDateBodySchema.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.settlements.setDueDate(orgId, invoiceId, parsed.data.dueDate, user.id);
  }
}
