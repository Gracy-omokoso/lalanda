// Rattrapages à la demande — ADR-0046 § 5.1. ADR-0046 — S4.
//
//   POST /stock/sync   stock.manage — rattrapages achats et ventes de l'organisation
//                      active ; 6 par heure ; la réponse ne porte que des nombres.

import { STOCK_LIMITS, type StockSyncResponse } from '@lalanda/shared/stock';
import { Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentOrgId } from '../../auth/current-user.decorator.js';
import { RequirePermission } from '../../authz/authz.decorators.js';
import { PermissionsGuard } from '../../authz/permissions.guard.js';
import { UserThrottlerGuard } from '../../security/user-throttler.guard.js';
import { StockSyncService } from './stock-sync.service.js';
import { RequireFeature } from '../../billing/feature.guard.js';

@Controller('stock')
@RequireFeature('stock') // ADR-0053 — P4
@UseGuards(AuthGuard, PermissionsGuard)
export class StockSyncController {
  constructor(@Inject(StockSyncService) private readonly sync: StockSyncService) {}

  @Post('sync')
  @HttpCode(200)
  @RequirePermission('stock.manage')
  @Throttle({ default: { ttl: 3_600_000, limit: STOCK_LIMITS.syncPerHour } })
  @UseGuards(UserThrottlerGuard)
  async run(@CurrentOrgId() orgId: string): Promise<StockSyncResponse> {
    return this.sync.syncOrganization(orgId);
  }
}
