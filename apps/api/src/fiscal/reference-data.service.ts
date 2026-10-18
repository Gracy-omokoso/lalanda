// Listes de référence e-MCF lues à la demande — ADR-0021 §6 et §10.
//
// La DGI reste la SOURCE des taux de facturation : ce service n'en code aucun.
// Le pack `cd-2026` sert seulement de garde-fou daté et sourcé : les taux des
// groupes B, C et O sont comparés à `tva_taux_normal`, `tva_taux_reduit` et
// `tva_taux_reduit_1pct` ; un écart produit un avertissement
// `TAX_RATE_DIFFERS_FROM_PACK`, non bloquant dans ce lot.

import { Inject, Injectable } from '@nestjs/common';

import { EdefReferenceSnapshotsService } from '../edef/edef-reference-snapshots.service.js';
import { EdefClient } from '../edef/edef.client.js';
import {
  EDEF_REFERENCE_LISTS,
  type EdefFailureKind,
  type EdefReferenceData,
  type EdefReferenceList,
} from '../edef/edef.types.js';
import { getParameterPack } from '../parameter-packs/parameter-pack-registry.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
  type EdefEnvironment,
} from '../platform-config/dgi-platform.config.js';
import { conflict, productionUnavailable } from './fiscal.errors.js';
import { PointsOfSaleService } from './points-of-sale.service.js';

/** Groupe de taxation ↔ paramètre du pack (ADR-0021 §6, contrôle croisé). */
export const PACK_CROSS_CHECK: ReadonlyArray<{ group: string; param: string }> = [
  { group: 'b', param: 'tva_taux_normal' },
  { group: 'c', param: 'tva_taux_reduit' },
  { group: 'o', param: 'tva_taux_reduit_1pct' },
];

export interface TaxRateWarning {
  code: 'TAX_RATE_DIFFERS_FROM_PACK';
  group: string;
  /** Taux DGI, en pour cent. */
  dgi: number | null;
  /** Taux du pack, en pour cent. */
  pack: number;
}

export interface ReferenceDataView {
  environment: EdefEnvironment;
  fetchedAt: string;
  lists: Partial<EdefReferenceData>;
  failures: Partial<Record<EdefReferenceList, { kind: EdefFailureKind; message: string }>>;
  warnings: TaxRateWarning[];
}

/** Compare les taux DGI aux paramètres du pack. Exporté pour le test unitaire. */
export function crossCheckTaxGroups(
  taxGroups: Record<string, number>,
  packParams: Record<string, { valeur: number } | undefined>,
): TaxRateWarning[] {
  const warnings: TaxRateWarning[] = [];
  for (const { group, param } of PACK_CROSS_CHECK) {
    const packValue = packParams[param]?.valeur;
    if (packValue === undefined) continue;
    const packPct = Math.round(packValue * 100 * 1e6) / 1e6;
    const dgi = taxGroups[group];
    if (dgi === undefined || Math.abs(dgi - packPct) > 1e-9) {
      warnings.push({
        code: 'TAX_RATE_DIFFERS_FROM_PACK',
        group,
        dgi: dgi ?? null,
        pack: packPct,
      });
    }
  }
  return warnings;
}

@Injectable()
export class ReferenceDataService {
  constructor(
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(EdefClient) private readonly edef: EdefClient,
    @Inject(EdefReferenceSnapshotsService)
    private readonly snapshots: EdefReferenceSnapshotsService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
  ) {}

  async read(organizationId: string, pointOfSaleId: string): Promise<ReferenceDataView> {
    const doc = await this.pointsOfSale.requireOwn(organizationId, pointOfSaleId);
    if (doc.environment === 'production' && !this.config.productionEnabled) {
      productionUnavailable();
    }
    const token = await this.pointsOfSale.tokenOf(organizationId, pointOfSaleId);
    if (!token) {
      conflict(
        'EMCF_TOKEN_MISSING',
        'Aucun jeton n’est enregistré pour ce point de vente : saisissez-en un pour lire les listes.',
      );
    }

    const ctx = {
      environment: doc.environment,
      token,
      organizationId,
      pointOfSaleId,
    };
    const results = await Promise.all(
      EDEF_REFERENCE_LISTS.map(async (list) => ({
        list,
        outcome: await this.edef.getReferenceList(list, ctx),
      })),
    );

    const lists: Partial<Record<EdefReferenceList, unknown>> = {};
    const failures: ReferenceDataView['failures'] = {};
    for (const { list, outcome } of results) {
      if (outcome.ok) {
        lists[list] = outcome.data;
        await this.snapshots.record(doc.environment, list, outcome.data);
      } else {
        failures[list] = { kind: outcome.error.kind, message: outcome.error.message };
      }
    }

    const taxGroups = lists['taxGroups'] as Record<string, number> | undefined;
    const pack = getParameterPack('cd-2026');
    const warnings = taxGroups && pack ? crossCheckTaxGroups(taxGroups, pack.params) : [];

    return {
      environment: doc.environment,
      fetchedAt: new Date().toISOString(),
      lists: lists as Partial<EdefReferenceData>,
      failures,
      warnings,
    };
  }
}
