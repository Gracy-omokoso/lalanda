// Arithmétique exacte des achats (ADR-0044 § 7) — fichier INTERNE.
//
// Un décimal est un entier `bigint` à échelle fixe : montants en CENTIMES
// (échelle 2), quantités en MILLIÈMES (échelle 3), pourcentages en CENTIÈMES de
// point (échelle 2, 100 % = 10 000). Une division n'a lieu qu'au moment d'un
// arrondi explicite (`divHalfUp`). Aucun flottant n'intervient dans un montant.

import { isCalendarDay } from '../treasury/calendar.js';
import { PURCHASE_CURRENCIES, type PurchaseCurrency } from './types.js';

const DECIMAL = /^(\d{1,15})(?:\.(\d+))?$/;

/** Décimal positif ou nul d'au plus `decimals` décimales → entier à cette échelle ; `null` sinon. */
export function scaledOf(value: unknown, decimals: number): bigint | null {
  if (typeof value !== 'string') return null;
  const match = DECIMAL.exec(value);
  if (match === null) return null;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return null;
  return (
    BigInt(match[1] ?? '0') * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0')
  );
}

/** Comme `scaledOf`, mais lève une erreur : valeurs déjà validées par l'appelant. */
export function trustedScaled(value: unknown, decimals: number, what: string): bigint {
  const scaled = scaledOf(value, decimals);
  if (scaled === null) {
    throw new RangeError(
      `${what} : décimal positif d’au plus ${decimals} décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return scaled;
}

/** Montant en centimes (≥ 0). */
export const centsOf = (value: unknown, what: string): bigint => trustedScaled(value, 2, what);

/** Quantité en millièmes (≥ 0). */
export const milliOf = (value: unknown, what: string): bigint => trustedScaled(value, 3, what);

/** Quantité strictement positive en millièmes. */
export function positiveMilliOf(value: unknown, what: string): bigint {
  const q = milliOf(value, what);
  if (q <= 0n) throw new RangeError(`${what} : quantité strictement positive attendue`);
  return q;
}

/** Remise en centièmes de point (0 à 10 000) ; absente = 0. */
export function discountOf(value: unknown, what: string): bigint {
  if (value === undefined || value === null) return 0n;
  const d = trustedScaled(value, 2, what);
  if (d > 10_000n) throw new RangeError(`${what} : remise au plus 100 %`);
  return d;
}

/**
 * Formate un entier à l'échelle `decimals`, signé, avec au moins `minDecimals`
 * décimales (zéros finaux au-delà retirés).
 */
export function formatScaled(value: bigint, decimals: number, minDecimals = decimals): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);
  const integer = (abs / unit).toString();
  let fraction = (abs % unit).toString().padStart(decimals, '0');
  while (fraction.length > minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${negative ? '-' : ''}${integer}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Centimes → « 12.05 » (signé si négatif). */
export const formatCents = (cents: bigint): string => formatScaled(cents, 2);

/** Millièmes → quantité la plus courte (« 6 », « 2.5 »). */
export const formatQuantity = (milli: bigint): string => formatScaled(milli, 3, 0);

/** Quotient `num / den` arrondi au plus proche, la moitié vers le haut ; `num` ≥ 0, `den` > 0. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new RangeError('Division hors domaine');
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

/** 10 000 = 100 % ; dénominateur de quantité × prix × (1 − remise). */
const LINE_DENOMINATOR = 1_000n * 10_000n;

/**
 * Montant HT d'une ligne en centimes : quantité × prix × (1 − remise), calculé
 * exactement puis arrondi UNE SEULE FOIS au centime, demi vers le haut.
 */
export function lineCents(milli: bigint, priceCents: bigint, discount: bigint): bigint {
  return divHalfUp(milli * priceCents * (10_000n - discount), LINE_DENOMINATOR);
}

/** Prix unitaire net de remise, en millionièmes (centimes × 10⁻⁴), exact. */
export function netUnitPriceMicro(priceCents: bigint, discount: bigint): bigint {
  return priceCents * (10_000n - discount);
}

/** Prix net en millionièmes → « 4.5 » au moins deux décimales, six au plus. */
export const formatNetPrice = (micro: bigint): string => formatScaled(micro, 6, 2);

export const sumOf = (values: readonly bigint[]): bigint => values.reduce((s, v) => s + v, 0n);

export function checkCurrency(value: unknown, what: string): PurchaseCurrency {
  if (typeof value !== 'string' || !(PURCHASE_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as PurchaseCurrency;
}

export function checkDay(value: unknown, what: string): string {
  if (!isCalendarDay(value))
    throw new RangeError(`${what} : date illisible ${JSON.stringify(value)}`);
  return value;
}

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
