// Journal d'envoi des notifications — ADR-0079 § 6.
//
// Une ligne par (notification, destinataire) : le sort de CHAQUE canal (envoyée, en
// file, ignorée ou en échec) et pourquoi. Jamais le titre, le lien ni le contenu : un
// type, un module, des identifiants techniques, des motifs. Lu par la personne pour
// elle-même ; par l'administrateur pour l'organisation (avec le nom du destinataire).
// Conservation bornée : 90 jours (index TTL sur `expiresAt`).
//
// Sert aussi aux garde-fous : rafales (un envoi récent du même type sur le même objet),
// plafond quotidien WhatsApp (envois du jour de Kinshasa), « M'envoyer un test » (au
// plus 5 par heure).

import {
  NOTIFICATION_SETTINGS_LIMITS,
  type ListNotificationDeliveriesQuery,
  type NotificationChannel,
  type NotificationChannelOutcome,
  type NotificationDeliveriesPageView,
  type NotificationDeliveryStatus,
  type NotificationDeliveryView,
  type NotificationKind,
  type NotificationSkipReason,
} from '@lalanda/shared/notifications';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../crm/time-cursor.js';
import { invalidCursor } from '../sales/sales.errors.js';
import {
  NotificationDeliveryDoc,
  type NotificationDeliveryDocument,
  type NotificationDeliveryLean,
  type StoredChannelOutcome,
} from './notification-settings.schemas.js';

const DAY_MS = 86_400_000;

export interface DeliveryOutcome {
  status: NotificationDeliveryStatus;
  reason: NotificationSkipReason | null;
}

export interface NewDelivery {
  organizationId: string;
  userId: string;
  kind: NotificationKind;
  module: string;
  entityId: string | null;
  projectId: string | null;
  channels: Partial<Record<NotificationChannel, DeliveryOutcome>>;
  test?: boolean;
}

/** Début du jour de Kinshasa (UTC+1) qui contient `now`. */
export function kinshasaDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 3_600_000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 3_600_000,
  );
}

function outcomeView(o: StoredChannelOutcome): NotificationChannelOutcome {
  return {
    status: o.status as NotificationDeliveryStatus,
    reason: (o.reason ?? null) as NotificationSkipReason | null,
    at: o.at instanceof Date ? o.at.toISOString() : new Date(o.at).toISOString(),
  };
}

@Injectable()
export class NotificationDeliveriesService {
  private readonly logger = new Logger('NotificationDeliveries');

  constructor(
    @InjectModel(NotificationDeliveryDoc.name)
    private readonly deliveries: Model<NotificationDeliveryDocument>,
  ) {}

  /** Écrit les lignes ; rend leurs identifiants dans l'ordre. Ne lève jamais. */
  async record(rows: NewDelivery[], now = new Date()): Promise<(string | null)[]> {
    if (rows.length === 0) return [];
    try {
      const docs = await this.deliveries.insertMany(
        rows.map((r) => ({
          organizationId: r.organizationId,
          userId: r.userId,
          kind: r.kind,
          module: r.module,
          entityId: r.entityId,
          projectId: r.projectId,
          channels: Object.fromEntries(
            Object.entries(r.channels).map(([c, o]) => [
              c,
              { status: o!.status, reason: o!.reason, at: now },
            ]),
          ),
          test: r.test === true,
          createdAt: now,
          expiresAt: new Date(
            now.getTime() + NOTIFICATION_SETTINGS_LIMITS.deliveriesRetentionDays * DAY_MS,
          ),
          _schemaVersion: 1,
        })),
      );
      return docs.map((d) => String(d._id));
    } catch (err) {
      this.logger.warn(`journal d'envoi non écrit : ${err instanceof Error ? err.name : 'erreur'}`);
      return rows.map(() => null);
    }
  }

