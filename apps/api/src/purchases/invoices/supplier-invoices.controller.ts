// Factures fournisseurs — ADR-0044 § 3.5. ADR-0044 — P4.
//
//   GET  /purchases/invoices?status=&supplierId=&orderId=&due=&matching=&disputed=&cursor=
//                                                            purchase.read
//   POST /purchases/invoices                                 purchase.manage — brouillon
//   POST /purchases/invoices/from-order { orderId }          purchase.manage — préremplissage
//   GET  /purchases/invoices/:id                             purchase.read
//   PUT  /purchases/invoices/:id                             purchase.manage — brouillon
//   POST /purchases/invoices/:id/validate                    purchase.manage
//   POST /purchases/invoices/:id/force-validate { reason }   purchase.approve
//   POST /purchases/invoices/:id/dispute { reason }          purchase.manage
//   POST /purchases/invoices/:id/resolve-dispute             purchase.manage
//   POST /purchases/invoices/:id/cancel { reason }           purchase.manage
//   POST /purchases/invoices/:id/attachment                  purchase.manage — corps BINAIRE,
//                                                            nom en `X-File-Name`, 30/h
//   GET  /purchases/invoices/:id/attachment                  purchase.read — en-têtes inertes
//
// Une facture d'une autre organisation répond 404.

import {
  CreateSupplierInvoiceBody,
  ListSupplierInvoicesQuery,
  PURCHASE_ATTACHMENT_LIMITS,
  SupplierInvoiceFromOrderBody,
  SupplierInvoiceReasonBody,
  SupplierInvoiceRevisionBody,
  UpdateSupplierInvoiceBody,
  type SupplierInvoicePage,
  type SupplierInvoicePrefill,
  type SupplierInvoiceView,
} from '@lalanda/shared/purchases';
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
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import {
  readAttachmentBody,
  sendAttachment,
  storageFailure,
} from '../attachments/purchase-attachments.js';
import { parseBody, type PurchaseActor } from './purchase-p4.common.js';
import { SupplierInvoicesService } from './supplier-invoices.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): PurchaseActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('purchases/invoices')
@UseGuards(AuthGuard, PermissionsGuard)
export class SupplierInvoicesController {
  constructor(
    @Inject(SupplierInvoicesService) private readonly invoices: SupplierInvoicesService,
  ) {}

  @Get()
  @RequirePermission('purchase.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<SupplierInvoicePage> {
    const parsed = ListSupplierInvoicesQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.invoices.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('purchase.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(CreateSupplierInvoiceBody, body);
    return this.invoices.create(orgId, input, actorOf(user, role));
  }

  // Déclarée AVANT `:invoiceId` : sinon « from-order » serait lu comme un identifiant.
  @Post('from-order')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async fromOrder(
    @CurrentOrgId() orgId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoicePrefill> {
    const input = parseBody(SupplierInvoiceFromOrderBody, body);
    return this.invoices.prefillFromOrder(orgId, input.orderId);
  }

  @Get(':invoiceId')
  @RequirePermission('purchase.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
  ): Promise<SupplierInvoiceView> {
    return this.invoices.get(orgId, invoiceId);
  }

  @Put(':invoiceId')
  @RequirePermission('purchase.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(UpdateSupplierInvoiceBody, body);
    return this.invoices.update(orgId, invoiceId, input, actorOf(user, role));
  }

  @Post(':invoiceId/validate')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(SupplierInvoiceRevisionBody, body);
    return this.invoices.validate(orgId, invoiceId, input.expectedRevision, actorOf(user, role));
  }

  @Post(':invoiceId/force-validate')
  @HttpCode(200)
  @RequirePermission('purchase.approve')
  async forceValidate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(SupplierInvoiceReasonBody, body);
    return this.invoices.forceValidate(
      orgId,
      invoiceId,
      input.reason,
      input.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':invoiceId/dispute')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async dispute(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(SupplierInvoiceReasonBody, body);
    return this.invoices.dispute(
      orgId,
      invoiceId,
      input.reason,
      input.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':invoiceId/resolve-dispute')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async resolveDispute(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(SupplierInvoiceRevisionBody, body);
    return this.invoices.resolveDispute(
      orgId,
      invoiceId,
      input.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':invoiceId/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Body() body: unknown,
  ): Promise<SupplierInvoiceView> {
    const input = parseBody(SupplierInvoiceReasonBody, body);
    return this.invoices.cancel(
      orgId,
      invoiceId,
      input.reason,
      input.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':invoiceId/attachment')
  @HttpCode(201)
  @RequirePermission('purchase.manage')
  @Throttle({
    default: { ttl: 3_600_000, limit: PURCHASE_ATTACHMENT_LIMITS.uploadsPerHourPerUser },
  })
  @UseGuards(UserThrottlerGuard)
  async uploadAttachment(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('invoiceId') invoiceId: string,
    @Req() req: Request,
  ): Promise<SupplierInvoiceView> {
    await this.invoices.assertAttachable(orgId, invoiceId);
    const file = await readAttachmentBody(req);
    try {
      return await this.invoices.uploadAttachment(
        orgId,
        invoiceId,
        file,
        req.headers['x-file-name'],
        actorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':invoiceId/attachment')
  @RequirePermission('purchase.read')
  async downloadAttachment(
    @CurrentOrgId() orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.invoices.readAttachment(orgId, invoiceId);
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendAttachment(res, found.meta, found.body);
  }
}
