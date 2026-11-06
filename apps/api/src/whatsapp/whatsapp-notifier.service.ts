// Envoi des notifications des Projets par WhatsApp — ADR-0065 § 4.
//
// Appelé par `WorkNotifier` APRÈS ses propres filtres : destinataires qui voient le
// projet, jamais l'auteur du geste, préférence « WhatsApp » de chacun. Ce service n'en
// élargit aucun ; il ajoute les siens : numéro VÉRIFIÉ (ni « à vérifier », ni retiré
// par « STOP »), fournisseur disponible, plafond mensuel de l'organisation.
//
// ── Non bloquant ─────────────────────────────────────────────────────────────
//
// `direct()` rend la main IMMÉDIATEMENT : l'envoi part en tâche de fond, ses erreurs
// sont traitées (fournisseur signalé, numéro à vérifier) et journalisées (code Meta
// seul), jamais remontées au geste de l'utilisateur. `flush()` attend les envois en
// cours — pour les tests et l'arrêt propre.

import type { WorkNotificationEvent } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { WhatsAppApi, WhatsAppApiError } from './whatsapp-api.js';
import { workTemplateMessage } from './whatsapp-templates.js';
import { WhatsAppService, whatsappCodeOf } from './whatsapp.service.js';
import {
  WhatsAppRecipient,
  type WhatsAppRecipientDocument,
  type WhatsAppRecipientLean,
} from './whatsapp.schemas.js';

export interface WhatsAppWorkMessage {
  recipientUserId: string;
  event: WorkNotificationEvent;
  /** Libellé de l'événement (« Une tâche m’est assignée ») — modèle générique seulement. */
  eventLabel: string;
  title: string;
  /** Chemin RELATIF dans l'application. */
  href: string;
}

/** Jeton d'injection facultatif côté `work` (le module WhatsApp peut ne pas être chargé). */
export const WHATSAPP_NOTIFIER = Symbol('WHATSAPP_NOTIFIER');

export interface WhatsAppNotifierPort {
  direct(organizationId: string, projectId: string, messages: WhatsAppWorkMessage[]): void;
  /** La personne a-t-elle un numéro vérifié dans cette organisation ? */
  isVerified(organizationId: string, userId: string): Promise<boolean>;
}

@Injectable()
export class WhatsAppNotifier implements WhatsAppNotifierPort, OnApplicationShutdown {
  private readonly logger = new Logger('WhatsAppNotifier');
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(WhatsAppService) private readonly service: WhatsAppService,
    @Inject(WhatsAppApi) private readonly api: WhatsAppApi,
    @InjectModel(WhatsAppRecipient.name)
    private readonly recipients: Model<WhatsAppRecipientDocument>,
    @InjectConnection() private readonly db: Connection,
  ) {}

  direct(organizationId: string, projectId: string, messages: WhatsAppWorkMessage[]): void {
    if (messages.length === 0) return;
    this.track(this.send(organizationId, projectId, messages));
  }

  isVerified(organizationId: string, userId: string): Promise<boolean> {
    return this.service.isVerified(organizationId, userId);
  }

  /** Attend la fin des envois en cours (tests, arrêt). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  private track(p: Promise<void>): void {
    const tracked = p.catch((err: unknown) => {
      this.logger.warn(`Envoi WhatsApp interrompu : ${whatsappCodeOf(err)}`);
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private async send(
    organizationId: string,
    projectId: string,
    messages: WhatsAppWorkMessage[],
  ): Promise<void> {
    const state = await this.service.platform();
    if (!state.platform) return;
    const { creds, monthlyLimit } = state.platform;
    const docs = await this.recipients
      .find({
        organizationId,
        userId: { $in: [...new Set(messages.map((m) => m.recipientUserId))] },
        status: 'verified',
        phone: { $ne: null },
      })
      .lean<WhatsAppRecipientLean[]>()
      .exec();
    if (docs.length === 0) return;
    const phoneOf = new Map(docs.map((d) => [d.userId, d.phone as string]));
    const context = await this.context(organizationId, projectId);
    for (const m of messages) {
      const to = phoneOf.get(m.recipientUserId);
      if (!to) continue;
      if (!(await this.service.reserve(organizationId, monthlyLimit))) {
        this.logger.warn(`Plafond mensuel WhatsApp atteint (organisation ${organizationId})`);
        continue;
      }
      const message = workTemplateMessage({
        to,
        event: m.event,
        eventLabel: m.eventLabel,
        title: m.title,
        projectName: context.projectName,
        organizationName: context.organizationName,
        href: m.href,
      });
      try {
        const wamid = await this.api.sendTemplate(creds, message);
        await this.service.recordMessage(organizationId, m.recipientUserId, wamid, message.name);
      } catch (err) {
        await this.service.release(organizationId);
        await this.service.onSendError(organizationId, m.recipientUserId, err);
        // Jeton refusé : inutile d'insister pour les destinataires suivants.
        if (err instanceof WhatsAppApiError && err.kind === 'provider') return;
      }
    }
  }

  /** Nom du projet et de l'organisation — lecture seule, scopée. */
  private async context(
    organizationId: string,
    projectId: string,
  ): Promise<{ projectName: string | null; organizationName: string }> {
    const db = this.db.db;
    if (!db) return { projectName: null, organizationName: 'Lalanda' };
    const [project, org] = await Promise.all([
      Types.ObjectId.isValid(projectId)
        ? db
            .collection('work_projects')
            .findOne(
              { _id: new Types.ObjectId(projectId), organizationId },
              { projection: { name: 1 } },
            )
        : null,
      Types.ObjectId.isValid(organizationId)
        ? db
            .collection('organizations')
            .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } })
        : null,
    ]);
    return {
      projectName: project ? String(project['name'] ?? '') || null : null,
      organizationName: org ? String(org['name'] ?? 'Lalanda') : 'Lalanda',
    };
  }
}
