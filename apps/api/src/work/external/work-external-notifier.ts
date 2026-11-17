// Notifications VERS les comptes externes (contacts client, consultants) — ADR-0079 § 9.
//
// E-MAIL SEULEMENT (un externe n'a ni cloche, ni Slack, ni WhatsApp de l'organisation).
// Trois événements :
//
//   approval_requested  « Un livrable attend votre validation » — contacts client du projet ;
//   shared_comment      « Nouveau commentaire partagé » — externes qui VOIENT la tâche
//                       (client : tâche visible par le client ; consultant : ses tâches, ou
//                       toutes s'il « peut ouvrir le projet »), jamais l'auteur ;
//   access_opened       « Accès ouvert à un nouveau projet » — compte déjà actif ailleurs (le
//                       premier accès part par l'e-mail d'invitation d'ADR-0078).
//
// Préférence PAR COMPTE externe (`notificationPreference`) : `all` (défaut), `approvals`
// (les livrables à valider seulement), `none`. Chaque e-mail porte un lien de désinscription
// signé (`/portail/notifications?jeton=…`) qui ne règle QUE cela. Rafales (commentaires) :
// un e-mail sur la même tâche il y a moins de 10 minutes → rien ne repart (« regroupée »).
// Jamais de montant, de temps, de coût ni de nom interne ; l'adresse est masquée des
// journaux (`redactInLogs`). Ne lève jamais : une notification perdue ne défait aucun geste.

import { NOTIFICATION_SETTINGS_LIMITS } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { MailService } from '../../mail/mail.service.js';
import { externalPreferenceToken } from './work-external-crypto.js';
import {
  WorkExternalAccount,
  WorkExternalMembership,
  WorkExternalNotification,
  type WorkExternalAccountDocument,
  type WorkExternalAccountLean,
  type WorkExternalMembershipDocument,
  type WorkExternalMembershipLean,
  type WorkExternalNotificationDocument,
} from './work-external.schemas.js';

export type ExternalNotificationKind = 'approval_requested' | 'shared_comment' | 'access_opened';
export type ExternalNotificationPreference = 'all' | 'approvals' | 'none';

export const EXTERNAL_NOTIFICATION_LABELS: Readonly<Record<ExternalNotificationKind, string>> = {
  approval_requested: 'Un livrable attend votre validation',
  shared_comment: 'Nouveau commentaire sur une tâche de votre projet',
  access_opened: 'Un nouveau projet vous est ouvert',
};

/** La préférence laisse-t-elle partir ce genre d'e-mail ? (pur, testé) */
export function externalPreferenceAllows(
  pref: ExternalNotificationPreference | null | undefined,
  kind: ExternalNotificationKind,
): boolean {
  const p = pref ?? 'all';
  if (p === 'none') return false;
  if (p === 'approvals') return kind === 'approval_requested';
  return true;
}

/** Tâche telle que le notifier la lit (visibilité côté externe). */
export interface ExternalTaskRef {
  id: string;
  projectId: string;
  number: number;
  title: string;
  clientVisible?: boolean | null;
  consultantAssigneeId?: string | null;
  consultantCollaboratorIds?: readonly string[] | null;
}

const DAY_MS = 86_400_000;

@Injectable()
export class WorkExternalNotifier {
  private readonly logger = new Logger('WorkExternalNotifier');

  constructor(
    @InjectModel(WorkExternalAccount.name)
    private readonly accounts: Model<WorkExternalAccountDocument>,
    @InjectModel(WorkExternalMembership.name)
    private readonly memberships: Model<WorkExternalMembershipDocument>,
    @InjectModel(WorkExternalNotification.name)
    private readonly ledger: Model<WorkExternalNotificationDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Optional() @Inject(MailService) private readonly mail: MailService | null = null,
  ) {}

  /** Livrable mis en attente de validation : les contacts CLIENT du projet. */
  async approvalRequested(organizationId: string, task: ExternalTaskRef): Promise<void> {
    await this.safe(async () => {
      const rows = await this.openMembers(organizationId, task.projectId);
      const ids = rows.filter((r) => r.kind === 'client').map((r) => r.accountId);
      await this.send(organizationId, ids, 'approval_requested', task.projectId, task.id, task);
    });
  }

  /** Commentaire PARTAGÉ : les externes qui voient la tâche, sauf l'auteur. */
  async sharedComment(
    organizationId: string,
    task: ExternalTaskRef,
    authorId: string | null,
  ): Promise<void> {
    await this.safe(async () => {
      const rows = await this.openMembers(organizationId, task.projectId);
      const mine = new Set(
        [task.consultantAssigneeId, ...(task.consultantCollaboratorIds ?? [])].filter(
          (u): u is string => !!u,
        ),
      );
      const ids = rows
        .filter((r) => r.accountId !== authorId)
        .filter((r) =>
          r.kind === 'client'
            ? task.clientVisible === true
            : r.canOpenProject === true || mine.has(r.accountId),
        )
        .map((r) => r.accountId);
      await this.send(organizationId, ids, 'shared_comment', task.projectId, task.id, task);
    });
  }

