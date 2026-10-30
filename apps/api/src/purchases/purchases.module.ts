// Achats et fournisseurs — ADR-0044 (application RUN `/achats`, module API
// `/purchases/…`). Créé par le lot P2 ; les lots P3 à P6 ajoutent chacun leurs
// lignes dans `controllers`, `providers` et `forFeature`, sous leur commentaire.
//
// Le trousseau `MASTER_KEYRING` (ADR-0013) est fourni ici par le même fournisseur
// que le module des intégrations : une fabrique sans état qui lit l'environnement,
// sans dépendre de ce module ni rien en exporter.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0044 — P2
import { SUPPLIER_PAYABLES_SOURCE } from './suppliers/supplier-payables.port.js';
import { Supplier, SupplierSchema } from './suppliers/supplier.schema.js';
import { PurchaseSuppliersController } from './suppliers/purchase-suppliers.controller.js';
import { SuppliersNotifier } from './suppliers/suppliers-notifier.js';
import { SuppliersService } from './suppliers/suppliers.service.js';
// ADR-0044 — P4
import { PurchaseAttachmentsService } from './attachments/purchase-attachments.js';
import { SupplierInvoice, SupplierInvoiceSchema } from './invoices/supplier-invoice.schema.js';
import { SupplierInvoicesController } from './invoices/supplier-invoices.controller.js';
import { SupplierInvoicesNotifier } from './invoices/supplier-invoices-notifier.js';
import { SupplierInvoicesPayablesSource } from './invoices/supplier-invoices-payables.source.js';
import { SupplierInvoicesService } from './invoices/supplier-invoices.service.js';
import {
  MongoPurchaseOrdersReader,
  PURCHASE_ORDERS_READER,
} from './receptions/purchase-orders.port.js';
import { PurchaseReceptionsController } from './receptions/purchase-receptions.controller.js';
import { PurchaseReceptionsService } from './receptions/purchase-receptions.service.js';
import { PurchaseReception, PurchaseReceptionSchema } from './receptions/reception.schema.js';
import { PURCHASE_RECEPTION_SINK, noPurchaseReceptionSink } from './stock-sink.port.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      // ADR-0044 — P2 : fiches fournisseurs ; adhésions (destinataires des alertes).
      { name: Supplier.name, schema: SupplierSchema },
      { name: Membership.name, schema: MembershipSchema },
      // ADR-0044 — P4 : réceptions et factures fournisseurs.
      { name: PurchaseReception.name, schema: PurchaseReceptionSchema },
      { name: SupplierInvoice.name, schema: SupplierInvoiceSchema },
    ]),
  ],
  controllers: [
    // ADR-0044 — P2
    PurchaseSuppliersController,
    // ADR-0044 — P4
    PurchaseReceptionsController,
    SupplierInvoicesController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0044 — P2 : fiches, coordonnées chiffrées, fusion. Reste dû : fournisseur
    // nul jusqu'aux factures et paiements (P4, P5), qui le remplaceront.
    SuppliersService,
    SuppliersNotifier,
    // ADR-0044 — P4 : le reste dû se lit désormais sur les factures validées (et les
    // paiements du lot P5, lus par la connexion) : le fournisseur nul de P2 est remplacé.
    { provide: SUPPLIER_PAYABLES_SOURCE, useExisting: SupplierInvoicesPayablesSource },
    // ADR-0044 — P4 : réceptions, factures, rapprochement, pièces jointes. Commandes lues
    // par un port (lot P3) ; port de stock nul en R3 (§ 6.6).
    PurchaseAttachmentsService,
    SupplierInvoicesService,
    SupplierInvoicesNotifier,
    SupplierInvoicesPayablesSource,
    PurchaseReceptionsService,
    { provide: PURCHASE_ORDERS_READER, useClass: MongoPurchaseOrdersReader },
    { provide: PURCHASE_RECEPTION_SINK, useValue: noPurchaseReceptionSink },
  ],
  exports: [SuppliersService, SupplierInvoicesService],
})
export class PurchasesModule {}
