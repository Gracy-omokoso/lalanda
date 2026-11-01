// Tâche planifiée `accounting.sync` (ADR-0049 O3, § Conséquences). ADR-0049 — K5.
//
// Toutes les 5 minutes, pour chaque organisation en mode ACTIF : lecture des pièces
// depuis le dernier point et génération idempotente des écritures. Une organisation en
// `off` n'est jamais lue ; en `simulation`, rien n'est à enregistrer. Une organisation en
// échec n'empêche pas les suivantes.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { AccountingSyncService } from './accounting-sync.service.js';

export const ACCOUNTING_SYNC_JOB = 'accounting.sync';
export const ACCOUNTING_SYNC_EVERY_MS = 5 * 60_000;

@Injectable()
export class AccountingSyncJob implements OnModuleInit {
  private readonly logger = new Logger('AccountingSync');

  constructor(
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(AccountingSyncService) private readonly sync: AccountingSyncService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(ACCOUNTING_SYNC_JOB, ACCOUNTING_SYNC_EVERY_MS, async () => {
      await this.run();
    });
  }

  async run(): Promise<{ organizations: number; failed: number }> {
    const orgs = await this.sync.activeOrganizations();
    let failed = 0;
    for (const organizationId of orgs) {
      try {
        await this.sync.sync(organizationId, {
          userId: 'system',
          role: 'system',
          perms: undefined,
        });
      } catch (err) {
        failed += 1;
        this.logger.error(
          `Synchronisation comptable en échec (${organizationId}) : ${String(err)}`,
        );
      }
    }
    return { organizations: orgs.length, failed };
  }
}
