// Stocks — ADR-0046 (application RUN `/stocks`, module API `/stock/…`). Créé par le lot
// S3 (référentiel, grand livre, cache, bons, « À traiter », inventaires, valorisation,
// rapports, réglages, `stock.levels-check`). Les lots S4 (branchements achats et
// ventes) et S7 (brief, « Mes tâches », marge) ajoutent chacun UNE ligne dans
// `imports` ou `providers`, sous leur commentaire.
//
// Points d'extension exportés pour S4 : `StockMovementsService.record()` (écriture
// idempotente par `sourceKey`, mode `observed`), `StockPendingService.open()` et
// `resolvedItemFor()`, port `STOCK_OPEN_ORDERS_SOURCE` (quantités commandées).
// L'ordonnanceur, l'audit et `AuthzService` sont globaux.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0046 — S3
import { StockCountsController } from './stock-counts.controller.js';
import { StockCountsService } from './stock-counts.service.js';
import { StockItemsController } from './stock-items.controller.js';
import { StockItemsService } from './stock-items.service.js';
import { StockLevelsCheckJob } from './stock-levels-check.job.js';
import { StockLevelsController } from './stock-levels.controller.js';
import { StockLocationsController } from './stock-locations.controller.js';
import { StockLocationsService } from './stock-locations.service.js';
import { StockMovementsService } from './stock-movements.service.js';
import { StockPendingController } from './stock-pending.controller.js';
import { StockPendingService } from './stock-pending.service.js';
import { StockRefsService } from './stock-refs.service.js';
import { StockReportsController } from './stock-reports.controller.js';
import { StockReportsService } from './stock-reports.service.js';
import { StockSettingsController } from './stock-settings.controller.js';
import { StockSettingsService } from './stock-settings.service.js';
import { StockVouchersController } from './stock-vouchers.controller.js';
import { StockVouchersService } from './stock-vouchers.service.js';
import {
  StockCount,
  StockCountSchema,
  StockCounter,
  StockCounterSchema,
  StockItem,
  StockItemSchema,
  StockLevel,
  StockLevelSchema,
  StockLocation,
  StockLocationSchema,
  StockMovement,
  StockMovementSchema,
  StockPendingLine,
  StockPendingLineSchema,
  StockSettings,
  StockSettingsSchema,
  StockVoucher,
  StockVoucherSchema,
} from './stock.schemas.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0046 — S3
      { name: StockItem.name, schema: StockItemSchema },
      { name: StockLocation.name, schema: StockLocationSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: StockLevel.name, schema: StockLevelSchema },
      { name: StockVoucher.name, schema: StockVoucherSchema },
      { name: StockPendingLine.name, schema: StockPendingLineSchema },
      { name: StockCount.name, schema: StockCountSchema },
      { name: StockSettings.name, schema: StockSettingsSchema },
      { name: StockCounter.name, schema: StockCounterSchema },
    ]),
  ],
  controllers: [
    // ADR-0046 — S3
    StockItemsController,
    StockLocationsController,
    StockLevelsController,
    StockVouchersController,
    StockPendingController,
    StockCountsController,
    StockReportsController,
    StockSettingsController,
  ],
  providers: [
    // ADR-0046 — S3
    StockSettingsService,
    StockRefsService,
    StockMovementsService,
    StockItemsService,
    StockLocationsService,
    StockVouchersService,
    StockPendingService,
    StockCountsService,
    StockReportsService,
    StockLevelsCheckJob,
  ],
  exports: [
    // ADR-0046 — S3 : points d'extension des lots S4 et S7.
    StockSettingsService,
    StockMovementsService,
    StockPendingService,
    StockItemsService,
    StockLocationsService,
    StockReportsService,
  ],
})
export class StockModule {}
