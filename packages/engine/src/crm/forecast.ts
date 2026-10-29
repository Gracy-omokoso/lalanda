// ─────────────────────────────────────────────────────────────────────────────
// Prévision pondérée et montant estimé des lignes d'une opportunité
// (ADR-0040 § 7.1 et § 2.6). ADR-0040 — C2.
//
// Fonctions PURES, sans horloge ni base, entiers `bigint` (virgule fixe
// d'`invoice-totals`), montants en chaînes, JAMAIS de conversion entre devises.
// Chaque résultat porte `{ version, basis: 'estimated' }` : ce sont des montants
// ESTIMÉS, ni réalisé, ni plan ; rien n'alimente `actual_periods`.
//
// Pondération (O4) : probabilité de l'étape en FRACTION EXACTE (`won / sample`
// pour l'historique, `p / 100` pour un pourcentage saisi), jamais le pourcentage
// arrondi. Une étape sans probabilité (`unavailable`) ou un montant absent rend
// l'opportunité « non pondérable » : elle est comptée à part, avec son montant
// brut, jamais multipliée par un nombre inventé. Un SEUL arrondi au centime
// (demi vers le haut) par devise.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CENT,
  divRound,
  fixedOf,
  formatAmount,
  mulExact,
  roundHalfUp,
  type Fixed,
} from '../invoice-totals/decimal.js';
import { discountedUnitPrice } from '../invoice-totals/pricing.js';
import type { DecimalString } from '../invoice-totals/types.js';
import { CRM_INDICATORS_VERSION, type StageWinRate } from './index.js';

/** Origine des probabilités d'étape (ADR-0040 § 2.5, décision ouverte n° 6). */
export type ForecastProbabilitySource = 'historical' | 'manual';

/** Probabilité d'une étape : fraction exacte `numerator / denominator`, ou indisponible. */
export type ForecastProbability =
  { status: 'available'; numerator: number; denominator: number } | { status: 'unavailable' };

export interface ForecastOpportunity {
  id: string;
  stageKey: string;
  /** Décimal canonique à 2 décimales au plus, ou `null` (montant non estimé). */
  amount: DecimalString | null;
  currency: string;
  expectedCloseDate: string | null;
  ownerId: string | null;
}

export interface CurrencyForecast {
  currency: string;
  /** Σ montant × probabilité, un seul arrondi au centime (demi vers le haut). */
  weighted: DecimalString;
  /** Σ montants bruts (tous les montants estimés de la devise). */
  unweighted: DecimalString;
  /** Opportunités de la devise (montant estimé ou non). */
  count: number;
  /** Étape sans probabilité, ou montant absent : comptées à part, jamais pondérées. */
  notWeightable: { total: DecimalString; count: number };
}

export interface WeightedForecast {
  version: string;
  basis: 'estimated';
  probabilitySource: ForecastProbabilitySource;
  /** Une entrée par devise, dans l'ordre alphabétique ; jamais de somme entre devises. */
  currencies: CurrencyForecast[];
}

/** Probabilités historiques (`stageWinRates`) en fractions exactes `won / sample`. */
export function probabilitiesFromWinRates(
  rates: Readonly<Record<string, StageWinRate>>,
): Record<string, ForecastProbability> {
  const out: Record<string, ForecastProbability> = {};
  for (const [key, rate] of Object.entries(rates)) {
    out[key] =
      rate.status === 'available' && rate.sample > 0
        ? { status: 'available', numerator: rate.won, denominator: rate.sample }
        : { status: 'unavailable' };
  }
  return out;
}

