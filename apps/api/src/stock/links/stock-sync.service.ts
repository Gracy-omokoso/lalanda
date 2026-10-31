// Rattrapages achats et ventes (ADR-0046 § 5.1, § 6.1, § 6.2). ADR-0046 — S4.
//
//   - `stock.purchase-sync` (toutes les 10 minutes) : relit les réceptions modifiées
//     depuis le point (recouvrement de 15 minutes) et rejoue `applyReception` — un appel
//     du port perdu (erreur avalée par R3, redémarrage) est rattrapé ;
//   - `stock.sales-sync` (toutes les 5 minutes) : relit les factures finales émises ou
//     normalisées depuis le point et crée les sorties (lecture seule des ventes) ;
//   - `POST /stock/sync` : les deux, à la demande, pour l'organisation active.
// Point initial : l'activation des stocks ; le point avance à l'instant de DÉBUT du
// passage (ce qui change pendant le passage est relu au suivant). Rien n'est écrit deux
// fois : index uniques `sourceKey` des mouvements et des lignes « À traiter ». Chaque
// passage ne lit que l'organisation traitée.

import { STOCK_VERSION } from '@lalanda/engine';
import type { StockSyncResponse, StockSyncSourceReport } from '@lalanda/shared/stock';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { StockReceptionApplier } from '../purchases/stock-reception-applier.js';
import { PurchaseFactsReader } from '../purchases/purchase-facts.reader.js';
import { StockSalesSyncService } from '../sales/stock-sales-sync.service.js';
import { StockSettings, type StockSettingsLean } from '../stock.schemas.js';
import {
  StockSyncCheckpoint,
  type StockSyncCheckpointLean,
  type StockSyncSource,
} from './stock-sync-checkpoint.schema.js';

export const STOCK_PURCHASE_SYNC_JOB = 'stock.purchase-sync';
export const STOCK_PURCHASE_SYNC_EVERY_MS = 10 * 60_000;
export const STOCK_SALES_SYNC_JOB = 'stock.sales-sync';
export const STOCK_SALES_SYNC_EVERY_MS = 5 * 60_000;
/** Recouvrement des relectures (§ 6.1) : absorbe les horloges et les écritures en vol. */
export const STOCK_SYNC_OVERLAP_MS = 15 * 60_000;

const EMPTY = (): StockSyncSourceReport => ({ read: 0, written: 0, pending: 0 });

@Injectable()
export class StockSyncService implements OnModuleInit {
  private readonly logger = new Logger('StockSync');
  private readonly purchases: PurchaseFactsReader;

  constructor(
    @InjectConnection() connection: Connection,
    @InjectModel(StockSettings.name) private readonly settings: Model<StockSettingsLean>,
    @InjectModel(StockSyncCheckpoint.name)
    private readonly checkpoints: Model<StockSyncCheckpointLean>,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(StockReceptionApplier) private readonly receptions: StockReceptionApplier,
    @Inject(StockSalesSyncService) private readonly sales: StockSalesSyncService,
  ) {
    this.purchases = new PurchaseFactsReader(connection);
  }

  onModuleInit(): void {
    this.scheduler.every(STOCK_PURCHASE_SYNC_JOB, STOCK_PURCHASE_SYNC_EVERY_MS, async () => {
      await this.runAll('purchases');
    });
    this.scheduler.every(STOCK_SALES_SYNC_JOB, STOCK_SALES_SYNC_EVERY_MS, async () => {
      await this.runAll('sales');
    });
  }

  /** Passage d'une tâche : chaque organisation dont les stocks sont activés. */
  async runAll(source: StockSyncSource): Promise<StockSyncSourceReport> {
    const total = EMPTY();
    const orgs = (await this.settings.distinct('organizationId').exec()) as string[];
    for (const organizationId of orgs.sort()) {
      try {
        const r = await this.run(organizationId, source);
        total.read += r.read;
        total.written += r.written;
        total.pending += r.pending;
      } catch (err) {
        this.logger.warn(
          `Rattrapage ${source} en échec (org ${organizationId}) : ${(err as Error).message}`,
        );
      }
    }
    return total;
  }

  /** `POST /stock/sync` : les deux rattrapages de l'organisation active. */
  async syncOrganization(organizationId: string): Promise<StockSyncResponse> {
    return {
      version: STOCK_VERSION,
      purchases: await this.run(organizationId, 'purchases'),
      sales: await this.run(organizationId, 'sales'),
    };
  }

  private async run(
    organizationId: string,
    source: StockSyncSource,
  ): Promise<StockSyncSourceReport> {
    const settings = await this.settings
      .findOne({ organizationId })
      .lean<StockSettingsLean>()
      .exec();
    if (!settings) return EMPTY(); // stocks non activés : rien n'est lu
    const startedAt = new Date();
    const point = await this.checkpointOf(organizationId, source, new Date(settings.createdAt));
    const since = new Date(point.since.getTime() - STOCK_SYNC_OVERLAP_MS);
    const report =
      source === 'purchases'
        ? await this.syncPurchases(organizationId, since)
        : await this.sales.syncSince(organizationId, settings, since);
    await this.checkpoints.updateOne(
      { organizationId, source },
      { $max: { since: startedAt }, $set: { lastRunAt: startedAt } },
    );
    return report;
  }

  private async syncPurchases(organizationId: string, since: Date): Promise<StockSyncSourceReport> {
    const report = EMPTY();
    const changed = await this.purchases.receptionsChangedSince(organizationId, since);
    report.read = changed.length;
    for (const r of changed) {
      const applied = await this.receptions.applyReception(organizationId, String(r._id));
      report.written += applied.written;
      report.pending += applied.pending;
    }
    return report;
  }

  private async checkpointOf(
    organizationId: string,
    source: StockSyncSource,
    activatedAt: Date,
  ): Promise<StockSyncCheckpointLean> {
    const doc = await this.checkpoints
      .findOneAndUpdate(
        { organizationId, source },
        {
          $setOnInsert: {
            organizationId,
            source,
            since: activatedAt,
            lastRunAt: null,
            _schemaVersion: 1,
          },
        },
        { upsert: true, new: true },
      )
      .lean<StockSyncCheckpointLean>()
      .exec();
    return doc!;
  }
}
