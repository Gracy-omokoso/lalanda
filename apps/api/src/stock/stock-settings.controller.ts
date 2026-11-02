// Réglages des stocks — ADR-0046 § 2.8, § 5.1. ADR-0046 — S3.
//
//   GET /stock/settings   stock.read
//   PUT /stock/settings   stock.manage

import { UpdateStockSettingsBody, type StockSettingsView } from '@lalanda/shared/stock';
import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentOrgId } from '../auth/current-user.decorator.js';
import { RequirePermission } from '../authz/authz.decorators.js';
import { PermissionsGuard } from '../authz/permissions.guard.js';
import { CurrentStockActor } from './stock-actor.decorator.js';
import { parseWith, type StockActor } from './stock.common.js';
import { StockSettingsService } from './stock-settings.service.js';
import { RequireFeature } from '../billing/feature.guard.js';

@Controller('stock/settings')
@RequireFeature('stock') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class StockSettingsController {
  constructor(@Inject(StockSettingsService) private readonly settings: StockSettingsService) {}

  @Get()
  @RequirePermission('stock.read')
  async get(@CurrentOrgId() orgId: string): Promise<StockSettingsView> {
    return this.settings.view(orgId);
  }

  @Put()
  @RequirePermission('stock.manage')
  async update(
    @CurrentOrgId() orgId: string,
    @CurrentStockActor() actor: StockActor,
    @Body() body: unknown,
  ): Promise<StockSettingsView> {
    return this.settings.update(orgId, parseWith(UpdateStockSettingsBody, body), actor);
  }
}
