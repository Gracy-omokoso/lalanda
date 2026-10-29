// Boîte de notifications in-app (ADR-0039 O6, § 2.11, § 4) : implémentation du
// port `NOTIFICATIONS_PORT` et lecture par le destinataire.
//
// Ce service ne connaît AUCUN module producteur : il stocke, déduplique, sert et
// marque comme lu. Le contrat du port (en-tête de `notifications.port.ts`) est
// tenu ici :
//
// - `notify()` ne lève jamais : une émission irrecevable est journalisée et
//   ignorée, une panne de base aussi ;
// - auteur jamais notifié de son propre geste ; type coupé non enregistré ;
// - `dedupeKey` unique par (organisation, destinataire) — l'index partiel fait
//   foi, l'erreur E11000 d'une réémission est absorbée ;
// - destinataire membre de l'organisation et détenant `requiredAction` à
//   l'émission ; l'action est REVÉRIFIÉE à chaque lecture (liste, compteur,
//   marquage) par un filtre `requiredAction ∈ actions détenues`.
//
// Toutes les lectures sont bornées à (organisation active, appelant) : une
// notification d'un autre membre ou d'une autre organisation répond 404.

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import {
  type ListNotificationsQuery,
  type NotificationKind,
  type NotificationPageView,
  type NotificationPreferencesView,
  type NotificationView,
  type UnreadCountView,
} from '@lalanda/shared/notifications';

import { can, type Action, type OrgRole } from '../authz/permissions.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { invalidCursor } from '../sales/sales.errors.js';
import {
  Notification,
  NotificationPreferences,
  type NotificationDocument,
  type NotificationPreferencesDocument,
} from './notification.schemas.js';
import type { NotificationInput, NotificationsPort } from './notifications.port.js';
import { heldActions, knownKinds, rejectEmission, retentionDays } from './notifications.rules.js';

/** Horloge injectable (tests). */
export const NOTIFICATIONS_CLOCK = Symbol('NOTIFICATIONS_CLOCK');
export type NotificationsClock = () => Date;

/** Résultat d'une émission — utile aux tests, ignoré par les producteurs. */
export type NotifyOutcome =
  'created' | 'duplicate' | 'muted' | 'not_member' | 'not_allowed' | 'rejected' | 'error';

const DAY_MS = 86_400_000;

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function notificationNotFound(): never {
  throw new NotFoundException({
    code: 'NOTIFICATION_NOT_FOUND',
    message: 'Notification introuvable.',
  });
}

