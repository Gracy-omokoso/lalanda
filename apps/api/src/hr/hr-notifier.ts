// Notifications des absences (ADR-0045 § 6.1). ADR-0045 — H3.
//
// Motif de `hr-private-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé
// HORS de la transaction, erreurs journalisées et avalées ; l'auteur d'un geste n'est
// jamais notifié. AUCUNE notification ne porte un type d'absence (un type confidentiel
// ne fuit pas), ni un motif, ni un nombre de jours : seulement le nom d'usage.
// Destinataires choisis par RELATION (manager désigné, bénéficiaire) ou par droits
// EFFECTIFS (`holdersOf`), refiltrés à la lecture par `analytics.read`.

import { HR_LEAVE_APPROVALS_HREF } from '@lalanda/shared/hr';
import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AuthzService } from '../authz/authz.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

export interface LeaveNoticeBase {
  organizationId: string;
  requestId: string;
  employeeName: string;
  actorUserId: string | null;
}

@Injectable()
export class HrNotifier {
  private readonly logger = new Logger('HrNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  /** Détenteurs EFFECTIFS de `leave.approve` (étape RH, suppléance). */
  async approversOf(organizationId: string): Promise<string[]> {
    return this.authz.holdersOf(organizationId, 'leave.approve');
  }

  /** `hr.leave_requested` : les validateurs de l'étape en attente. */
  async leaveRequested(n: LeaveNoticeBase & { recipients: readonly string[] }): Promise<void> {
    await this.send(
      n,
      'hr.leave_requested',
      n.recipients,
      () => clip(`Absence à valider : ${n.employeeName}`),
      HR_LEAVE_APPROVALS_HREF,
    );
  }

  /** `hr.leave_approved` · `hr.leave_rejected` : décision finale. */
  async leaveDecided(
    n: LeaveNoticeBase & {
      approved: boolean;
      beneficiaryUserId: string | null;
      creatorUserId: string;
      /** Manager informé d'une absence confidentielle (validée par les RH seules). */
      informedManagerUserId: string | null;
    },
  ): Promise<void> {
    const kind: NotificationKind = n.approved ? 'hr.leave_approved' : 'hr.leave_rejected';
    const verb = n.approved ? 'validée' : 'refusée';
    if (n.beneficiaryUserId) {
      await this.send(
        n,
        kind,
        [n.beneficiaryUserId],
        () => `Votre demande d’absence a été ${verb}`,
        '/rh/moi',
      );
    }
    const others = [n.creatorUserId, n.informedManagerUserId].filter(
      (u): u is string => !!u && u !== n.beneficiaryUserId,
    );
    await this.send(
      n,
      kind,
      others,
      () => clip(`Absence de ${n.employeeName} ${verb}`),
      '/rh/absences',
    );
  }

  /** `hr.leave_cancelled` : annulation d'une absence approuvée. */
  async leaveCancelled(n: LeaveNoticeBase & { recipients: readonly string[] }): Promise<void> {
    await this.send(
      n,
      'hr.leave_cancelled',
      n.recipients,
      () => clip(`Absence annulée : ${n.employeeName}`),
      '/rh/absences',
    );
  }

  private async send(
    n: LeaveNoticeBase,
    kind: NotificationKind,
    recipients: readonly string[],
    title: () => string,
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
          source: { module: 'hr', entityType: 'leave_request', entityId: n.requestId },
          title: title(),
          href,
          actorUserId: n.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Notification d’absence non émise (organisation ${n.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
