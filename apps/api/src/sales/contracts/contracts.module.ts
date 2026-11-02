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

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    forwardRef(() => SalesModule),
    MongooseModule.forFeature([
      // ADR-0050 — V2
      { name: SalesOrder.name, schema: SalesOrderSchema },
      { name: SalesOrderCounter.name, schema: SalesOrderCounterSchema },
      { name: SalesDocumentLink.name, schema: SalesDocumentLinkSchema },
      { name: SalesContractFile.name, schema: SalesContractFileSchema },
    ]),
  ],
  controllers: [
    // ADR-0050 — V2
    SalesOrdersController,
    QuoteToOrderController,
  ],
  providers: [
    // ADR-0050 — V2
    SalesDocumentLinksService,
    SalesContractFilesService,
    SalesOrdersService,
  ],
  exports: [
    // ADR-0050 — V2 : liens et pièces partagés par V3 à V6.
    SalesDocumentLinksService,
    SalesContractFilesService,
    SalesOrdersService,
  ],
})
export class ContractsModule {}
