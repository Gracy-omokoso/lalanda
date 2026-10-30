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
import { SUPPLIER_PAYABLES_SOURCE } from './suppliers/supplier-payables.port.js';
import { Supplier, SupplierSchema } from './suppliers/supplier.schema.js';
import { PurchaseSuppliersController } from './suppliers/purchase-suppliers.controller.js';
import { SuppliersNotifier } from './suppliers/suppliers-notifier.js';
import { SuppliersService } from './suppliers/suppliers.service.js';
// ADR-0044 — P4
import { PurchaseAttachmentsService } from './attachments/purchase-attachments.js';
import { SupplierInvoice, SupplierInvoiceSchema } from './invoices/supplier-invoice.schema.js';
import { SupplierInvoicesController } from './invoices/supplier-invoices.controller.js';
import { SupplierInvoiceSettlements } from './invoices/supplier-invoice-settlements.js';
import { SupplierInvoicesNotifier } from './invoices/supplier-invoices-notifier.js';
import { SupplierInvoicesPayablesSource } from './invoices/supplier-invoices-payables.source.js';
import { SupplierInvoicesService } from './invoices/supplier-invoices.service.js';
import { PurchaseOrderFactsReader } from './receptions/purchase-order-facts.js';
import { PurchaseReceptionsController } from './receptions/purchase-receptions.controller.js';
import { PurchaseReceptionsService } from './receptions/purchase-receptions.service.js';
import { PurchaseReception, PurchaseReceptionSchema } from './receptions/reception.schema.js';
import { PURCHASE_RECEPTION_SINK, noPurchaseReceptionSink } from './stock-sink.port.js';
// ADR-0044 — P5
import { TreasuryModule } from '../treasury/treasury.module.js';
import { SupplierPayment, SupplierPaymentSchema } from './payments/supplier-payment.schema.js';
import { SupplierPaymentsController } from './payments/supplier-payments.controller.js';
import { SupplierPaymentsService } from './payments/supplier-payments.service.js';
// ADR-0044 — P6
import { SupplierOverviewController } from './overview/supplier-overview.controller.js';
import { SupplierOverviewService } from './overview/supplier-overview.service.js';
import { PurchasesSummaryController } from './payables/purchases-summary.controller.js';
import { PurchasesSummaryService } from './payables/purchases-summary.service.js';
import { PurchasesRemindersModule } from './reminders/purchases-reminders.module.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    // ADR-0044 — P3 : bon de commande PDF et envoi (ADR-0025, ADR-0028, ADR-0042).
    SalesModule,
    FiscalModule,
    BrandingModule,
    PdfModule,
    // ADR-0044 — P5 : un paiement crée ses dépenses par `TreasuryExpensesService`.
    TreasuryModule,
    // ADR-0044 — P6 : rappels d'échéance des factures (tâche `purchases.due-reminders`).
    PurchasesRemindersModule,
    MongooseModule.forFeature([
      // ADR-0044 — P2 : fiches fournisseurs ; adhésions (destinataires des alertes).
      { name: Supplier.name, schema: SupplierSchema },
      { name: Membership.name, schema: MembershipSchema },
      // ADR-0044 — P3 : demandes et commandes, réglages, compteurs.
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: PurchaseSettings.name, schema: PurchaseSettingsSchema },
      { name: PurchaseCounter.name, schema: PurchaseCounterSchema },
      // ADR-0044 — P4 : réceptions et factures fournisseurs.
      { name: PurchaseReception.name, schema: PurchaseReceptionSchema },
      { name: SupplierInvoice.name, schema: SupplierInvoiceSchema },
      // ADR-0044 — P5 : paiements fournisseurs.
      { name: SupplierPayment.name, schema: SupplierPaymentSchema },
    ]),
  ],
  controllers: [
    // ADR-0044 — P2
    PurchaseSuppliersController,
    // ADR-0044 — P3
    PurchaseOrdersController,
    PurchaseSettingsController,
    // ADR-0044 — P4
    PurchaseReceptionsController,
    SupplierInvoicesController,
    // ADR-0044 — P5
    SupplierPaymentsController,
    // ADR-0044 — P6
    SupplierOverviewController,
    PurchasesSummaryController,
  ],
  providers: [
    MasterKeyringProvider,
    // ADR-0044 — P2 : fiches, coordonnées chiffrées, fusion. Reste dû : fournisseur
    // nul jusqu'aux factures et paiements (P4, P5), qui le remplaceront.
    SuppliersService,
    SuppliersNotifier,
    // ADR-0044 — P3 : cycle demande → bon de commande, réglages, numérotation (DA, BC,
    // et FF/PF pour P4 et P5), PDF et envoi, notifications d'approbation.
    PurchaseSettingsService,
    PurchaseCountersService,
    PurchasesNotifier,
    PurchaseOrdersService,
    PurchaseOrderDocumentsService,
    // ADR-0044 — P4 : le reste dû se lit désormais sur les factures validées (et les
    // paiements du lot P5, lus par la connexion) : le fournisseur nul de P2 est remplacé.
    { provide: SUPPLIER_PAYABLES_SOURCE, useExisting: SupplierInvoicesPayablesSource },
    // ADR-0044 — P4 : réceptions, factures, rapprochement, pièces jointes. Commandes lues
    // sur le modèle de P3 ; port de stock nul en R3 (§ 6.6).
    PurchaseAttachmentsService,
    SupplierInvoicesService,
    SupplierInvoicesNotifier,
    SupplierInvoiceSettlements,
    SupplierInvoicesPayablesSource,
    PurchaseReceptionsService,
    PurchaseOrderFactsReader,
    { provide: PURCHASE_RECEPTION_SINK, useValue: noPurchaseReceptionSink },
    // ADR-0044 — P5 : paiements, ventilation, dépenses possédées, échéancier, doublons.
    SupplierPaymentsService,
    // ADR-0044 — P6 : fiche fournisseur 360° (lecture seule, calculs du moteur).
    SupplierOverviewService,
    // ADR-0044 — P6 : résumé engagé, facturé, payé (moteur `purchasesSummary`).
    PurchasesSummaryService,
  ],
  exports: [
    SuppliersService,
    // ADR-0044 — P3
    PurchaseOrdersService,
    PurchaseSettingsService,
    PurchaseCountersService,
    // ADR-0044 — P4
    SupplierInvoicesService,
    // ADR-0044 — P5
    SupplierPaymentsService,
  ],
})
export class PurchasesModule {}
