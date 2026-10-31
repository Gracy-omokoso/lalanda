// Niveaux, contrôle du cache et correction de coût — ADR-0046 § 2.3.1, § 2.5, § 5.1.
// ADR-0046 — S3.
//
//   GET  /stock/levels?locationId=&itemId=&below=reorder   stock.read
//   POST /stock/levels/rebuild                             stock.manage
//   PUT  /stock/movements/:id/cost                         stock.manage — audit strict
//   GET  /stock/movements?itemId=&locationId=&kind=&…       stock.read — grand livre de
//        tous les articles (ADR-0046 — S4, complément des écrans S8)

import {
  ListStockLedgerQuery,
  ListStockLevelsQuery,
  UpdateStockMovementCostBody,
  type StockLedgerPage,
  type StockLevelsRebuildReport,
  type StockLevelsResponse,
  type StockMovementView,
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
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentStockActor } from './stock-actor.decorator.js';
import { inTransaction, parseWith, seesValues, type StockActor } from './stock.common.js';
import { movementView, StockItemsService } from './stock-items.service.js';
import { StockMovementsService } from './stock-movements.service.js';
import { StockReportsService } from './stock-reports.service.js';

@Controller('stock')
@UseGuards(AuthGuard, PermissionsGuard)
export class StockLevelsController {
  constructor(
    @Inject(StockReportsService) private readonly reports: StockReportsService,
    @Inject(StockMovementsService) private readonly movements: StockMovementsService,
    @InjectConnection() private readonly connection: Connection,
    // ADR-0046 — S4 : grand livre de tous les articles.
    @Inject(StockItemsService) private readonly items: StockItemsService,
  ) {}

  // ADR-0046 — S4 (complément des écrans S8).
  @Get('movements')
  @RequirePermission('stock.read')
  async ledger(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Query() query: unknown,
  ): Promise<StockLedgerPage> {
    return this.items.ledgerPage(orgId, parseWith(ListStockLedgerQuery, query), actor);
  }

  @Get('levels')
  @RequirePermission('stock.read')
  async levels(
    @CurrentOrgId() orgId: string,
    @Query() query: unknown,
  ): Promise<StockLevelsResponse> {
    return this.reports.levelsView(orgId, parseWith(ListStockLevelsQuery, query));
  }

  @Post('levels/rebuild')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  async rebuild(@CurrentOrgId() orgId: string): Promise<StockLevelsRebuildReport> {
    return this.reports.checkLevels(orgId, true);
  }

  @Put('movements/:movementId/cost')
  @RequirePermission('stock.manage')
  async cost(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Param('movementId') movementId: string,
    @Body() body: unknown,
  ): Promise<StockMovementView> {
    const input = parseWith(UpdateStockMovementCostBody, body);
    await this.movements.findOwn(orgId, movementId);
    const updated = await inTransaction(this.connection, (session) =>
      this.movements.correctCost(orgId, movementId, input, actor, session),
    );
    return movementView(updated, seesValues(actor), null);
  }
}
