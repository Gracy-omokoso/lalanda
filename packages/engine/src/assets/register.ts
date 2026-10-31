// Registre des équipements et coût total de possession (ADR-0046 § 5.2, § 7.2).
// Sommes PAR DEVISE, jamais converties ; l'estimation de gestion n'apparaît
// qu'à la demande (date fournie) et reste étiquetée.

import { managementDepreciationEstimate } from './depreciation.js';
import {
  byString,
  centsOf,
  checkCurrency,
  checkDay,
  checkId,
  checkNullableDay,
  formatCents,
} from './money.js';
import {
  ASSET_CURRENCIES,
  ASSET_STATUSES,
  ASSETS_VERSION,
  MANAGEMENT_ESTIMATE_LABEL,
  type AssetCoverageInput,
  type AssetCurrency,
  type AssetDay,
  type AssetInput,
  type AssetMaintenanceInput,
  type AssetRegisterSummary,
  type AssetStatus,
  type AssetCurrencyTotal,
  type TotalCostOfOwnership,
} from './types.js';

class CurrencySums {
  private readonly sums = new Map<AssetCurrency, { count: number; total: bigint }>();
  add(currency: AssetCurrency, cents: bigint): void {
    const s = this.sums.get(currency) ?? { count: 0, total: 0n };
    s.count += 1;
    s.total += cents;
    this.sums.set(currency, s);
  }
  list(): AssetCurrencyTotal[] {
    return ASSET_CURRENCIES.flatMap((currency) => {
      const s = this.sums.get(currency);
      return s === undefined ? [] : [{ currency, count: s.count, total: formatCents(s.total) }];
    });
  }
}

const statusCounts = (counts: Map<AssetStatus, number>): { status: AssetStatus; count: number }[] =>
  ASSET_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));

/**
 * Nombres par statut et par catégorie ; coûts d'acquisition par devise (tous,
 * et hors cédés). Avec `onDate`, somme par devise des valeurs estimées (estimation
 * de gestion) des équipements non cédés à cette date, et nombre de non estimables.
 */
export function assetRegisterSummary(
  assets: readonly AssetInput[],
  onDate: AssetDay | null = null,
): AssetRegisterSummary {
  if (onDate !== null) checkDay(onDate, 'Date de l’estimation');
  const byStatus = new Map<AssetStatus, number>();
  const categories = new Map<
    string | null,
    { count: number; byStatus: Map<AssetStatus, number>; costs: CurrencySums }
  >();
  const all = new CurrencySums();
  const activeCosts = new CurrencySums();
  const estimated = new CurrencySums();
  let notEstimable = 0;
  for (const a of assets) {
    const what = `Équipement ${checkId(a.id, 'Équipement')}`;
    if (!(ASSET_STATUSES as readonly string[]).includes(a.status)) {
      throw new RangeError(`${what} : statut inconnu ${JSON.stringify(a.status)}`);
    }
    const currency = checkCurrency(a.acquisition.currency, `${what} (devise)`);
    const cost = centsOf(a.acquisition.cost, `${what} (coût d’acquisition)`);
    byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
    const key = a.categoryId ?? null;
    const cat = categories.get(key) ?? {
      count: 0,
      byStatus: new Map<AssetStatus, number>(),
      costs: new CurrencySums(),
    };
    cat.count += 1;
    cat.byStatus.set(a.status, (cat.byStatus.get(a.status) ?? 0) + 1);
    cat.costs.add(currency, cost);
    categories.set(key, cat);
    all.add(currency, cost);
    if (a.status !== 'disposed') activeCosts.add(currency, cost);
    if (onDate !== null) {
      const disposedOn = checkNullableDay(a.disposal?.on, `${what} (date de cession)`);
      const disposed = a.status === 'disposed' && (disposedOn === null || disposedOn <= onDate);
      if (disposed) continue;
      const e = managementDepreciationEstimate(a, onDate);
      if (e.estimable) estimated.add(e.currency, centsOf(e.estimatedValue, what));
      else notEstimable += 1;
    }
  }
  const keys = [...categories.keys()].sort((x, y) =>
    x === null ? (y === null ? 0 : 1) : y === null ? -1 : byString(x, y),
  );
  return {
    version: ASSETS_VERSION,
    total: assets.length,
    byStatus: statusCounts(byStatus),
    byCategory: keys.map((categoryId) => {
      const c = categories.get(categoryId);
      if (c === undefined) throw new Error('catégorie absente');
      return {
        categoryId,
        count: c.count,
        byStatus: statusCounts(c.byStatus),
        acquisitionCosts: c.costs.list(),
      };
    }),
    acquisitionCosts: all.list(),
    activeAcquisitionCosts: activeCosts.list(),
    managementEstimate:
      onDate === null
        ? null
        : {
            label: MANAGEMENT_ESTIMATE_LABEL,
            onDate,
            estimatedValues: estimated.list(),
            notEstimable,
          },
  };
}