/** Pourcentages entiers saisis par l'organisation (mode `manual`) ; `null` : indisponible. */
export function probabilitiesFromPercents(
  percents: Readonly<Record<string, number | null>>,
): Record<string, ForecastProbability> {
  const out: Record<string, ForecastProbability> = {};
  for (const [key, p] of Object.entries(percents)) {
    if (p === null) {
      out[key] = { status: 'unavailable' };
      continue;
    }
    if (!Number.isInteger(p) || p < 0 || p > 100) {
      throw new RangeError(`Pourcentage d'étape invalide : ${JSON.stringify(p)}`);
    }
    out[key] = { status: 'available', numerator: p, denominator: 100 };
  }
  return out;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

function amountOf(raw: string): Fixed {
  const fixed = fixedOf(raw);
  if (fixed % CENT !== 0n) throw new RangeError(`Montant estimé invalide : ${JSON.stringify(raw)}`);
  return fixed;
}

function fractionOf(p: ForecastProbability | undefined): { n: bigint; d: bigint } | null {
  if (p === undefined || p.status !== 'available') return null;
  const { numerator, denominator } = p;
  if (
    !Number.isInteger(numerator) ||
    !Number.isInteger(denominator) ||
    denominator <= 0 ||
    numerator < 0 ||
    numerator > denominator
  ) {
    throw new RangeError(`Probabilité invalide : ${numerator}/${denominator}`);
  }
  return { n: BigInt(numerator), d: BigInt(denominator) };
}

/**
 * Prévision pondérée des opportunités OUVERTES, par devise (ADR-0040 § 7.1).
 * L'appelant ne passe que des opportunités ouvertes ; l'ordre d'entrée ne change
 * pas le résultat.
 */
export function weightedForecast(input: {
  opportunities: readonly ForecastOpportunity[];
  probabilities: Readonly<Record<string, ForecastProbability>>;
  probabilitySource: ForecastProbabilitySource;
}): WeightedForecast {
  interface Acc {
    // Somme pondérée EXACTE en virgule fixe : num / den.
    num: bigint;
    den: bigint;
    unweighted: Fixed;
    count: number;
    notWeightableTotal: Fixed;
    notWeightableCount: number;
  }
  const byCurrency = new Map<string, Acc>();
  for (const o of input.opportunities) {
    const acc = byCurrency.get(o.currency) ?? {
      num: 0n,
      den: 1n,
      unweighted: 0n,
      count: 0,
      notWeightableTotal: 0n,
      notWeightableCount: 0,
    };
    acc.count += 1;
    const amount = o.amount === null ? null : amountOf(o.amount);
    if (amount !== null) acc.unweighted += amount;
    const p = fractionOf(input.probabilities[o.stageKey]);
    if (amount === null || p === null) {
      acc.notWeightableCount += 1;
      if (amount !== null) acc.notWeightableTotal += amount;
    } else {
      // num/den + amount × n/d, réduit à chaque pas.
      const num = acc.num * p.d + amount * p.n * acc.den;
      const den = acc.den * p.d;
      const g = gcd(num, den);
      acc.num = num / g;
      acc.den = den / g;
    }
    byCurrency.set(o.currency, acc);
  }
  return {
    version: CRM_INDICATORS_VERSION,
    basis: 'estimated',
    probabilitySource: input.probabilitySource,
    currencies: [...byCurrency.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, acc]) => ({
        currency,
        weighted: formatAmount(divRound(acc.num, acc.den * CENT, 'half_up') * CENT),
        unweighted: formatAmount(acc.unweighted),
        count: acc.count,
        notWeightable: {
          total: formatAmount(acc.notWeightableTotal),
          count: acc.notWeightableCount,
        },
      })),
  };
}

// ── Montant estimé des lignes (§ 2.6) ───────────────────────────────────────

export interface EstimatedLine {
  /** Décimal > 0, 3 décimales au plus. */
  quantity: DecimalString;
  /** Prix unitaire HORS TAXES dans la devise de l'opportunité ; `null` : sans prix. */
  unitPrice: DecimalString | null;
  /** Remise en pour cent, 0 ≤ r < 100, 2 décimales au plus ; `null` : aucune. */
  discountPercent: DecimalString | null;
}

export interface EstimatedLinesAmount {
  version: string;
  basis: 'estimated';
  /** Total hors taxes au centime ; `null` si aucune ligne n'a de prix. */
  amount: DecimalString | null;
  /** Index des lignes sans prix : comptées pour zéro (`CRM_LINE_WITHOUT_PRICE`). */
  linesWithoutPrice: number[];
}

/**
 * Total HORS TAXES des lignes d'une opportunité (ADR-0040 § 2.6, décision
 * ouverte n° 8 : hors taxes). Mêmes règles que la composition d'un devis en mode
 * HT sans taxe spécifique : prix remisé par `discountedUnitPrice` (au centime,
 * demi vers le haut), puis montant de ligne prix × quantité arrondi au centime
 * (politique `per_line`), puis somme. Aucune taxe, aucune conversion.
 */
export function estimatedLinesAmount(lines: readonly EstimatedLine[]): EstimatedLinesAmount {
  let total = 0n;
  let priced = 0;
  const linesWithoutPrice: number[] = [];
  lines.forEach((line, index) => {
    if (line.unitPrice === null) {
      linesWithoutPrice.push(index);
      return;
    }
    const discount =
      line.discountPercent === null || fixedOf(line.discountPercent) === 0n
        ? null
        : line.discountPercent;
    let price: DecimalString = line.unitPrice;
    if (discount !== null) {
      const r = discountedUnitPrice({
        originalPrice: line.unitPrice,
        quantity: line.quantity,
        discount: { kind: 'percent', value: discount },
      });
      if (!r.ok) throw new RangeError(`Ligne ${index} invalide : ${r.issue.message}`);
      price = r.unitPrice;
    }
    total += roundHalfUp(mulExact(fixedOf(price), fixedOf(line.quantity)));
    priced += 1;
  });
  return {
    version: CRM_INDICATORS_VERSION,
    basis: 'estimated',
    amount: priced === 0 ? null : formatAmount(total),
    linesWithoutPrice,
  };
}
