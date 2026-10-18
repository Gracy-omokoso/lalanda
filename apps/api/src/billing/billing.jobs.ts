import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { SchedulerService } from '../scheduler/scheduler.service.js';
import { BillingService } from './billing.service.js';

/** Période du balayage des abonnements. */
export const BILLING_SWEEP_EVERY_MS = 60 * 60_000;

/**
 * Tâches planifiées du module abonnements (S25a).
 *
 * `billing.sweep` applique toutes les heures les transitions échues — essais,
 * périodes de grâce, baisses de gamme différées — que `getSnapshot()` applique
 * déjà paresseusement à la lecture. Le balayage reste une COMMODITÉ (rapports
 * d'exploitation à jour), jamais la source de vérité : si l'ordonnanceur
 * s'arrête, rien n'est faux. C'est pour cela qu'il est le premier client de
 * l'ordonnanceur — le risque est nul. `sweep()` est idempotent : une transition
 * déjà appliquée n'est pas rejouée.
 */
@Injectable()
export class BillingJobs implements OnModuleInit {
  private readonly logger = new Logger('BillingJobs');

  constructor(
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.scheduler.every('billing.sweep', BILLING_SWEEP_EVERY_MS, async (_payload, ctx) => {
      const { scanned, changed } = await this.billing.sweep(ctx.now);
      if (changed > 0) {
        this.logger.log(`Balayage des abonnements : ${changed} transition(s) sur ${scanned}.`);
      }
    });
  }
}
