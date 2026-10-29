// Émission des notifications du CRM — ADR-0040 — C4 § 5.4.
//
// Motif exact de `work/work-notifier.ts` : tout passe par le port
// `NOTIFICATIONS_PORT`, injecté en facultatif (repli `noNotifications`), HORS de
// la transaction métier, après l'écriture. Une notification perdue ne défait
// jamais une assignation ; les erreurs sont journalisées et avalées. L'auteur
// d'un geste n'est jamais notifié de son propre geste.
//
// `requiredAction: 'crm.read'` : le destinataire doit encore détenir `crm.read`
// pour VOIR la notification (revérifié à la lecture par le module générique).
//
// Types émis ici : `crm.activity_assigned`, `crm.activity_due_soon`,
// `crm.activity_overdue`. `crm.opportunity_assigned` (responsable, lot C2) et
// `crm.opportunity_won` (lot C7) passent par `opportunityEvent`, prêt pour eux.

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';

export type CrmActivityNotificationKind =
  'crm.activity_assigned' | 'crm.activity_due_soon' | 'crm.activity_overdue';

export type CrmOpportunityNotificationKind = 'crm.opportunity_assigned' | 'crm.opportunity_won';

interface CrmEvent {
  organizationId: string;
  recipients: readonly (string | null | undefined)[];
  title: string;
  href: string;
  actorUserId: string | null;
  /** Clé de déduplication (rappels) ; facultative pour les gestes. */
  dedupeKey?: string;
}

export interface CrmActivityNotification extends CrmEvent {
  kind: CrmActivityNotificationKind;
  activityId: string;
}

export interface CrmOpportunityNotification extends CrmEvent {
  kind: CrmOpportunityNotificationKind;
  opportunityId: string;
}

/** Titre borné à 200 caractères (figé à l'émission). */
export function crmBoundedTitle(title: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

@Injectable()
export class CrmNotifier {
  private readonly logger = new Logger('CrmNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(@Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null) {
    this.port = port ?? noNotifications;
  }

  async activityEvent(n: CrmActivityNotification): Promise<void> {
    await this.emit(n, n.kind, 'activity', n.activityId);
  }

  async opportunityEvent(n: CrmOpportunityNotification): Promise<void> {
    await this.emit(n, n.kind, 'opportunity', n.opportunityId);
  }

  private async emit(
    n: CrmEvent,
    kind: NotificationKind,
    entityType: 'activity' | 'opportunity',
    entityId: string,
  ): Promise<void> {
    const seen = new Set<string>();
    for (const recipient of n.recipients) {
      if (!recipient || recipient === n.actorUserId || seen.has(recipient)) continue;
      seen.add(recipient);
      try {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId: recipient,
          kind,
          requiredAction: 'crm.read',
          source: { module: 'crm', entityType, entityId },
          title: crmBoundedTitle(n.title),
          href: n.href,
          actorUserId: n.actorUserId,
          ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        });
      } catch (err) {
        this.logger.warn(
          `Notification ${kind} non émise (organisation ${n.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
