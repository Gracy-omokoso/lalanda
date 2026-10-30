// Notifications des demandes d'achat (ADR-0044 § 6.5). ADR-0044 — P3.
//
// Motif de `suppliers-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé
// HORS de la transaction, erreurs journalisées et avalées ; l'auteur d'un geste
// n'en est jamais notifié (règle du port). Les destinataires sont choisis par le
// service des commandes sur les droits EFFECTIFS (`holdersFilter`), jamais par une
// requête sur le rôle (ADR-0041 § 9.4). Refiltrées à la lecture par `purchase.read`.

import { NOTIFICATION_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';

export interface PurchaseOrderNotice {
  organizationId: string;
  orderId: string;
  /** `DA…` (soumission) ou `BC…` (approbation) ; `null` faute de numéro. */
  number: string | null;
  title: string;
  /** Révision de la demande : une modification ré-émet une demande d'approbation. */
  revision: number;
  actorUserId: string;
}

function titleOf(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

@Injectable()
export class PurchasesNotifier {
  private readonly logger = new Logger('PurchasesNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(@Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null) {
    this.port = port ?? noNotifications;
  }

  /** Soumission (ou modification d'une demande soumise) : aux approbateurs éligibles. */
  async approvalRequested(n: PurchaseOrderNotice, recipients: readonly string[]): Promise<void> {
    await this.emit(
      n,
      recipients,
      'purchases.approval_requested',
      `Demande d’achat à approuver : ${n.number ? `${n.number} — ` : ''}${n.title}`,
      `purchases.approval_requested:${n.orderId}:${n.revision}`,
    );
  }

  /** Décision finale : au demandeur et au créateur. */
  async decided(
    n: PurchaseOrderNotice,
    recipients: readonly string[],
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    await this.emit(
      n,
      recipients,
      decision === 'approved' ? 'purchases.request_approved' : 'purchases.request_rejected',
      decision === 'approved'
        ? `Demande d’achat approuvée : ${n.number ? `${n.number} — ` : ''}${n.title}`
        : `Demande d’achat refusée : ${n.title}`,
      `purchases.request_${decision}:${n.orderId}:${n.revision}`,
    );
  }

  private async emit(
    n: PurchaseOrderNotice,
    recipients: readonly string[],
    kind:
      'purchases.approval_requested' | 'purchases.request_approved' | 'purchases.request_rejected',
    title: string,
    dedupeKey: string,
  ): Promise<void> {
    for (const recipientUserId of [...new Set(recipients)].sort()) {
      if (recipientUserId === n.actorUserId) continue;
      try {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId,
          kind,
          requiredAction: 'purchase.read',
          source: { module: 'purchases', entityType: 'purchase_order', entityId: n.orderId },
          title: titleOf(title),
          href: `/achats/commandes/${n.orderId}`,
          actorUserId: n.actorUserId,
          dedupeKey: dedupeKey.slice(0, NOTIFICATION_LIMITS.dedupeKeyMax),
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
