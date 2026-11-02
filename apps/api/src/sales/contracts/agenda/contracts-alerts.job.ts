// Tâche planifiée `sales.contracts.alerts` — ADR-0050 § 6. ADR-0050 — V6.
//
// Quotidienne (ordonnanceur ADR-0020, « au moins une fois »). Pour chaque organisation
// qui a des contrats signés : les alertes « date limite de préavis proche » et « fin de
// terme proche » du moteur (`contractAlerts`) deviennent une notification in-app du
// RESPONSABLE du contrat (`sales.contract_notice_due`, `sales.contract_term_ending`).
//
// IDEMPOTENTE : une clé par (contrat, date) — rejouer la tâche, le même jour ou le
// suivant, ne crée aucun doublon. AUCUN envoi externe : la cloche seulement. Une
// organisation en échec n'empêche pas les suivantes.

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { SchedulerService } from '../../../scheduler/scheduler.service.js';
import { SalesContract, type SalesContractDocument } from '../contracts/sales-contract.schema.js';
import { SalesContractsAgendaSource } from './contracts-agenda.source.js';
import { SalesContractsNotifier } from './contracts-notifier.js';

export const SALES_CONTRACT_ALERTS_JOB_NAME = 'sales.contracts.alerts';

/** Une fois par jour. */
export const SALES_CONTRACT_ALERTS_EVERY_MS = 24 * 60 * 60_000;

export interface ContractAlertsRunReport {
  today: string | null;
  organizations: number;
  noticeDue: number;
  termEnding: number;
  failed: number;
}

@Injectable()
export class SalesContractsAlertsJob implements OnModuleInit {
  private readonly logger = new Logger('SalesContractsAlerts');

  constructor(
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(SalesContractsAgendaSource) private readonly agenda: SalesContractsAgendaSource,
    @Inject(SalesContractsNotifier) private readonly notifier: SalesContractsNotifier,
    @InjectModel(SalesContract.name) private readonly contracts: Model<SalesContractDocument>,
  ) {}

  onModuleInit(): void {
    this.scheduler.every(
      SALES_CONTRACT_ALERTS_JOB_NAME,
      SALES_CONTRACT_ALERTS_EVERY_MS,
      async (_p, ctx) => {
        await this.run(ctx.now);
      },
    );
  }

  async run(now: Date = new Date()): Promise<ContractAlertsRunReport> {
    const report: ContractAlertsRunReport = {
      today: null,
      organizations: 0,
      noticeDue: 0,
      termEnding: 0,
      failed: 0,
    };
    const organizations = (await this.contracts
      .distinct('organizationId', { status: 'signed' })
      .exec()) as string[];
    for (const organizationId of [...organizations].sort()) {
      report.organizations += 1;
      try {
        const scan = await this.agenda.scan(organizationId, now, {
          blockedFor: null,
          withDrafts: false,
        });
        report.today = scan.today;
        for (const alert of scan.alerts) {
          const c = alert.contractId ? scan.contracts.get(alert.contractId) : undefined;
          if (!c || alert.dueDate === null) continue;
          if (alert.kind === 'notice_deadline') {
            await this.notifier.noticeDue({
              organizationId,
              contractId: c.id,
              number: c.number,
              ownerUserId: c.ownerUserId,
              deadline: alert.dueDate,
            });
            report.noticeDue += 1;
          } else if (alert.kind === 'term_end') {
            await this.notifier.termEnding({
              organizationId,
              contractId: c.id,
              number: c.number,
              ownerUserId: c.ownerUserId,
              termEnd: alert.dueDate,
            });
            report.termEnding += 1;
          }
        }
      } catch (err) {
        report.failed += 1;
        this.logger.error(`Alertes de contrats en échec (${organizationId}) : ${String(err)}`);
      }
    }
    return report;
  }
}
