// Notification « coordonnées de paiement modifiées » (ADR-0044 § 2.1.1, § 6.5).
// ADR-0044 — P2.
//
// Motif de `crm/crm-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé
// HORS de la transaction, erreurs journalisées et avalées, l'auteur n'est jamais
// notifié. Destinataires : détenteurs EFFECTIFS de `payables.pay` et de
// `purchase.approve` (ADR-0041 § 9.4 : `holdersFilter`, jamais une requête par
// rôle). Le titre ne contient ni numéro ni masque : seulement le nom de la fiche.

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

@Injectable()
export class SuppliersNotifier {
  private readonly logger = new Logger('SuppliersNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  async paymentDetailsChanged(input: {
    organizationId: string;
    supplierId: string;
    supplierName: string;
    actorUserId: string;
  }): Promise<void> {
    try {
      const [payers, approvers] = await Promise.all(
        (['payables.pay', 'purchase.approve'] as const).map((action) =>
          this.memberships
            .find(holdersFilter(input.organizationId, action), { userId: 1 })
            .lean<{ userId: string }[]>()
            .exec(),
        ),
      );
      const recipients = new Set<string>();
      for (const m of [...payers!, ...approvers!]) {
        if (m.userId && m.userId !== input.actorUserId) recipients.add(m.userId);
      }
      const max = NOTIFICATION_LIMITS.titleMax;
      const raw = `Coordonnées de paiement modifiées : ${input.supplierName}`;
      const title = raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
      for (const recipientUserId of [...recipients].sort()) {
        await this.port.notify({
          organizationId: input.organizationId,
          recipientUserId,
          kind: 'purchases.supplier_payment_details_changed',
          requiredAction: 'purchase.read',
          source: { module: 'purchases', entityType: 'supplier', entityId: input.supplierId },
          title,
          href: `/achats/fournisseurs/${input.supplierId}`,
          actorUserId: input.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Notification de changement de coordonnées non émise (organisation ${input.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
