// Boîte de notifications in-app commune à tout Lalanda (ADR-0039 O6, lot L2).
//
// GLOBAL, comme `MailModule` : chaque module producteur (work aujourd'hui ; CRM,
// factures, brief demain) injecte `NOTIFICATIONS_PORT` sans importer ce module,
// et sans que ce module ne connaisse aucun producteur. Déclaré dans
// `app.module.ts` AVANT les producteurs.
//
// Rappels d'échéance : ils appartiennent au module producteur (`work`, tâche
// récurrente `work.due-reminders`, ADR-0039 § 6.6) et passent par le port avec
// `actorUserId: null` et une `dedupeKey`. Ce module n'enregistre aucune tâche
// d'ordonnanceur : la conservation est assurée par l'index TTL de `notifications`.

import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import {
  Notification,
  NotificationPreferences,
  NotificationPreferencesSchema,
  NotificationSchema,
} from './notification.schemas.js';
import { NotificationDeliveriesService } from './notification-deliveries.service.js';
import { NotificationDispatcher } from './notification-dispatcher.js';
import { NotificationSettingsController } from './notification-settings.controller.js';
import {
  NotificationDeliveryDoc,
  NotificationDeliverySchema,
  NotificationOrgSettingsDoc,
  NotificationOrgSettingsSchema,
  NotificationSettingsDoc,
  NotificationSettingsSchema,
} from './notification-settings.schemas.js';
import { NotificationSettingsService } from './notification-settings.service.js';
import { NotificationsController } from './notifications.controller.js';
import {
  NOTIFICATIONS_BELL_PORT,
  NOTIFICATIONS_PORT,
  type NotificationsPort,
} from './notifications.port.js';
import { NOTIFICATIONS_CLOCK, NotificationsService } from './notifications.service.js';

@Global()
@Module({
  imports: [
    // `AuthGuard` (OrganizationsService) et le modèle `Membership`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationPreferences.name, schema: NotificationPreferencesSchema },
      // ADR-0079 : réglages, réglages d'organisation, journal d'envoi.
      { name: NotificationSettingsDoc.name, schema: NotificationSettingsSchema },
      { name: NotificationOrgSettingsDoc.name, schema: NotificationOrgSettingsSchema },
      { name: NotificationDeliveryDoc.name, schema: NotificationDeliverySchema },
    ]),
  ],
  controllers: [NotificationsController, NotificationSettingsController],
  providers: [
    { provide: NOTIFICATIONS_CLOCK, useValue: () => new Date() },
    NotificationSettingsService,
    NotificationDeliveriesService,
    NotificationDispatcher,
    NotificationsService,
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
    {
      provide: NOTIFICATIONS_BELL_PORT,
      inject: [NotificationsService],
      useFactory: (s: NotificationsService): NotificationsPort => ({
        // Le sort (`created`, `duplicate`…) remonte au répartiteur pour son journal.
        notify: (input) => s.emit(input) as unknown as Promise<void>,
      }),
    },
  ],
  exports: [
    NOTIFICATIONS_PORT,
    NOTIFICATIONS_BELL_PORT,
    NotificationsService,
    NotificationSettingsService,
    NotificationDispatcher,
  ],
})
export class NotificationsModule {}
