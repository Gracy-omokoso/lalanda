// Verrou unique des lignes du réalisé alimentées par RUN — ADR-0031 § 3 et
// ADR-0034 § 5, unifiés le 26 oct. 2026.
//
// Deux ponts écrivent dans `actual_periods` : les ventes (`run.sales`, une ligne
// de chiffre d'affaires) et les dépenses (`run.expenses`, les lignes visées par la
// table de correspondance). Tant qu'un pont est ACTIF sur le projet, ses lignes
// ne se saisissent pas à la main (`409 LINE_FED_BY_RUN`), effacement compris. Le
// module du réalisé ne consulte que ce service : un troisième pont s'y ajoutera
// sans toucher à la saisie.

import { Inject, Injectable } from '@nestjs/common';

import { TreasuryBridgeLocks } from '../treasury/treasury-bridge-locks.service.js';
import type { RunActualSource } from './actual-period.schema.js';
import { RunBridgeService } from './run-bridge/run-bridge.service.js';

@Injectable()
export class RunActualsLocks {
  constructor(
    @Inject(RunBridgeService) private readonly sales: RunBridgeService,
    @Inject(TreasuryBridgeLocks) private readonly expenses: TreasuryBridgeLocks,
  ) {}

  /** Lignes verrouillées du projet et le pont qui alimente chacune. */
  async lockedLines(
    organizationId: string,
    projectId: string,
  ): Promise<ReadonlyMap<string, RunActualSource>> {
    const [sales, expenses] = await Promise.all([
      this.sales.lockedLines(organizationId, projectId),
      this.expenses.lockedLines(organizationId, projectId),
    ]);
    const locked = new Map<string, RunActualSource>();
    for (const lineId of expenses) locked.set(lineId, 'run.expenses');
    // Une ligne ne peut pas être visée par les deux ponts (refusé à la
    // configuration) ; si l'état en base le contredisait, la vente l'emporte.
    for (const lineId of sales) locked.set(lineId, 'run.sales');
    return locked;
  }
}
