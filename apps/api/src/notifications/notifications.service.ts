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
  NOTIFICATION_SETTINGS_LIMITS,
  burstTitle,
  notificationSpecOf,
  type ListNotificationsQuery,
  type NotificationKind,
  type NotificationPageView,
  type NotificationPreferencesView,
  type NotificationView,
  type UnreadCountView,
  type UnreadElsewhereView,
} from '@lalanda/shared/notifications';

import {
  MEMBER_PERMISSIONS_PROJECTION,
  memberPermissionsOf,
  type MemberPermissions,
} from '../authz/authz.service.js';
import { can, type Action } from '../authz/permissions.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { Membership, type MembershipDocument } from '../organizations/membership.schema.js';
import { invalidCursor } from '../sales/sales.errors.js';
import {
  Notification,
  NotificationPreferences,
  type NotificationDocument,
  type NotificationPreferencesDocument,
} from './notification.schemas.js';
import { NotificationDispatcher } from './notification-dispatcher.js';
import { NotificationSettingsService } from './notification-settings.service.js';
import type { NotificationInput, NotificationsPort } from './notifications.port.js';
import { heldActions, knownKinds, rejectEmission, retentionDays } from './notifications.rules.js';

/**
 * Filtre de lecture d'un producteur (ADR-0060 § 5) : condition Mongo AJOUTÉE au
 * filtre du destinataire, ou `null`. Ne doit jamais élargir la lecture.
 */
export type NotificationReadFilter = (
  organizationId: string,
  userId: string,
  member: MemberPermissions,
) => Promise<Record<string, unknown> | null>;

/** Horloge injectable (tests). */
export const NOTIFICATIONS_CLOCK = Symbol('NOTIFICATIONS_CLOCK');
export type NotificationsClock = () => Date;

