// Envoi des notifications des Projets vers Slack — ADR-0064 § 3 et § 5.
//
// Appelé par `WorkNotifier` APRÈS ses propres filtres : destinataires qui voient le
// projet, jamais l'auteur du geste, préférences « Slack » de chacun. Ce service n'en
// élargit aucun ; il ne fait que remettre.
//
// ── Non bloquant ─────────────────────────────────────────────────────────────
//
// `direct()` et `channel()` rendent la main IMMÉDIATEMENT : l'envoi part en tâche de
// fond, ses erreurs sont comptées et journalisées (code Slack seul), jamais remontées
// au geste de l'utilisateur. `flush()` attend les envois en cours — pour les tests et
// l'arrêt propre.
//
// ── Destinataires introuvables ───────────────────────────────────────────────
//
// Un membre Lalanda est retrouvé dans l'espace Slack par son ADRESSE
// (`users.lookupByEmail`), mise en cache par organisation (24 h trouvé, 6 h
// introuvable). Introuvable : rien ne part, rien n'est signalé à l'utilisateur, le
// compteur `unmatched` de la connexion augmente.

import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { webUrl } from '../mail/mail.links.js';
import { MembersService } from '../organizations/members.service.js';
import { SlackApi, SlackApiError } from './slack-api.js';
import {
  codeOf,
  emailKeyOf,
  SlackConnectionsService,
  type ActiveSlackConnection,
} from './slack-connections.service.js';
import { lalandaLink, slackWorkMessage } from './slack-messages.js';
import type { SlackProjectChannelLean, SlackUserLinkLean } from './slack.schemas.js';

export const SLACK_LINK_TTL_FOUND_MS = 24 * 3_600_000;
export const SLACK_LINK_TTL_MISSING_MS = 6 * 3_600_000;

export interface SlackDirectMessage {
  recipientUserId: string;
  /** Libellé de l'événement, à la première personne (« Une tâche m’est assignée »). */
  eventLabel: string;
  title: string;
  /** Chemin RELATIF dans l'application. */
  href: string;
}

export interface SlackChannelEvent {
  organizationId: string;
  projectId: string;
  /** Libellé à la troisième personne (« Tâche assignée », « Projet à risque »). */
  eventLabel: string;
  title: string;
  href: string;
}

/** Jeton d'injection facultatif côté `work` (le module Slack peut ne pas être chargé). */
export const SLACK_NOTIFIER = Symbol('SLACK_NOTIFIER');

export interface SlackNotifierPort {
  direct(organizationId: string, projectId: string, messages: SlackDirectMessage[]): void;
  channel(event: SlackChannelEvent): void;
}

