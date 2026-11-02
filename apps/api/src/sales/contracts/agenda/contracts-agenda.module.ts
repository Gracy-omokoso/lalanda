// Alertes des engagements clients : « Mes tâches », cloche — ADR-0050 § 6. ADR-0050 — V6.
//
// `@Global` (motif de `NotificationsModule`) : `WorkModule` injecte le port
// `SALES_CONTRACTS_AGENDA_SOURCE` SANS importer ce module — le module des ventes importe
// déjà, par le CRM, `WorkModule` ; un import en retour fermerait un cycle. Le port reste
// FACULTATIF dans `WorkTasksService` (tests sans ce module : aucun élément).
//
// `ContractsModule` importe ce module (une ligne) ; l'import en retour passe par
// `forwardRef` (services des lots V3 et V5, exportés par `ContractsModule`). Les modèles
// lus ici le sont en LECTURE SEULE.

import { Global, Module, forwardRef } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';

import { SALES_CONTRACTS_AGENDA_SOURCE } from '../../../work/my-tasks.ports.js';
import {
  SalesContractAmendment,
  SalesContractAmendmentSchema,
} from '../amendments/sales-contract-amendment.schema.js';
import { ContractsModule } from '../contracts.module.js';
import { SalesContract, SalesContractSchema } from '../contracts/sales-contract.schema.js';
import {
  SalesDepositResolution,
  SalesDepositResolutionSchema,
} from '../deposits/sales-deposit-resolution.schema.js';
import { SalesContractFile, SalesContractFileSchema } from '../files/sales-contract-file.schema.js';
import { SalesDocumentLink, SalesDocumentLinkSchema } from '../links/sales-document-link.schema.js';
import { SalesOrder, SalesOrderSchema } from '../orders/sales-order.schema.js';
import { SalesContractsAlertsJob } from './contracts-alerts.job.js';
import { SalesContractsAgendaSource } from './contracts-agenda.source.js';
import { SalesContractsNotificationsInterceptor } from './contracts-notifications.interceptor.js';
import { SalesContractsNotifier } from './contracts-notifier.js';

@Global()
@Module({
  imports: [
    forwardRef(() => ContractsModule),
    MongooseModule.forFeature([
      { name: SalesContract.name, schema: SalesContractSchema },
      { name: SalesContractAmendment.name, schema: SalesContractAmendmentSchema },
      { name: SalesContractFile.name, schema: SalesContractFileSchema },
      { name: SalesDocumentLink.name, schema: SalesDocumentLinkSchema },
      { name: SalesDepositResolution.name, schema: SalesDepositResolutionSchema },
      { name: SalesOrder.name, schema: SalesOrderSchema },
    ]),
  ],
  providers: [
    SalesContractsAgendaSource,
    { provide: SALES_CONTRACTS_AGENDA_SOURCE, useExisting: SalesContractsAgendaSource },
    SalesContractsNotifier,
    SalesContractsAlertsJob,
    { provide: APP_INTERCEPTOR, useClass: SalesContractsNotificationsInterceptor },
  ],
  exports: [SALES_CONTRACTS_AGENDA_SOURCE, SalesContractsNotifier],
})
export class SalesContractsAgendaModule {}
