// Module ventes — clients et catalogue (ADR-0022, lot S25c, chantier D1).
//
// Routes sous `/sales/…`. `FiscalModule` fournit le lecteur de l'environnement
// DGI de l'organisation ; `EdefModule`, le dernier instantané des groupes de
// taxation. `SalesUsageService` est exporté pour le lot S25e (factures).
//
// ADR-0023 (S25e, chantier E2) : documents de vente sous `/sales/invoices`,
// journal sous `/sales/journal`. Le port de normalisation
// (`SALES_INVOICE_NORMALIZER`) est fourni par `EdefSalesInvoiceNormalizer`
// (ADR-0024, S25f) ; `NoopSalesInvoiceNormalizer` reste disponible pour les tests. `InvoiceNumberingService` et
// `InvoiceJournalService` sont exportés pour S25f.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { APP_INTERCEPTOR } from '@nestjs/core';

import { BrandingModule } from '../branding/branding.module.js';
import { EdefModule } from '../edef/edef.module.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PdfModule } from '../reports/pdf.module.js';
import { InvoiceDocumentsController } from './documents/invoice-documents.controller.js';
import { InvoiceDocumentsService } from './documents/invoice-documents.service.js';
import { InvoiceTemplatesController } from './documents/invoice-templates.controller.js';
import { CatalogItem, CatalogItemSchema } from './catalog-item.schema.js';
import { CatalogItemsController } from './catalog-items.controller.js';
import { CatalogItemsService } from './catalog-items.service.js';
import { Customer, CustomerSchema } from './customer.schema.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import {
  SalesInvoiceSettlement,
  SalesInvoiceSettlementSchema,
} from './receipts/invoice-settlement.schema.js';
import { SalesReceipt, SalesReceiptSchema } from './receipts/receipt.schema.js';
import { ReceiptsController } from './receipts/receipts.controller.js';
import { ReceiptsService } from './receipts/receipts.service.js';
import { SettlementClock, SettlementsService } from './receipts/settlements.service.js';
import { SalesTreasuryFeed } from './receipts/treasury-feed.service.js';
import { SalesUsageService } from './sales-usage.service.js';
import { TaxGroupsController } from './tax-groups.controller.js';
import { TaxGroupsService } from './tax-groups.service.js';
import { CreditNotesService } from './invoices/credit-notes.service.js';
import { ExchangeRateReferenceService } from './invoices/exchange-rate-reference.service.js';
import { InvoiceTaxRatesReader } from './invoices/invoice-calculation.js';
import {
  SalesInvoiceCounter,
  SalesInvoiceCounterSchema,
} from './invoices/invoice-counter.schema.js';
import { InvoiceDraftsService } from './invoices/invoice-drafts.service.js';
import { InvoiceFreezingService } from './invoices/invoice-freezing.service.js';
import {
  SalesInvoiceJournalEntry,
  SalesInvoiceJournalEntrySchema,
} from './invoices/invoice-journal.schema.js';
import { InvoiceJournalService } from './invoices/invoice-journal.service.js';
import { InvoiceNumberingService } from './invoices/invoice-numbering.service.js';
import { SalesInvoice, SalesInvoiceSchema } from './invoices/invoice.schema.js';
import { InvoicesController } from './invoices/invoices.controller.js';
import { SalesJournalHead, SalesJournalHeadSchema } from './invoices/journal-head.schema.js';
import { JournalController } from './invoices/journal.controller.js';
import { JournalExportService } from './invoices/journal-export.service.js';
import { SALES_INVOICE_NORMALIZER } from './invoices/normalization.port.js';
import { NormalizationAlertsJob } from './normalization/alerts.job.js';
import { NormalizationConsistencyJob } from './normalization/consistency.job.js';
import { DgiCallGuard } from './normalization/dgi-call-guard.js';
import { EdefSalesInvoiceNormalizer } from './normalization/edef-normalizer.js';
import { NormalizationActionsInterceptor } from './normalization/normalization-actions.interceptor.js';
import {
  NormalizationAlert,
  NormalizationAlertSchema,
} from './normalization/normalization-alert.schema.js';
import { NormalizationAlertsService } from './normalization/normalization-alerts.service.js';
import { NormalizationRecorder } from './normalization/normalization-recorder.js';
import { NormalizationRoutesService } from './normalization/normalization-routes.service.js';
import { NormalizationController } from './normalization/normalization.controller.js';
import { NormalizationReconciliationJob } from './normalization/reconciliation.job.js';
import { ReferenceRefreshJob } from './normalization/reference-refresh.job.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    FiscalModule,
    EdefModule,
    // ADR-0024 (F2) : garde de ré-authentification récente de `declare-not-normalized`.
    IntegrationsModule,
    // ADR-0025 (S25g) : rendu PDF partagé avec les rapports (un seul Chromium).
    PdfModule,
    // ADR-0028 : identité visuelle et modèle de facture (gel, rendu, aperçu).
    BrandingModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: SalesInvoiceCounter.name, schema: SalesInvoiceCounterSchema },
      { name: SalesInvoiceJournalEntry.name, schema: SalesInvoiceJournalEntrySchema },
      { name: SalesJournalHead.name, schema: SalesJournalHeadSchema },
      // ADR-0024, amendement du 21 oct. 2026 : alertes e-mail (dédoublonnage, journal).
      { name: NormalizationAlert.name, schema: NormalizationAlertSchema },
      // ADR-0031 : encaissements et règlement des factures.
      { name: SalesReceipt.name, schema: SalesReceiptSchema },
      { name: SalesInvoiceSettlement.name, schema: SalesInvoiceSettlementSchema },
    ]),
  ],
  controllers: [
    CustomersController,
    CatalogItemsController,
    TaxGroupsController,
    InvoicesController,
    JournalController,
    // ADR-0024 § 9.1 (F2).
    NormalizationController,
    // ADR-0025 (S25g) : PDF et duplicata.
    InvoiceDocumentsController,
    // ADR-0028 : catalogue des modèles, choix et aperçu.
    InvoiceTemplatesController,
    // ADR-0031 : encaissements et statut de règlement.
    ReceiptsController,
  ],
  providers: [
    CustomersService,
    CatalogItemsService,
    TaxGroupsService,
    SalesUsageService,
    InvoiceNumberingService,
    InvoiceJournalService,
    InvoiceTaxRatesReader,
    ExchangeRateReferenceService,
    InvoiceDraftsService,
    InvoiceFreezingService,
    CreditNotesService,
    InvoiceDocumentsService,
    // ADR-0026 § 6.3 : export du journal pour les vérificateurs (lecture seule).
    JournalExportService,
    // ADR-0031 : encaissements et statut de règlement.
    SettlementClock,
    SettlementsService,
    ReceiptsService,
    // ADR-0034 § 4 et § 7 (intégration du 26 oct. 2026) : encaissements et
    // échéances clients lus par la trésorerie.
    SalesTreasuryFeed,
    // ADR-0024 (F2) : normalisation DGI réelle, rattrapage et tâches planifiées.
    DgiCallGuard,
    NormalizationRecorder,
    EdefSalesInvoiceNormalizer,
    NormalizationReconciliationJob,
    ReferenceRefreshJob,
    NormalizationConsistencyJob,
    // ADR-0024, décision ouverte n° 3 (amendement du 21 oct. 2026) : alertes e-mail.
    NormalizationAlertsService,
    NormalizationAlertsJob,
    NormalizationRoutesService,
    { provide: SALES_INVOICE_NORMALIZER, useExisting: EdefSalesInvoiceNormalizer },
    { provide: APP_INTERCEPTOR, useClass: NormalizationActionsInterceptor },
  ],
  exports: [
    SalesUsageService,
    TaxGroupsService,
    InvoiceNumberingService,
    InvoiceJournalService,
    SalesTreasuryFeed,
  ],
})
export class SalesModule {}
