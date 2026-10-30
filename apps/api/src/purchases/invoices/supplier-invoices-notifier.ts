// Notification « facture fournisseur en écart » (ADR-0044 § 5.3, § 6.5). ADR-0044 — P4.
//
// Motif de `suppliers/suppliers-notifier.ts` : port facultatif, appelé HORS de toute
// transaction, erreurs journalisées et avalées, l'auteur n'est jamais notifié.
// Destinataires : détenteurs EFFECTIFS de `purchase.approve` (`holdersFilter`, jamais
// une requête par rôle) — ce sont eux qui peuvent forcer la facture.

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
export class SupplierInvoicesNotifier {
  private readonly logger = new Logger('SupplierInvoicesNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  async invoiceVariance(input: {
    organizationId: string;
    invoiceId: string;
    internalNumber: string;
    supplierName: string | null;
    actorUserId: string;
  }): Promise<void> {
    try {
      const approvers = await this.memberships
        .find(holdersFilter(input.organizationId, 'purchase.approve'), { userId: 1 })
        .lean<{ userId: string }[]>()
        .exec();
      const recipients = [
        ...new Set(approvers.map((m) => m.userId).filter((u) => u && u !== input.actorUserId)),
      ].sort();
      const max = NOTIFICATION_LIMITS.titleMax;
      const raw = `Facture fournisseur en écart : ${input.internalNumber}${
        input.supplierName ? ` (${input.supplierName})` : ''
      }`;
      const title = raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
      for (const recipientUserId of recipients) {
        await this.port.notify({
          organizationId: input.organizationId,
          recipientUserId,
          kind: 'purchases.invoice_variance',
          requiredAction: 'purchase.read',
          source: {
            module: 'purchases',
            entityType: 'supplier_invoice',
            entityId: input.invoiceId,
          },
          title,
          href: `/achats/factures/${input.invoiceId}`,
          actorUserId: input.actorUserId,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Notification d'écart non émise (organisation ${input.organizationId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
