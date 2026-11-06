// Module WhatsApp — ADR-0065.
//
// Exporte `WhatsAppNotifier` (sous le jeton `WHATSAPP_NOTIFIER`, consommé en FACULTATIF
// par `WorkNotifier` et les préférences des Projets). Ne dépend pas du module `work` :
// il lit le nom d'un projet en lecture seule par la connexion.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { WhatsAppApi } from './whatsapp-api.js';
import { WHATSAPP_NOTIFIER, WhatsAppNotifier } from './whatsapp-notifier.service.js';
import { WhatsappController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';
import { WorkWhatsappController } from './work-whatsapp.controller.js';
import {
  WhatsAppMessage,
  WhatsAppMessageSchema,
  WhatsAppRecipient,
  WhatsAppRecipientSchema,
  WhatsAppUsage,
  WhatsAppUsageSchema,
} from './whatsapp.schemas.js';

@Module({
  imports: [
    // `AuthGuard` (routes `/work/whatsapp`) dépend d'`OrganizationsService`.
    OrganizationsModule,
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: WhatsAppRecipient.name, schema: WhatsAppRecipientSchema },
      { name: WhatsAppMessage.name, schema: WhatsAppMessageSchema },
      { name: WhatsAppUsage.name, schema: WhatsAppUsageSchema },
    ]),
  ],
  controllers: [WorkWhatsappController, WhatsappController],
  providers: [
    WhatsAppApi,
    WhatsAppService,
    WhatsAppNotifier,
    { provide: WHATSAPP_NOTIFIER, useExisting: WhatsAppNotifier },
  ],
  exports: [WHATSAPP_NOTIFIER, WhatsAppNotifier, WhatsAppService, WhatsAppApi],
})
export class WhatsAppModule {}
