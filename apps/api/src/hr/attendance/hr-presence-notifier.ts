// Notifications des présences et des plannings (ADR-0051 § 7.5). ADR-0051 — H12.
//
// Motif de `hr-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé HORS de la
// transaction, erreurs journalisées et avalées ; l'auteur d'un geste n'est jamais
// notifié. Aucune notification ne porte une heure de pointage, un motif ni une note :
// seulement le nom d'usage. Destinataires par RELATION (manager désigné, collaborateur)
// ou par droits EFFECTIFS (`holdersOf`), refiltrés à la lecture par `analytics.read`.

import {
  NOTIFICATION_LIMITS,
  type NotificationEntityType,
  type NotificationKind,
} from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AuthzService } from '../../authz/authz.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';

export const HR_PRESENCES_HREF = '/rh/presences';
export const HR_PLANNING_HREF = '/rh/planning';

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

interface Notice {
  organizationId: string;
  actorUserId: string | null;
  entityType: NotificationEntityType;
  entityId: string;
}

@Injectable()
export class HrPresenceNotifier {
  private readonly logger = new Logger('HrPresenceNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  /** Détenteurs EFFECTIFS de `hr.manage` (décideurs sans manager désigné). */
  async hrManagersOf(organizationId: string): Promise<string[]> {
    return this.authz.holdersOf(organizationId, 'hr.manage');
  }

  /** `hr.attendance_correction_requested` : les décideurs. */
  async correctionRequested(
    n: Omit<Notice, 'entityType'> & { employeeName: string; recipients: readonly string[] },
  ): Promise<void> {
    await this.send(
      { ...n, entityType: 'attendance_correction' },
      'hr.attendance_correction_requested',
      n.recipients,
      clip(`Correction de pointage à décider : ${n.employeeName}`),
      HR_PRESENCES_HREF,
    );
  }

  /** `hr.attendance_correction_decided` : le demandeur et le collaborateur. */
  async correctionDecided(
    n: Omit<Notice, 'entityType'> & {
      approved: boolean;
      beneficiaryUserId: string | null;
      requestedBy: string;
      employeeName: string;
    },
  ): Promise<void> {
    const verb = n.approved ? 'acceptée' : 'refusée';
    if (n.beneficiaryUserId) {
      await this.send(
        { ...n, entityType: 'attendance_correction' },
        'hr.attendance_correction_decided',
        [n.beneficiaryUserId],
        `Votre correction de pointage a été ${verb}`,
        HR_PRESENCES_HREF,
      );
    }
    if (n.requestedBy !== n.beneficiaryUserId) {
      await this.send(
        { ...n, entityType: 'attendance_correction' },
        'hr.attendance_correction_decided',
        [n.requestedBy],
        clip(`Correction de pointage de ${n.employeeName} ${verb}`),
        HR_PRESENCES_HREF,
      );
    }
  }

  /** `hr.shifts_published` : un message par collaborateur relié. */
  async shiftsPublished(
    n: Omit<Notice, 'entityType' | 'entityId'> & {
      byUser: ReadonlyMap<string, string>;
    },
  ): Promise<void> {
    for (const [userId, shiftId] of n.byUser) {
      await this.send(
        { ...n, entityType: 'shift', entityId: shiftId },
        'hr.shifts_published',
        [userId],
        'Votre planning a été publié',
        HR_PLANNING_HREF,
      );
    }
  }

  /** `hr.shift_changed` : créneau publié modifié ou annulé, ou indisponibilité signalée. */
  async shiftChanged(
    n: Omit<Notice, 'entityType'> & { recipients: readonly string[]; title: string },
  ): Promise<void> {
    await this.send(
      { ...n, entityType: 'shift' },
      'hr.shift_changed',
      n.recipients,
      clip(n.title),
      HR_PLANNING_HREF,
    );
  }

  private async send(
    n: Notice,
    kind: NotificationKind,
    recipients: readonly string[],
    title: string,
    href: string,
  ): Promise<void> {
    try {
      const unique = [...new Set(recipients)].filter((u) => u && u !== n.actorUserId).sort();
      for (const recipientUserId of unique) {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId,
          kind,
          requiredAction: 'analytics.read',
          source: { module: 'hr', entityType: n.entityType, entityId: n.entityId },
          title,
          href,
          actorUserId: n.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Notification de présence ou de planning non émise (organisation ${n.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
