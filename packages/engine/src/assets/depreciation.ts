// Estimation de gestion de la valeur d'un équipement (ADR-0046 O7, § 7.2, § 9).
//
// Linéaire MENSUEL : base = coût − valeur résiduelle, répartie sur `years × 12`
// mois à partir du mois de `startOn` (mois entamé compté). Le cumul consommé
// après `k` mois vaut `base × k ÷ N` arrondi au centime (demi vers le haut) :
// chaque mois porte la différence de deux cumuls, si bien que les restes
// d'arrondi se répartissent et que le dernier mois solde exactement la base.
// Aucune durée par défaut, aucune règle comptable ni fiscale : sans durée
// saisie, l'estimation est « non estimable », jamais 0. Arrêt à la cession.

import {
  checkCurrency,
  checkDay,
  checkIntegerIn,
  checkNullableDay,
  centsOf,
  divHalfUp,
  formatCents,
  lastDayOfMonthIndex,
  monthIndexOf,
  monthKeyOfIndex,
  percentOf,
} from './money.js';
import {
  ASSETS_VERSION,
  DEPRECIATION_YEARS_BOUNDS,
  MANAGEMENT_ESTIMATE_LABEL,
  type AssetCurrency,
  type AssetDay,
  type AssetInput,
  type ManagementEstimateResult,
  type ManagementEstimateUnavailable,
  type ManagementScheduleMonth,
  type ManagementScheduleResult,
  type ManagementScheduleYear,
  type NotEstimableReason,
} from './types.js';

interface Plan {
  currency: AssetCurrency;
  cost: bigint;
  residual: bigint;
  base: bigint;
  startOn: AssetDay;
  startMonth: number;
  months: number;
  disposalOn: AssetDay | null;
}

const unavailable = (reason: NotEstimableReason): ManagementEstimateUnavailable => ({
  version: ASSETS_VERSION,
  label: MANAGEMENT_ESTIMATE_LABEL,
  estimable: false,
  reason,
});

function planOf(asset: AssetInput): Plan | NotEstimableReason {
  const what = `Équipement ${asset.id}`;
  const currency = checkCurrency(asset.acquisition.currency, `${what} (devise)`);
  const rawCost = asset.acquisition.cost ?? null;
  const cost = rawCost === null ? null : centsOf(rawCost, `${what} (coût d’acquisition)`);
  const disposalOn = checkNullableDay(asset.disposal?.on, `${what} (date de cession)`);
  const params = asset.managementDepreciation ?? null;
  if (params === null || params.years === null || params.years === undefined) return 'NO_DURATION';
  // Coût inconnu : non estimable, jamais calculé sur zéro.
  if (cost === null) return 'UNKNOWN_COST';
  const { min, max } = DEPRECIATION_YEARS_BOUNDS;
  const years = checkIntegerIn(params.years, min, max, `${what} (durée en années)`);
  const residual = centsOf(params.residualValue, `${what} (valeur résiduelle)`);
  const startOn = checkDay(params.startOn, `${what} (début de l’estimation)`);
  if (residual > cost) return 'RESIDUAL_ABOVE_COST';
  return {
    currency,
    cost,
    residual,
    base: cost - residual,
    startOn,
    startMonth: monthIndexOf(startOn),
    months: years * 12,
    disposalOn,
  };
}

/** Cumul consommé après `k` mois (0 ≤ k ≤ N). */
function consumedAfter(plan: Plan, k: number): bigint {
  if (k <= 0) return 0n;
  if (k >= plan.months) return plan.base;
  return divHalfUp(plan.base * BigInt(k), BigInt(plan.months));
}

/** Mois comptés à la date `day` : 0 avant `startOn`, mois entamé compté, plafonné à N. */
function monthsElapsedAt(plan: Plan, day: AssetDay): number {
  if (day < plan.startOn) return 0;
  const k = monthIndexOf(day) - plan.startMonth + 1;
  return k > plan.months ? plan.months : k;
}

/**
 * Valeur nette estimée d'un équipement à `onDate` — estimation de gestion,
 * étiquetée `management_estimate`. Rend `estimable: false` (jamais 0) sans
 * durée saisie, au coût d'acquisition inconnu, ou si la valeur résiduelle dépasse
 * le coût.
 */
export function managementDepreciationEstimate(
  asset: AssetInput,
  onDate: AssetDay,
): ManagementEstimateResult {
  checkDay(onDate, 'Date de l’estimation');
  const plan = planOf(asset);
  if (typeof plan === 'string') return unavailable(plan);
  const stopped = plan.disposalOn !== null && plan.disposalOn < onDate ? plan.disposalOn : null;
  const effectiveOn = stopped ?? onDate;
  const k = monthsElapsedAt(plan, effectiveOn);
  const consumed = consumedAfter(plan, k);
  return {
    version: ASSETS_VERSION,
    label: MANAGEMENT_ESTIMATE_LABEL,
    estimable: true,
    currency: plan.currency,
    cost: formatCents(plan.cost),
    residualValue: formatCents(plan.residual),
    depreciableBase: formatCents(plan.base),
    startOn: plan.startOn,
    endOn: lastDayOfMonthIndex(plan.startMonth + plan.months - 1),
    monthsTotal: plan.months,
    monthsElapsed: k,
    onDate,
    effectiveOn,
    stoppedByDisposalOn: stopped,
    consumed: formatCents(consumed),
    estimatedValue: formatCents(plan.cost - consumed),
    consumedPercent: percentOf(BigInt(k), BigInt(plan.months)),
  };
}

/**
 * Tableau indicatif mois par mois (et regroupé par année civile) de
 * l'estimation de gestion. Arrêté au mois de cession inclus s'il y en a une.
 */
export function managementDepreciationSchedule(asset: AssetInput): ManagementScheduleResult {
  const plan = planOf(asset);
  if (typeof plan === 'string') return unavailable(plan);
  const last = plan.disposalOn === null ? plan.months : monthsElapsedAt(plan, plan.disposalOn);
  const months: ManagementScheduleMonth[] = [];
  const years: ManagementScheduleYear[] = [];
  let previous = 0n;
  for (let k = 1; k <= last; k += 1) {
    const cumulative = consumedAfter(plan, k);
    const charge = cumulative - previous;
    previous = cumulative;
    const index = plan.startMonth + k - 1;
    months.push({
      month: monthKeyOfIndex(index),
      index: k,
      charge: formatCents(charge),
      cumulative: formatCents(cumulative),
      closingValue: formatCents(plan.cost - cumulative),
    });
    const year = Math.floor(index / 12);
    const row = years[years.length - 1];
    if (row !== undefined && row.year === year) {
      row.months += 1;
      row.charge = formatCents(centsOf(row.charge, 'cumul') + charge);
      row.closingValue = formatCents(plan.cost - cumulative);
    } else {
      years.push({
        year,
        months: 1,
        charge: formatCents(charge),
        closingValue: formatCents(plan.cost - cumulative),
      });
    }
  }
  return {
    version: ASSETS_VERSION,
    label: MANAGEMENT_ESTIMATE_LABEL,
    estimable: true,
    currency: plan.currency,
    cost: formatCents(plan.cost),
    residualValue: formatCents(plan.residual),
    depreciableBase: formatCents(plan.base),
    startOn: plan.startOn,
    endOn: lastDayOfMonthIndex(plan.startMonth + plan.months - 1),
    monthsTotal: plan.months,
    stoppedByDisposalOn: plan.disposalOn !== null && last < plan.months ? plan.disposalOn : null,
    months,
    years,
  };
}
