// Notifications des objectifs et des évaluations (ADR-0051 § 7.5). ADR-0051 — H15.
//
// Motif de `hr-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé HORS de la
// transaction, erreurs journalisées et avalées ; l'auteur d'un geste n'est jamais
// notifié. AUCUNE notification ne porte une note, une appréciation, un commentaire ni
// un extrait d'évaluation ou d'objectif : le titre dit seulement l'étape attendue et,
// au plus, le nom d'usage du collaborateur.

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

export interface PerformanceNotice {
  organizationId: string;
  kind: Extract<NotificationKind, 'hr.review_step' | 'hr.goal_proposed' | 'hr.goal_agreed'>;
  entityType: 'review' | 'goal';
  entityId: string;
  recipients: readonly (string | null)[];
  title: string;
  href: string;
  actorUserId: string | null;
}

@Injectable()
export class HrPerformanceNotifier {
  private readonly logger = new Logger('HrPerformanceNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(@Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null) {
    this.port = port ?? noNotifications;
  }

  async send(n: PerformanceNotice): Promise<void> {
    try {
      const unique = [...new Set(n.recipients)]
        .filter((u): u is string => !!u && u !== n.actorUserId)
        .sort();
      for (const recipientUserId of unique) {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId,
          kind: n.kind,
          requiredAction: 'analytics.read',
          source: { module: 'hr', entityType: n.entityType, entityId: n.entityId },
          title: clip(n.title),
          href: n.href,
          actorUserId: n.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Notification d’objectif ou d’évaluation non émise (organisation ${n.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
