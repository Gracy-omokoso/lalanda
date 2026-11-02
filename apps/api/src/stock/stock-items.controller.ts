// Articles stockés — ADR-0046 § 5.1. ADR-0046 — S3.
//
//   GET  /stock/items                     stock.read
//   GET  /stock/items/:id                 stock.read
//   GET  /stock/items/:id/movements       stock.read
//   POST /stock/items                     stock.manage
//   PUT  /stock/items/:id                 stock.manage
//   POST /stock/items/:id/archive         stock.manage
//   POST /stock/items/:id/restore         stock.manage
//
// Valeurs (coût moyen, valeur) seulement avec `purchase.read` ou `treasury.read`.

import {
  CreateStockItemBody,
  ListStockItemsQuery,
  ListStockMovementsQuery,
  StockRevisionBody,
  UpdateStockItemBody,
  type StockItemPage,
  type StockItemView,
  type StockMovementPage,
} from '@lalanda/shared/stock';
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

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentStockActor } from './stock-actor.decorator.js';
import { parseWith, type StockActor } from './stock.common.js';
import { StockItemsService } from './stock-items.service.js';
import { RequireFeature } from '../billing/feature.guard.js';

@Controller('stock/items')
@RequireFeature('stock') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class StockItemsController {
  constructor(@Inject(StockItemsService) private readonly items: StockItemsService) {}

  @Get()
  @RequirePermission('stock.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockItemPage> {
    return this.items.list(orgId, parseWith(ListStockItemsQuery, query), actor);
  }

  @Get(':itemId')
  @RequirePermission('stock.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('itemId') itemId: string,
  ): Promise<StockItemView> {
    return this.items.get(orgId, itemId, actor);
  }

  @Get(':itemId/movements')
  @RequirePermission('stock.read')
  async movements(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('itemId') itemId: string,
    @Query() query: unknown,
  ): Promise<StockMovementPage> {
    return this.items.movements(orgId, itemId, parseWith(ListStockMovementsQuery, query), actor);
  }

  @Post()
  @RequirePermission('stock.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Body() body: unknown,
  ): Promise<StockItemView> {
    return this.items.create(orgId, parseWith(CreateStockItemBody, body), actor);
  }

  @Put(':itemId')
  @RequirePermission('stock.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<StockItemView> {
    return this.items.update(orgId, itemId, parseWith(UpdateStockItemBody, body), actor);
  }

  @Post(':itemId/archive')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<StockItemView> {
    const { expectedRevision } = parseWith(StockRevisionBody, body);
    return this.items.setActive(orgId, itemId, false, expectedRevision, actor);
  }

  @Post(':itemId/restore')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async restore(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<StockItemView> {
    const { expectedRevision } = parseWith(StockRevisionBody, body);
    return this.items.setActive(orgId, itemId, true, expectedRevision, actor);
  }
}
