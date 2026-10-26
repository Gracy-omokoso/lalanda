// Montants signés au centime, sur l'arithmétique exacte d'`invoice-totals`
// (`decimal.ts`, interne, réutilisé SANS modification). Fichier interne au module.

import {
  CENT,
  formatAmount,
  hasAtMostDecimals,
  parseFixed,
  splitDecimal,
  type Fixed,
} from '../invoice-totals/decimal.js';

export type { Fixed };
export { CENT };

/** Montant d'au plus 2 décimales, positif ou nul ; `null` sinon. */
export function amountOf(value: unknown): Fixed | null {
  const parts = splitDecimal(value);
  if (parts === null || !hasAtMostDecimals(parts, 2)) return null;
  return parseFixed(value);
}

/** Montant strictement positif d'au plus 2 décimales ; `null` sinon. */
export function positiveAmountOf(value: unknown): Fixed | null {
  const fixed = amountOf(value);
  return fixed !== null && fixed > 0n ? fixed : null;
}

/** Comme `amountOf`, mais lève une erreur : pour les valeurs déjà validées en amont. */
export function trustedAmount(value: string, what: string): Fixed {
  const fixed = amountOf(value);
  if (fixed === null) {
    throw new RangeError(
      `${what} : décimal d’au plus 2 décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return fixed;
}

/** Positif ou nul → `"123.45"`. */
export function formatPositive(value: Fixed): string {
  return formatAmount(value);
}

/** Signé → `"-123.45"` ou `"123.45"`. */
export function formatSigned(value: Fixed): string {
  return value < 0n ? `-${formatAmount(-value)}` : formatAmount(value);
}

export function sum(values: readonly Fixed[]): Fixed {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
