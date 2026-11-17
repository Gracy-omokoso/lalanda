// Émission des notifications du module « work » — ADR-0039 § 6.6.
//
// Passe TOUJOURS par le port `NOTIFICATIONS_PORT` (module générique, lot L2),
// injecté en facultatif avec repli `noNotifications` : tant que le module de
// notifications n'est pas chargé, rien n'est émis et rien ne casse.
//
// Appelé HORS de la transaction métier, après l'écriture : une notification
// perdue ne défait jamais une assignation ni un commentaire. Les erreurs sont
// journalisées et avalées. L'auteur d'un geste n'est jamais notifié de son
// propre geste (vérifié ici, et de nouveau par le port).

import {
  NOTIFICATION_LIMITS,
  type NotificationAudience,
  type NotificationKind,
} from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { can, type Action } from '../authz/permissions.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.js';
import { NotificationSettingsService } from '../notifications/notification-settings.service.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import {
  NOTIFICATIONS_BELL_PORT,
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';
import { SLACK_NOTIFIER, type SlackNotifierPort } from '../slack/slack-notifier.service.js';
import {
  WHATSAPP_NOTIFIER,
  type WhatsAppNotifierPort,
} from '../whatsapp/whatsapp-notifier.service.js';
import { taskHref } from './work.common.js';
import { WorkAccessService } from './work-access.service.js';
import { WorkMembersService } from './work-members.service.js';

export interface TaskNotification {
  organizationId: string;
  recipients: readonly (string | null | undefined)[];
  kind: NotificationKind;
  projectId: string;
  taskId: string;
  title: string;
  actorUserId: string | null;
  /** Clé de déduplication (rappels) ; facultative pour les gestes. */
  dedupeKey?: string;
  /** ADR-0079 : relation des destinataires (le chef et l'adjoint sont reconnus seuls). */
  audience?: NotificationAudience;
}

/** Tâche assignée, retenue par un lot (import, création par l'IA). */
export interface BatchedAssignment {
  taskId: string;
  number: number;
  title: string;
}

/**
 * ADR-0066 § 5 (risque d'ADR-0062) : assignations d'un même geste de masse (import d'un
 * fichier, projet construit avec l'IA), retenues PAR PERSONNE pendant l'écriture puis
 * remises en une fois (`WorkNotifier.flushAssignments`) — et seulement si le plan entier
 * a été écrit : une création compensée n'envoie rien. Les gestes unitaires ne passent
 * jamais par ici.
 */
export class WorkAssignmentBatch {
  private readonly byUser = new Map<string, BatchedAssignment[]>();

  add(assigneeUserId: string, task: BatchedAssignment): void {
    const list = this.byUser.get(assigneeUserId) ?? [];
    list.push(task);
    this.byUser.set(assigneeUserId, list);
  }

  /** Personnes et leurs tâches, dans l'ordre d'assignation. */
  entries(): [string, readonly BatchedAssignment[]][] {
    return [...this.byUser.entries()];
  }
}

/** « 12 tâches vous ont été assignées dans le projet X » (pur, testé). */
export function groupedAssignmentTitle(count: number, projectName: string): string {
  return `${count} tâches vous ont été assignées dans le projet ${projectName}`;
}

