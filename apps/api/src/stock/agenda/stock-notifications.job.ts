// Tâche `stock.notifications` — la cloche des stocks (ADR-0046 § 6.7). ADR-0046 — S7.
//
// Les lots S3 et S4 n'émettent aucune notification : cette tâche, idempotente, LIT le
// cache des niveaux, les lignes « À traiter » et les inventaires, et émet les cinq
// types déclarés par S0 :
//   - `stock.below_reorder` : passage sous le seuil (moteur `replenishmentSuggestions`) ;
//   - `stock.negative` : niveau négatif constaté (O4) ;
//   UNE fois par article, emplacement (ou seuil global) et FRANCHISSEMENT : un état
//   (`stock_notification_states`, unique par organisation et clé) est réclamé à
//   l'entrée dans la situation et effacé à la sortie ; y revenir rouvre un épisode.
//   Destinataires : détenteurs EFFECTIFS de `stock.manage` et responsable de
//   l'emplacement.
//   - `stock.pending_lines` : nouvelles lignes « À traiter », regroupées, au plus une
//     notification par heure, aux détenteurs effectifs de `stock.move` ;
//   - `stock.count_assigned` : inventaire en comptage → ses compteurs (`stock.count`) ;
//   - `stock.count_submitted` : inventaire soumis → validateurs ÉLIGIBLES
//     (`stock.manage`, `stockCountDecision` : jamais un compteur, sauf approbateur unique).
// Chaque émission porte une `dedupeKey` (unique par destinataire, port des
// notifications) : rejouer la tâche ne crée aucun doublon. Aucun titre ne porte une
// valeur, un coût ni une quantité théorique. Refiltrées à la lecture par `stock.read`
// (`stock.count` pour l'assignation).

import { replenishmentSuggestions } from '@lalanda/engine';
import {
  NOTIFICATION_LIMITS,
  type NotificationEmission,
  type NotificationKind,
} from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Schema as MongooseSchema, type Connection, type Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import { stockCountDecision, type Action } from '../../authz/permissions.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { engineItem, qty3 } from '../stock.common.js';
import type { StockCountLean, StockItemLean } from '../stock.schemas.js';
import { countersOf } from './stock-agenda.source.js';

export const STOCK_NOTIFICATIONS_JOB = 'stock.notifications';
export const STOCK_NOTIFICATIONS_EVERY_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

// ── État des épisodes ────────────────────────────────────────────────────────

