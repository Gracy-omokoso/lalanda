// Branchements des stocks sur les achats et les ventes — ADR-0046 § 6.1, § 6.2.
// ADR-0046 — S4.
//
// - `StockReceptionSink` : fournisseur du port `PURCHASE_RECEPTION_SINK` (R3), exporté ;
//   `PurchasesModule` importe ce module et y pointe son port (`useExisting`).
// - `StockSyncService` : tâches `stock.purchase-sync`, `stock.sales-sync` et
//   `POST /stock/sync`.
// Les achats et les ventes sont lus en LECTURE SEULE par la connexion (aucun modèle,
// aucun service de ces modules n'est importé) ; les écritures passent par les points
// d'extension de `StockModule` (`StockMovementsService.record()`,
// `StockPendingService.open()`).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { StockModule } from '../stock.module.js';
import {
  StockItem,
  StockItemSchema,
  StockLocation,
  StockLocationSchema,
  StockMovement,
  StockMovementSchema,
  StockPendingLine,
  StockPendingLineSchema,
  StockSettings,
  StockSettingsSchema,
} from '../stock.schemas.js';
import { StockReceptionApplier } from '../purchases/stock-reception-applier.js';
import { StockReceptionSink } from '../purchases/stock-reception.sink.js';
import { StockSalesSyncService } from '../sales/stock-sales-sync.service.js';
import { StockSyncCheckpoint, StockSyncCheckpointSchema } from './stock-sync-checkpoint.schema.js';
import { StockSyncController } from './stock-sync.controller.js';
import { StockSyncService } from './stock-sync.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    StockModule,
    MongooseModule.forFeature([
      { name: StockItem.name, schema: StockItemSchema },
      { name: StockLocation.name, schema: StockLocationSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: StockPendingLine.name, schema: StockPendingLineSchema },
      { name: StockSettings.name, schema: StockSettingsSchema },
      { name: StockSyncCheckpoint.name, schema: StockSyncCheckpointSchema },
    ]),
  ],
  controllers: [StockSyncController],
  providers: [StockReceptionApplier, StockReceptionSink, StockSalesSyncService, StockSyncService],
  exports: [StockReceptionSink, StockSyncService],
})
export class StockLinksModule {}
