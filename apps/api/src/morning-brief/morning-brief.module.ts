// Brief du matin (ADR-0033).
//
// Lit les factures RUN (`sales_invoices`) en lecture seule, les remet au moteur,
// et réutilise l'IA existante (client OpenAI partagé, quota commun), l'ordonnanceur
// et l'envoi d'e-mails. Trésorerie, échéances et reste à encaisser viennent des
// modules RUN (`morning-brief.run-sources.ts`, amendement du 27 oct. 2026).

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  OrganizationSuspension,
  OrganizationSuspensionSchema,
} from '../admin/organization-suspension.schema.js';
import { AiModule, OPENAI_CHAT_CLIENT } from '../ai/ai.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/invoices/invoice.schema.js';
import { SalesModule } from '../sales/sales.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { MorningBriefEmailJob } from './morning-brief-email.job.js';
import { MORNING_BRIEF_CHAT_CLIENT, MorningBriefAiService } from './morning-brief-ai.service.js';
import { MorningBriefController } from './morning-brief.controller.js';
import {
  CASH_POSITION_SOURCE,
  DUE_DATES_SOURCE,
  OUTSTANDING_SOURCE,
} from './morning-brief.ports.js';
import {
  SettlementsDueDates,
  SettlementsOutstanding,
  TreasuryCashPosition,
} from './morning-brief.run-sources.js';
import {
  MorningBriefAiLog,
  MorningBriefAiLogSchema,
  MorningBriefSettings,
  MorningBriefSettingsSchema,
  MorningBriefSubscription,
  MorningBriefSubscriptionSchema,
} from './morning-brief.schemas.js';
import { MorningBriefService } from './morning-brief.service.js';

@Module({
  imports: [
    // `AuthGuard` (OrganizationsService), `MembersService` et les modèles
    // `Organization` et `Membership`.
    OrganizationsModule,
    // `AiQuotaService` et le client OpenAI partagé.
    AiModule,
    // ADR-0031 : règlements (`SettlementsService`, `SalesTreasuryFeed`), lecture seule.
    SalesModule,
    // ADR-0034 : soldes des comptes (`TreasuryAccountsService`), lecture seule.
    TreasuryModule,
    MongooseModule.forFeature([
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: OrganizationSuspension.name, schema: OrganizationSuspensionSchema },
      { name: MorningBriefSettings.name, schema: MorningBriefSettingsSchema },
      { name: MorningBriefSubscription.name, schema: MorningBriefSubscriptionSchema },
      { name: MorningBriefAiLog.name, schema: MorningBriefAiLogSchema },
    ]),
  ],
  controllers: [MorningBriefController],
  providers: [
    MorningBriefService,
    MorningBriefAiService,
    MorningBriefEmailJob,
    { provide: MORNING_BRIEF_CHAT_CLIENT, useExisting: OPENAI_CHAT_CLIENT },
    // Points d'extension — ADR-0034 (trésorerie), ADR-0031 (échéances, créances).
    { provide: CASH_POSITION_SOURCE, useClass: TreasuryCashPosition },
    { provide: DUE_DATES_SOURCE, useClass: SettlementsDueDates },
    { provide: OUTSTANDING_SOURCE, useClass: SettlementsOutstanding },
  ],
  exports: [MorningBriefService],
})
export class MorningBriefModule {}
