// Alerte « coordonnées bancaires modifiées » (ADR-0045 § 2.4, § 6.1). ADR-0045 — H2.
//
// Motif de `suppliers-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé HORS
// de la transaction, erreurs journalisées et avalées, l'auteur n'est jamais notifié.
// Destinataires : le collaborateur relié (s'il a un compte) et les détenteurs
// EFFECTIFS de `hr.sensitive.read` (`holdersFilter`, jamais une requête par rôle).
// Le titre ne porte ni numéro, ni masque, ni montant : seulement le nom d'usage.

import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

@Injectable()
export class HrPrivateNotifier {
  private readonly logger = new Logger('HrPrivateNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  async bankDetailsChanged(input: {
    organizationId: string;
    employeeId: string;
    employeeUserId: string | null;
    displayName: string;
    actorUserId: string;
  }): Promise<void> {
    try {
      const holders = await this.memberships
        .find(holdersFilter(input.organizationId, 'hr.sensitive.read'), { userId: 1 })
        .lean<{ userId: string }[]>()
        .exec();
      const source = {
        module: 'hr' as const,
        entityType: 'employee' as const,
        entityId: input.employeeId,
      };
      if (input.employeeUserId && input.employeeUserId !== input.actorUserId) {
        await this.port.notify({
          organizationId: input.organizationId,
          recipientUserId: input.employeeUserId,
          kind: 'hr.bank_details_changed',
          requiredAction: 'analytics.read',
          source,
          title: 'Vos coordonnées bancaires ont été modifiées',
          href: '/rh/moi',
          actorUserId: input.actorUserId,
        });
      }
      const recipients = new Set<string>();
      for (const m of holders) {
        if (m.userId && m.userId !== input.actorUserId && m.userId !== input.employeeUserId) {
          recipients.add(m.userId);
        }
      }
      for (const recipientUserId of [...recipients].sort()) {
        await this.port.notify({
          organizationId: input.organizationId,
          recipientUserId,
          kind: 'hr.bank_details_changed',
          requiredAction: 'hr.sensitive.read',
          source,
          title: clip(`Coordonnées bancaires modifiées : ${input.displayName}`),
          href: `/rh/collaborateurs/${input.employeeId}`,
          actorUserId: input.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Alerte de changement de coordonnées bancaires non émise (organisation ${input.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