  /** Sort d'un canal connu plus tard (Slack, WhatsApp : envoi en tâche de fond). */
  async settle(
    deliveryId: string | null,
    channel: NotificationChannel,
    outcome: DeliveryOutcome,
  ): Promise<void> {
    if (!deliveryId || !Types.ObjectId.isValid(deliveryId)) return;
    try {
      await this.deliveries
        .updateOne(
          { _id: new Types.ObjectId(deliveryId) },
          {
            $set: {
              [`channels.${channel}`]: {
                status: outcome.status,
                reason: outcome.reason,
                at: new Date(),
              },
            },
          },
        )
        .exec();
    } catch (err) {
      this.logger.warn(`journal d'envoi non mis à jour : ${err instanceof Error ? err.name : 'erreur'}`);
    }
  }

  /** Un envoi récent (rafale) sur ce canal, pour ce type et cet objet ? */
  async recentlySent(
    organizationId: string,
    userId: string,
    kind: string,
    entityId: string | null,
    channel: NotificationChannel,
    now: Date,
  ): Promise<boolean> {
    if (!entityId) return false;
    const since = new Date(
      now.getTime() - NOTIFICATION_SETTINGS_LIMITS.burstWindowMinutes * 60_000,
    );
    const hit = await this.deliveries
      .exists({
        organizationId,
        userId,
        kind,
        entityId,
        createdAt: { $gte: since },
        [`channels.${channel}.status`]: { $in: ['sent', 'queued'] },
      })
      .exec();
    return hit !== null;
  }

  /** Messages WhatsApp partis (ou en file) aujourd'hui (Kinshasa) pour la personne. */
  async whatsappToday(organizationId: string, userId: string, now: Date): Promise<number> {
    return this.deliveries
      .countDocuments({
        organizationId,
        userId,
        createdAt: { $gte: kinshasaDayStart(now) },
        'channels.whatsapp.status': { $in: ['sent', 'queued'] },
      })
      .exec();
  }

  /** Tests demandés dans l'heure écoulée. */
  async testsLastHour(organizationId: string, userId: string, now: Date): Promise<number> {
    return this.deliveries
      .countDocuments({
        organizationId,
        userId,
        test: true,
        createdAt: { $gte: new Date(now.getTime() - 3_600_000) },
      })
      .exec();
  }

  async list(
    filter: { organizationId: string; userId?: string },
    query: ListNotificationDeliveriesQuery,
    names?: (ids: string[]) => Promise<Map<string, string>>,
  ): Promise<NotificationDeliveriesPageView> {
    let cursor: ReturnType<typeof decodeTimeCursor> = null;
    if (query.cursor !== undefined) {
      cursor = decodeTimeCursor(query.cursor);
      if (!cursor) invalidCursor();
    }
    const base: Record<string, unknown> = { organizationId: filter.organizationId };
    if (filter.userId) base['userId'] = filter.userId;
    if (query.channel) {
      base[`channels.${query.channel}`] = { $exists: true };
      if (query.status) base[`channels.${query.channel}.status`] = query.status;
    } else if (query.status) {
      base['$or'] = ['bell', 'email', 'slack', 'whatsapp'].map((c) => ({
        [`channels.${c}.status`]: query.status,
      }));
    }
    const conditions = cursor ? [base, beforeTimeCursor('createdAt', cursor)] : [base];
    const docs = await this.deliveries
      .find(conditions.length === 1 ? base : { $and: conditions })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<NotificationDeliveryLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const nameOf = names ? await names([...new Set(page.map((d) => d.userId))]) : null;
    const last = page[page.length - 1];
    return {
      items: page.map(
        (d): NotificationDeliveryView => ({
          id: String(d._id),
          kind: d.kind as NotificationKind,
          module: d.module as NotificationDeliveryView['module'],
          userId: d.userId,
          ...(nameOf ? { userName: nameOf.get(d.userId) ?? 'Ancien membre' } : {}),
          channels: Object.fromEntries(
            Object.entries(d.channels ?? {}).map(([c, o]) => [c, outcomeView(o)]),
          ),
          test: d.test === true,
          createdAt: d.createdAt.toISOString(),
        }),
      ),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(last.createdAt, String(last._id))
          : null,
    };
  }
}
