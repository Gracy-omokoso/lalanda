// Émission des notifications du module « work » — ADR-0039 § 6.6.
//
// Passe TOUJOURS par le port `NOTIFICATIONS_PORT` (module générique, lot L2),
// injecté en facultatif avec repli `noNotifications` : tant que le module de
// notifications n'est pas chargé, rien n'est émis et rien ne casse.
//
// Appelé HORS de la transaction métier, après l'écriture : une notification
// perdue ne défait jamais une assignation ni un commentaire. Les erreurs sont
// journalisées et avalées. L'auteur d'un geste n'est jamais notifié de son
// propre geste (vérifié ici, et de nouveau par le port).

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';
import { taskHref } from './work.common.js';

export interface TaskNotification {
  organizationId: string;
  recipients: readonly (string | null | undefined)[];
  kind: NotificationKind;
  projectId: string;
  taskId: string;
  title: string;
  actorUserId: string | null;
  /** Clé de déduplication (rappels) ; facultative pour les gestes. */
  dedupeKey?: string;
}

/** Titre borné à 200 caractères (figé à l'émission). */
export function boundedTitle(title: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

@Injectable()
export class WorkNotifier {
  private readonly logger = new Logger('WorkNotifier');

  /**
   * Port effectivement utilisé. Public et remplaçable : les tests de bout en bout
   * l'enveloppent pour observer les émissions sans dépendre du module L2.
   */
  port: NotificationsPort;

  constructor(@Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null) {
    this.port = port ?? noNotifications;
  }

  async taskEvent(n: TaskNotification): Promise<void> {
    const seen = new Set<string>();
    for (const recipient of n.recipients) {
      if (!recipient || recipient === n.actorUserId || seen.has(recipient)) continue;
      seen.add(recipient);
      try {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId: recipient,
          kind: n.kind,
          requiredAction: 'work.read',
          source: {
            module: 'work',
            entityType: 'task',
            entityId: n.taskId,
            projectId: n.projectId,
          },
          title: boundedTitle(n.title),
          href: taskHref(n.projectId, n.taskId),
          actorUserId: n.actorUserId,
          ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        });
      } catch (err) {
        this.logger.warn(
          `Notification ${n.kind} non émise (organisation ${n.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
