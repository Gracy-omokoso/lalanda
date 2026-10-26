// Verrou des lignes du réalisé alimentées par les dépenses — ADR-0034 § 5.
//
// Tant que le report est ACTIF sur un projet, les lignes visées par la table de
// correspondance ne se saisissent pas à la main (`409 LINE_FED_BY_RUN`) : la
// valeur vient des dépenses, on corrige la dépense. Désactivé, tout redevient
// saisissable. Service isolé pour que le module du réalisé ne dépende que de lui.

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import { TreasurySettings, type TreasurySettingsDocument } from './treasury.schemas.js';

@Injectable()
export class TreasuryBridgeLocks {
  constructor(
    @InjectModel(TreasurySettings.name) private readonly settings: Model<TreasurySettingsDocument>,
  ) {}

  async lockedLines(organizationId: string, projectId: string): Promise<ReadonlySet<string>> {
    const doc = await this.settings
      .findOne({ organizationId }, { bridge: 1 })
      .lean<{ bridge: TreasurySettings['bridge'] }>()
      .exec();
    const bridge = doc?.bridge;
    if (!bridge?.enabled || bridge.projectId !== projectId) return new Set();
    return new Set(Object.values(bridge.mapping).filter((l): l is string => typeof l === 'string'));
  }
}
