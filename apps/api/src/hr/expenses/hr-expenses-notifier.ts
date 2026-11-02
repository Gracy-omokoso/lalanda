// Notifications des notes de frais et des avances (ADR-0051 § 7.5). ADR-0051 — H10.
//
// Motif de `hr-notifier.ts` : port `NOTIFICATIONS_PORT` facultatif, appelé HORS de la
// transaction, erreurs journalisées et avalées ; l'auteur d'un geste n'est jamais
// notifié. AUCUNE notification ne porte un montant, un motif, ni la nature d'une avance
// sur salaire : une avance est « Avance AV… » pour un tiers ; une avance sur salaire ne
// nomme personne pour les payeurs. Destinataires choisis par RELATION (manager désigné,
// bénéficiaire, auteur) ou par droits EFFECTIFS (`holdersOf`), refiltrés à la lecture par
// `analytics.read`.

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AuthzService } from '../../authz/authz.service.js';
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

/** Écrans de l'ADR § 10. */
export const HR_EXPENSES_TO_APPROVE_HREF = '/rh/frais?vue=a-valider';
export const HR_EXPENSES_TO_PAY_HREF = '/rh/frais?vue=a-payer';
export const HR_MY_EXPENSES_HREF = '/rh/moi/frais';

export interface HrExpenseNotice {
  organizationId: string;
  entityType: 'expense_report' | 'advance';
  entityId: string;
  kind: NotificationKind;
  recipients: readonly string[];
  title: string;
  href: string;
  actorUserId: string | null;
  dedupeKey?: string;
}

@Injectable()
export class HrExpensesNotifier {
  private readonly logger = new Logger('HrExpensesNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  /** Détenteurs EFFECTIFS d'une action (jamais un filtre par rôle). */
  holdersOf(organizationId: string, action: Action): Promise<string[]> {
    return this.authz.holdersOf(organizationId, action);
  }

  /** Envoie une notification par destinataire (sauf l'auteur) ; rend le nombre émis. */
  async send(n: HrExpenseNotice): Promise<number> {
    let sent = 0;
    const unique = [...new Set(n.recipients)].filter((u) => u && u !== n.actorUserId).sort();
    for (const recipientUserId of unique) {
      try {
        await this.port.notify({
          organizationId: n.organizationId,
          recipientUserId,
          kind: n.kind,
          requiredAction: 'analytics.read',
          source: { module: 'hr', entityType: n.entityType, entityId: n.entityId },
          title: clip(n.title),
          href: n.href,
          actorUserId: n.actorUserId,
          ...(n.dedupeKey
            ? { dedupeKey: n.dedupeKey.slice(0, NOTIFICATION_LIMITS.dedupeKeyMax) }
            : {}),
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Notification de frais non émise (organisation ${n.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return sent;
  }
}
