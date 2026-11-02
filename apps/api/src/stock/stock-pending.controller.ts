// « À traiter » — ADR-0046 § 2.6, § 5.1. ADR-0046 — S3.
//
//   GET  /stock/pending                   stock.read
//   POST /stock/pending/:id/resolve       stock.read au guard ; stock.move (coût : stock.manage)
//   POST /stock/pending/:id/dismiss       décidé dans le service selon le motif (droits effectifs)
//
// Le guard ne demande que `stock.read` : un Comptable (`stock.manage` sans `stock.move`)
// doit pouvoir saisir un coût en attente.

import {
  DismissStockPendingBody,
  ListStockPendingQuery,
  ResolveStockPendingBody,
  type StockPendingLineView,
  type StockPendingPage,
} from '@lalanda/shared/stock';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentStockActor } from './stock-actor.decorator.js';
import { parseWith, type StockActor } from './stock.common.js';
import { StockPendingService } from './stock-pending.service.js';
import { RequireFeature } from '../billing/feature.guard.js';

@Controller('stock/pending')
@RequireFeature('stock') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class StockPendingController {
  constructor(@Inject(StockPendingService) private readonly pending: StockPendingService) {}

  @Get()
  @RequirePermission('stock.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockPendingPage> {
    return this.pending.list(orgId, parseWith(ListStockPendingQuery, query), actor);
  }

  @Post(':pendingId/resolve')
  @HttpCode(200)
  @RequirePermission('stock.read')
  async resolve(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('pendingId') pendingId: string,
    @Body() body: unknown,
  ): Promise<StockPendingLineView> {
    return this.pending.resolve(orgId, pendingId, parseWith(ResolveStockPendingBody, body), actor);
  }

  @Post(':pendingId/dismiss')
  @HttpCode(200)
  @RequirePermission('stock.read')
  async dismiss(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('pendingId') pendingId: string,
    @Body() body: unknown,
  ): Promise<StockPendingLineView> {
    return this.pending.dismiss(orgId, pendingId, parseWith(DismissStockPendingBody, body), actor);
  }
}
