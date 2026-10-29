// ─────────────────────────────────────────────────────────────────────────────
// Indicateurs du CRM minimal (ADR-0035 § 2)
//
// Deux fonctions PURES et déterministes, sans horloge ni base :
//   - `sumAmountsByCurrency` : montants ESTIMÉS des opportunités, additionnés
//     par devise — jamais convertis d'une devise à l'autre ;
//   - `stageWinRates` : probabilité historique de gain par étape, calculée
//     seulement au-delà d'un échantillon minimal ; sinon « indisponible »
//     (brief § 5.1 : « ne pas inventer de pourcentages sans données
//     suffisantes »).
//
// Arithmétique exacte en entiers `bigint` (virgule fixe d'`invoice-totals`),
// aucun nombre flottant pour un montant (docs/26). Versionné à part :
// `CRM_INDICATORS_VERSION` ne touche ni `ENGINE_VERSION` ni
// `INVOICE_TOTALS_VERSION`.
// ─────────────────────────────────────────────────────────────────────────────

import { divRound, formatAmount, parseFixed, CENT, type Fixed } from '../invoice-totals/decimal.js';
import type { DecimalString } from '../invoice-totals/types.js';

// ADR-0040 — C2 : 1.1.0 (fonctions ajoutées, sorties existantes inchangées).
export const CRM_INDICATORS_VERSION = '1.1.0';

/** Échantillon minimal par défaut d'une probabilité d'étape (ADR-0035, décision ouverte n° 3). */
export const DEFAULT_WIN_RATE_MIN_SAMPLE = 10;

export interface EstimatedAmount {
  /** Décimal canonique à 2 décimales au plus, ou `null` (montant non estimé). */
  amount: DecimalString | null;
  currency: string;
}

export interface CurrencyTotal {
  currency: string;
  /** Somme des montants estimés, 2 décimales. */
  total: DecimalString;
  /** Nombre d'éléments de cette devise portant un montant. */
  count: number;
}

/**
 * Somme des montants estimés, par devise, dans l'ordre alphabétique des
 * devises. Un montant `null` est ignoré ; un montant illisible, négatif ou à
 * plus de 2 décimales lève une erreur (donnée déjà validée en entrée d'API).
 */
export function sumAmountsByCurrency(items: readonly EstimatedAmount[]): CurrencyTotal[] {
  const sums = new Map<string, { total: Fixed; count: number }>();
  for (const item of items) {
    if (item.amount === null) continue;
    const fixed = parseFixed(item.amount);
    if (fixed === null || fixed % CENT !== 0n) {
      throw new RangeError(`Montant estimé invalide : ${JSON.stringify(item.amount)}`);
    }
    const current = sums.get(item.currency) ?? { total: 0n, count: 0 };
    sums.set(item.currency, { total: current.total + fixed, count: current.count + 1 });
  }
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, s]) => ({ currency, total: formatAmount(s.total), count: s.count }));
}

export interface ClosedOpportunity {
  /** Étapes par lesquelles l'opportunité est passée (doublons admis). */
  stagesVisited: readonly string[];
  won: boolean;
}

export type StageWinRate =
  | {
      status: 'available';
      /** Pourcentage entier, arrondi au plus proche (demi vers le haut), « 0 » à « 100 ». */
      ratePercent: string;
      sample: number;
      won: number;
    }
  | { status: 'unavailable'; sample: number; won: number; requiredSample: number };

/**
 * Probabilité historique de gain pour chaque étape demandée : parmi les
 * opportunités CLÔTURÉES (gagnées ou perdues) passées par l'étape, la part
 * gagnée. En dessous de `minSample` opportunités, `unavailable`.
 */
export function stageWinRates(input: {
  stages: readonly string[];
  closed: readonly ClosedOpportunity[];
  minSample?: number;
}): Record<string, StageWinRate> {
  const minSample = input.minSample ?? DEFAULT_WIN_RATE_MIN_SAMPLE;
  if (!Number.isInteger(minSample) || minSample < 1) {
    throw new RangeError('Échantillon minimal : un entier strictement positif.');
  }
  const out: Record<string, StageWinRate> = {};
  for (const stage of input.stages) {
    let sample = 0;
    let won = 0;
    for (const o of input.closed) {
      if (!o.stagesVisited.includes(stage)) continue;
      sample += 1;
      if (o.won) won += 1;
    }
    out[stage] =
      sample < minSample
        ? { status: 'unavailable', sample, won, requiredSample: minSample }
        : {
            status: 'available',
            ratePercent: divRound(BigInt(won) * 100n, BigInt(sample), 'half_up').toString(),
            sample,
            won,
          };
  }
  return out;
}

// ADR-0040 — C2
export * from './forecast.js';

// ADR-0040 — C3
export * from './reports.js';
