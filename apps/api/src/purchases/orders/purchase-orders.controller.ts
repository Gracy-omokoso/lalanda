// Demandes d'achat et bons de commande — ADR-0044 § 3.2, § 3.3. ADR-0044 — P3.
//
//   GET    /purchases/orders?phase=&status=&supplierId=&requestedBy=me|<id>&workProjectId=   purchase.read
//   GET    /purchases/orders/:id                     purchase.read
//   POST   /purchases/orders                         purchase.request
//   PUT    /purchases/orders/:id                     purchase.request (sa demande draft) ou purchase.manage
//   DELETE /purchases/orders/:id                     idem, brouillon seulement
//   POST   /purchases/orders/:id/submit              purchase.request
//   POST   /purchases/orders/:id/approve             purchase.approve
//   POST   /purchases/orders/:id/reject              purchase.approve
//   POST   /purchases/orders/:id/duplicate           purchase.request
//   POST   /purchases/orders/:id/mark-sent           purchase.manage
//   POST   /purchases/orders/:id/cancel              purchase.manage
//   POST   /purchases/orders/:id/close               purchase.manage
//   GET    /purchases/orders/:id/pdf                 purchase.read
//   GET    /purchases/orders/:id/email               purchase.manage
//   POST   /purchases/orders/:id/email               purchase.manage (seau d'ADR-0042)
//   GET    /purchases/approvals/pending              purchase.approve
//
// « Sa demande » (`purchase.request`) ou toute demande (`purchase.manage`) : le guard
// exige `purchase.request`, le service exige `purchase.manage` au-delà (droits
// EFFECTIFS, `@CurrentOrgPermissions`). Une demande d'une autre organisation : 404.

import {
  ApprovePurchaseOrderBody,
  CancelPurchaseOrderBody,
  CreatePurchaseOrderBody,
  ListPurchaseOrdersQuery,
  PendingApprovalsQuery,
  PurchaseOrderRevisionBody,
  RejectPurchaseOrderBody,
  UpdatePurchaseOrderBody,
  type PurchaseOrderDetailView,
  type PurchaseOrderPage,
  type PurchaseOrderView,
} from '@lalanda/shared/purchases';
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
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import {
  CurrentOrgPermissions,
  type CurrentOrgPermissionsValue,
} from '../../authz/current-org-permissions.decorator.js';
import { CurrentOrgRole } from '../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import type { OrgRole } from '../../authz/permissions.js';
import type {
  DocumentEmailDraft,
  DocumentEmailResult,
} from '../../sales/documents/document-email.js';
import {
  documentEmailInputOf,
  senderOf,
} from '../../sales/documents/invoice-documents.controller.js';
import { invalidRequest } from '../../sales/sales.errors.js';
import {
  OrgDocumentEmailThrottlerGuard,
  UserDocumentEmailThrottlerGuard,
} from '../../security/document-email-throttler.guard.js';
import { PurchaseOrderDocumentsService } from '../documents/purchase-order-documents.service.js';
// ADR-0044 — P4 : la fiche porte ses réceptions et factures liées.
import { SupplierInvoicesService } from '../invoices/supplier-invoices.service.js';
import { PurchaseReceptionsService } from '../receptions/purchase-receptions.service.js';
import { PurchaseOrdersService, type PurchaseOrderActor } from './purchase-orders.service.js';

type User = { id: string; email: string; name?: string | null };

function actorOf(
  user: User,
  role: OrgRole | undefined,
  perms: CurrentOrgPermissionsValue | undefined,
): PurchaseOrderActor {
  return { userId: user.id, role: role ?? 'unknown', perms };
}

function revisionOf(body: unknown): number {
  const parsed = PurchaseOrderRevisionBody.safeParse(body);
  if (!parsed.success) invalidRequest(parsed.error);
  return parsed.data.expectedRevision;
}

