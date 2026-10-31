// Fournisseur réel du port `ASSETS_SOURCE` du brief du matin — ADR-0046 § 6.6.
// ADR-0046 — S7.
//
// LECTURE SEULE, organisation de la session. Les trois nombres viennent du moteur des
// équipements (`assetDeadlines`, par `AssetsService.deadlinesOf`, délais des réglages) :
// maintenances prévues en retard ou dues, couvertures expirées ou qui expirent,
// équipements encore affectés à un collaborateur sorti
// (`ASSET_HELD_BY_FORMER_EMPLOYEE`). Rien d'autre ne sort d'ici : ni nom, ni coût.
// Appelé seulement avec `assets.read` (service du brief).

import type { BriefAssetsInput } from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';

import type { AssetsSource } from '../../morning-brief/morning-brief.ports.js';
import { assetsToday } from '../assets-common.js';
import { AssetsService } from '../registry/assets.service.js';

@Injectable()
export class AssetsBriefSource implements AssetsSource {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  async assetsOf(organizationId: string, now: Date): Promise<BriefAssetsInput> {
    const { result } = await this.assets.deadlinesOf(organizationId, assetsToday(now));
    const c = result.counts;
    return {
      status: 'known',
      maintenanceDueCount: c.maintenance_overdue + c.maintenance_due_soon,
      coverageExpiringCount: c.coverage_expired + c.coverage_due_soon,
      heldByFormerEmployeeCount: c.held_by_former_employee,
    };
  }
}
