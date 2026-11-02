// Module des engagements clients — ADR-0050 (contrats, commandes clients, acomptes,
// abonnements).
//
// Créé par le lot V2 ; les lots V3 à V6 AJOUTENT une ligne chacun (modèles,
// contrôleurs, fournisseurs), sous leur commentaire `// ADR-0050 — <lot>`, sans
// toucher aux lignes des autres lots.
//
// Consomme, sans les modifier : la composition et la création des brouillons de
// facture (`InvoiceDraftsService`, exporté par `SalesModule`) — SEUL chemin d'écriture
// vers `sales_invoices` ; les devis, factures, clients et opportunités sont LUS en
// lecture seule par la connexion. Aucun appel e-MCF/DGI, aucune émission.
//
// `SalesModule` importe ce module (une ligne) ; l'import en retour passe par
// `forwardRef` (cycle de modules).

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { SalesModule } from '../sales.module.js';
import { SalesContractFile, SalesContractFileSchema } from './files/sales-contract-file.schema.js';
import { SalesContractFilesService } from './files/sales-contract-files.service.js';
import { SalesDocumentLink, SalesDocumentLinkSchema } from './links/sales-document-link.schema.js';
import { SalesDocumentLinksService } from './links/sales-document-links.service.js';
import { QuoteToOrderController } from './orders/quote-to-order.controller.js';
import {
  SalesOrder,
  SalesOrderCounter,
  SalesOrderCounterSchema,
  SalesOrderSchema,
} from './orders/sales-order.schema.js';
import { SalesOrdersController } from './orders/sales-orders.controller.js';
import { SalesOrdersService } from './orders/sales-orders.service.js';
// ADR-0050 — V3
import { SalesContractAmendmentsController } from './amendments/sales-contract-amendments.controller.js';
import {
  SalesContractAmendment,
  SalesContractAmendmentSchema,
} from './amendments/sales-contract-amendment.schema.js';
import { SalesContractAmendmentsService } from './amendments/sales-contract-amendments.service.js';
import { QuoteToContractController } from './contracts/quote-to-contract.controller.js';
import {
  SalesContract,
  SalesContractCounter,
  SalesContractCounterSchema,
  SalesContractSchema,
} from './contracts/sales-contract.schema.js';
import { SalesContractsController } from './contracts/sales-contracts.controller.js';
import { SalesContractsService } from './contracts/sales-contracts.service.js';
import { SalesContractSettingsController } from './settings/sales-contract-settings.controller.js';
import {
  SalesContractSettings,
  SalesContractSettingsSchema,
} from './settings/sales-contract-settings.schema.js';
import { SalesContractSettingsService } from './settings/sales-contract-settings.service.js';
// ADR-0050 — V4
import { SalesContractDepositsController } from './deposits/sales-contract-deposits.controller.js';
import { SalesOrderDepositsController } from './deposits/sales-order-deposits.controller.js';
import {
  SalesDepositResolution,
  SalesDepositResolutionSchema,
} from './deposits/sales-deposit-resolution.schema.js';
import { SalesDepositsService } from './deposits/sales-deposits.service.js';
// ADR-0050 — V5
import { SalesSubscriptionsController } from './subscriptions/sales-subscriptions.controller.js';
import { SalesSubscriptionsJob } from './subscriptions/sales-subscriptions.job.js';
import { SalesSubscriptionsService } from './subscriptions/sales-subscriptions.service.js';
// ADR-0050 — V6
import { SalesContractsAgendaModule } from './agenda/contracts-agenda.module.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    forwardRef(() => SalesModule),
    // ADR-0050 — V6 : « Mes tâches » (port global), cloche, tâche des alertes.
    forwardRef(() => SalesContractsAgendaModule),
    MongooseModule.forFeature([
      // ADR-0050 — V2
      { name: SalesOrder.name, schema: SalesOrderSchema },
      { name: SalesOrderCounter.name, schema: SalesOrderCounterSchema },
      { name: SalesDocumentLink.name, schema: SalesDocumentLinkSchema },
      { name: SalesContractFile.name, schema: SalesContractFileSchema },
      // ADR-0050 — V3
      { name: SalesContract.name, schema: SalesContractSchema },
      { name: SalesContractCounter.name, schema: SalesContractCounterSchema },
      { name: SalesContractAmendment.name, schema: SalesContractAmendmentSchema },
      { name: SalesContractSettings.name, schema: SalesContractSettingsSchema },
      // ADR-0050 — V4
      { name: SalesDepositResolution.name, schema: SalesDepositResolutionSchema },
    ]),
  ],
  controllers: [
    // ADR-0050 — V2
    SalesOrdersController,
    QuoteToOrderController,
    // ADR-0050 — V3
    SalesContractsController,
    SalesContractAmendmentsController,
    QuoteToContractController,
    SalesContractSettingsController,
    // ADR-0050 — V4
    SalesOrderDepositsController,
    SalesContractDepositsController,
    // ADR-0050 — V5
    SalesSubscriptionsController,
  ],
  providers: [
    // ADR-0050 — V2
    SalesDocumentLinksService,
    SalesContractFilesService,
    SalesOrdersService,
    // ADR-0050 — V3
    SalesContractSettingsService,
    SalesContractsService,
    SalesContractAmendmentsService,
    // ADR-0050 — V4
    SalesDepositsService,
    // ADR-0050 — V5 : échéancier, préparation manuelle et tâche `sales.subscriptions.prepare`.
    SalesSubscriptionsService,
    SalesSubscriptionsJob,
  ],
  exports: [
    // ADR-0050 — V2 : liens et pièces partagés par V3 à V6.
    SalesDocumentLinksService,
    SalesContractFilesService,
    SalesOrdersService,
    // ADR-0050 — V3 : contrats, avenants et réglages, lus par V4 à V6.
    SalesContractSettingsService,
    SalesContractsService,
    SalesContractAmendmentsService,
    // ADR-0050 — V5 : échéancier, lu par V6 (alertes).
    SalesSubscriptionsService,
  ],
})
export class ContractsModule {}
