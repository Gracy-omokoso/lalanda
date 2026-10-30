// Achats et fournisseurs — ADR-0044 (application RUN `/achats`, module API
// `/purchases/…`). Créé par le lot P2 ; les lots P3 à P6 ajoutent chacun leurs
// lignes dans `controllers`, `providers` et `forFeature`, sous leur commentaire.
//
// Le trousseau `MASTER_KEYRING` (ADR-0013) est fourni ici par le même fournisseur
// que le module des intégrations : une fabrique sans état qui lit l'environnement,
// sans dépendre de ce module ni rien en exporter.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BrandingModule } from '../branding/branding.module.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { MasterKeyringProvider } from '../integrations/keyring.provider.js';
import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PdfModule } from '../reports/pdf.module.js';
import { SalesModule } from '../sales/sales.module.js';
// ADR-0044 — P3
import { PurchaseCounter, PurchaseCounterSchema } from './counters/purchase-counter.schema.js';
import { PurchaseCountersService } from './counters/purchase-counters.service.js';
import { PurchaseOrderDocumentsService } from './documents/purchase-order-documents.service.js';
import { PurchaseOrder, PurchaseOrderSchema } from './orders/purchase-order.schema.js';
import { PurchaseOrdersController } from './orders/purchase-orders.controller.js';
import { PurchaseOrdersService } from './orders/purchase-orders.service.js';
import { PurchasesNotifier } from './purchases-notifier.js';
import { PurchaseSettings, PurchaseSettingsSchema } from './settings/purchase-settings.schema.js';
import { PurchaseSettingsController } from './settings/purchase-settings.controller.js';
import { PurchaseSettingsService } from './settings/purchase-settings.service.js';
// ADR-0044 — P2
import {
  SUPPLIER_PAYABLES_SOURCE,
  noSupplierPayables,
} from './suppliers/supplier-payables.port.js';
import { Supplier, SupplierSchema } from './suppliers/supplier.schema.js';
import { PurchaseSuppliersController } from './suppliers/purchase-suppliers.controller.js';
import { SuppliersNotifier } from './suppliers/suppliers-notifier.js';
import { SuppliersService } from './suppliers/suppliers.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    // ADR-0044 — P3 : bon de commande PDF et envoi (ADR-0025, ADR-0028, ADR-0042).
    SalesModule,
    FiscalModule,
    BrandingModule,
    PdfModule,
    MongooseModule.forFeature([
      // ADR-0044 — P2 : fiches fournisseurs ; adhésions (destinataires des alertes).
      { name: Supplier.name, schema: SupplierSchema },
      { name: Membership.name, schema: MembershipSchema },
      // ADR-0044 — P3 : demandes et commandes, réglages, compteurs.
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: PurchaseSettings.name, schema: PurchaseSettingsSchema },
      { name: PurchaseCounter.name, schema: PurchaseCounterSchema },
    ]),
  ],
  controllers: [
    // ADR-0044 — P2
    PurchaseSuppliersController,
    // ADR-0044 — P3
    PurchaseOrdersController,
    PurchaseSettingsController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0044 — P2 : fiches, coordonnées chiffrées, fusion. Reste dû : fournisseur
    // nul jusqu'aux factures et paiements (P4, P5), qui le remplaceront.
    SuppliersService,
    SuppliersNotifier,
    { provide: SUPPLIER_PAYABLES_SOURCE, useValue: noSupplierPayables },
    // ADR-0044 — P3 : cycle demande → bon de commande, réglages, numérotation (DA, BC,
    // et FF/PF pour P4 et P5), PDF et envoi, notifications d'approbation.
    PurchaseSettingsService,
    PurchaseCountersService,
    PurchasesNotifier,
    PurchaseOrdersService,
    PurchaseOrderDocumentsService,
  ],
  exports: [
    SuppliersService,
    // ADR-0044 — P3
    PurchaseOrdersService,
    PurchaseSettingsService,
    PurchaseCountersService,
  ],
})
export class PurchasesModule {}
