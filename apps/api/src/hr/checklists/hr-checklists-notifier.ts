// Notifications des listes d'entrée et de sortie et des échéances RH (ADR-0045 § 6.1,
// § 6.4). ADR-0045 — H4.
//
// Motif de `hr-notifier.ts` (H3) : port `NOTIFICATIONS_PORT` facultatif, appelé HORS
// de toute transaction, erreurs journalisées et avalées ; l'auteur d'un geste n'est
// jamais notifié. Aucune notification ne porte un numéro, un montant, un libellé de
// document ni un type d'absence : le nom d'usage, une nature, une date.

import { HR_CHECKLIST_KIND_LABELS, type HrChecklistKind } from '@lalanda/shared/hr';
import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type { Action } from '../../authz/permissions.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

/** Écran « Mes tâches » : chaque élément y apparaît pour son seul assigné. */
export const HR_MY_TASKS_HREF = '/projets/mes-taches';

export interface HrReminderNotice {
  organizationId: string;
  recipientUserId: string;
  kind: Extract<
    NotificationKind,
    'hr.probation_ending' | 'hr.contract_ending' | 'hr.document_expiring'
  >;
  requiredAction: Action;
  employeeId: string;
  documentId: string | null;
  title: string;
  href: string;
  dedupeKey: string;
}

@Injectable()
export class HrChecklistsNotifier {
  private readonly logger = new Logger('HrChecklistsNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(@Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null) {
    this.port = port ?? noNotifications;
  }

  /** `hr.checklist_item_assigned` : une notification par assigné (sauf l'auteur). */
  async itemsAssigned(n: {
    organizationId: string;
    checklistId: string;
    kind: HrChecklistKind;
    employeeName: string;
    assignees: ReadonlyMap<string, number>;
    actorUserId: string;
  }): Promise<void> {
    for (const [recipientUserId, count] of [...n.assignees].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (recipientUserId === n.actorUserId) continue;
      try {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId,
          kind: 'hr.checklist_item_assigned',
          requiredAction: 'analytics.read',
          source: { module: 'hr', entityType: 'hr_checklist', entityId: n.checklistId },
          title: clip(
            `${HR_CHECKLIST_KIND_LABELS[n.kind]} de ${n.employeeName} : ${count} élément${
              count > 1 ? 's' : ''
            } pour vous`,
          ),
          href: HR_MY_TASKS_HREF,
          actorUserId: n.actorUserId,
          dedupeKey: `hr.checklist_item_assigned:${n.checklistId}`,
        });
      } catch (err) {
        this.warn(n.organizationId, err);
      }
    }
  }

  /** Rappel d'échéance (tâche `hr.reminders`) : `actorUserId: null`, clé de dédoublonnage. */
  async reminder(n: HrReminderNotice): Promise<boolean> {
    try {
      await this.port.notify({
        organizationId: n.organizationId,
        recipientUserId: n.recipientUserId,
        kind: n.kind,
        requiredAction: n.requiredAction,
        source: n.documentId
          ? { module: 'hr', entityType: 'hr_document', entityId: n.documentId }
          : { module: 'hr', entityType: 'employee', entityId: n.employeeId },
        title: clip(n.title),
        href: n.href,
        actorUserId: null,
        dedupeKey: n.dedupeKey.slice(0, NOTIFICATION_LIMITS.dedupeKeyMax),
      });
      return true;
    } catch (err) {
      this.warn(n.organizationId, err);
      return false;
    }
  }

  private warn(organizationId: string, err: unknown): void {
    this.logger.warn(
      `Notification RH non émise (organisation ${organizationId}) : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
