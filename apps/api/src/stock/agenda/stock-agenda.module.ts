// « Mes tâches » et cloche des stocks — ADR-0046 § 6.7. ADR-0046 — S7.
//
// Module à part, SANS dépendance vers `StockModule` (motif de `PurchasesAgendaModule`) :
//   - `StockAgendaSource` : `WorkModule` l'importe pour le port `STOCK_AGENDA_SOURCE` ;
//   - `StockNotificationsJob` : la tâche des notifications des stocks ; `StockModule`
//     importe ce module (sa ligne du lot S7). Les modules Nest étant des singletons, la
//     tâche n'est enregistrée qu'une fois.
// `AuthzService`, l'ordonnanceur et le port des notifications sont globaux.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { StockAgendaSource } from './stock-agenda.source.js';
import {
  StockNotificationState,
  StockNotificationStateSchema,
  StockNotificationsJob,
} from './stock-notifications.job.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockNotificationState.name, schema: StockNotificationStateSchema },
    ]),
  ],
  providers: [StockAgendaSource, StockNotificationsJob],
  exports: [StockAgendaSource, StockNotificationsJob],
})
export class StockAgendaModule {}
