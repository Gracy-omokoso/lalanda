// Espace de l'abonné : ses factures d'abonnement et sa fiche de facturation
// (ADR-0047, décisions n° 6 et n° 8). Routes de l'organisation ACTIVE seulement :
// une facture d'une autre organisation est « introuvable ».

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { CurrentOrgRole } from '../authz/current-org-role.decorator.js';
import type { OrgRole } from '../authz/permissions.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { BillingProfileInputSchema } from './subscription-invoices.dto.js';
import {
  SubscriptionInvoicingService,
  type BillingProfileView,
  type SubscriberInvoiceView,
} from './subscription-invoicing.service.js';

type User = NonNullable<AuthenticatedRequest['user']>;

@Controller('organizations/current/subscription')
@UseGuards(AuthGuard, PermissionsGuard)
export class SubscriptionInvoicesController {
  constructor(
    @Inject(SubscriptionInvoicingService) private readonly invoicing: SubscriptionInvoicingService,
  ) {}

  @Get('invoices')
  @RequirePermission('billing.manage')
  async list(@CurrentOrgId() orgId: string): Promise<{ invoices: SubscriberInvoiceView[] }> {
    return { invoices: await this.invoicing.listForSubscriber(orgId) };
  }

  @Get('invoices/:documentId/pdf')
  @RequirePermission('billing.manage')
  async pdf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('documentId') documentId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const doc = await this.invoicing.pdfForSubscriber(orgId, documentId, {
      id: user.id,
      role: role ?? 'unknown',
    });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${doc.fileName}"`);
    res.setHeader('content-length', String(doc.pdf.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(doc.pdf);
  }

  @Get('billing-profile')
  @RequirePermission('billing.manage')
  async profile(@CurrentOrgId() orgId: string): Promise<BillingProfileView> {
    return this.invoicing.billingProfile(orgId);
  }

  @Put('billing-profile')
  @RequirePermission('billing.manage')
  async saveProfile(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<BillingProfileView> {
    const parsed = BillingProfileInputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const code = (first as { params?: { code?: string } } | undefined)?.params?.code;
      throw new BadRequestException({
        code: code ?? 'VALIDATION_ERROR',
        message: first?.message ?? 'Fiche de facturation invalide.',
      });
    }
    return this.invoicing.saveBillingProfile(orgId, parsed.data, {
      id: user.id,
      role: role ?? 'unknown',
    });
  }
}
