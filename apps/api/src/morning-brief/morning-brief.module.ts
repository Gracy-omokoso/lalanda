// Brief du matin (ADR-0033).
//
// Lit les factures RUN (`sales_invoices`) en lecture seule, les remet au moteur,
// et réutilise l'IA existante (client OpenAI partagé, quota commun), l'ordonnanceur
// et l'envoi d'e-mails. Les fournisseurs de trésorerie et d'échéances sont des
// points d'extension (`morning-brief.ports.ts`) : un chantier qui les livre
// remplace la ligne `useValue` correspondante, rien d'autre.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  OrganizationSuspension,
  OrganizationSuspensionSchema,
} from '../admin/organization-suspension.schema.js';
import { AiModule, OPENAI_CHAT_CLIENT } from '../ai/ai.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/invoices/invoice.schema.js';
import { MorningBriefEmailJob } from './morning-brief-email.job.js';
import { MORNING_BRIEF_CHAT_CLIENT, MorningBriefAiService } from './morning-brief-ai.service.js';
import { MorningBriefController } from './morning-brief.controller.js';
import {
  CASH_POSITION_SOURCE,
  DUE_DATES_SOURCE,
  noCashPosition,
  noDueDates,
} from './morning-brief.ports.js';
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
    // Points d'extension — ADR-0034 (trésorerie), ADR-0031 (échéances).
    { provide: CASH_POSITION_SOURCE, useValue: noCashPosition },
    { provide: DUE_DATES_SOURCE, useValue: noDueDates },
  ],
  exports: [MorningBriefService],
})
export class MorningBriefModule {}
