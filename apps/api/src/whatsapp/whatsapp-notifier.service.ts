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

import type { NotificationKind } from '@lalanda/shared/notifications';
import type { WorkNotificationEvent } from '@lalanda/shared/work';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import {
  NotificationDispatcher,
  type PushChannelStatus,
  type PushReport,
  type RegisteredSender,
} from '../notifications/notification-dispatcher.js';
import { WhatsAppApi, WhatsAppApiError } from './whatsapp-api.js';
import { isTemplateApproved, workTemplateMessage } from './whatsapp-templates.js';
import { WhatsAppService, whatsappCodeOf } from './whatsapp.service.js';
import {
  WhatsAppRecipient,
  type WhatsAppRecipientDocument,
  type WhatsAppRecipientLean,
} from './whatsapp.schemas.js';

export interface WhatsAppWorkMessage {
  recipientUserId: string;
  /** Événement ADR-0061 (modèles dédiés) ; absent pour un type du catalogue ADR-0079. */
  event?: WorkNotificationEvent;
  /** ADR-0079 § 7 : modèle du catalogue, prioritaire. */
  template?: string;
  kind?: NotificationKind;
  /** Ligne du journal d'envoi (ADR-0079 § 6). */
  deliveryId?: string | null;
  /** Libellé de l'événement (« Une tâche m’est assignée ») — modèle générique seulement. */
  eventLabel: string;
  title: string;
  /** Chemin RELATIF dans l'application. */
  href: string;
}

/** Jeton d'injection facultatif côté `work` (le module WhatsApp peut ne pas être chargé). */
export const WHATSAPP_NOTIFIER = Symbol('WHATSAPP_NOTIFIER');

export interface WhatsAppNotifierPort {
  /** `report` (ADR-0079 § 6) : sort de chaque message, pour le journal d'envoi. */
  direct(
    organizationId: string,
    projectId: string,
    messages: WhatsAppWorkMessage[],
    report?: PushReport,
  ): void;
  /** La personne a-t-elle un numéro vérifié dans cette organisation ? */
  isVerified(organizationId: string, userId: string): Promise<boolean>;
}

@Injectable()
export class WhatsAppNotifier
  implements WhatsAppNotifierPort, RegisteredSender, OnApplicationShutdown, OnModuleInit
{
  private readonly logger = new Logger('WhatsAppNotifier');
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(WhatsAppService) private readonly service: WhatsAppService,
    @Inject(WhatsAppApi) private readonly api: WhatsAppApi,
    @InjectModel(WhatsAppRecipient.name)
    private readonly recipients: Model<WhatsAppRecipientDocument>,
    @InjectConnection() private readonly db: Connection,
    @Optional()
    @Inject(NotificationDispatcher)
    private readonly dispatcher: NotificationDispatcher | null = null,
  ) {}

  /** ADR-0079 : WhatsApp s'offre au répartiteur commun (notifications hors Projets). */
  onModuleInit(): void {
    this.dispatcher?.registerSender('whatsapp', this);
  }

  direct(
    organizationId: string,
    projectId: string,
    messages: WhatsAppWorkMessage[],
    report?: PushReport,
  ): void {
    if (messages.length === 0) return;
    this.track(this.send(organizationId, projectId, messages, report));
  }

  /** ADR-0079 § 8 : état du canal pour l'écran « Mes notifications ». */
  async channelStatus(organizationId: string, userId: string): Promise<PushChannelStatus> {
    const v = await this.service.view(organizationId, userId);
    if (!v.available) return { ready: false, reason: 'whatsapp_unavailable', detail: null };
    if (v.number?.status !== 'verified') {
      return {
        ready: false,
        reason: 'whatsapp_not_verified',
        detail: v.number?.phoneMasked ?? null,
      };
    }
    if (v.quota.reached) {
      return { ready: false, reason: 'monthly_quota', detail: v.number.phoneMasked };
    }
    return { ready: true, reason: null, detail: v.number.phoneMasked };
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
    report?: PushReport,
  ): Promise<void> {
    const tell: PushReport = (m, o) => {
      try {
        report?.(m, o);
      } catch {
        /* le journal ne casse jamais un envoi */
      }
    };
    const state = await this.service.platform();
    if (!state.platform) {
      for (const m of messages) tell(m, { status: 'skipped', reason: 'whatsapp_unavailable' });
      return;
    }
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
    const phoneOf = new Map(docs.map((d) => [d.userId, d.phone as string]));
    const context = await this.context(organizationId, projectId);
    for (const [index, m] of messages.entries()) {
      const to = phoneOf.get(m.recipientUserId);
      if (!to) {
        tell(m, { status: 'skipped', reason: 'whatsapp_not_verified' });
        continue;
      }
      if (m.template && !isTemplateApproved(m.template)) {
        tell(m, { status: 'skipped', reason: 'template_unavailable' });
        continue;
      }
      if (!(await this.service.reserve(organizationId, monthlyLimit))) {
        this.logger.warn(`Plafond mensuel WhatsApp atteint (organisation ${organizationId})`);
        tell(m, { status: 'skipped', reason: 'monthly_quota' });
        continue;
      }
      const message = workTemplateMessage({
        to,
        event: m.event,
        template: m.template,
        eventLabel: m.eventLabel,
        title: m.title,
        projectName: context.projectName,
        organizationName: context.organizationName,
        href: m.href,
      });
      try {
        const wamid = await this.api.sendTemplate(creds, message);
        await this.service.recordMessage(organizationId, m.recipientUserId, wamid, message.name);
        tell(m, { status: 'sent', reason: null });
      } catch (err) {
        await this.service.release(organizationId);
        await this.service.onSendError(organizationId, m.recipientUserId, err);
        tell(m, { status: 'failed', reason: 'provider_error' });
        // Jeton refusé : inutile d'insister pour les destinataires suivants.
        if (err instanceof WhatsAppApiError && err.kind === 'provider') {
          for (const rest of messages.slice(index + 1)) {
            tell(rest, { status: 'failed', reason: 'provider_error' });
          }
          return;
        }
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