function toView(doc: Notification & { _id: Types.ObjectId }): NotificationView {
  return {
    id: String(doc._id),
    kind: doc.kind,
    source: {
      module: doc.source.module,
      entityType: doc.source.entityType,
      entityId: doc.source.entityId,
      ...(doc.source.projectId ? { projectId: doc.source.projectId } : {}),
    },
    title: doc.title,
    href: doc.href,
    actorUserId: doc.actorUserId ?? null,
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService implements NotificationsPort {
  private readonly logger = new Logger('Notifications');

  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<NotificationDocument>,
    @InjectModel(NotificationPreferences.name)
    private readonly preferencesModel: Model<NotificationPreferencesDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @Inject(NOTIFICATIONS_CLOCK) private readonly clock: NotificationsClock,
  ) {}

  // ── Port ─────────────────────────────────────────────────────────────────

  async notify(input: NotificationInput): Promise<void> {
    await this.emit(input);
  }

  /** Comme `notify`, en rendant le sort de l'émission. Ne lève jamais. */
  async emit(input: NotificationInput): Promise<NotifyOutcome> {
    try {
      const rejection = rejectEmission(input);
      if (rejection === 'self_notification') return 'rejected';
      if (rejection !== null) {
        this.logger.warn(`émission ignorée (${rejection}) : type ${String(input.kind)}`);
        return 'rejected';
      }
      const { organizationId, recipientUserId } = input;

      const member = await this.membershipOf(organizationId, recipientUserId);
      if (!member) return 'not_member';
      if (!can(member.role, input.requiredAction, member)) return 'not_allowed';

      const prefs = await this.preferencesModel
        .findOne({ organizationId, userId: recipientUserId })
        .lean();
      if (knownKinds(prefs?.mutedKinds).includes(input.kind)) return 'muted';

      const now = this.clock();
      try {
        await this.notifications.create({
          organizationId,
          recipientUserId,
          kind: input.kind,
          requiredAction: input.requiredAction,
          source: {
            module: input.source.module,
            entityType: input.source.entityType,
            entityId: input.source.entityId,
            ...(input.source.projectId ? { projectId: input.source.projectId } : {}),
          },
          title: input.title,
          href: input.href,
          actorUserId: input.actorUserId,
          ...(input.dedupeKey !== undefined ? { dedupeKey: input.dedupeKey } : {}),
          readAt: null,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + retentionDays() * DAY_MS),
          _schemaVersion: 1,
        });
      } catch (err) {
        if (isDuplicateKeyError(err)) return 'duplicate';
        throw err;
      }
      return 'created';
    } catch (err) {
      this.logger.error(
        `émission impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'error';
    }
  }

  // ── Lecture par le destinataire ──────────────────────────────────────────

  async list(
    organizationId: string,
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationPageView> {
    let cursor: ReturnType<typeof decodeTimeCursor> = null;
    if (query.cursor !== undefined) {
      cursor = decodeTimeCursor(query.cursor);
      if (!cursor) invalidCursor();
    }
    const base = await this.visibleFilter(organizationId, userId);
    if (!base) return { items: [], nextCursor: null };
    const filter: Record<string, unknown> = { ...base };
    if (query.unreadOnly) filter['readAt'] = null;
    const conditions = cursor ? [filter, beforeTimeCursor('createdAt', cursor)] : [filter];
    const docs = await this.notifications
      .find(conditions.length === 1 ? filter : { $and: conditions })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<(Notification & { _id: Types.ObjectId })[]>();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toView),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(last.createdAt, String(last._id))
          : null,
    };
  }

  async unreadCount(organizationId: string, userId: string): Promise<UnreadCountView> {
    const base = await this.visibleFilter(organizationId, userId);
    if (!base) return { unread: 0 };
    return { unread: await this.notifications.countDocuments({ ...base, readAt: null }) };
  }

  async markRead(
    organizationId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationView> {
    if (!Types.ObjectId.isValid(notificationId) || !/^[0-9a-f]{24}$/i.test(notificationId)) {
      notificationNotFound();
    }
    const base = await this.visibleFilter(organizationId, userId);
    if (!base) notificationNotFound();
    const _id = new Types.ObjectId(notificationId);
    const now = this.clock();
    // Premier marquage seulement : relire une notification lue garde sa date.
    await this.notifications.updateOne(
      { ...base, _id, readAt: null },
      { $set: { readAt: now, updatedAt: now } },
    );
    const doc = await this.notifications
      .findOne({ ...base, _id })
      .lean<Notification & { _id: Types.ObjectId }>();
    if (!doc) notificationNotFound();
    return toView(doc);
  }

  async markAllRead(organizationId: string, userId: string): Promise<UnreadCountView> {
    const base = await this.visibleFilter(organizationId, userId);
    if (!base) return { unread: 0 };
    const now = this.clock();
    await this.notifications.updateMany(
      { ...base, readAt: null },
      { $set: { readAt: now, updatedAt: now } },
    );
    return { unread: 0 };
  }

  // ── Préférences ──────────────────────────────────────────────────────────

  async preferences(organizationId: string, userId: string): Promise<NotificationPreferencesView> {
    const doc = await this.preferencesModel.findOne({ organizationId, userId }).lean();
    return { mutedKinds: knownKinds(doc?.mutedKinds) };
  }

  async setPreferences(
    organizationId: string,
    userId: string,
    mutedKinds: NotificationKind[],
  ): Promise<NotificationPreferencesView> {
    await this.preferencesModel.updateOne(
      { organizationId, userId },
      {
        $set: { mutedKinds: [...mutedKinds] },
        $setOnInsert: { organizationId, userId, _schemaVersion: 1 },
      },
      { upsert: true },
    );
    return this.preferences(organizationId, userId);
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  private async membershipOf(
    organizationId: string,
    userId: string,
  ): Promise<{ role: OrgRole; canClosePeriods: boolean } | null> {
    const m = await this.memberships
      .findOne({ organizationId, userId }, { role: 1, canClosePeriods: 1 })
      .lean();
    return m ? { role: m.role, canClosePeriods: m.canClosePeriods === true } : null;
  }

  /**
   * Filtre des notifications VISIBLES par l'appelant : les siennes, dans
   * l'organisation active, dont il détient encore l'action requise. `null` s'il
   * n'est pas (ou plus) membre : rien n'est visible.
   */
  private async visibleFilter(
    organizationId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const member = await this.membershipOf(organizationId, userId);
    if (!member) return null;
    const held: Action[] = heldActions(member.role, member);
    // `expiresAt` : le moniteur TTL de MongoDB passe toutes les 60 s environ ;
    // une ligne échue n'est plus servie, même avant sa suppression.
    return {
      organizationId,
      recipientUserId: userId,
      requiredAction: { $in: held },
      expiresAt: { $gt: this.clock() },
    };
  }
}
