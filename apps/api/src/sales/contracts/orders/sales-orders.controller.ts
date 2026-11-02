// Commandes clients — ADR-0050 § 3. ADR-0050 — V2.
//
//   GET    /sales/orders                         sales.read
//   GET    /sales/orders/:id                     sales.read
//   POST   /sales/orders                         sales.contract
//   PUT    /sales/orders/:id                     sales.contract (brouillon)
//   DELETE /sales/orders/:id                     sales.contract (brouillon)
//   POST   /sales/orders/:id/confirm             sales.contract
//   POST   /sales/orders/:id/close               sales.contract (motif)
//   POST   /sales/orders/:id/cancel              sales.contract (motif)
//   POST   /sales/orders/:id/prepare-invoice     sales.read + sales.manage — BROUILLON
//                                                seulement ; l'émission reste sous
//                                                `sales.invoice` (routes existantes)
//   POST   /sales/orders/:id/files               sales.contract — corps BINAIRE, PDF ≤ 10 Mio
//   GET    /sales/orders/:id/files/:fileId       sales.read — téléchargement inerte
//
// Une commande d'une autre organisation répond 404.

import {
  SalesContractReasonSchema,
  SalesContractRevisionSchema,
} from '@lalanda/shared/sales-contracts';
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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthGuard } from '../../../auth/auth.guard.js';
import { CurrentOrgId, CurrentUser } from '../../../auth/current-user.decorator.js';
import { RequirePermission } from '../../../authz/authz.decorators.js';
import { CurrentOrgRole } from '../../../authz/current-org-role.decorator.js';
import { PermissionsGuard } from '../../../authz/permissions.guard.js';
import type { OrgRole } from '../../../authz/permissions.js';
import { storageFailure } from '../../../purchases/attachments/purchase-attachments.js';
import { UserThrottlerGuard } from '../../../security/user-throttler.guard.js';
import { invalidRequest } from '../../sales.errors.js';
import {
  contractsActorOf,
  parseContractsBody,
  type ContractsUser,
} from '../common/contracts.common.js';
import {
  readSalesContractPdf,
  sendSalesContractFile,
  type SalesContractFileView,
} from '../files/sales-contract-files.service.js';
import {
  CreateSalesOrderSchema,
  ListSalesOrdersQuerySchema,
  PrepareOrderInvoiceSchema,
  PutSalesOrderSchema,
} from './sales-orders.dto.js';
import {
  SalesOrdersService,
  type PreparedOrderInvoice,
  type SalesOrderPage,
  type SalesOrderView,
} from './sales-orders.service.js';
import { RequireFeature } from '../../../billing/feature.guard.js';

/** Téléversements par utilisateur et par heure (motif des pièces des achats). */
const UPLOADS_PER_HOUR = 30;

@Controller('sales/orders')
@RequireFeature('sales_contracts') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesOrdersController {
  constructor(@Inject(SalesOrdersService) private readonly orders: SalesOrdersService) {}

  @Get()
  @RequirePermission('sales.read')
  async list(@CurrentOrgId() orgId: string, @Query() query: unknown): Promise<SalesOrderPage> {
    const parsed = ListSalesOrdersQuerySchema.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.orders.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('sales.contract')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<SalesOrderView> {
    const input = parseContractsBody(CreateSalesOrderSchema, body);
    return this.orders.create(orgId, input, contractsActorOf(user, role));
  }

  @Get(':orderId')
  @RequirePermission('sales.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('orderId') orderId: string,
  ): Promise<SalesOrderView> {
    return this.orders.view(orgId, orderId);
  }

  @Put(':orderId')
  @RequirePermission('sales.contract')
  async put(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<SalesOrderView> {
    const input = parseContractsBody(PutSalesOrderSchema, body);
    return this.orders.put(
      orgId,
      orderId,
      input.expectedRevision,
      input.order,
      contractsActorOf(user, role),
    );
  }

  @Delete(':orderId')
  @HttpCode(204)
  @RequirePermission('sales.contract')
  async remove(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    await this.orders.remove(orgId, orderId, contractsActorOf(user, role));
  }

  @Post(':orderId/confirm')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async confirm(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<SalesOrderView> {
    const input = parseContractsBody(SalesContractRevisionSchema, body);
    return this.orders.confirm(
      orgId,
      orderId,
      input.expectedRevision,
      contractsActorOf(user, role),
    );
  }

  @Post(':orderId/close')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async close(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<SalesOrderView> {
    const input = parseContractsBody(SalesContractReasonSchema, body);
    return this.orders.close(
      orgId,
      orderId,
      input.expectedRevision,
      input.reason,
      contractsActorOf(user, role),
    );
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  @RequirePermission('sales.contract')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<SalesOrderView> {
    const input = parseContractsBody(SalesContractReasonSchema, body);
    return this.orders.cancel(
      orgId,
      orderId,
      input.expectedRevision,
      input.reason,
      contractsActorOf(user, role),
    );
  }

  @Post(':orderId/prepare-invoice')
  @HttpCode(200)
  @RequirePermission('sales.read', 'sales.manage')
  async prepareInvoice(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ): Promise<PreparedOrderInvoice> {
    const input = parseContractsBody(PrepareOrderInvoiceSchema, body);
    return this.orders.prepareInvoice(orgId, orderId, input, contractsActorOf(user, role));
  }

  @Post(':orderId/files')
  @HttpCode(201)
  @RequirePermission('sales.contract')
  @Throttle({ default: { ttl: 3_600_000, limit: UPLOADS_PER_HOUR } })
  @UseGuards(UserThrottlerGuard)
  async addFile(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: ContractsUser,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('orderId') orderId: string,
    @Req() req: Request,
  ): Promise<SalesContractFileView> {
    await this.orders.assertFileAttachable(orgId, orderId);
    const bytes = await readSalesContractPdf(req);
    try {
      return await this.orders.addFile(
        orgId,
        orderId,
        bytes,
        req.headers['x-file-name'],
        contractsActorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':orderId/files/:fileId')
  @RequirePermission('sales.read')
  async file(
    @CurrentOrgId() orgId: string,
    @Param('orderId') orderId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.orders.readFile(orgId, orderId, fileId);
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendSalesContractFile(res, found.meta, found.body);
  }
}
