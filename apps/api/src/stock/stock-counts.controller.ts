// Inventaires — ADR-0046 § 2.7, § 5.1. ADR-0046 — S3.
//
//   GET  /stock/counts                    stock.read
//   GET  /stock/counts/:id                stock.read — théorique masqué (aveugle)
//   POST /stock/counts                    stock.manage
//   POST /stock/counts/:id/start          stock.manage
//   PUT  /stock/counts/:id/lines/:lineId  stock.count (coût saisi : stock.manage, service)
//   POST /stock/counts/:id/submit         stock.count
//   POST /stock/counts/:id/cancel         stock.count
//   POST /stock/counts/:id/validate       stock.manage — 409 COUNT_SELF_VALIDATION

import {
  CancelStockCountBody,
  CountStockLineBody,
  CreateStockCountBody,
  ListStockCountsQuery,
  StockCountRevisionBody,
  ValidateStockCountBody,
  type StockCountPage,
  type StockCountView,
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
import { StockCountsService } from './stock-counts.service.js';
import { RequireFeature } from '../billing/feature.guard.js';

@Controller('stock/counts')
@RequireFeature('stock') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class StockCountsController {
  constructor(@Inject(StockCountsService) private readonly counts: StockCountsService) {}

  @Get()
  @RequirePermission('stock.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockCountPage> {
    return this.counts.list(orgId, parseWith(ListStockCountsQuery, query), actor);
  }

  @Get(':countId')
  @RequirePermission('stock.read')
  async get(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
  ): Promise<StockCountView> {
    return this.counts.get(orgId, countId, actor);
  }

  @Post()
  @RequirePermission('stock.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    return this.counts.create(orgId, parseWith(CreateStockCountBody, body), actor);
  }

  @Post(':countId/start')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async start(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    const { expectedRevision } = parseWith(StockCountRevisionBody, body);
    return this.counts.start(orgId, countId, expectedRevision, actor);
  }

  @Put(':countId/lines/:lineId')
  @RequirePermission('stock.count')
  async countLine(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    return this.counts.countLine(
      orgId,
      countId,
      lineId,
      parseWith(CountStockLineBody, body),
      actor,
    );
  }

  @Post(':countId/submit')
  @HttpCode(200)
  @RequirePermission('stock.count')
  async submit(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    const { expectedRevision } = parseWith(StockCountRevisionBody, body);
    return this.counts.submit(orgId, countId, expectedRevision, actor);
  }

  @Post(':countId/cancel')
  @HttpCode(200)
  @RequirePermission('stock.count')
  async cancel(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    return this.counts.cancel(orgId, countId, parseWith(CancelStockCountBody, body), actor);
  }

  @Post(':countId/validate')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async validate(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('countId') countId: string,
    @Body() body: unknown,
  ): Promise<StockCountView> {
    return this.counts.validate(orgId, countId, parseWith(ValidateStockCountBody, body), actor);
  }
}