@Injectable()
export class SlackNotifier implements SlackNotifierPort, OnApplicationShutdown {
  private readonly logger = new Logger('SlackNotifier');
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(SlackConnectionsService) private readonly connections: SlackConnectionsService,
    @Inject(SlackApi) private readonly api: SlackApi,
    @Inject(MembersService) private readonly members: MembersService,
    @InjectConnection() private readonly db: Connection,
  ) {}

  direct(organizationId: string, projectId: string, messages: SlackDirectMessage[]): void {
    if (messages.length === 0) return;
    this.track(this.sendDirect(organizationId, projectId, messages));
  }

  channel(event: SlackChannelEvent): void {
    this.track(this.sendChannel(event));
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
      this.logger.warn(`Envoi Slack interrompu : ${codeOf(err)}`);
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  // ── Messages privés ────────────────────────────────────────────────────────

  private async sendDirect(
    organizationId: string,
    projectId: string,
    messages: SlackDirectMessage[],
  ): Promise<void> {
    const active = await this.connections.active(organizationId);
    if (!active) return;
    const [context, who] = await Promise.all([
      this.context(organizationId, projectId),
      this.members.identitiesOf(messages.map((m) => m.recipientUserId)),
    ]);
    for (const m of messages) {
      const email = who.get(m.recipientUserId)?.email ?? null;
      try {
        const slackUserId = email ? await this.slackUserOf(active, m.recipientUserId, email) : null;
        if (!slackUserId) {
          await this.connections.count(organizationId, 'unmatched');
          continue;
        }
        const channel = await this.api.openDirectMessage(active.token, slackUserId);
        await this.api.postMessage(active.token, {
          channel,
          ...slackWorkMessage({
            eventLabel: m.eventLabel,
            title: m.title,
            projectName: context.projectName,
            organizationName: context.organizationName,
            url: lalandaLink(webUrl(), m.href),
          }),
        });
        await this.connections.count(organizationId, 'sent');
      } catch (err) {
        await this.connections.onError(organizationId, err);
        // Jeton mort : inutile d'insister pour les destinataires suivants.
        if (err instanceof SlackApiError && err.deadToken) return;
      }
    }
  }

  /** Identifiant Slack d'un membre — cache d'abord, `users.lookupByEmail` sinon. */
  private async slackUserOf(
    active: ActiveSlackConnection,
    userId: string,
    email: string,
  ): Promise<string | null> {
    const { organizationId, teamId } = active.connection;
    const emailKey = emailKeyOf(email);
    const cached = await this.connections.linkModel
      .findOne({ organizationId, userId })
      .lean<SlackUserLinkLean>()
      .exec();
    if (
      cached &&
      cached.teamId === teamId &&
      cached.emailKey === emailKey &&
      cached.expiresAt.getTime() > Date.now()
    ) {
      return cached.slackUserId;
    }
    const slackUserId = await this.api.lookupUserByEmail(active.token, email);
    const ttl = slackUserId ? SLACK_LINK_TTL_FOUND_MS : SLACK_LINK_TTL_MISSING_MS;
    await this.connections.linkModel
      .updateOne(
        { organizationId, userId },
        { $set: { teamId, emailKey, slackUserId, expiresAt: new Date(Date.now() + ttl) } },
        { upsert: true },
      )
      .exec();
    return slackUserId;
  }

  // ── Canal d'un projet ──────────────────────────────────────────────────────

  private async sendChannel(event: SlackChannelEvent): Promise<void> {
    const { organizationId, projectId } = event;
    const setting = await this.connections.channelModel
      .findOne({ organizationId, projectId })
      .lean<SlackProjectChannelLean>()
      .exec();
    if (!setting) return;
    const context = await this.context(organizationId, projectId);
    if (!context.projectFound) return;
    // Projet privé : jamais publié sans confirmation explicite (« tout le canal verra »).
    if (context.projectPrivate && !setting.privateConfirmed) return;
    const active = await this.connections.active(organizationId);
    if (!active) return;
    try {
      await this.api.postMessage(active.token, {
        channel: setting.channelId,
        ...slackWorkMessage({
          eventLabel: event.eventLabel,
          title: event.title,
          projectName: context.projectName,
          organizationName: context.organizationName,
          url: lalandaLink(webUrl(), event.href),
        }),
      });
      await this.connections.count(organizationId, 'sent');
    } catch (err) {
      await this.connections.onError(organizationId, err);
    }
  }

  /** Nom et visibilité du projet, nom de l'organisation — lecture seule, scopée. */
  private async context(
    organizationId: string,
    projectId: string,
  ): Promise<{
    projectFound: boolean;
    projectName: string | null;
    projectPrivate: boolean;
    organizationName: string;
  }> {
    const db = this.db.db;
    if (!db) {
      return { projectFound: false, projectName: null, projectPrivate: true, organizationName: '' };
    }
    const [project, org] = await Promise.all([
      Types.ObjectId.isValid(projectId)
        ? db
            .collection('work_projects')
            .findOne(
              { _id: new Types.ObjectId(projectId), organizationId },
              { projection: { name: 1, visibility: 1 } },
            )
        : null,
      Types.ObjectId.isValid(organizationId)
        ? db
            .collection('organizations')
            .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } })
        : null,
    ]);
    return {
      projectFound: project !== null,
      projectName: project ? String(project['name'] ?? '') || null : null,
      projectPrivate: project?.['visibility'] === 'private',
      organizationName: org ? String(org['name'] ?? 'Lalanda') : 'Lalanda',
    };
  }
}
