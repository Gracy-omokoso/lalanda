// Module CRM minimal — ADR-0035 § 2.
//
// Routes sous `/crm/…`. Lit les clients (`customers`) pour rattacher contacts et
// opportunités, et les devis (`sales_quotes`) pour les montrer sur une
// opportunité — en LECTURE seule : il n'importe pas `SalesModule`, c'est le
// module des devis qui l'importe (règle de gain, `OpportunitiesService`).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { Customer, CustomerSchema } from '../sales/customer.schema.js';
import { SalesQuote, SalesQuoteSchema } from '../sales/quotes/quote.schema.js';
import { ActivitiesService } from './activities.service.js';
import { ContactsService } from './contacts.service.js';
import { CrmActivitiesController } from './crm-activities.controller.js';
import { CrmContactsController } from './crm-contacts.controller.js';
import { CrmCsvService } from './crm-csv.service.js';
import { CrmOpportunitiesController } from './crm-opportunities.controller.js';
import { CrmSettingsController } from './crm-settings.controller.js';
import { CrmSettingsService } from './crm-settings.service.js';
import {
  CrmActivity,
  CrmActivitySchema,
  CrmContact,
  CrmContactSchema,
  CrmOpportunity,
  CrmOpportunitySchema,
  CrmSettings,
  CrmSettingsSchema,
} from './crm.schemas.js';
import { OpportunitiesService } from './opportunities.service.js';

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: CrmSettings.name, schema: CrmSettingsSchema },
      { name: CrmContact.name, schema: CrmContactSchema },
      { name: CrmOpportunity.name, schema: CrmOpportunitySchema },
      { name: CrmActivity.name, schema: CrmActivitySchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: SalesQuote.name, schema: SalesQuoteSchema },
    ]),
  ],
  controllers: [
    CrmSettingsController,
    CrmContactsController,
    CrmOpportunitiesController,
    CrmActivitiesController,
  ],
  providers: [
    CrmSettingsService,
    ContactsService,
    OpportunitiesService,
    ActivitiesService,
    CrmCsvService,
  ],
  exports: [OpportunitiesService],
})
export class CrmModule {}
