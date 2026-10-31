// Bons — ADR-0046 § 2.4, § 5.1. ADR-0046 — S3.
//
//   GET  /stock/vouchers                  stock.read
//   GET  /stock/vouchers/:id              stock.read
//   POST /stock/vouchers                  stock.move (ajustement : stock.manage, service)
//   PUT  /stock/vouchers/:id              stock.move (idem)
//   POST /stock/vouchers/:id/post         stock.move (idem) — 409 STOCK_INSUFFICIENT
//   POST /stock/vouchers/:id/cancel       stock.move (idem) — contre-mouvements

import {
  CancelStockVoucherBody,
  CreateStockVoucherBody,
  ListStockVouchersQuery,
  StockRevisionBody,
  UpdateStockVoucherBody,
  type StockVoucherPage,
  type StockVoucherView,
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
import { StockVouchersService } from './stock-vouchers.service.js';

@Controller('stock/vouchers')
@UseGuards(AuthGuard, PermissionsGuard)
export class StockVouchersController {
  constructor(@Inject(StockVouchersService) private readonly vouchers: StockVouchersService) {}

  @Get()
  @RequirePermission('stock.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockVoucherPage> {
    return this.vouchers.list(orgId, parseWith(ListStockVouchersQuery, query), actor);
  }

  @Get(':voucherId')
  @RequirePermission('stock.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('voucherId') voucherId: string,
  ): Promise<StockVoucherView> {
    return this.vouchers.get(orgId, voucherId, actor);
  }

  @Post()
  @RequirePermission('stock.move')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Body() body: unknown,
  ): Promise<StockVoucherView> {
    return this.vouchers.create(orgId, parseWith(CreateStockVoucherBody, body), actor);
  }

  @Put(':voucherId')
  @RequirePermission('stock.move')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('voucherId') voucherId: string,
    @Body() body: unknown,
  ): Promise<StockVoucherView> {
    return this.vouchers.update(orgId, voucherId, parseWith(UpdateStockVoucherBody, body), actor);
  }

  @Post(':voucherId/post')
  @HttpCode(200)
  @RequirePermission('stock.move')
  async post(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('voucherId') voucherId: string,
    @Body() body: unknown,
  ): Promise<StockVoucherView> {
    const { expectedRevision } = parseWith(StockRevisionBody, body);
    return this.vouchers.post(orgId, voucherId, expectedRevision, actor);
  }

  @Post(':voucherId/cancel')
  @HttpCode(200)
  @RequirePermission('stock.move')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('voucherId') voucherId: string,
    @Body() body: unknown,
  ): Promise<StockVoucherView> {
    return this.vouchers.cancel(orgId, voucherId, parseWith(CancelStockVoucherBody, body), actor);
  }
}
