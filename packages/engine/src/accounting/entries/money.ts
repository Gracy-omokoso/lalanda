// Arithmétique exacte du moteur d'écritures (ADR-0049 § 12) — fichier INTERNE.
//
// Montants : entiers de CENTIMES (`bigint`). Taux : entiers à l'échelle 10⁸
// (huit décimales au plus). Une division n'a lieu qu'à un arrondi explicite,
// au plus proche, la moitié vers le haut. Aucun flottant.

import { ACCOUNTING_CURRENCIES, type AccountingCurrency } from '../types.js';

const AMOUNT = /^(\d{1,15})(?:\.(\d{1,2}))?$/;
const RATE = /^(\d{1,12})(?:\.(\d{1,8}))?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Échelle des taux : 1 = 10⁸. */
export const RATE_SCALE = 100_000_000n;

/** Centimes d'un montant positif ou nul (deux décimales au plus), ou `null`. */
export function centsOrNull(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const m = AMOUNT.exec(value);
  if (m === null) return null;
  return BigInt(m[1] ?? '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Centimes d'un montant déjà validé par l'appelant ; lève une erreur sinon. */
export function centsOf(value: unknown, what: string): bigint {
  const cents = centsOrNull(value);
  if (cents === null) {
    throw new RangeError(
      `${what} : montant décimal positif d’au plus deux décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return cents;
}

/** Taux strictement positif à l'échelle 10⁸, ou `null`. */
export function rateOrNull(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const m = RATE.exec(value);
  if (m === null) return null;
  const scaled = BigInt(m[1] ?? '0') * RATE_SCALE + BigInt((m[2] ?? '').padEnd(8, '0'));
  return scaled > 0n ? scaled : null;
}

/** Centimes → « 12.05 » (deux décimales exactement). */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Taux à l'échelle 10⁸ → décimal le plus court (« 2800 », « 0.00035714 »). */
export function formatRate(scaled: bigint): string {
  const integer = (scaled / RATE_SCALE).toString();
  const fraction = (scaled % RATE_SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction === '' ? integer : `${integer}.${fraction}`;
}

/** `num / den` au plus proche, la moitié vers le haut ; `num` ≥ 0, `den` > 0. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new RangeError('Division hors domaine');
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

/** Montant × taux, arrondi une seule fois au centime. */
export function convert(cents: bigint, rate: bigint): bigint {
  return divHalfUp(cents * rate, RATE_SCALE);
}

/**
 * Répartit `total` entre des parts proportionnelles à `weights` (≥ 0, somme
 * > 0) : partie entière de chaque part, puis un centime de plus aux plus grands
 * restes (à reste égal, l'ordre d'entrée). La somme vaut exactement `total`.
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum <= 0n || total < 0n) throw new RangeError('Répartition hors domaine');
  const shares = weights.map((w) => (total * w) / sum);
  const remainders = weights.map((w, index) => ({ index, rest: (total * w) % sum }));
  let missing = total - shares.reduce((s, v) => s + v, 0n);
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (missing === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    missing -= 1n;
  }
  return shares;
}

export const sumOf = (values: readonly bigint[]): bigint => values.reduce((s, v) => s + v, 0n);

export function isAccountingCurrency(value: unknown): value is AccountingCurrency {
  return typeof value === 'string' && (ACCOUNTING_CURRENCIES as readonly string[]).includes(value);
}

/** Jour civil `AAAA-MM-JJ` valide. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}