export class StockNotificationState {}
export type StockNotificationStateLean = {
  organizationId: string;
  key: string;
  since: Date;
  lastAt: Date | null;
};
export const StockNotificationStateSchema = new MongooseSchema(
  {
    organizationId: { type: String, required: true },
    key: { type: String, required: true },
    since: { type: Date, required: true },
    /** `pending` : instant de la plus récente ligne déjà signalée. */
    lastAt: { type: Date, default: null },
  },
  { collection: 'stock_notification_states', strict: true, minimize: false },
);
StockNotificationStateSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export interface StockNotificationsReport {
  organizations: number;
  notified: number;
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

function clip(raw: string, max: number = NOTIFICATION_LIMITS.titleMax): string {
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

@Injectable()
export class StockNotificationsJob implements OnModuleInit {
  private readonly logger = new Logger('StocksCloche');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(StockNotificationState.name)
    private readonly states: Model<StockNotificationStateLean>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  onModuleInit(): void {
    this.scheduler.every(STOCK_NOTIFICATIONS_JOB, STOCK_NOTIFICATIONS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<StockNotificationsReport> {
    const report: StockNotificationsReport = { organizations: 0, notified: 0 };
    const orgs = (await this.connection
      .collection('stock_settings')
      .distinct('organizationId')) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        await this.runOrg(organizationId, now, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Notifications des stocks non émises (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  /** Réclame un état ; `false` s'il existait déjà (épisode en cours ou déjà signalé). */
  private async claim(organizationId: string, key: string, now: Date): Promise<boolean> {
    try {
      await this.states.create({ organizationId, key, since: now, lastAt: null });
      return true;
    } catch (err) {
      if (isDuplicateKey(err)) return false;
      throw err;
    }
  }

  private async holders(organizationId: string, action: Action): Promise<string[]> {
    const rows = await this.connection
      .collection('memberships')
      .find(holdersFilter(organizationId, action), { projection: { userId: 1 } })
      .toArray();
    return [...new Set(rows.map((m) => String(m['userId'])).filter(Boolean))].sort();
  }

  private async emit(
    base: Omit<NotificationEmission<Action>, 'recipientUserId'>,
    recipients: readonly string[],
    report: StockNotificationsReport,
  ): Promise<void> {
    for (const recipientUserId of [...new Set(recipients)].sort()) {
      try {
        await this.port.notify({ ...base, recipientUserId });
        report.notified += 1;
      } catch (err) {
        this.logger.warn(
          `Notification des stocks non émise (organisation ${base.organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async runOrg(
    organizationId: string,
    now: Date,
    report: StockNotificationsReport,
  ): Promise<void> {
    await this.levelAlerts(organizationId, now, report);
    await this.pendingLines(organizationId, now, report);
    await this.counts(organizationId, now, report);
  }

  // ── Seuils et négatifs ───────────────────────────────────────────────────

  private async levelAlerts(
    organizationId: string,
    now: Date,
    report: StockNotificationsReport,
  ): Promise<void> {
    const [itemDocs, levelDocs, locationDocs] = await Promise.all([
      this.connection.collection('stock_items').find({ organizationId }).toArray(),
      this.connection
        .collection('stock_levels')
        .find({ organizationId }, { projection: { itemId: 1, locationId: 1, quantity: 1 } })
        .toArray(),
      this.connection
        .collection('stock_locations')
        .find({ organizationId }, { projection: { name: 1, responsibleUserId: 1 } })
        .toArray(),
    ]);
    const items = itemDocs as unknown as StockItemLean[];
    const byId = new Map(items.map((i) => [String(i._id), i]));
    const locations = new Map(
      locationDocs.map((l) => [
        String(l['_id']),
        { name: String(l['name']), responsible: (l['responsibleUserId'] as string | null) ?? null },
      ]),
    );
    const levels = levelDocs.map((l) => ({
      itemId: String(l['itemId']),
      locationId: String(l['locationId']),
      quantity: qty3(String(l['quantity'])),
    }));

    interface Alert {
      key: string;
      kind: NotificationKind;
      itemId: string;
      locationId: string | null;
    }
    const current: Alert[] = [];
    for (const l of levels) {
      const item = byId.get(l.itemId);
      if (!item || item.tracked === false || item.active === false) continue;
      if (l.quantity.startsWith('-')) {
        current.push({
          key: `negative:${l.itemId}:${l.locationId}`,
          kind: 'stock.negative',
          itemId: l.itemId,
          locationId: l.locationId,
        });
      }
    }
    for (const s of replenishmentSuggestions(levels, items.map(engineItem)).suggestions) {
      current.push({
        key: `below:${s.itemId}:${s.locationId ?? 'all'}`,
        kind: 'stock.below_reorder',
        itemId: s.itemId,
        locationId: s.locationId,
      });
    }

    // Fin d'épisode : la situation a cessé, l'état est effacé (un nouveau passage
    // sous le seuil sera signalé de nouveau).
    const keys = new Set(current.map((a) => a.key));
    await this.states
      .deleteMany({
        organizationId,
        key: { $regex: '^(below|negative):', $nin: [...keys] },
      })
      .exec();
    if (current.length === 0) return;

    const managers = await this.holders(organizationId, 'stock.manage');
    for (const a of current) {
      if (!(await this.claim(organizationId, a.key, now))) continue;
      const item = byId.get(a.itemId)!;
      const loc = a.locationId === null ? null : (locations.get(a.locationId) ?? null);
      const label = `${item.code ? `${item.code} ` : ''}${item.name}${loc ? ` — ${loc.name}` : ''}`;
      await this.emit(
        {
          organizationId,
          kind: a.kind,
          requiredAction: 'stock.read',
          source: { module: 'stock', entityType: 'stock_item', entityId: a.itemId },
          title: clip(
            a.kind === 'stock.negative' ? `Stock négatif : ${label}` : `Sous le seuil : ${label}`,
          ),
          href:
            a.kind === 'stock.negative'
              ? `/stocks/articles/${a.itemId}`
              : '/stocks/reapprovisionnement',
          actorUserId: null,
          dedupeKey: clip(`stock.${a.key}:${now.toISOString()}`, NOTIFICATION_LIMITS.dedupeKeyMax),
        },
        loc?.responsible ? [...managers, loc.responsible] : managers,
        report,
      );
    }
  }

  // ── « À traiter » ────────────────────────────────────────────────────────

  private async pendingLines(
    organizationId: string,
    now: Date,
    report: StockNotificationsReport,
  ): Promise<void> {
    const state = await this.states
      .findOne({ organizationId, key: 'pending' })
      .lean<StockNotificationStateLean>()
      .exec();
    // Au plus une notification par heure : les lignes arrivées entre-temps attendent.
    if (state && now.getTime() - new Date(state.since).getTime() < HOUR_MS) return;
    const filter: Record<string, unknown> = { organizationId, status: 'open' };
    if (state?.lastAt) filter['createdAt'] = { $gt: state.lastAt };
    const fresh = await this.connection
      .collection('stock_pending_lines')
      .find(filter, { projection: { createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    if (fresh.length === 0) return;
    const newest = fresh[0]!;
    const lastAt = new Date(newest['createdAt'] as Date);
    const bucket = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString();
    await this.states
      .updateOne(
        { organizationId, key: 'pending' },
        { $set: { since: now, lastAt }, $setOnInsert: { organizationId, key: 'pending' } },
        { upsert: true },
      )
      .exec();
    const n = fresh.length;
    await this.emit(
      {
        organizationId,
        kind: 'stock.pending_lines',
        requiredAction: 'stock.read',
        source: { module: 'stock', entityType: 'stock_item', entityId: String(newest['_id']) },
        title:
          n > 1
            ? `${n} nouvelles lignes « À traiter » dans le magasin`
            : '1 nouvelle ligne « À traiter » dans le magasin',
        href: '/stocks/a-traiter',
        actorUserId: null,
        dedupeKey: `stock.pending_lines:${bucket}`,
      },
      await this.holders(organizationId, 'stock.move'),
      report,
    );
  }

  // ── Inventaires ──────────────────────────────────────────────────────────

  private async counts(
    organizationId: string,
    now: Date,
    report: StockNotificationsReport,
  ): Promise<void> {
    const docs = (await this.connection
      .collection('stock_counts')
      .find(
        { organizationId, status: { $in: ['counting', 'submitted'] } },
        {
          projection: {
            number: 1,
            status: 1,
            assignees: 1,
            'lines.countedBy': 1,
            'lines.recounts.countedBy': 1,
            submission: 1,
          },
        },
      )
      .toArray()) as unknown as StockCountLean[];
    if (docs.length === 0) return;
    let managers: string[] | null = null;
    for (const c of docs) {
      const countId = String(c._id);
      if (c.status === 'counting') {
        const key = `count_assigned:${countId}`;
        if (c.assignees.length === 0 || !(await this.claim(organizationId, key, now))) continue;
        await this.emit(
          {
            organizationId,
            kind: 'stock.count_assigned',
            requiredAction: 'stock.count',
            source: { module: 'stock', entityType: 'stock_count', entityId: countId },
            title: clip(`Inventaire ${c.number} à compter`),
            href: `/stocks/inventaires/${countId}`,
            actorUserId: null,
            dedupeKey: `stock.${key}`,
          },
          c.assignees,
          report,
        );
        continue;
      }
      const at = c.submission?.at ? new Date(c.submission.at).toISOString() : 'soumis';
      const key = `count_submitted:${countId}:${at}`;
      if (!(await this.claim(organizationId, key, now))) continue;
      managers ??= await this.holders(organizationId, 'stock.manage');
      const counters = countersOf(c);
      const eligible = managers.filter(
        (userId) =>
          stockCountDecision({
            validatorUserId: userId,
            counterUserIds: counters,
            approverCountInOrg: managers!.length,
          }).ok,
      );
      await this.emit(
        {
          organizationId,
          kind: 'stock.count_submitted',
          requiredAction: 'stock.manage',
          source: { module: 'stock', entityType: 'stock_count', entityId: countId },
          title: clip(`Inventaire ${c.number} soumis : à valider`),
          href: `/stocks/inventaires/${countId}`,
          actorUserId: null,
          dedupeKey: clip(`stock.${key}`, NOTIFICATION_LIMITS.dedupeKeyMax),
        },
        eligible,
        report,
      );
    }
  }
}
