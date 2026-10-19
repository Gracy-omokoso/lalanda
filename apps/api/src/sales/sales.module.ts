// Module ventes — clients et catalogue (ADR-0022, lot S25c, chantier D1).
//
// Routes sous `/sales/…`. `FiscalModule` fournit le lecteur de l'environnement
// DGI de l'organisation ; `EdefModule`, le dernier instantané des groupes de
// taxation. `SalesUsageService` est exporté pour le lot S25e (factures).
//
// ADR-0023 (S25e, chantier E2) : documents de vente sous `/sales/invoices`,
// journal sous `/sales/journal`. Le port de normalisation
// (`SALES_INVOICE_NORMALIZER`) est fourni ici par `NoopSalesInvoiceNormalizer` ;
// S25f remplace ce seul fournisseur. `InvoiceNumberingService` et
// `InvoiceJournalService` sont exportés pour S25f.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { EdefModule } from '../edef/edef.module.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { CatalogItem, CatalogItemSchema } from './catalog-item.schema.js';
import { CatalogItemsController } from './catalog-items.controller.js';
import { CatalogItemsService } from './catalog-items.service.js';
import { Customer, CustomerSchema } from './customer.schema.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
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
import { NoopSalesInvoiceNormalizer } from './invoices/noop-normalizer.js';
import { SALES_INVOICE_NORMALIZER } from './invoices/normalization.port.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    FiscalModule,
    EdefModule,
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      { name: CatalogItem.name, schema: CatalogItemSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: SalesInvoiceCounter.name, schema: SalesInvoiceCounterSchema },
      { name: SalesInvoiceJournalEntry.name, schema: SalesInvoiceJournalEntrySchema },
      { name: SalesJournalHead.name, schema: SalesJournalHeadSchema },
    ]),
  ],
  controllers: [
    CustomersController,
    CatalogItemsController,
    TaxGroupsController,
    InvoicesController,
    JournalController,
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
    { provide: SALES_INVOICE_NORMALIZER, useClass: NoopSalesInvoiceNormalizer },
  ],
  exports: [SalesUsageService, TaxGroupsService, InvoiceNumberingService, InvoiceJournalService],
})
export class SalesModule {}