@Controller('purchases')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(PurchaseOrderDocumentsService)
    private readonly documents: PurchaseOrderDocumentsService,
    // ADR-0044 — P4
    @Inject(PurchaseReceptionsService) private readonly receptions: PurchaseReceptionsService,
    @Inject(SupplierInvoicesService) private readonly invoices: SupplierInvoicesService,
  ) {}

  @Get('orders')
  @RequirePermission('purchase.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<PurchaseOrderPage> {
    const parsed = ListPurchaseOrdersQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.orders.list(orgId, parsed.data, actorOf(user, role, perms));
  }

  @Get('approvals/pending')
  @RequirePermission('purchase.approve')
  async pending(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Query() query: unknown,
  ): Promise<PurchaseOrderPage> {
    const parsed = PendingApprovalsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.orders.pendingApprovals(orgId, parsed.data, actorOf(user, role, perms));
  }

  @Get('orders/:orderId')
  @RequirePermission('purchase.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('orderId') orderId: string,
  ): Promise<PurchaseOrderDetailView> {
    const view = await this.orders.get(orgId, orderId);
    // ADR-0044 — P4 : réceptions et factures fournisseurs liées (§ 3.2).
    const facts = await this.receptions.orderFacts(orgId, view.id);
    return {
      ...view,
      receptions: facts ? await this.receptions.forOrder(orgId, facts) : [],
      invoices: await this.invoices.forOrder(orgId, view.id),
    };
  }

  @Post('orders')
  @RequirePermission('purchase.request')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    const parsed = CreatePurchaseOrderBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.orders.create(orgId, parsed.data, actorOf(user, role, perms));
  }

  @Put('orders/:orderId')
  @RequirePermission('purchase.request')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    const parsed = UpdatePurchaseOrderBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.orders.update(orgId, orderId, parsed.data, actorOf(user, role, perms));
  }

  @Delete('orders/:orderId')
  @HttpCode(204)
  @RequirePermission('purchase.request')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    await this.orders.remove(orgId, orderId, actorOf(user, role, perms));
  }

  @Post('orders/:orderId/submit')
  @HttpCode(200)
  @RequirePermission('purchase.request')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    return this.orders.submit(orgId, orderId, revisionOf(body), actorOf(user, role, perms));
  }

  @Post('orders/:orderId/approve')
  @HttpCode(200)
  @RequirePermission('purchase.approve')
  async approve(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    const parsed = ApprovePurchaseOrderBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.orders.approve(orgId, orderId, parsed.data, actorOf(user, role, perms));
  }

  @Post('orders/:orderId/reject')
  @HttpCode(200)
  @RequirePermission('purchase.approve')
  async reject(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    const parsed = RejectPurchaseOrderBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.orders.reject(
      orgId,
      orderId,
      parsed.data.comment,
      parsed.data.expectedRevision,
      actorOf(user, role, perms),
    );
  }

  @Post('orders/:orderId/duplicate')
  @RequirePermission('purchase.request')
  async duplicate(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
  ): Promise<PurchaseOrderView> {
    return this.orders.duplicate(orgId, orderId, actorOf(user, role, perms));
  }

  @Post('orders/:orderId/mark-sent')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async markSent(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    return this.orders.markSent(orgId, orderId, revisionOf(body), actorOf(user, role, perms));
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    const parsed = CancelPurchaseOrderBody.safeParse(body);
    if (!parsed.success) invalidRequest(parsed.error);
    return this.orders.cancel(
      orgId,
      orderId,
      parsed.data.reason,
      parsed.data.expectedRevision,
      actorOf(user, role, perms),
    );
  }

  @Post('orders/:orderId/close')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async close(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PurchaseOrderView> {
    return this.orders.close(orgId, orderId, revisionOf(body), actorOf(user, role, perms));
  }

  @Get('orders/:orderId/pdf')
  @RequirePermission('purchase.read')
  async pdf(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const doc = await this.documents.pdf(orgId, orderId, {
      userId: user.id,
      role: role ?? 'unknown',
    });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${doc.fileName}"`);
    res.setHeader('content-length', String(doc.pdf.byteLength));
    res.setHeader('cache-control', 'no-store');
    res.end(doc.pdf);
  }

  @Get('orders/:orderId/email')
  @RequirePermission('purchase.manage')
  async emailDraft(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
  ): Promise<DocumentEmailDraft> {
    return this.documents.emailDraft(orgId, orderId, senderOf(user, role).name);
  }

  @Post('orders/:orderId/email')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  @UseGuards(UserDocumentEmailThrottlerGuard, OrgDocumentEmailThrottlerGuard)
  async email(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @CurrentOrgPermissions() perms: CurrentOrgPermissionsValue | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<DocumentEmailResult> {
    const input = documentEmailInputOf(body);
    return this.documents.email(
      orgId,
      orderId,
      senderOf(user, role),
      actorOf(user, role, perms),
      input,
    );
  }
}
