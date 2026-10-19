// ─────────────────────────────────────────────────────────────────────────────
// Contre-valeur en dollars d'une facture libellée en CDF (ADR-0022 § S25d.5)
//
// La facture normalisée est libellée en francs congolais ; un total en USD peut
// être indiqué (`curCode`, `curRate`, réponse `curTotal`), et devient
// obligatoire pour un paiement en USD, avec un taux à ±1 % du taux moyen de la
// Banque centrale du Congo. Le choix du taux de référence et de sa date
// appartient au lot S25e. L'arrondi de `curTotal` par la DGI reste à calibrer.
// ─────────────────────────────────────────────────────────────────────────────

import { SCALE, formatAmount, parseFixed, roundRatio, type Fixed } from './decimal.js';
import type { DecimalString } from './types.js';

function positive(value: DecimalString, label: string): Fixed {
  const fixed = parseFixed(value);
  if (fixed === null || fixed <= 0n) {
    throw new RangeError(
      `${label} : décimal strictement positif attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return fixed;
}

/** Contre-valeur indicative : total CDF / taux (CDF pour 1 USD), arrondi au plus proche. */
export function usdCounterValue(totalCdf: DecimalString, cdfPerUsd: DecimalString): DecimalString {
  const total = parseFixed(totalCdf);
  if (total === null) {
    throw new RangeError(`Total CDF : décimal attendu, reçu ${JSON.stringify(totalCdf)}`);
  }
  const rate = positive(cdfPerUsd, 'Taux de change');
  // Valeur exacte total / taux, en virgule fixe : total × 10⁸ / taux.
  return formatAmount(roundRatio(total * SCALE, rate, 'half_up'));
}

/** |taux − référence| ≤ tolérance % de la référence (bornes incluses). */
export function isExchangeRateWithinTolerance(
  rate: DecimalString,
  referenceRate: DecimalString,
  tolerancePercent: DecimalString = '1',
): boolean {
  const actual = positive(rate, 'Taux de change');
  const reference = positive(referenceRate, 'Taux de référence');
  const tolerance = parseFixed(tolerancePercent);
  if (tolerance === null) {
    throw new RangeError(`Tolérance : décimal attendu, reçu ${JSON.stringify(tolerancePercent)}`);
  }
  const gap = actual >= reference ? actual - reference : reference - actual;
  // gap / référence ≤ tolérance / 100, sans division : gap × 100 × 10⁸ ≤ tolérance × référence.
  return gap * 100n * SCALE <= tolerance * reference;
}
