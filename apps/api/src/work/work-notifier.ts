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

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { WORK_NOTIFICATION_EVENT_LABELS, workEventOf } from '@lalanda/shared/work';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { MailService } from '../mail/mail.service.js';
import { MembersService } from '../organizations/members.service.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { WorkNotificationPreferencesService } from './preferences/work-notification-preferences.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../notifications/notifications.port.js';
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
    @Inject(WorkNotificationPreferencesService)
    private readonly prefs: WorkNotificationPreferencesService,
    @Inject(MembersService) private readonly identities: MembersService,
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(MailService) mail: MailService | null = null,
  ) {
    this.port = port ?? noNotifications;
    this.mail = mail;
  }

  /** Remplaçable par les tests (aucun envoi réel : transport de test). */
  mail: MailService | null;

  /**
   * ADR-0061 § 2 : remet une notification selon les préférences du destinataire —
   * cloche (boîte commune, par le port) et/ou e-mail (service mail). Un type hors des
   * huit événements réglables part dans la cloche, comme avant.
   */
  private async deliver(inputs: NotificationInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const organizationId = inputs[0]!.organizationId;
    const prefs = await this.prefs.many(
      organizationId,
      inputs.map((i) => i.recipientUserId),
    );
    const emailTo: NotificationInput[] = [];
    for (const input of inputs) {
      const event = workEventOf(input.kind);
      const channels = event ? prefs.get(input.recipientUserId)?.events[event] : undefined;
      if (!channels || channels.bell) {
        try {
          await this.port.notify(input);
        } catch (err) {
          this.warn(input, err);
        }
      }
      if (event && channels?.email) emailTo.push(input);
    }
    if (emailTo.length === 0 || !this.mail) return;
    try {
      const [who, orgName] = await Promise.all([
        this.identities.identitiesOf(emailTo.map((i) => i.recipientUserId)),
        this.organizationName(organizationId),
      ]);
      for (const input of emailTo) {
        const to = who.get(input.recipientUserId)?.email;
        const event = workEventOf(input.kind);
        if (!to || !event) continue;
        await this.mail.sendWorkNotification({
          to,
          href: input.href,
          organizationName: orgName,
          title: input.title,
          eventLabel: WORK_NOTIFICATION_EVENT_LABELS[event],
        });
      }
    } catch (err) {
      this.warn(emailTo[0]!, err);
    }
  }

  private async organizationName(organizationId: string): Promise<string> {
    if (!Types.ObjectId.isValid(organizationId)) return 'Lalanda';
    const doc = await this.connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } });
    return doc ? String(doc['name'] ?? 'Lalanda') : 'Lalanda';
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
    const ids = [
      ...new Set(recipients.filter((r): r is string => !!r && r !== actorUserId)),
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
      })),
    );
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
        href: `/projets/${n.projectId}`,
        actorUserId: n.actorUserId,
        ...(n.dedupeKey ? { dedupeKey: n.dedupeKey } : {}),
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
}
