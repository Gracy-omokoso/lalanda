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
// ADR-0040 — C1
import { Membership, MembershipSchema } from '../organizations/membership.schema.js';
import { CrmAccount, CrmAccountSchema } from './accounts/crm-account.schema.js';
import { CrmAccountsReconcileJob } from './accounts/crm-accounts-reconcile.job.js';
import { CrmAccountsSync } from './accounts/crm-accounts-sync.service.js';
import { CrmAccountsController } from './accounts/crm-accounts.controller.js';
import { CrmAccountsService } from './accounts/crm-accounts.service.js';
// ADR-0040 — C2
import { CatalogItem, CatalogItemSchema } from '../sales/catalog-item.schema.js';
import { CRM_OPPORTUNITY_EVENTS, NO_OPPORTUNITY_EVENTS } from './opportunity-events.js';

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
      // ADR-0040 — C1 : comptes 360° ; adhésions pour l'éligibilité du responsable.
      { name: CrmAccount.name, schema: CrmAccountSchema },
      { name: Membership.name, schema: MembershipSchema },
      // ADR-0040 — C2 : articles du catalogue (lignes d'opportunité), en lecture seule.
      { name: CatalogItem.name, schema: CatalogItemSchema },
    ]),
  ],
  controllers: [
    CrmSettingsController,
    CrmContactsController,
    CrmOpportunitiesController,
    CrmActivitiesController,
    // ADR-0040 — C1
    CrmAccountsController,
  ],
  providers: [
    CrmSettingsService,
    ContactsService,
    OpportunitiesService,
    ActivitiesService,
    CrmCsvService,
    // ADR-0040 — C1
    CrmAccountsService,
    CrmAccountsSync,
    CrmAccountsReconcileJob,
    // ADR-0040 — C2 : point d'extension « opportunité gagnée » (sans effet par défaut).
    { provide: CRM_OPPORTUNITY_EVENTS, useValue: NO_OPPORTUNITY_EVENTS },
  ],
  exports: [
    OpportunitiesService,
    // ADR-0040 — C1 : comptes (C2, C8) ; synchronisation appelée par Ventes.
    CrmAccountsService,
    CrmAccountsSync,
  ],
})
export class CrmModule {}
