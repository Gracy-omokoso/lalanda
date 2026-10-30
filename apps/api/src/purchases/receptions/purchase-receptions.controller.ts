// Réceptions — ADR-0044 § 3.4. ADR-0044 — P4.
//
//   GET  /purchases/receptions?orderId=&from=&to=&cursor=   purchase.read
//   POST /purchases/receptions                              purchase.manage
//   GET  /purchases/receptions/:id                          purchase.read
//   POST /purchases/receptions/:id/cancel { reason }        purchase.manage
//   POST /purchases/receptions/:id/attachment               purchase.manage — corps BINAIRE,
//                                                           nom en `X-File-Name`, 30/h
//   GET  /purchases/receptions/:id/attachment               purchase.read — en-têtes inertes
//
// Une réception, une commande ou une ligne d'une autre organisation répond 404.

import {
  CancelPurchaseReceptionBody,
  CreatePurchaseReceptionBody,
  ListPurchaseReceptionsQuery,
  PURCHASE_ATTACHMENT_LIMITS,
  type PurchaseReceptionPage,
  type PurchaseReceptionView,
  type PurchaseReceptionWriteResult,
} from '@lalanda/shared/purchases';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
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
import { parseBody, type PurchaseActor } from '../invoices/purchase-p4.common.js';
import { PurchaseReceptionsService } from './purchase-receptions.service.js';

type User = { id: string };

function actorOf(user: User, role: OrgRole | undefined): PurchaseActor {
  return { userId: user.id, role: role ?? 'unknown' };
}

@Controller('purchases/receptions')
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchaseReceptionsController {
  constructor(
    @Inject(PurchaseReceptionsService) private readonly receptions: PurchaseReceptionsService,
  ) {}

  @Get()
  @RequirePermission('purchase.read')
  async list(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<PurchaseReceptionPage> {
    const parsed = ListPurchaseReceptionsQuery.safeParse(query);
    if (!parsed.success) invalidRequest(parsed.error, 'Paramètres de liste invalides.');
    return this.receptions.list(orgId, parsed.data);
  }

  @Post()
  @RequirePermission('purchase.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Body() body: unknown,
  ): Promise<PurchaseReceptionWriteResult> {
    const input = parseBody(CreatePurchaseReceptionBody, body);
    return this.receptions.create(orgId, input, actorOf(user, role));
  }

  @Get(':receptionId')
  @RequirePermission('purchase.read')
  async get(
    @CurrentOrgId() orgId: string,
    @Param('receptionId') receptionId: string,
  ): Promise<PurchaseReceptionView> {
    return this.receptions.get(orgId, receptionId);
  }

  @Post(':receptionId/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.manage')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentUser() user: User,
    @CurrentOrgRole() role: OrgRole | undefined,
    @Param('receptionId') receptionId: string,
    @Body() body: unknown,
  ): Promise<PurchaseReceptionWriteResult> {
    const input = parseBody(CancelPurchaseReceptionBody, body);
    return this.receptions.cancel(
      orgId,
      receptionId,
      input.reason,
      input.expectedRevision,
      actorOf(user, role),
    );
  }

  @Post(':receptionId/attachment')
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
    @Param('receptionId') receptionId: string,
    @Req() req: Request,
  ): Promise<PurchaseReceptionView> {
    await this.receptions.assertAttachable(orgId, receptionId);
    const file = await readAttachmentBody(req);
    try {
      return await this.receptions.uploadAttachment(
        orgId,
        receptionId,
        file,
        req.headers['x-file-name'],
        actorOf(user, role),
      );
    } catch (cause) {
      throw storageFailure(cause);
    }
  }

  @Get(':receptionId/attachment')
  @RequirePermission('purchase.read')
  async downloadAttachment(
    @CurrentOrgId() orgId: string,
    @Param('receptionId') receptionId: string,
    @Res() res: Response,
  ): Promise<void> {
    let found;
    try {
      found = await this.receptions.readAttachment(orgId, receptionId);
    } catch (cause) {
      throw storageFailure(cause);
    }
    sendAttachment(res, found.meta, found.body);
  }
}
