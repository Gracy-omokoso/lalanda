// Emplacements — ADR-0046 § 5.1. ADR-0046 — S3.
//
//   GET  /stock/locations                 stock.read
//   POST /stock/locations                 stock.manage
//   PUT  /stock/locations/:id             stock.manage
//   POST /stock/locations/:id/archive     stock.manage

import {
  CreateStockLocationBody,
  ListStockLocationsQuery,
  StockRevisionBody,
  UpdateStockLocationBody,
  type StockLocationList,
  type StockLocationView,
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
import { StockLocationsService } from './stock-locations.service.js';

@Controller('stock/locations')
@UseGuards(AuthGuard, PermissionsGuard)
export class StockLocationsController {
  constructor(@Inject(StockLocationsService) private readonly locations: StockLocationsService) {}

  @Get()
  @RequirePermission('stock.read')
  async list(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockLocationList> {
    const q = parseWith(ListStockLocationsQuery, query);
    return this.locations.list(orgId, q.active, actor);
  }

  @Post()
  @RequirePermission('stock.manage')
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Body() body: unknown,
  ): Promise<StockLocationView> {
    return this.locations.create(orgId, parseWith(CreateStockLocationBody, body), actor);
  }

  @Put(':locationId')
  @RequirePermission('stock.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ): Promise<StockLocationView> {
    return this.locations.update(
      orgId,
      locationId,
      parseWith(UpdateStockLocationBody, body),
      actor,
    );
  }

  @Post(':locationId/archive')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async archive(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ): Promise<StockLocationView> {
    const { expectedRevision } = parseWith(StockRevisionBody, body);
    return this.locations.archive(orgId, locationId, expectedRevision, actor);
  }
}
