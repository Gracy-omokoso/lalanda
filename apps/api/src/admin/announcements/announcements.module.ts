// Annonces de la plateforme (ADR-0053 § 6.6 — lot P6). Module propre, importé par
// `AdminModule` en une ligne : il n'emprunte que le journal plateforme et la fenêtre de
// ré-authentification (`IntegrationsModule`), et AUCUN service d'e-mail.

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Subscription, SubscriptionSchema } from '../../billing/subscription.schema.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { OrganizationsModule } from '../../organizations/organizations.module.js';
import {
  PlatformAnnouncement,
  PlatformAnnouncementReceipt,
  PlatformAnnouncementReceiptSchema,
  PlatformAnnouncementSchema,
} from './announcement.schema.js';
import { MeAnnouncementsController } from './me-announcements.controller.js';
import { PlatformAnnouncementsController } from './platform-announcements.controller.js';
import { PlatformAnnouncementsService } from './platform-announcements.service.js';

@Module({
  imports: [
    // `Organization` et `Membership` (module ré-exporté).
    OrganizationsModule,
    IntegrationsModule,
    MongooseModule.forFeature([
      { name: PlatformAnnouncement.name, schema: PlatformAnnouncementSchema },
      { name: PlatformAnnouncementReceipt.name, schema: PlatformAnnouncementReceiptSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [PlatformAnnouncementsController, MeAnnouncementsController],
  providers: [PlatformAnnouncementsService],
})
export class PlatformAnnouncementsModule {}