/** Titre borné à 200 caractères (figé à l'émission). */
export function boundedTitle(title: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

@Injectable()
export class WorkNotifier {
  private readonly logger = new Logger('WorkNotifier');

  /**
   * Port effectivement utilisé. Public et remplaçable : les tests de bout en bout
   * l'enveloppent pour observer les émissions sans dépendre du module L2.
   */
  port: NotificationsPort;

  constructor(
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
    @Inject(WorkAccessService) private readonly access: WorkAccessService,
    @Inject(WorkMembersService) private readonly members: WorkMembersService,
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(MailService) mail: MailService | null = null,
    @Optional() @Inject(SLACK_NOTIFIER) slack: SlackNotifierPort | null = null,
    @Optional() @Inject(WHATSAPP_NOTIFIER) whatsapp: WhatsAppNotifierPort | null = null,
    // ADR-0079 : cloche seule (le répartiteur s'occupe des autres canaux).
    @Optional() @Inject(NOTIFICATIONS_BELL_PORT) bell: NotificationsPort | null = null,
    @Optional()
    @Inject(NotificationDispatcher)
    private readonly dispatcher: NotificationDispatcher | null = null,
    @Optional()
    @Inject(NotificationSettingsService)
    private readonly settings: NotificationSettingsService | null = null,
  ) {
    this.port = bell ?? port ?? noNotifications;
    this.mail = mail;
    this.slack = slack;
    this.whatsapp = whatsapp;
  }

  /**
   * ADR-0065 : envoi WhatsApp, NON BLOQUANT (le port rend la main aussitôt). Facultatif :
   * sans module WhatsApp, rien ne part. Remplaçable par les tests.
   */
  whatsapp: WhatsAppNotifierPort | null;

  /**
   * ADR-0064 : envoi Slack, NON BLOQUANT (le port rend la main aussitôt). Facultatif :
   * sans module Slack, rien ne part. Remplaçable par les tests.
   */
  slack: SlackNotifierPort | null;

  /** Remplaçable par les tests (aucun envoi réel : transport de test). */
  mail: MailService | null;

  /**
   * ADR-0079 § 4 : remet les notifications par le répartiteur commun — mode et réglages de
   * chaque destinataire, obligations de l'organisation, garde-fous, journal d'envoi. La
   * cloche passe par `this.port` (enveloppé par les tests) ; l'e-mail, Slack et WhatsApp
   * par les champs ci-dessus (remplaçables par les tests). Le chef et l'adjoint du projet
   * sont reconnus (`audience: project_lead`) : leur mode par défaut est celui du chef.
   */
  private async deliver(inputs: NotificationInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      const leads = new Map<string, string[]>();
      for (const i of inputs) {
        const p = i.source.projectId;
        if (p && !leads.has(p)) leads.set(p, await this.leads(i.organizationId, p));
      }
      const marked = inputs.map((i) =>
        i.source.projectId && leads.get(i.source.projectId)?.includes(i.recipientUserId)
          ? { ...i, audience: 'project_lead' as const }
          : i,
      );
      if (!this.dispatcher) {
        for (const i of marked) await this.port.notify(i);
        return;
      }
      await this.dispatcher.dispatch(marked, {
        bell: (i) => this.port.notify(i),
        mail: this.mail,
        slack: this.slack,
        whatsapp: this.whatsapp,
      });
    } catch (err) {
      this.warn(inputs[0]!, err);
    }
  }

  /** ADR-0076 : chef et adjoint d'un projet (lecture seule, scopée). */
  async leads(organizationId: string, projectId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(projectId)) return [];
    const doc = await this.connection
      .collection('work_projects')
      .findOne(
        { _id: new Types.ObjectId(projectId), organizationId },
        { projection: { ownerUserId: 1, deputyUserId: 1 } },
      );
    if (!doc) return [];
    return [doc['ownerUserId'], doc['deputyUserId']].filter(
      (u): u is string => typeof u === 'string' && u !== '',
    );
  }

  /** Membres qui détiennent EFFECTIVEMENT une action (rôle, ajouts, retraits). */
  async holdersOf(organizationId: string, action: Action): Promise<string[]> {
    const perms = await this.members.permissions(organizationId);
    return [...perms.entries()].filter(([, m]) => can(m.role, action, m.context)).map(([u]) => u);
  }

  private warn(input: NotificationInput, err: unknown): void {
    this.logger.warn(
      `Notification ${input.kind} non remise (organisation ${input.organizationId}) : ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  /**
   * ADR-0060 § 5 : destinataires qui VOIENT le projet. On n'écrit jamais à quelqu'un
   * au sujet d'un projet privé qu'il ne peut pas ouvrir (la lecture refiltre aussi).
   */
  async visibleRecipients(
    organizationId: string,
    projectId: string,
    recipients: readonly (string | null | undefined)[],
    actorUserId: string | null,
  ): Promise<string[]> {
    // ADR-0079 § 1 : l'auteur reste destinataire s'il a demandé à être notifié de ses
    // propres actions (désactivé par défaut).
    const keepActor =
      actorUserId !== null &&
      recipients.includes(actorUserId) &&
      !!(await this.settings?.notifyOwnActions(organizationId, actorUserId).catch(() => false));
    const ids = [
      ...new Set(recipients.filter((r): r is string => !!r && (r !== actorUserId || keepActor))),
    ];
    if (ids.length === 0) return [];
    const perms = await this.members.permissions(organizationId, ids);
    const out: string[] = [];
    for (const id of ids) {
      const m = perms.get(id);
      if (!m) continue;
      if (await this.access.userSees(organizationId, id, m.role, m.context, projectId)) {
        out.push(id);
      }
    }
    return out;
  }

  async taskEvent(n: TaskNotification): Promise<void> {
    const recipients = await this.visibleRecipients(
      n.organizationId,
      n.projectId,
      n.recipients,
      n.actorUserId,
    );
    await this.deliver(
      recipients.map((recipient) => ({
        organizationId: n.organizationId,
        recipientUserId: recipient,
        kind: n.kind,
        requiredAction: 'work.read' as const,
        source: {
          module: 'work' as const,
          entityType: 'task' as const,
          entityId: n.taskId,
          projectId: n.projectId,
        },
        title: boundedTitle(n.title),
        href: taskHref(n.projectId, n.taskId),
        actorUserId: n.actorUserId,
        ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        ...(n.audience ? { audience: n.audience } : {}),
      })),
    );
  }

  /**
   * ADR-0064 § 3 : événement publié dans le canal Slack du projet, s'il en a un. Une
   * fois par geste (pas par destinataire), titre à la troisième personne. Le module
   * Slack vérifie la connexion, le canal et la règle des projets privés. Jamais
   * d'exception remontée au geste.
   */
  channelEvent(n: {
    organizationId: string;
    projectId: string;
    eventLabel: string;
    title: string;
    href: string;
  }): void {
    if (!this.slack) return;
    try {
      this.slack.channel({ ...n, title: boundedTitle(n.title) });
    } catch (err) {
      this.logger.warn(
        `Événement Slack du projet non publié : ${err instanceof Error ? err.name : 'erreur'}`,
      );
    }
  }

  /**
   * ADR-0066 § 5 : remet les assignations d'un lot — par personne, UNE notification
   * (« 12 tâches vous ont été assignées dans le projet X ») sur chaque canal choisi
   * (cloche, e-mail, Slack, WhatsApp), et UN événement dans le canal Slack du projet. Une seule
   * tâche : la notification habituelle d'un geste unitaire. L'auteur n'est jamais
   * notifié de ses propres assignations (le canal du projet, lui, les voit).
   */
  async flushAssignments(n: {
    organizationId: string;
    projectId: string;
    projectName: string;
    batch: WorkAssignmentBatch;
    actorUserId: string;
  }): Promise<void> {
    const entries = n.batch.entries();
    if (entries.length === 0) return;
    const refs = await this.members.refs([n.actorUserId, ...entries.map(([u]) => u)]);
    const nameOf = (id: string) => WorkMembersService.refOf(refs, id).name;
    const actorName = nameOf(n.actorUserId);
    for (const [assignee, tasks] of entries) {
      const first = tasks[0]!;
      const single = tasks.length === 1;
      this.channelEvent({
        organizationId: n.organizationId,
        projectId: n.projectId,
        eventLabel: single ? 'Tâche assignée' : 'Tâches assignées',
        title: single
          ? `#${first.number} ${first.title} — assignée par ${actorName}`
          : `${tasks.length} tâches assignées à ${nameOf(assignee)} par ${actorName}`,
        href: single ? taskHref(n.projectId, first.taskId) : `/projets/${n.projectId}/liste`,
      });
      if (assignee === n.actorUserId) continue;
      if (single) {
        await this.taskEvent({
          organizationId: n.organizationId,
          recipients: [assignee],
          kind: 'work.task_assigned',
          projectId: n.projectId,
          taskId: first.taskId,
          title: `${actorName} vous a assigné #${first.number} ${first.title}`,
          actorUserId: n.actorUserId,
        });
      } else {
        await this.projectEvent({
          organizationId: n.organizationId,
          recipients: [assignee],
          kind: 'work.task_assigned',
          projectId: n.projectId,
          title: groupedAssignmentTitle(tasks.length, n.projectName),
          actorUserId: n.actorUserId,
          href: `/projets/${n.projectId}/liste`,
        });
      }
    }
  }

  /**
   * ADR-0079 § 3 : événement d'un membre hors projet (feuilles de temps). Destinataires :
   * membres qui détiennent `work.read` ; jamais l'auteur, sauf s'il l'a demandé.
   */
  async memberEvent(n: MemberNotification): Promise<void> {
    try {
      const keepActor =
        n.actorUserId !== null &&
        !!(await this.settings
          ?.notifyOwnActions(n.organizationId, n.actorUserId)
          .catch(() => false));
      const ids = [
        ...new Set(
          n.recipients.filter((r): r is string => !!r && (r !== n.actorUserId || keepActor)),
        ),
      ];
      if (ids.length === 0) return;
      const perms = await this.members.permissions(n.organizationId, ids);
      const recipients = ids.filter((id) => {
        const m = perms.get(id);
        return !!m && can(m.role, 'work.read', m.context);
      });
      await this.deliver(
        recipients.map((recipient) => ({
          organizationId: n.organizationId,
          recipientUserId: recipient,
          kind: n.kind,
          requiredAction: 'work.read' as const,
          source: { module: 'work' as const, entityType: n.entity.type, entityId: n.entity.id },
          title: boundedTitle(n.title),
          href: n.href,
          actorUserId: n.actorUserId,
          ...(n.audience ? { audience: n.audience } : {}),
        })),
      );
    } catch (err) {
      this.logger.warn(
        `Notification ${n.kind} non remise : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** ADR-0061 § 2 : événement de projet (ajouté au projet, projet à risque). */
  async projectEvent(n: ProjectNotification): Promise<void> {
    const recipients = await this.visibleRecipients(
      n.organizationId,
      n.projectId,
      n.recipients,
      n.actorUserId,
    );
    await this.deliver(
      recipients.map((recipient) => ({
        organizationId: n.organizationId,
        recipientUserId: recipient,
        kind: n.kind,
        requiredAction: 'work.read' as const,
        source: {
          module: 'work' as const,
          entityType: 'project' as const,
          entityId: n.projectId,
          projectId: n.projectId,
        },
        title: boundedTitle(n.title),
        href: n.href ?? `/projets/${n.projectId}`,
        actorUserId: n.actorUserId,
        ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
        ...(n.audience ? { audience: n.audience } : {}),
      })),
    );
  }
}

export interface ProjectNotification {
  organizationId: string;
  recipients: readonly (string | null | undefined)[];
  kind: NotificationKind;
  projectId: string;
  title: string;
  actorUserId: string | null;
  dedupeKey?: string;
  /** Lien relatif de l'application ; défaut : la page du projet. */
  href?: string;
  /** ADR-0079 : relation des destinataires. */
  audience?: NotificationAudience;
}

/** ADR-0079 § 3 : événement hors projet (feuille de temps), entre membres de l'organisation. */
export interface MemberNotification {
  organizationId: string;
  recipients: readonly (string | null | undefined)[];
  kind: NotificationKind;
  entity: { type: 'timesheet'; id: string };
  title: string;
  href: string;
  actorUserId: string | null;
  audience?: NotificationAudience;
}
