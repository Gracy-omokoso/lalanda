// Répartiteur des notifications sur les quatre canaux — ADR-0079 § 4 à § 6.
//
// Une émission (déjà filtrée par le producteur : destinataires qui VOIENT l'objet) passe
// ici pour chaque destinataire :
//
//   1. « mes propres actions » : l'auteur n'est notifié que s'il l'a demandé (§ 1) ;
//   2. mode appliqué : le sien, sinon le défaut de l'organisation (chef ou adjoint du
//      projet → mode « chef » ; sinon mode de son rôle, sinon « membre ») ;
//   3. canaux effectifs (`effectiveChannels`, partagé avec l'écran) : défauts du mode,
//      surcharges de CE mode, canaux permis, types coupés, obligations ;
//   4. garde-fous des canaux qui sortent de Lalanda : rafale (un envoi du même type sur
//      le même objet il y a moins de 10 min → « regroupée »), heures calmes (Slack,
//      WhatsApp), modèle WhatsApp approuvé, plafond quotidien WhatsApp ;
//   5. envoi : cloche (port fourni par l'appelant), e-mail (attendu), Slack et WhatsApp
//      (NON BLOQUANTS, leur sort arrive plus tard par `report`) ;
//   6. journal : une ligne par destinataire, le sort et le motif de chaque canal.
//
// Ne lève JAMAIS : une notification perdue ne défait aucun geste. Ne connaît aucun
// module producteur ; Slack et WhatsApp s'enregistrent eux-mêmes (`registerSender`).

import {
  CONFIGURABLE_NOTIFICATION_KINDS,
  effectiveChannels,
  inQuietHours,
  notificationSpecOf,
  type NotificationChannel,
  type NotificationChannelStatus,
  type NotificationChannelsView,
  type NotificationKind,
  type NotificationSkipReason,
  type NotificationTestView,
} from '@lalanda/shared/notifications';
import type { WorkNotificationEvent } from '@lalanda/shared/work';
import { workEventOf } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { MailService } from '../mail/mail.service.js';
import { isTemplateApproved } from '../whatsapp/whatsapp-templates.js';
import {
  NotificationDeliveriesService,
  type DeliveryOutcome,
  type NewDelivery,
} from './notification-deliveries.service.js';
import { NotificationSettingsService } from './notification-settings.service.js';
import type { NotificationInput } from './notifications.port.js';

export interface PushOutcome {
  status: 'sent' | 'skipped' | 'failed';
  reason: NotificationSkipReason | null;
}

/** Message d'un canal externe (Slack, WhatsApp). */
export interface PushMessage {
  recipientUserId: string;
  kind?: NotificationKind;
  /** Événement ADR-0061 (modèles WhatsApp dédiés). */
  event?: WorkNotificationEvent;
  /** Modèle WhatsApp à utiliser (catalogue). */
  template?: string;
  eventLabel: string;
  title: string;
  href: string;
  /** Ligne du journal à compléter. */
  deliveryId?: string | null;
}

export type PushReport = (message: PushMessage, outcome: PushOutcome) => void;

/** Ce que Slack et WhatsApp exposent au répartiteur. */
export interface PushPort {
  direct(
    organizationId: string,
    projectId: string,
    messages: PushMessage[],
    report?: PushReport,
  ): void;
}

export interface PushChannelStatus {
  ready: boolean;
  reason: NotificationSkipReason | null;
  detail: string | null;
}

export interface RegisteredSender extends PushPort {
  channelStatus?(organizationId: string, userId: string): Promise<PushChannelStatus>;
}

export interface DispatchOptions {
  /** Cloche : port du producteur (enveloppable par les tests). */
  bell: (input: NotificationInput) => Promise<unknown>;
  /** `undefined` : service injecté ; `null` : pas d'e-mail. */
  mail?: MailService | null;
  /** `undefined` : expéditeur enregistré ; `null` : pas de Slack. */
  slack?: PushPort | null;
  whatsapp?: PushPort | null;
}

/** Lien des réglages dans les e-mails (§ 8). */
export const NOTIFICATION_SETTINGS_PATH = '/compte/notifications';

