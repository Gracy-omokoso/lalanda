// File des heures calmes — ADR-0079 § 5.
//
// Pendant les heures calmes d'une personne, ses messages Slack et WhatsApp ne sont PAS
// perdus : ils entrent dans `notification_deferred` (journal : « différée ») et partent à
// la FIN des heures calmes (tâche `notifications.deferred-release`, toutes les 5 minutes) :
// un message seul tel quel, plusieurs regroupés en UN message (« 4 notifications pendant
// les heures calmes : … »), journal complété (« envoyée »). File bornée : 20 messages par
// personne et par canal ; au-delà, une ligne `overflow` les compte et ils rejoignent le
// message regroupé.

import {
  NOTIFICATION_SETTINGS_LIMITS,
  kinshasaHourOf,
  type QuietHours,
} from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';

import { SchedulerService } from '../scheduler/scheduler.service.js';
import {
  NotificationDeferredDoc,
  type NotificationDeferredDocument,
  type NotificationDeferredLean,
} from './notification-settings.schemas.js';

export const NOTIFICATIONS_DEFERRED_JOB = 'notifications.deferred-release';
export const NOTIFICATIONS_DEFERRED_EVERY_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Prochaine fin des heures calmes après `now` : l'heure `end` de Kinshasa (UTC+1), le
 * jour même si elle n'est pas encore passée, sinon le lendemain (pur, testé).
 */
export function quietEndAfter(q: QuietHours, now: Date): Date {
  const h = kinshasaHourOf(now);
  const startOfHourUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
  );
  const ahead = (q.end - h + 24) % 24 || 24;
  return new Date(startOfHourUtc + ahead * 3_600_000);
}

/** Titre du message regroupé (pur, testé), borné à 200 caractères. */
export function deferredGroupTitle(count: number, titles: readonly string[], max = 200): string {
  const t = `${count} notifications pendant les heures calmes : ${titles.join(' ; ')}`;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export interface DeferredInput {
  organizationId: string;
  userId: string;
  channel: 'slack' | 'whatsapp';
  kind: string;
  projectId: string;
  eventLabel: string;
  title: string;
  href: string;
  template: string | null;
  deliveryId: string | null;
  releaseAt: Date;
}

/** Un lot à libérer : une personne, un canal. */
export interface DeferredBatch {
  organizationId: string;
  userId: string;
  channel: 'slack' | 'whatsapp';
  items: NotificationDeferredLean[];
  /** Messages comptés au-delà de la borne (ligne `overflow`). */
  overflowCount: number;
  deliveryIds: string[];
}

export type DeferredReleaseHandler = (batch: DeferredBatch) => Promise<void>;

@Injectable()
export class NotificationDeferredService implements OnModuleInit {
  private readonly logger = new Logger('NotificationsDifférées');
  private handler: DeferredReleaseHandler | null = null;

  constructor(
    @InjectModel(NotificationDeferredDoc.name)
    private readonly queue: Model<NotificationDeferredDocument>,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(
      NOTIFICATIONS_DEFERRED_JOB,
      NOTIFICATIONS_DEFERRED_EVERY_MS,
      async (_p, ctx) => {
        await this.release(ctx.now);
      },
    );
  }

  /** Le répartiteur fournit l'envoi (il détient les expéditeurs Slack et WhatsApp). */
  setReleaseHandler(handler: DeferredReleaseHandler): void {
    this.handler = handler;
  }

  async enqueue(inputs: DeferredInput[], now: Date): Promise<void> {
    for (const i of inputs) {
      try {
        const waiting = await this.queue
          .countDocuments({
            organizationId: i.organizationId,
            userId: i.userId,
            channel: i.channel,
            overflow: false,
            releasedAt: null,
          })
          .exec();
        if (waiting < NOTIFICATION_SETTINGS_LIMITS.deferredPerUserMax) {
          await this.queue.create({
            ...i,
            overflow: false,
            overflowCount: 0,
            overflowDeliveryIds: [],
            claimedBy: null,
            releasedAt: null,
            expiresAt: null,
            createdAt: now,
            _schemaVersion: 1,
          });
          continue;
        }
        // Au-delà de la borne : compté dans une seule ligne, rejoint le message regroupé.
        await this.queue
          .updateOne(
            {
              organizationId: i.organizationId,
              userId: i.userId,
              channel: i.channel,
              overflow: true,
              releasedAt: null,
            },
            {
              $inc: { overflowCount: 1 },
              ...(i.deliveryId
                ? { $push: { overflowDeliveryIds: { $each: [i.deliveryId], $slice: -500 } } }
                : {}),
              $min: { releaseAt: i.releaseAt },
              $setOnInsert: {
                organizationId: i.organizationId,
                userId: i.userId,
                channel: i.channel,
                overflow: true,
                kind: null,
                claimedBy: null,
                releasedAt: null,
                expiresAt: null,
                createdAt: now,
                _schemaVersion: 1,
              },
            },
            { upsert: true },
          )
          .exec();
      } catch (err) {
        this.logger.warn(
          `Message différé non mis en file : ${err instanceof Error ? err.name : 'erreur'}`,
        );
      }
    }
  }

  /** Libère ce qui est dû (une personne et un canal à la fois). Rend le nombre de lots. */
  async release(now: Date): Promise<number> {
    const due = await this.queue
      .find({ releasedAt: null, claimedBy: null, releaseAt: { $lte: now } })
      .limit(1000)
      .lean<NotificationDeferredLean[]>()
      .exec();
    const keys = new Map<string, { organizationId: string; userId: string; channel: string }>();
    for (const d of due) {
      keys.set(`${d.organizationId}|${d.userId}|${d.channel}`, {
        organizationId: d.organizationId,
        userId: d.userId,
        channel: d.channel,
      });
    }
    let batches = 0;
    for (const k of keys.values()) {
      const runId = randomBytes(8).toString('hex');
      // Réclamer d'abord : deux passages concurrents n'envoient jamais deux fois.
      await this.queue
        .updateMany(
          { ...k, releasedAt: null, claimedBy: null, releaseAt: { $lte: now } },
          { $set: { claimedBy: runId } },
        )
        .exec();
      const items = await this.queue
        .find({ ...k, claimedBy: runId })
        .sort({ createdAt: 1, _id: 1 })
        .lean<NotificationDeferredLean[]>()
        .exec();
      if (items.length === 0) continue;
      const plain = items.filter((i) => !i.overflow);
      const overflowCount = items.reduce((s, i) => s + (i.overflow ? i.overflowCount : 0), 0);
      const deliveryIds = [
        ...plain.map((i) => i.deliveryId).filter((d): d is string => !!d),
        ...items.flatMap((i) => (i.overflow ? i.overflowDeliveryIds : [])),
      ];
      try {
        await this.handler?.({
          organizationId: k.organizationId,
          userId: k.userId,
          channel: k.channel as 'slack' | 'whatsapp',
          items: plain,
          overflowCount,
          deliveryIds,
        });
      } catch (err) {
        this.logger.warn(`Lot différé non envoyé : ${err instanceof Error ? err.name : 'erreur'}`);
      }
      await this.queue
        .updateMany(
          { claimedBy: runId },
          { $set: { releasedAt: now, expiresAt: new Date(now.getTime() + 7 * DAY_MS) } },
        )
        .exec();
      batches += 1;
    }
    return batches;
  }
}
