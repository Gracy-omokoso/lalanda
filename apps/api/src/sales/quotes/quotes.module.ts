// Module des devis — ADR-0035 § 1.
//
// Routes sous `/sales/quotes`. Consomme, sans les modifier : la composition et la
// création des brouillons de facture (`InvoiceDraftsService`), le rendu des
// documents (`InvoiceDocumentsService`, modèles d'ADR-0028), et la règle de gain
// du CRM (`OpportunitiesService`). Le circuit de normalisation n'est pas touché.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BrandingModule } from '../../branding/branding.module.js';
import { CrmModule } from '../../crm/crm.module.js';
import { FiscalModule } from '../../fiscal/fiscal.module.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { PdfModule } from '../../reports/pdf.module.js';
import { SalesModule } from '../sales.module.js';
import { QuoteDocumentsService } from './quote-documents.service.js';
import {
  SalesQuote,
  SalesQuoteCounter,
  SalesQuoteCounterSchema,
  SalesQuoteSchema,
} from './quote.schema.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesFromOpportunityController } from './quotes-from-opportunity.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [
    OrganizationsModule,
    FiscalModule,
    BrandingModule,
    PdfModule,
    SalesModule,
    CrmModule,
    MongooseModule.forFeature([
      { name: SalesQuote.name, schema: SalesQuoteSchema },
      { name: SalesQuoteCounter.name, schema: SalesQuoteCounterSchema },
    ]),
  ],
  // ADR-0040 — C2 : devis prérempli depuis une opportunité (contrôleur à part).
  controllers: [QuotesController, QuotesFromOpportunityController],
  providers: [QuotesService, QuoteDocumentsService],
})
export class QuotesModule {}
