// Lecture des approbations d'achat pour « Mes tâches » — ADR-0044 § 6.5.
// ADR-0044 — P3.
//
// Module à part, SANS dépendance (motif de `CrmAgendaModule`) : `WorkModule`
// l'importe pour fournir le port `PURCHASES_AGENDA_SOURCE` sans dépendre du module
// des achats (qui importe les ventes, les documents et les fournisseurs).
// `AuthzService` vient du module global d'autorisation.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PurchaseOrder, PurchaseOrderSchema } from '../orders/purchase-order.schema.js';
import { PurchasesAgendaSource } from './purchases-agenda.source.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: PurchaseOrder.name, schema: PurchaseOrderSchema }])],
  providers: [PurchasesAgendaSource],
  exports: [PurchasesAgendaSource],
})
export class PurchasesAgendaModule {}
