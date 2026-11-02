// Notifications in-app des contrats et abonnements — ADR-0050 § 6. ADR-0050 — V6.
//
// Motif de `HrNotifier` : port `NOTIFICATIONS_PORT` facultatif, appelé HORS de la
// transaction métier, erreurs journalisées et avalées ; l'auteur d'un geste n'est jamais
// notifié. Destinataires par droits EFFECTIFS (`holdersOf`) ou par relation (responsable,
// soumetteur), JAMAIS par rôle ; l'action requise est revérifiée à la lecture.
//
// AUCUN envoi externe (ni e-mail ni SMS) : la cloche seulement (décision ouverte n° 19 :
// pas d'envoi par e-mail en v1). Idempotentes : chaque notification porte une clé
// `dedupeKey` (unique par destinataire) — rejouer la tâche du jour ne crée aucun doublon.
// Aucune ne porte un montant ni ne juge une clause : un numéro et une date.

import type { NotificationKind } from '@lalanda/shared/notifications';
import { SALES_INVOICES_HREF, salesContractHref } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AuthzService } from '../../../authz/authz.service.js';
import { contractApprovalDecision, type Action } from '../../../authz/permissions.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../../notifications/notifications.port.js';
import { frenchDay } from '../subscriptions/sales-subscriptions-model.js';
import { clip } from './contracts-agenda-model.js';

/** Document soumis ou décidé : un contrat, ou l'un de ses avenants. */
export interface ContractDocumentNotice {
  organizationId: string;
  contractId: string;
  /** `CT…` pour un contrat, `CT…-A{n}` pour un avenant. */
  number: string;
  isAmendment: boolean;
  /** Identifiant de l'avenant (clé de dédoublonnage), `null` pour le contrat. */
  amendmentId: string | null;
  createdBy: string;
  submittedBy: string | null;
  ownerUserId: string;
  /** Instant du geste (soumission ou décision) : une notification par geste. */
  at: Date;
  actorUserId: string | null;
}

interface Emission {
  organizationId: string;
  kind: NotificationKind;
  requiredAction: Action;
  entityId: string;
  title: string;
  href: string;
  actorUserId: string | null;
  dedupeKey: string;
}

@Injectable()
export class SalesContractsNotifier {
  private readonly logger = new Logger('SalesContractsNotifier');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  /**
   * `sales.contract_submitted` : détenteurs EFFECTIFS de `sales.contract.approve` qui
   * peuvent approuver CE document (ni créateur ni soumetteur, sauf approbateur unique).
   */
  async submitted(n: ContractDocumentNotice, allowSoleApprover: boolean): Promise<void> {
    try {
      const holders = await this.authz.holdersOf(n.organizationId, 'sales.contract.approve');
      const recipients = holders.filter(
        (userId) =>
          contractApprovalDecision({
            approverUserId: userId,
            submittedBy: n.submittedBy,
            createdBy: n.createdBy,
            holdersCount: holders.length,
            allowSoleApprover,
          }).ok,
      );
      const what = n.isAmendment ? `Avenant ${n.number}` : `Contrat ${n.number}`;
      await this.send(recipients, {
        organizationId: n.organizationId,
        kind: 'sales.contract_submitted',
        requiredAction: 'sales.contract.approve',
        entityId: n.contractId,
        title: clip(`${what} à approuver`),
        href: salesContractHref(n.contractId),
        actorUserId: n.actorUserId,
        dedupeKey: `sales.contract_submitted:${n.amendmentId ?? n.contractId}:${n.at.getTime()}`,
      });
    } catch (err) {
      this.warn(n.organizationId, err);
    }
  }

