// Tâche nocturne `stock.levels-check` (ADR-0046 § 2.5). ADR-0046 — S3.
//
// Recalcule, pour chaque organisation dont les stocks sont activés, les niveaux depuis
// le grand livre (moteur `stockLevelDrift`) et SIGNALE tout écart au journal
// d'exploitation (`STOCK_LEVEL_DRIFT`). Elle ne réécrit rien : le rétablissement est un
// geste explicite (`POST /stock/levels/rebuild`, `stock.manage`). Idempotente.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { SchedulerService } from '../scheduler/scheduler.service.js';
import { StockReportsService } from './stock-reports.service.js';

export const STOCK_LEVELS_CHECK_JOB = 'stock.levels-check';
export const STOCK_LEVELS_CHECK_EVERY_MS = 24 * 3_600_000;

@Injectable()
export class StockLevelsCheckJob implements OnModuleInit {
  private readonly logger = new Logger('StockLevelsCheck');

  constructor(
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(StockReportsService) private readonly reports: StockReportsService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(STOCK_LEVELS_CHECK_JOB, STOCK_LEVELS_CHECK_EVERY_MS, async () => {
      await this.run();
    });
  }

  async run(): Promise<{ organizations: number; drifts: number }> {
    let drifts = 0;
    const orgs = await this.reports.activeOrganizations();
    for (const organizationId of orgs.sort()) {
      const report = await this.reports.checkLevels(organizationId, false);
      drifts += report.drifts.length;
    }
    if (drifts > 0) this.logger.warn(`${drifts} écart(s) STOCK_LEVEL_DRIFT constaté(s).`);
    return { organizations: orgs.length, drifts };
  }
}
