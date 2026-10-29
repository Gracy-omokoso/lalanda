// Module CRM minimal — ADR-0035 § 2.
//
// Routes sous `/crm/…`. Lit les clients (`customers`) pour rattacher contacts et
// opportunités, et les devis (`sales_quotes`) pour les montrer sur une
// opportunité — en LECTURE seule : il n'importe pas `SalesModule`, c'est le
// module des devis qui l'importe (règle de gain, `OpportunitiesService`).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
// ADR-0040 — C4
import { WorkModule } from '../work/work.module.js';
import { CrmBriefSource } from './brief/crm-brief.source.js';
import { CrmNotifier } from './crm-notifier.js';
import { CrmDueRemindersJob } from './crm-reminders.job.js';
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

@Module({
  imports: [
    // `AuthGuard` résout l'organisation active via `OrganizationsService`.
    OrganizationsModule,
    // ADR-0040 — C4 : membres (assigné, rappels) et `dueSoonDays` du module work.
    WorkModule,
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
    // ADR-0040 — C4 : notifications `crm.*`, rappels, source du brief.
    CrmNotifier,
    CrmDueRemindersJob,
    CrmBriefSource,
  ],
  exports: [
    OpportunitiesService,
    // ADR-0040 — C1 : comptes (C2, C8) ; synchronisation appelée par Ventes.
    CrmAccountsService,
    CrmAccountsSync,
    // ADR-0040 — C4 : brief du matin (`CRM_SOURCE`) ; notifier pour C2 et C7.
    CrmBriefSource,
    CrmNotifier,
  ],
})
export class CrmModule {}