  /** `sales.contract_approved` · `sales.contract_rejected` : soumetteur et responsable. */
  async decided(n: ContractDocumentNotice, approved: boolean): Promise<void> {
    const what = n.isAmendment ? `Avenant ${n.number}` : `Contrat ${n.number}`;
    const kind: NotificationKind = approved ? 'sales.contract_approved' : 'sales.contract_rejected';
    await this.send([n.submittedBy, n.ownerUserId], {
      organizationId: n.organizationId,
      kind,
      requiredAction: 'sales.read',
      entityId: n.contractId,
      title: clip(`${what} ${approved ? 'approuvé' : 'rejeté'}`),
      href: salesContractHref(n.contractId),
      actorUserId: n.actorUserId,
      dedupeKey: `${kind}:${n.amendmentId ?? n.contractId}:${n.at.getTime()}`,
    });
  }

  /** `sales.contract_notice_due` : le responsable, une fois par date limite. */
  async noticeDue(n: {
    organizationId: string;
    contractId: string;
    number: string;
    ownerUserId: string;
    deadline: string;
  }): Promise<void> {
    await this.send([n.ownerUserId], {
      organizationId: n.organizationId,
      kind: 'sales.contract_notice_due',
      requiredAction: 'sales.read',
      entityId: n.contractId,
      title: clip(`Date limite de préavis le ${frenchDay(n.deadline)} — contrat ${n.number}`),
      href: salesContractHref(n.contractId),
      actorUserId: null,
      dedupeKey: `sales.contract_notice_due:${n.contractId}:${n.deadline}`,
    });
  }

  /** `sales.contract_term_ending` : le responsable, une fois par fin de terme. */
  async termEnding(n: {
    organizationId: string;
    contractId: string;
    number: string;
    ownerUserId: string;
    termEnd: string;
  }): Promise<void> {
    await this.send([n.ownerUserId], {
      organizationId: n.organizationId,
      kind: 'sales.contract_term_ending',
      requiredAction: 'sales.read',
      entityId: n.contractId,
      title: clip(`Fin du terme le ${frenchDay(n.termEnd)} — contrat ${n.number}`),
      href: salesContractHref(n.contractId),
      actorUserId: null,
      dedupeKey: `sales.contract_term_ending:${n.contractId}:${n.termEnd}`,
    });
  }

  /**
   * `sales.subscription_drafts_ready` : détenteurs EFFECTIFS de `sales.invoice`, au plus
   * une fois par jour et par organisation (tâche rejouée : aucun doublon).
   */
  async draftsReady(n: {
    organizationId: string;
    today: string;
    prepared: number;
    /** Un contrat concerné (source de la notification). */
    contractId: string;
  }): Promise<void> {
    if (n.prepared <= 0) return;
    try {
      const recipients = await this.authz.holdersOf(n.organizationId, 'sales.invoice');
      await this.send(recipients, {
        organizationId: n.organizationId,
        kind: 'sales.subscription_drafts_ready',
        requiredAction: 'sales.invoice',
        entityId: n.contractId,
        title:
          n.prepared === 1
            ? '1 brouillon d’échéance préparé, à vérifier et émettre'
            : `${n.prepared} brouillons d’échéance préparés, à vérifier et émettre`,
        href: SALES_INVOICES_HREF,
        actorUserId: null,
        dedupeKey: `sales.subscription_drafts_ready:${n.today}`,
      });
    } catch (err) {
      this.warn(n.organizationId, err);
    }
  }

  private async send(recipients: readonly (string | null)[], e: Emission): Promise<void> {
    try {
      const unique = [...new Set(recipients)]
        .filter((u): u is string => !!u && u !== e.actorUserId)
        .sort();
      for (const recipientUserId of unique) {
        await this.port.notify({
          organizationId: e.organizationId,
          recipientUserId,
          kind: e.kind,
          requiredAction: e.requiredAction,
          source: { module: 'sales', entityType: 'sales_contract', entityId: e.entityId },
          title: e.title,
          href: e.href,
          actorUserId: e.actorUserId,
          dedupeKey: e.dedupeKey,
        });
      }
    } catch (err) {
      this.warn(e.organizationId, err);
    }
  }

  private warn(organizationId: string, err: unknown): void {
    this.logger.warn(
      `Notification de contrat non émise (organisation ${organizationId}) : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