/**
 * Coût total de possession d'un équipement, par devise : acquisition +
 * interventions FAITES (coût saisi, `doneOn` ≤ `until` si fourni) + couvertures
 * (coût saisi, `startOn` ≤ `until`). Les éléments d'un autre équipement sont
 * ignorés ; aucune conversion entre devises.
 */
export function assetTotalCostOfOwnership(
  asset: AssetInput,
  maintenance: readonly AssetMaintenanceInput[],
  coverages: readonly AssetCoverageInput[] = [],
  until: AssetDay | null = null,
): TotalCostOfOwnership {
  const what = `Équipement ${checkId(asset.id, 'Équipement')}`;
  if (until !== null) checkDay(until, 'Date de fin');
  const rows = new Map<
    AssetCurrency,
    { acquisition: bigint; maintenance: bigint; coverages: bigint }
  >();
  const row = (
    c: AssetCurrency,
  ): { acquisition: bigint; maintenance: bigint; coverages: bigint } => {
    const r = rows.get(c) ?? { acquisition: 0n, maintenance: 0n, coverages: 0n };
    rows.set(c, r);
    return r;
  };
  const acquiredOn = checkDay(asset.acquisition.on, `${what} (date d’acquisition)`);
  if (until === null || acquiredOn <= until) {
    row(checkCurrency(asset.acquisition.currency, `${what} (devise)`)).acquisition += centsOf(
      asset.acquisition.cost,
      `${what} (coût d’acquisition)`,
    );
  }
  let maintenanceCount = 0;
  let unpriced = 0;
  for (const [i, m] of maintenance.entries()) {
    if (m.assetId !== asset.id || m.status !== 'done') continue;
    const label = `Intervention n° ${i + 1}`;
    const doneOn = checkNullableDay(m.doneOn, `${label} (date)`);
    if (until !== null && (doneOn === null || doneOn > until)) continue;
    maintenanceCount += 1;
    if (m.cost === null || m.cost === undefined) {
      unpriced += 1;
      continue;
    }
    row(checkCurrency(m.currency, `${label} (devise)`)).maintenance += centsOf(m.cost, label);
  }
  let coverageCount = 0;
  for (const [i, c] of coverages.entries()) {
    if (c.assetId !== asset.id) continue;
    const label = `Couverture n° ${i + 1}`;
    const start = checkDay(c.startOn, `${label} (début)`);
    if (until !== null && start > until) continue;
    coverageCount += 1;
    if (c.cost === null || c.cost === undefined) continue;
    row(checkCurrency(c.currency, `${label} (devise)`)).coverages += centsOf(c.cost, label);
  }
  return {
    version: ASSETS_VERSION,
    assetId: asset.id,
    until,
    byCurrency: ASSET_CURRENCIES.flatMap((currency) => {
      const r = rows.get(currency);
      if (r === undefined) return [];
      return [
        {
          currency,
          acquisition: formatCents(r.acquisition),
          maintenance: formatCents(r.maintenance),
          coverages: formatCents(r.coverages),
          total: formatCents(r.acquisition + r.maintenance + r.coverages),
        },
      ];
    }),
    maintenanceCount,
    unpricedMaintenanceCount: unpriced,
    coverageCount,
  };
}
