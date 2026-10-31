// Tâche `assets.reminders` — rappels des équipements (ADR-0046 § 3.3, § 3.4, § 6.7 ;
// critère 13). ADR-0046 — S5.
//
// Motif de `hr.reminders` : toutes les heures à partir de 7 h à Kinshasa. Échéances
// calculées par le MOTEUR (`assetDeadlines`) sous les délais des réglages :
//   - `assets.maintenance_due` : intervention planifiée en retard ou due bientôt ;
//   - `assets.coverage_expiring` : garantie, assurance ou contrat qui expire ou a expiré.
// Destinataires : détenteurs EFFECTIFS de `assets.manage` (`holdersFilter`), jamais par
// rôle ; refiltrés à la lecture par `assets.read`. UNE notification par échéance :
// réclamation sous index unique (`asset_reminder_claims`) puis `dedupeKey` identique au
// port. Aucun titre ne porte un coût ni une valeur. Le constat
// `ASSET_HELD_BY_FORMER_EMPLOYEE` relève du brief (R17, lot S7) : pas de notification ici.

import { NOTIFICATION_LIMITS, type NotificationKind } from '@lalanda/shared/notifications';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { holdersFilter } from '../../authz/authz.service.js';
import {
  NOTIFICATIONS_PORT,
  noNotifications,
  type NotificationsPort,
} from '../../notifications/notifications.port.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { assetsToday } from '../assets-common.js';
import { AssetReminderClaim, type AssetReminderClaimDocument } from '../assets.schemas.js';
import { AssetsService } from '../registry/assets.service.js';

export const ASSETS_REMINDERS_JOB = 'assets.reminders';
export const ASSETS_REMINDERS_EVERY_MS = 60 * 60_000;
export const ASSETS_REMINDERS_HOUR = 7;

export interface AssetsRemindersReport {
  organizations: number;
  claimed: number;
  notified: number;
}

function kinshasaHour(now: Date): number {
  return new Date(now.getTime() + 3_600_000).getUTCHours();
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

function clip(raw: string): string {
  const max = NOTIFICATION_LIMITS.titleMax;
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

const COVERAGE_LABEL: Record<string, string> = {
  warranty: 'Garantie',
  insurance: 'Assurance',
  service_contract: 'Contrat de service',
};

@Injectable()
export class AssetsRemindersJob implements OnModuleInit {
  private readonly logger = new Logger('EquipementsRappels');

  /** Port utilisé. Public et remplaçable : les tests e2e l'enveloppent pour observer. */
  port: NotificationsPort;

  constructor(
    @InjectModel(AssetReminderClaim.name)
    private readonly claims: Model<AssetReminderClaimDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AssetsService) private readonly assets: AssetsService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Optional() @Inject(NOTIFICATIONS_PORT) port: NotificationsPort | null,
  ) {
    this.port = port ?? noNotifications;
  }

  onModuleInit(): void {
    this.scheduler.every(ASSETS_REMINDERS_JOB, ASSETS_REMINDERS_EVERY_MS, async (_p, ctx) => {
      await this.run(ctx.now);
    });
  }

  async run(now: Date = new Date()): Promise<AssetsRemindersReport> {
    const report: AssetsRemindersReport = { organizations: 0, claimed: 0, notified: 0 };
    if (kinshasaHour(now) < ASSETS_REMINDERS_HOUR) return report;
    const today = assetsToday(now);
    const orgs = (await this.connection
      .collection('assets')
      .distinct('organizationId', { status: { $nin: ['disposed', 'lost'] } })) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        await this.runOrg(organizationId, today, now, report);
        report.organizations += 1;
      } catch (err) {
        this.logger.warn(
          `Rappels des équipements non émis (organisation ${organizationId}) : ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return report;
  }

  private async runOrg(
    organizationId: string,
    today: string,
    now: Date,
    report: AssetsRemindersReport,
  ): Promise<void> {
    const d = await this.assets.deadlinesOf(organizationId, today);
    const due = d.result.deadlines.filter((x) => x.kind !== 'held_by_former_employee');
    if (due.length === 0) return;
    const holders = await this.connection
      .collection('memberships')
      .find(holdersFilter(organizationId, 'assets.manage'), { projection: { userId: 1 } })
      .toArray();
    const recipients = [...new Set(holders.map((m) => String(m['userId'])).filter(Boolean))].sort();
    const coverageKinds = new Map<string, string>();
    const coverageIds = due
      .filter((x) => x.kind.startsWith('coverage') && x.refId)
      .map((x) => x.refId!);
    if (coverageIds.length > 0) {
      const rows = await this.connection
        .collection('asset_coverages')
        .find(
          { organizationId, _id: { $in: coverageIds.map((id) => new Types.ObjectId(id)) } },
          { projection: { kind: 1 } },
        )
        .toArray();
      for (const r of rows) coverageKinds.set(String(r['_id']), String(r['kind']));
    }

    for (const x of due) {
      const kind: NotificationKind = x.kind.startsWith('coverage')
        ? 'assets.coverage_expiring'
        : 'assets.maintenance_due';
      const dedupeKey = `${kind}:${x.dedupeKey}`.slice(0, NOTIFICATION_LIMITS.dedupeKeyMax);
      try {
        await this.claims.create({ organizationId, dedupeKey, claimedAt: now });
      } catch (err) {
        if (isDuplicateKey(err)) continue;
        throw err;
      }
      report.claimed += 1;
      const asset = d.assets.get(x.assetId);
      const label = asset ? `${asset.number} ${asset.name}` : 'Équipement';
      const title =
        kind === 'assets.coverage_expiring'
          ? `${COVERAGE_LABEL[coverageKinds.get(x.refId ?? '') ?? ''] ?? 'Couverture'} ${
              x.kind === 'coverage_expired' ? 'expirée le' : 'qui expire le'
            } ${x.date} : ${label}`
          : `Maintenance ${x.kind === 'maintenance_overdue' ? 'en retard depuis le' : 'prévue le'} ${
              x.date
            } : ${label}`;
      for (const userId of recipients) {
        try {
          await this.port.notify({
            organizationId,
            recipientUserId: userId,
            kind,
            requiredAction: 'assets.read',
            source: { module: 'assets', entityType: 'asset', entityId: x.assetId },
            title: clip(title),
            href: `/equipements/${x.assetId}`,
            actorUserId: null,
            dedupeKey,
          });
          report.notified += 1;
        } catch (err) {
          this.logger.warn(
            `Notification d’équipement non émise (organisation ${organizationId}) : ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }
}
