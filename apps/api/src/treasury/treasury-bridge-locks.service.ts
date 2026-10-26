// Verrou des lignes du réalisé alimentées par les dépenses — ADR-0034 § 5.
//
// Tant que le report est ACTIF, les lignes visées par la table de
// correspondance, sur le projet du rattachement commun (`RunLinkService`), ne
// se saisissent pas à la main (`409 LINE_FED_BY_RUN`) : la valeur vient des
// dépenses, on corrige la dépense. Désactivé, tout redevient saisissable. Le
// module du réalisé réunit ce verrou à celui des ventes (`RunActualsLocks`).

import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { RunLinkService } from '../actuals/run-link/run-link.service.js';
import { TreasurySettings, type TreasurySettingsDocument } from './treasury.schemas.js';

@Injectable()
export class TreasuryBridgeLocks {
  constructor(
    @InjectModel(TreasurySettings.name) private readonly settings: Model<TreasurySettingsDocument>,
    @Inject(RunLinkService) private readonly runLink: RunLinkService,
  ) {}

  /** Interrupteur du report des dépenses et lignes visées par sa correspondance. */
  async expensesBridge(
    organizationId: string,
  ): Promise<{ enabled: boolean; lines: ReadonlySet<string> }> {
    const doc = await this.settings
      .findOne({ organizationId }, { bridge: 1 })
      .lean<{ bridge: TreasurySettings['bridge'] }>()
      .exec();
    const bridge = doc?.bridge;
    return {
      enabled: bridge?.enabled ?? false,
      lines: new Set(
        Object.values(bridge?.mapping ?? {}).filter((l): l is string => typeof l === 'string'),
      ),
    };
  }

  async lockedLines(organizationId: string, projectId: string): Promise<ReadonlySet<string>> {
    const [bridge, link] = await Promise.all([
      this.expensesBridge(organizationId),
      this.runLink.state(organizationId),
    ]);
    if (!bridge.enabled || link.projectId !== projectId) return new Set();
    return bridge.lines;
  }
}
