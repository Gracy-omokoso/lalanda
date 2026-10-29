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
import { NotificationsController } from './notifications.controller.js';
import { NOTIFICATIONS_PORT } from './notifications.port.js';
import { NOTIFICATIONS_CLOCK, NotificationsService } from './notifications.service.js';

@Global()
@Module({
  imports: [
    // `AuthGuard` (OrganizationsService) et le modèle `Membership`.
    OrganizationsModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationPreferences.name, schema: NotificationPreferencesSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATIONS_CLOCK, useValue: () => new Date() },
    NotificationsService,
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
  ],
  exports: [NOTIFICATIONS_PORT, NotificationsService],
})
export class NotificationsModule {}
