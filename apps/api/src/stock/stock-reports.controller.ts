// Valorisation, réapprovisionnement, rapports — ADR-0046 § 5.1, § 7.1. ADR-0046 — S3.
//
//   GET /stock/valuation?on=&locationId=   stock.read + (purchase.read ou treasury.read,
//                                          décidé dans le service : 403 sinon)
//   GET /stock/replenishment               stock.read — aucune écriture
//   GET /stock/reports?from=&to=           stock.read — valeurs si visibles

import {
  StockReportsQuery,
  StockValuationQuery,
  type StockReplenishmentResponse,
  type StockReportResponse,
  type StockValuationResponse,
} from '@lalanda/shared/stock';
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentStockActor } from './stock-actor.decorator.js';
import { parseWith, type StockActor } from './stock.common.js';
import { StockReportsService } from './stock-reports.service.js';

@Controller('stock')
@UseGuards(AuthGuard, PermissionsGuard)
export class StockReportsController {
  constructor(@Inject(StockReportsService) private readonly reports: StockReportsService) {}

  @Get('valuation')
  @RequirePermission('stock.read')
  async valuation(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockValuationResponse> {
    return this.reports.valuation(orgId, parseWith(StockValuationQuery, query), actor);
  }

  @Get('replenishment')
  @RequirePermission('stock.read')
  async replenishment(@CurrentOrgId() orgId: string): Promise<StockReplenishmentResponse> {
    return this.reports.replenishment(orgId);
  }

  @Get('reports')
  @RequirePermission('stock.read')
  async report(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockReportResponse> {
    return this.reports.report(orgId, parseWith(StockReportsQuery, query), actor);
  }
}
