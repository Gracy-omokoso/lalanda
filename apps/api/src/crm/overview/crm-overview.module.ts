// Module de composition de la fiche 360° et du fil chronologique (ADR-0040 § 3.1.2).
// ADR-0040 — C8.
//
// Importe Ventes ET le CRM : `CrmModule` ne peut pas importer `SalesModule`
// (Ventes l'importe déjà, ce serait un cycle). Lit les projets RUN par leur
// collection, en lecture seule : aucun service de `WorkModule` n'est requis.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { Customer, CustomerSchema } from '../../sales/customer.schema.js';
import { SalesInvoice, SalesInvoiceSchema } from '../../sales/invoices/invoice.schema.js';
import { SalesQuote, SalesQuoteSchema } from '../../sales/quotes/quote.schema.js';
import { SalesReceipt, SalesReceiptSchema } from '../../sales/receipts/receipt.schema.js';
import { SalesModule } from '../../sales/sales.module.js';
import { WorkProject, WorkProjectSchema } from '../../work/work.schemas.js';
import { CrmAccount, CrmAccountSchema } from '../accounts/crm-account.schema.js';
import { CrmModule } from '../crm.module.js';
import {
  CrmActivity,
  CrmActivitySchema,
  CrmContact,
  CrmContactSchema,
  CrmOpportunity,
  CrmOpportunitySchema,
  CrmSettings,
  CrmSettingsSchema,
} from '../crm.schemas.js';
import { CrmOverviewController } from './crm-overview.controller.js';
import { CrmOverviewService } from './crm-overview.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    // `SettlementsService` (règlement des factures, moteur `receivables`).
    SalesModule,
    // `CrmAccountsService` (résolution du compte dans l'organisation).
    CrmModule,
    MongooseModule.forFeature([
      { name: CrmAccount.name, schema: CrmAccountSchema },
      { name: CrmContact.name, schema: CrmContactSchema },
      { name: CrmOpportunity.name, schema: CrmOpportunitySchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
      { name: CrmSettings.name, schema: CrmSettingsSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesQuote.name, schema: SalesQuoteSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: SalesReceipt.name, schema: SalesReceiptSchema },
      { name: WorkProject.name, schema: WorkProjectSchema },
    ]),
  ],
  controllers: [CrmOverviewController],
  providers: [CrmOverviewService],
})
export class CrmOverviewModule {}