/** Résultat d'une émission — utile aux tests, ignoré par les producteurs. */
export type NotifyOutcome =
  | 'created'
  | 'grouped'
  | 'duplicate'
  | 'muted'
  | 'not_member'
  | 'not_allowed'
  | 'rejected'
  | 'error';

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
    ...(doc.groupCount && doc.groupCount > 1 ? { count: doc.groupCount } : {}),
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
    @Inject(NotificationDispatcher) private readonly dispatcher: NotificationDispatcher,
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
  ) {}

  // ── Port ─────────────────────────────────────────────────────────────────

  /**
   * ADR-0079 § 4 : répartit l'émission sur les canaux choisis par le destinataire (mode,
   * surcharges, obligations) — la cloche par `emit`, l'e-mail, Slack et WhatsApp par le
   * répartiteur, journal compris. Ne lève jamais.
   */
  async notify(input: NotificationInput): Promise<void> {
    await this.dispatcher.dispatch([input], { bell: (i) => this.emit(i) });
  }

  /**
   * CLOCHE seule, en rendant le sort de l'émission. Ne lève jamais. Respecte les types
   * coupés ; regroupe les rafales (§ 5) ; l'auteur n'est enregistré que s'il a demandé à
   * être notifié de ses propres actions (§ 1).
   */
  async emit(input: NotificationInput): Promise<NotifyOutcome> {
    try {
      const rejection = rejectEmission(input);
      if (rejection === 'self_notification') {
        const allowed = await this.settings
          .notifyOwnActions(input.organizationId, input.recipientUserId)
          .catch(() => false);
        if (!allowed) return 'rejected';
      } else if (rejection !== null) {
        this.logger.warn(`émission ignorée (${rejection}) : type ${String(input.kind)}`);
        return 'rejected';
      }
      const { organizationId, recipientUserId } = input;

      const member = await this.membershipOf(organizationId, recipientUserId);
      if (!member) return 'not_member';
      if (!can(member.role, input.requiredAction, member.context)) return 'not_allowed';

      const prefs = await this.preferencesModel
        .findOne({ organizationId, userId: recipientUserId })
        .lean();
      if (knownKinds(prefs?.mutedKinds).includes(input.kind)) return 'muted';

      const now = this.clock();
      if ((await this.groupBurst(input, now)) === 'grouped') return 'grouped';
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

  /**
   * ADR-0079 § 5 : rafale — une notification NON LUE du même type, sur le même objet,
   * créée il y a moins de 10 minutes absorbe la nouvelle (« 3 nouveaux commentaires —
   * … ») et garde une seule ligne (sa place dans la liste ne bouge pas). Seulement pour les types du
   * catalogue qui le prévoient, et jamais pour un rappel (`dedupeKey`).
   */
  private async groupBurst(input: NotificationInput, now: Date): Promise<'grouped' | null> {
    const spec = notificationSpecOf(input.kind);
    if (!spec?.burst || input.dedupeKey !== undefined) return null;
    const since = new Date(
      now.getTime() - NOTIFICATION_SETTINGS_LIMITS.burstWindowMinutes * 60_000,
    );
    const existing = await this.notifications
      .findOne({
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        kind: input.kind,
        'source.entityId': input.source.entityId,
        readAt: null,
        createdAt: { $gte: since },
      })
      .sort({ createdAt: -1 })
      .lean<Notification & { _id: Types.ObjectId }>();
    if (!existing) return null;
    const count = (existing.groupCount ?? 1) + 1;
    await this.notifications.updateOne(
      { _id: existing._id, readAt: null },
      {
        $set: {
          title: burstTitle(count, spec.burst.noun, input.title),
          href: input.href,
          actorUserId: input.actorUserId,
          groupCount: count,
          updatedAt: now,
        },
      },
    );
    return 'grouped';
  }

  // ── Lecture par le destinataire ──────────────────────────────────────────

  /**
   * ADR-0079 § 1 : notifications non lues des AUTRES organisations de l'appelant. La
   * cloche ne montre que l'organisation active : sans ce signal, un salarié qui a aussi
   * son organisation personnelle ne voit jamais rien venir de son équipe.
   */
  async unreadElsewhere(activeOrgId: string, userId: string): Promise<UnreadElsewhereView> {
    const memberships = await this.memberships
      .find({ userId, organizationId: { $ne: activeOrgId } }, { organizationId: 1 })
      .limit(20)
      .lean();
    const out: UnreadElsewhereView['organizations'] = [];
    for (const m of memberships) {
      const organizationId = String(m.organizationId);
      const base = await this.visibleFilter(organizationId, userId);
      if (!base) continue;
      const unread = await this.notifications.countDocuments({ ...base, readAt: null });
      if (unread > 0) {
        out.push({
          organizationId,
          name: await this.dispatcher.organizationName(organizationId),
          unread,
        });
      }
    }
    return { organizations: out };
  }

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

  /**
   * Titre et contexte EFFECTIF du membre (ADR-0041 § 9.4, A3) : droit de clôture,
   * ajouts et retraits. Un retrait de `requiredAction` masque la notification et
   * bloque son émission ; un ajout l'ouvre.
   */
  private async membershipOf(
    organizationId: string,
    userId: string,
  ): Promise<MemberPermissions | null> {
    const m = await this.memberships
      .findOne({ organizationId, userId }, MEMBER_PERMISSIONS_PROJECTION)
      .lean();
    return memberPermissionsOf(m) ?? null;
  }

  /**
   * Filtre des notifications VISIBLES par l'appelant : les siennes, dans
   * l'organisation active, dont il détient encore l'action requise. `null` s'il
   * n'est pas (ou plus) membre : rien n'est visible.
   */
  // ── ADR-0060 § 5 : filtres de lecture fournis par les producteurs ──────

  private readonly readFilters: NotificationReadFilter[] = [];

  /**
   * Un module producteur ajoute un filtre de lecture (ex. `work` : notifications des
   * projets privés que le destinataire ne voit plus). Le module de notifications ne
   * connaît toujours aucun producteur : il applique les filtres enregistrés, rien de plus.
   */
  registerReadFilter(filter: NotificationReadFilter): void {
    this.readFilters.push(filter);
  }

  private async visibleFilter(
    organizationId: string,
    userId: string,
  ): Promise<Record<string, unknown> | null> {
    const member = await this.membershipOf(organizationId, userId);
    if (!member) return null;
    const held: Action[] = heldActions(member.role, member.context);
    const extra: Record<string, unknown>[] = [];
    for (const f of this.readFilters) {
      const clause = await f(organizationId, userId, member);
      if (clause && Object.keys(clause).length > 0) extra.push(clause);
    }
    // `expiresAt` : le moniteur TTL de MongoDB passe toutes les 60 s environ ;
    // une ligne échue n'est plus servie, même avant sa suppression.
    return {
      organizationId,
      recipientUserId: userId,
      requiredAction: { $in: held },
      expiresAt: { $gt: this.clock() },
      ...(extra.length > 0 ? { $and: extra } : {}),
    };
  }
}
