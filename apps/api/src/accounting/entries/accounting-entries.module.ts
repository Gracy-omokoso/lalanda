// Écritures et synchronisation de la comptabilité (ADR-0049, lot K5).
//
// Module du lot K5, importé par `AccountingModule` (une ligne, zone de conflit de l'ADR) ;
// il lit en retour les points d'extension de K4 (réglages, pack, plan, règles, journaux,
// taux, périodes) par `forwardRef`.
//
// Points d'extension exportés pour K6 et K7 :
// - `AccountingEntriesService.reportingEntries(org, { from, to })` : écritures en vue de
//   restitution (simulation : calculées ; actif : enregistrées) ;
// - `AccountingEntryStore` (`post`, `periodOf`, `firstOpenDayAfter`, `verifyChain`…) ;
// - `AccountingSyncService` (`state`, `simulate`, `sync`) ;
// - `AccountingPendingService` (`countOpen`, `list`) ; `AccountingLetteringService`.

import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../../organizations/organizations.module.js';
import { AccountingModule } from '../accounting.module.js';
import {
  AccountingLettering,
  AccountingLetteringSchema,
} from '../lettering/accounting-lettering.schema.js';
import { AccountingLetteringService } from '../lettering/accounting-lettering.service.js';
import { BookkeepingLetteringController } from '../lettering/bookkeeping-lettering.controller.js';
import { AccountingPending, AccountingPendingSchema } from '../pending/accounting-pending.schema.js';
import { AccountingPendingService } from '../pending/accounting-pending.service.js';
import { BookkeepingPendingController } from '../pending/bookkeeping-pending.controller.js';
import { AccountingSourcesService } from '../sources/accounting-sources.service.js';
import { AccountingSyncJob } from '../sync/accounting-sync.job.js';
import {
  AccountingSyncCheckpoint,
  AccountingSyncCheckpointSchema,
  AccountingTreasuryLink,
  AccountingTreasuryLinkSchema,
} from '../sync/accounting-sync.schema.js';
import { AccountingSyncService } from '../sync/accounting-sync.service.js';
import { BookkeepingSyncController } from '../sync/bookkeeping-sync.controller.js';
import { AccountingEntriesService } from './accounting-entries.service.js';
import { AccountingEntryStore } from './accounting-entry-store.service.js';
import {
  AccountingCounter,
  AccountingCounterSchema,
  AccountingEntry,
  AccountingEntrySchema,
  AccountingJournalHead,
  AccountingJournalHeadSchema,
} from './accounting-entry.schema.js';
import { BookkeepingEntriesController } from './bookkeeping-entries.controller.js';

@Module({
  imports: [
    OrganizationsModule,
    forwardRef(() => AccountingModule),
    MongooseModule.forFeature([
      { name: AccountingEntry.name, schema: AccountingEntrySchema },
      { name: AccountingJournalHead.name, schema: AccountingJournalHeadSchema },
      { name: AccountingCounter.name, schema: AccountingCounterSchema },
      { name: AccountingPending.name, schema: AccountingPendingSchema },
      { name: AccountingLettering.name, schema: AccountingLetteringSchema },
      { name: AccountingSyncCheckpoint.name, schema: AccountingSyncCheckpointSchema },
      { name: AccountingTreasuryLink.name, schema: AccountingTreasuryLinkSchema },
    ]),
  ],
  controllers: [
    BookkeepingEntriesController,
    BookkeepingPendingController,
    BookkeepingLetteringController,
    BookkeepingSyncController,
  ],
  providers: [
    AccountingSourcesService,
    AccountingEntryStore,
    AccountingPendingService,
    AccountingLetteringService,
    AccountingSyncService,
    AccountingEntriesService,
    AccountingSyncJob,
  ],
  exports: [
    AccountingSourcesService,
    AccountingEntryStore,
    AccountingPendingService,
    AccountingLetteringService,
    AccountingSyncService,
    AccountingEntriesService,
  ],
})
export class AccountingEntriesModule {}