  /** Nouvel accès d'un compte déjà actif sur un autre projet. */
  async accessOpened(organizationId: string, accountId: string, projectId: string): Promise<void> {
    await this.safe(() =>
      this.send(organizationId, [accountId], 'access_opened', projectId, projectId, null),
    );
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async safe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `Notification externe non envoyée : ${err instanceof Error ? err.name : 'erreur'}`,
      );
    }
  }

  private async openMembers(
    organizationId: string,
    projectId: string,
  ): Promise<WorkExternalMembershipLean[]> {
    return this.memberships
      .find({ organizationId, projectId, status: 'active' })
      .lean<WorkExternalMembershipLean[]>()
      .exec();
  }

  private async send(
    organizationId: string,
    accountIds: readonly string[],
    kind: ExternalNotificationKind,
    projectId: string,
    entityId: string,
    task: ExternalTaskRef | null,
  ): Promise<void> {
    const ids = [...new Set(accountIds)].filter((id) => Types.ObjectId.isValid(id));
    if (ids.length === 0 || !this.mail) return;
    const accounts = await this.accounts
      .find({
        organizationId,
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        status: 'active',
      })
      .lean<WorkExternalAccountLean[]>()
      .exec();
    if (accounts.length === 0) return;
    const [projectName, organizationName] = await Promise.all([
      this.projectName(organizationId, projectId),
      this.organizationName(organizationId),
    ]);
    const now = new Date();
    const since = new Date(
      now.getTime() - NOTIFICATION_SETTINGS_LIMITS.burstWindowMinutes * 60_000,
    );
    for (const a of accounts) {
      const accountId = String(a._id);
      let status: string;
      if (!externalPreferenceAllows(a.notificationPreference, kind)) {
        status = 'skipped:preference';
      } else if (
        // Rafales : seulement les commentaires (une nouvelle demande de validation, après
        // une décision du client, doit toujours partir).
        kind === 'shared_comment' &&
        (await this.ledger
          .exists({
            organizationId,
            accountId,
            kind,
            entityId,
            status: 'sent',
            createdAt: { $gte: since },
          })
          .exec()) !== null
      ) {
        status = 'skipped:grouped';
      } else {
        const res = await this.mail.sendExternalNotification({
          to: a.email,
          name: a.name,
          organizationName,
          projectName,
          eventLabel: EXTERNAL_NOTIFICATION_LABELS[kind],
          detail: task
            ? `#${task.number} ${task.title}`
            : 'vous pouvez le consulter dès maintenant.',
          portalPath: `/portail/projets/${projectId}`,
          preferencesPath: `/portail/notifications?jeton=${externalPreferenceToken(organizationId, accountId)}`,
        });
        status = res.delivered ? 'sent' : 'failed';
      }
      await this.ledger.create({
        organizationId,
        accountId,
        kind,
        entityId,
        status,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        _schemaVersion: 1,
      });
    }
  }

  private async projectName(organizationId: string, projectId: string): Promise<string> {
    if (!Types.ObjectId.isValid(projectId)) return 'Projet';
    const doc = await this.connection
      .collection('work_projects')
      .findOne({ _id: new Types.ObjectId(projectId), organizationId }, { projection: { name: 1 } });
    return doc ? String(doc['name'] ?? 'Projet') : 'Projet';
  }

  private async organizationName(organizationId: string): Promise<string> {
    if (!Types.ObjectId.isValid(organizationId)) return 'Lalanda';
    const doc = await this.connection
      .collection('organizations')
      .findOne({ _id: new Types.ObjectId(organizationId) }, { projection: { name: 1 } });
    return doc ? String(doc['name'] ?? 'Lalanda') : 'Lalanda';
  }

  // ── Préférence (lien signé ou session de l'espace externe) ───────────────

  async preferenceOf(
    organizationId: string,
    accountId: string,
  ): Promise<ExternalNotificationPreference | null> {
    if (!Types.ObjectId.isValid(accountId)) return null;
    const a = await this.accounts
      .findOne(
        { organizationId, _id: new Types.ObjectId(accountId) },
        { notificationPreference: 1 },
      )
      .lean<WorkExternalAccountLean>()
      .exec();
    return a ? (a.notificationPreference ?? 'all') : null;
  }

  async setPreference(
    organizationId: string,
    accountId: string,
    preference: ExternalNotificationPreference,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(accountId)) return false;
    const res = await this.accounts
      .updateOne(
        { organizationId, _id: new Types.ObjectId(accountId) },
        { $set: { notificationPreference: preference } },
      )
      .exec();
    return res.matchedCount === 1;
  }
}
