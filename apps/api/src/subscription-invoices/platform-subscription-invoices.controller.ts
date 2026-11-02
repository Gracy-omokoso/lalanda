// Console : factures des abonnements (ADR-0047, décisions n° 1, 7, 8 et 10), sous
// Abonnements. Même garde que `/admin/billing/**` (ADR-0053 P3) : `PlatformAuthGuard`
// puis `PermissionsGuard` ; toute écriture motivée exige la ré-authentification.
//
//   lire                         → `platform.billing.read`
//   émettre, avoir (demande et   → `platform.billing.confirm` (finance, super-admin)
//   approbation par une seconde
//   personne)
//   désigner l'organisation      → `platform.billing.grant`
//   vendeuse

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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { PlatformConsoleRoute, RequirePlatformAction } from '../authz/authz.decorators.js';
import { AuthzService } from '../authz/authz.service.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { PlatformAuthGuard } from '../authz/platform-auth.guard.js';
import { RequireRecentReauth } from '../integrations/reauth.guard.js';
import { invalidBody } from '../admin/admin.dto.js';
import type { AdminActor } from '../admin/admin.service.js';
import {
  CreditNoteRequestInputSchema,
  DesignateSellerInputSchema,
  EmitSubscriptionInvoiceInputSchema,
} from './subscription-invoices.dto.js';
import {
  SubscriptionInvoicingService,
  type ConsoleSubscriptionInvoiceView,
  type SellerView,
  type UninvoicedPaymentView,
} from './subscription-invoicing.service.js';

@Controller('admin/billing/subscription-invoices')
@UseGuards(PlatformAuthGuard, PermissionsGuard)
@PlatformConsoleRoute()
@RequirePlatformAction('platform.billing.read')
export class PlatformSubscriptionInvoicesController {
  constructor(
    @Inject(SubscriptionInvoicingService) private readonly invoicing: SubscriptionInvoicingService,
    @Inject(AuthzService) private readonly authz: AuthzService,
  ) {}

  private async actorOf(req: AuthenticatedRequest): Promise<AdminActor> {
    const roles = await this.authz.platformRolesOf(req.user!.id);
    return { userId: req.user!.id, platformRole: roles.join(',') || 'aucun' };
  }

  @Get()
  @RequirePlatformAction('platform.billing.read')
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ invoices: ConsoleSubscriptionInvoiceView[] }> {
    const n = Number.parseInt(limit ?? '', 10);
    return {
      invoices: await this.invoicing.listForConsole({
        status: status || undefined,
        limit: Number.isFinite(n) ? n : undefined,
      }),
    };
  }

  @Get('uninvoiced')
  @RequirePlatformAction('platform.billing.read')
  async uninvoiced(): Promise<{ payments: UninvoicedPaymentView[] }> {
    return { payments: await this.invoicing.uninvoicedPayments() };
  }

  @Post('emit')
  @RequirePlatformAction('platform.billing.confirm')
  @RequireRecentReauth()
  @HttpCode(200)
  async emit(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ alreadyIssued: boolean; invoice: ConsoleSubscriptionInvoiceView }> {
    const parsed = EmitSubscriptionInvoiceInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Paiement et motif obligatoires.');
    return this.invoicing.emitFromConsole(parsed.data, await this.actorOf(req));
  }

  @Get('seller')
  @RequirePlatformAction('platform.billing.read')
  async seller(): Promise<SellerView> {
    return this.invoicing.sellerView();
  }

  @Put('seller')
  @RequirePlatformAction('platform.billing.grant')
  @RequireRecentReauth()
  async designate(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<SellerView> {
    const parsed = DesignateSellerInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Organisation et motif obligatoires.');
    return this.invoicing.designateSeller(parsed.data, await this.actorOf(req));
  }

  @Post(':id/credit-note')
  @RequirePlatformAction('platform.billing.confirm')
  @RequireRecentReauth()
  @HttpCode(200)
  async requestCreditNote(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ConsoleSubscriptionInvoiceView> {
    const parsed = CreditNoteRequestInputSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidBody(parsed.error, 'Motif du remboursement obligatoire.');
    return this.invoicing.requestCreditNote(id, parsed.data, await this.actorOf(req));
  }

  @Post(':id/credit-note/approve')
  @RequirePlatformAction('platform.billing.confirm')
  @RequireRecentReauth()
  @HttpCode(200)
  async approveCreditNote(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ConsoleSubscriptionInvoiceView> {
    return this.invoicing.approveCreditNote(id, await this.actorOf(req));
  }

  @Get(':id/pdf')
  @RequirePlatformAction('platform.billing.read')
  async pdf(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('kind') kind: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const doc = await this.invoicing.pdfForConsole(
      id,
      kind === 'credit_note' ? 'credit_note' : 'invoice',
      await this.actorOf(req),
    );
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${doc.fileName}"`);
    res.setHeader('content-length', String(doc.pdf.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(doc.pdf);
  }
}