const BELL_OUTCOMES: Record<string, DeliveryOutcome> = {
  created: { status: 'sent', reason: null },
  grouped: { status: 'sent', reason: 'grouped' },
  duplicate: { status: 'skipped', reason: 'duplicate' },
  muted: { status: 'skipped', reason: 'muted' },
  not_member: { status: 'skipped', reason: 'not_member' },
  not_allowed: { status: 'skipped', reason: 'not_allowed' },
  rejected: { status: 'skipped', reason: 'error' },
  error: { status: 'failed', reason: 'error' },
};

interface Planned {
  input: NotificationInput;
  row: NewDelivery;
  email: boolean;
  slack: boolean;
  whatsapp: boolean;
  template: string | null;
}

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger('NotificationDispatcher');
  private readonly senders = new Map<'slack' | 'whatsapp', RegisteredSender>();
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
    @Inject(NotificationDeliveriesService)
    private readonly deliveries: NotificationDeliveriesService,
    // PAS `MembersService` : il dépend lui-même du port de notifications (autorisations
    // changées) — l'injecter ici ferait un cycle qui BLOQUE le démarrage de Nest.
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(MailService) private readonly mail: MailService | null = null,
  ) {}

  /** Slack et WhatsApp s'enregistrent au démarrage (le module générique ne les importe pas). */
  registerSender(channel: 'slack' | 'whatsapp', sender: RegisteredSender): void {
    this.senders.set(channel, sender);
  }

  /** Attend les mises à jour du journal en cours (tests, arrêt). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async dispatch(inputs: NotificationInput[], opts: DispatchOptions): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.run(inputs, opts);
    } catch (err) {
      this.logger.warn(
        `Notifications non réparties (${inputs[0]!.kind}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async run(inputs: NotificationInput[], opts: DispatchOptions): Promise<void> {
    const organizationId = inputs[0]!.organizationId;
    const now = new Date();
    const [settings, org] = await Promise.all([
      this.settings.many(
        organizationId,
        inputs.map((i) => i.recipientUserId),
      ),
      this.settings.org(organizationId),
    ]);
    const mail = opts.mail === undefined ? this.mail : opts.mail;
    const slack = opts.slack === undefined ? (this.senders.get('slack') ?? null) : opts.slack;
    const whatsapp =
      opts.whatsapp === undefined ? (this.senders.get('whatsapp') ?? null) : opts.whatsapp;
    const waToday = new Map<string, number>();

    const planned: Planned[] = [];
    for (const input of inputs) {
      const spec = notificationSpecOf(input.kind);
      const s = settings.get(input.recipientUserId);
      if (!s) continue;
      if (input.actorUserId !== null && input.actorUserId === input.recipientUserId) {
        if (!s.notifyOwnActions) continue;
      }
      if (!spec) {
        // Annonce, test : la cloche seulement, comme avant.
        await this.ring(opts, input);
        continue;
      }
      const mode = NotificationSettingsService.modeFor(s, org, input.audience === 'project_lead');
      const ch = effectiveChannels({
        spec,
        mode,
        overrides: s.overrides[mode],
        mutedKinds: s.mutedKinds,
        mandatory: org.mandatory,
      });
      const row: NewDelivery = {
        organizationId,
        userId: input.recipientUserId,
        kind: input.kind,
        module: input.source.module,
        entityId: input.source.entityId,
        projectId: input.source.projectId ?? null,
        channels: {},
      };
      const off = (c: NotificationChannel): DeliveryOutcome => ({
        status: 'skipped',
        reason: !spec.channels.includes(c)
          ? 'not_permitted'
          : c === 'bell' && s.mutedKinds.includes(input.kind)
            ? 'muted'
            : 'channel_off',
      });
      // 1. Cloche.
      let duplicate = false;
      if (ch.bell) {
        const outcome = await this.ring(opts, input);
        row.channels.bell = outcome;
        duplicate = outcome.reason === 'duplicate';
      } else {
        row.channels.bell = off('bell');
      }
      const p: Planned = {
        input,
        row,
        email: false,
        slack: false,
        whatsapp: false,
        template: null,
      };
      // 2. Canaux qui sortent de Lalanda.
      for (const c of ['email', 'slack', 'whatsapp'] as const) {
        if (!ch[c]) {
          row.channels[c] = off(c);
          continue;
        }
        if (duplicate) {
          row.channels[c] = { status: 'skipped', reason: 'duplicate' };
          continue;
        }
        if (
          spec.burst &&
          input.dedupeKey === undefined &&
          (await this.deliveries.recentlySent(
            organizationId,
            input.recipientUserId,
            input.kind,
            input.source.entityId,
            c,
            now,
          ))
        ) {
          row.channels[c] = { status: 'skipped', reason: 'grouped' };
          continue;
        }
        if (c === 'email') {
          if (!mail) {
            row.channels.email = { status: 'skipped', reason: 'mail_not_configured' };
            continue;
          }
          p.email = true;
          row.channels.email = { status: 'queued', reason: null };
          continue;
        }
        if (inQuietHours(s.quietHours, now)) {
          row.channels[c] = { status: 'skipped', reason: 'quiet_hours' };
          continue;
        }
        if (c === 'slack') {
          if (!slack) {
            row.channels.slack = { status: 'skipped', reason: 'slack_unavailable' };
            continue;
          }
          p.slack = true;
          row.channels.slack = { status: 'queued', reason: null };
          continue;
        }
        // WhatsApp.
        const template = spec.whatsappTemplate;
        if (!template || !isTemplateApproved(template)) {
          row.channels.whatsapp = { status: 'skipped', reason: 'template_unavailable' };
          continue;
        }
        if (!whatsapp) {
          row.channels.whatsapp = { status: 'skipped', reason: 'whatsapp_unavailable' };
          continue;
        }
        const count =
          waToday.get(input.recipientUserId) ??
          (await this.deliveries.whatsappToday(organizationId, input.recipientUserId, now));
        if (count >= org.whatsappDailyCap) {
          row.channels.whatsapp = { status: 'skipped', reason: 'daily_cap' };
          continue;
        }
        waToday.set(input.recipientUserId, count + 1);
        p.whatsapp = true;
        p.template = template;
        row.channels.whatsapp = { status: 'queued', reason: null };
      }
      planned.push(p);
    }
    if (planned.length === 0) return;

    const ids = await this.deliveries.record(
      planned.map((p) => p.row),
      now,
    );
    const settle = (id: string | null, c: NotificationChannel, o: DeliveryOutcome): void => {
      const t = this.deliveries.settle(id, c, o);
      this.pending.add(t);
      void t.finally(() => this.pending.delete(t));
    };
    const report =
      (c: NotificationChannel): PushReport =>
      (m, o) =>
        settle(m.deliveryId ?? null, c, o);

    // 3. Slack et WhatsApp : non bloquants, groupés par projet (contexte du message).
    const byProject = (channel: 'slack' | 'whatsapp') => {
      const groups = new Map<string, PushMessage[]>();
      planned.forEach((p, i) => {
        if (!p[channel]) return;
        const spec = notificationSpecOf(p.input.kind)!;
        const projectId = p.input.source.projectId ?? '';
        const list = groups.get(projectId) ?? [];
        const event = workEventOf(p.input.kind);
        list.push({
          recipientUserId: p.input.recipientUserId,
          kind: p.input.kind,
          ...(event ? { event } : {}),
          ...(p.template ? { template: p.template } : {}),
          eventLabel: spec.label,
          title: p.input.title,
          href: p.input.href,
          deliveryId: ids[i] ?? null,
        });
        groups.set(projectId, list);
      });
      return groups;
    };
    for (const [port, channel] of [
      [whatsapp, 'whatsapp'],
      [slack, 'slack'],
    ] as const) {
      if (!port) continue;
      for (const [projectId, messages] of byProject(channel)) {
        try {
          port.direct(organizationId, projectId, messages, report(channel));
        } catch (err) {
          this.logger.warn(
            `Envoi ${channel} non lancé : ${err instanceof Error ? err.name : 'erreur'}`,
          );
          for (const m of messages) {
            settle(m.deliveryId ?? null, channel, { status: 'failed', reason: 'error' });
          }
        }
      }
    }

    // 4. E-mail : attendu, comme avant (ADR-0061).
    const emailTo = planned.map((p, i) => ({ p, id: ids[i] ?? null })).filter((x) => x.p.email);
    if (emailTo.length === 0 || !mail) return;
    const [who, orgName] = await Promise.all([
      this.identitiesOf(emailTo.map((x) => x.p.input.recipientUserId)),
      this.organizationName(organizationId),
    ]);
    for (const { p, id } of emailTo) {
      const to = who.get(p.input.recipientUserId)?.email;
      if (!to) {
        settle(id, 'email', { status: 'skipped', reason: 'no_email' });
        continue;
      }
      try {
        const res = await mail.sendWorkNotification({
          to,
          href: p.input.href,
          organizationName: orgName,
          title: p.input.title,
          eventLabel: notificationSpecOf(p.input.kind)!.label,
          preferencesPath: NOTIFICATION_SETTINGS_PATH,
        });
        settle(
          id,
          'email',
          res.delivered
            ? { status: 'sent', reason: null }
            : res.reason === 'MAIL_NOT_CONFIGURED'
              ? { status: 'skipped', reason: 'mail_not_configured' }
              : { status: 'failed', reason: 'provider_error' },
        );
      } catch (err) {
        this.logger.warn(
          `E-mail de notification non remis : ${err instanceof Error ? err.name : 'erreur'}`,
        );
        settle(id, 'email', { status: 'failed', reason: 'provider_error' });
      }
    }
  }

  private async ring(opts: DispatchOptions, input: NotificationInput): Promise<DeliveryOutcome> {
    try {
      const r = await opts.bell(input);
      return typeof r === 'string' && BELL_OUTCOMES[r]
        ? BELL_OUTCOMES[r]
        : { status: 'sent', reason: null };
    } catch (err) {
      this.logger.warn(
        `Notification ${input.kind} non remise : ${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: 'failed', reason: 'error' };
    }
  }

  /** Adresse et nom des personnes (collection `user`, lecture seule). */
  async identitiesOf(
    userIds: readonly string[],
  ): Promise<Map<string, { email: string | null; name: string | null }>> {
    const out = new Map<string, { email: string | null; name: string | null }>();
    const db = this.connection.db;
    const ids = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!db || ids.length === 0) return out;
    const docs = await db
      .collection('user')
      .find({ _id: { $in: ids } }, { projection: { email: 1, name: 1 } })
      .toArray();
    for (const d of docs) {
      out.set(String(d['_id']), {
        email: typeof d['email'] === 'string' ? d['email'] : null,
        name: typeof d['name'] === 'string' && d['name'].trim() !== '' ? d['name'] : null,
      });
    }
    return out;
  }

  async organizationName(organizationId: string): Promise<string> {
    if (!Types.ObjectId.isValid(organizationId)) return 'Lalanda';
    const doc = await this.connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } });
    return doc ? String(doc['name'] ?? 'Lalanda') : 'Lalanda';
  }

  // ── État des canaux et tests (§ 6) ───────────────────────────────────────

  async channels(organizationId: string, userId: string): Promise<NotificationChannelsView> {
    const now = new Date();
    const [who, org, waCount] = await Promise.all([
      this.identitiesOf([userId]),
      this.settings.org(organizationId),
      this.deliveries.whatsappToday(organizationId, userId, now),
    ]);
    const email = who.get(userId)?.email ?? null;
    const statusOf = async (c: 'slack' | 'whatsapp'): Promise<NotificationChannelStatus> => {
      const sender = this.senders.get(c);
      if (!sender?.channelStatus) {
        return {
          channel: c,
          ready: false,
          reason: c === 'slack' ? 'slack_unavailable' : 'whatsapp_unavailable',
          detail: null,
        };
      }
      try {
        return { channel: c, ...(await sender.channelStatus(organizationId, userId)) };
      } catch {
        return { channel: c, ready: false, reason: 'error', detail: null };
      }
    };
    const [slack, whatsapp] = await Promise.all([statusOf('slack'), statusOf('whatsapp')]);
    return {
      channels: [
        { channel: 'bell', ready: true, reason: null, detail: null },
        {
          channel: 'email',
          ready: email !== null && this.mail !== null,
          reason: email === null ? 'no_email' : this.mail === null ? 'mail_not_configured' : null,
          detail: email ? maskEmail(email) : null,
        },
        slack,
        whatsapp,
      ],
      whatsappKinds: CONFIGURABLE_NOTIFICATION_KINDS.filter((k) => {
        const spec = notificationSpecOf(k)!;
        return (
          spec.channels.includes('whatsapp') &&
          !!spec.whatsappTemplate &&
          isTemplateApproved(spec.whatsappTemplate)
        );
      }),
      whatsappDailyCap: org.whatsappDailyCap,
      whatsappSentToday: waCount,
    };
  }

  /**
   * « M'envoyer un test » (§ 6) : un message réel sur le canal choisi, journalisé
   * (`test: true`). Les heures calmes ne s'appliquent pas (geste explicite) ; le plafond
   * quotidien WhatsApp, si. Attend le sort de Slack et WhatsApp 20 s au plus.
   */
  async sendTest(
    organizationId: string,
    userId: string,
    channel: NotificationChannel,
    bell: (input: NotificationInput) => Promise<unknown>,
  ): Promise<NotificationTestView> {
    const now = new Date();
    const at = () => new Date().toISOString();
    const input: NotificationInput = {
      organizationId,
      recipientUserId: userId,
      kind: 'organization.notification_test',
      requiredAction: 'analytics.read',
      source: { module: 'organization', entityType: 'membership', entityId: userId },
      title: 'Notification de test : ce canal fonctionne',
      href: NOTIFICATION_SETTINGS_PATH,
      actorUserId: null,
    };
    let outcome: DeliveryOutcome;
    if (channel === 'bell') {
      outcome = await this.ring({ bell }, input);
    } else if (channel === 'email') {
      const to = (await this.identitiesOf([userId])).get(userId)?.email;
      if (!to) outcome = { status: 'skipped', reason: 'no_email' };
      else if (!this.mail) outcome = { status: 'skipped', reason: 'mail_not_configured' };
      else {
        try {
          const res = await this.mail.sendWorkNotification({
            to,
            href: NOTIFICATION_SETTINGS_PATH,
            organizationName: await this.organizationName(organizationId),
            title: input.title,
            eventLabel: 'Test de vos notifications',
            preferencesPath: NOTIFICATION_SETTINGS_PATH,
          });
          outcome = res.delivered
            ? { status: 'sent', reason: null }
            : { status: 'failed', reason: 'provider_error' };
        } catch {
          outcome = { status: 'failed', reason: 'provider_error' };
        }
      }
    } else {
      const sender = this.senders.get(channel);
      const org = await this.settings.org(organizationId);
      if (!sender) {
        outcome = {
          status: 'skipped',
          reason: channel === 'slack' ? 'slack_unavailable' : 'whatsapp_unavailable',
        };
      } else if (
        channel === 'whatsapp' &&
        (await this.deliveries.whatsappToday(organizationId, userId, now)) >= org.whatsappDailyCap
      ) {
        outcome = { status: 'skipped', reason: 'daily_cap' };
      } else {
        outcome = await new Promise<DeliveryOutcome>((resolve) => {
          const timer = setTimeout(() => resolve({ status: 'queued', reason: null }), 20_000);
          try {
            sender.direct(
              organizationId,
              '',
              [
                {
                  recipientUserId: userId,
                  kind: 'organization.notification_test',
                  template: 'lalanda_notification_projet',
                  eventLabel: 'Test de vos notifications',
                  title: input.title,
                  href: NOTIFICATION_SETTINGS_PATH,
                },
              ],
              (_m, o) => {
                clearTimeout(timer);
                resolve(o);
              },
            );
          } catch {
            clearTimeout(timer);
            resolve({ status: 'failed', reason: 'error' });
          }
        });
      }
    }
    await this.deliveries.record(
      [
        {
          organizationId,
          userId,
          kind: 'organization.notification_test',
          module: 'organization',
          entityId: userId,
          projectId: null,
          channels: { [channel]: outcome },
          test: true,
        },
      ],
      now,
    );
    return { channel, outcome: { ...outcome, at: at() } };
  }
}

/** `gracy@exemple.cd` → `g***@exemple.cd`. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  return `${user[0]}***@${domain}`;
}
