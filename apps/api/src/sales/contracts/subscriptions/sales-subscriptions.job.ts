// Tâche planifiée `sales.subscriptions.prepare` — ADR-0050 § 5.3, O6. ADR-0050 — V5.
//
// Quotidienne (ordonnanceur ADR-0020, « au moins une fois »). Pour chaque contrat signé
// (ou résilié, jusqu'à la date d'effet) de chaque organisation : chaque échéance de
// `[aujourd'hui − 90 j, aujourd'hui + subscriptionLeadDays]` sans lien vivant, non
// bloquée et préparable automatiquement (réglage d'organisation, `autoPrepare` de
// l'abonnement) → UN BROUILLON (`createdBy = system:subscriptions`) et son lien.
//
// IDEMPOTENTE : une échéance déjà liée est ignorée, et les index uniques des liens
// retirent le brouillon d'une préparation concurrente ; rejouer ne crée rien.
// JAMAIS d'émission ni de normalisation, aucun appel e-MCF/DGI : chaque facture s'émet
// une à une, par un humain, sous `sales.invoice`. Un contrat en échec n'empêche pas les
// suivants.

import { SALES_SUBSCRIPTIONS_JOB_NAME } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { kinshasaDay } from '../../../crm/crm-model.js';
import { SchedulerService } from '../../../scheduler/scheduler.service.js';
import {
  SalesContract,
  type SalesContractDocument,
  type SalesContractLean,
} from '../contracts/sales-contract.schema.js';
// ADR-0050 — V6 : `sales.subscription_drafts_ready` (cloche des détenteurs de `sales.invoice`).
import { SalesContractsNotifier } from '../agenda/contracts-notifier.js';
import {
  SalesSubscriptionsService,
  type SubscriptionsRunReport,
} from './sales-subscriptions.service.js';

/** Une fois par jour (§ 5.3). */
export const SALES_SUBSCRIPTIONS_EVERY_MS = 24 * 60 * 60_000;

@Injectable()
export class SalesSubscriptionsJob implements OnModuleInit {
  private readonly logger = new Logger('SalesSubscriptions');

  constructor(
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(SalesSubscriptionsService) private readonly subscriptions: SalesSubscriptionsService,
    @InjectModel(SalesContract.name) private readonly contracts: Model<SalesContractDocument>,
    // ADR-0050 — V6 : facultatif (tests sans le module des alertes).
    @Optional()
    @Inject(SalesContractsNotifier)
    private readonly notifier: SalesContractsNotifier | null = null,
  ) {}

  // ADR-0050 — V5 : enregistrement de la tâche quotidienne.
  onModuleInit(): void {
    this.scheduler.every(
      SALES_SUBSCRIPTIONS_JOB_NAME,
      SALES_SUBSCRIPTIONS_EVERY_MS,
      async (_p, ctx) => {
        await this.run(ctx.now);
      },
    );
  }

  async run(now: Date = new Date()): Promise<SubscriptionsRunReport> {
    const report: SubscriptionsRunReport = {
      today: kinshasaDay(now),
      contracts: 0,
      prepared: 0,
      blocked: 0,
      failed: 0,
    };
    const contracts = await this.contracts
      .find({ status: { $in: ['signed', 'terminated'] } })
      .sort({ organizationId: 1, _id: 1 })
      .lean<SalesContractLean[]>()
      .exec();
    // ADR-0050 — V6 : brouillons préparés par organisation (premier contrat concerné).
    const preparedByOrg = new Map<string, { prepared: number; contractId: string }>();
    for (const contract of contracts) {
      report.contracts += 1;
      const before = report.prepared;
      try {
        await this.subscriptions.prepareDue(contract.organizationId, contract, now, report);
      } catch (err) {
        report.failed += 1;
        this.logger.error(
          `Préparation des échéances en échec (${contract.organizationId}, ${contract.number}) : ${String(err)}`,
        );
      }
      // ADR-0050 — V6
      if (report.prepared > before) {
        const p = preparedByOrg.get(contract.organizationId);
        preparedByOrg.set(contract.organizationId, {
          prepared: (p?.prepared ?? 0) + report.prepared - before,
          contractId: p?.contractId ?? String(contract._id),
        });
      }
    }
    // ADR-0050 — V6 : une notification par organisation et par jour (clé de dédoublonnage).
    for (const [organizationId, p] of preparedByOrg) {
      await this.notifier?.draftsReady({ organizationId, today: report.today, ...p });
    }
    if (report.prepared > 0 || report.failed > 0) {
      this.logger.log(
        `Échéances du ${report.today} : ${report.prepared} brouillon(s) préparé(s), ${report.blocked} bloquée(s), ${report.failed} échec(s).`,
      );
    }
    return report;
  }
}
