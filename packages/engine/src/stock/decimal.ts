// Arithmétique exacte des stocks (ADR-0046 § 7.1) — fichier INTERNE.
//
// Un décimal est un entier `bigint` à échelle fixe : quantités en MILLIÈMES
// (échelle 3), montants en CENTIMES (échelle 2), coûts unitaires et facteurs en
// MILLIONIÈMES (échelle 6). Une division n'a lieu qu'au moment d'un arrondi
// explicite, au plus proche, la moitié en s'éloignant de zéro. Aucun flottant.

import { isCalendarDay } from '../treasury/calendar.js';
import { STOCK_CURRENCIES, type StockCurrency } from './types.js';

export const QTY = 3;
export const AMOUNT = 2;
export const COST = 6;

/** q (millièmes) × coût (millionièmes) → échelle 9 ; ÷ 10⁷ → centimes. */
export const QTY_COST_TO_CENTS = 10n ** 7n;

const DECIMAL = /^(-)?(\d{1,15})(?:\.(\d+))?$/;

/** Décimal d'au plus `decimals` décimales → entier à cette échelle ; `null` sinon. */
export function scaledOf(value: unknown, decimals: number): bigint | null {
  if (typeof value !== 'string') return null;
  const match = DECIMAL.exec(value);
  if (match === null) return null;
  const fraction = match[3] ?? '';
  if (fraction.length > decimals) return null;
  const abs =
    BigInt(match[2] ?? '0') * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0');
  return match[1] === '-' ? -abs : abs;
}

type Sign = 'any' | 'nonnegative' | 'positive' | 'nonzero';

export function parse(value: unknown, decimals: number, sign: Sign, what: string): bigint {
  const scaled = scaledOf(value, decimals);
  if (scaled === null) {
    throw new RangeError(
      `${what} : décimal d’au plus ${decimals} décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  const bad =
    (sign === 'nonnegative' && scaled < 0n) ||
    (sign === 'positive' && scaled <= 0n) ||
    (sign === 'nonzero' && scaled === 0n);
  if (bad) throw new RangeError(`${what} : valeur hors domaine (${sign}) : ${String(value)}`);
  return scaled;
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

export const formatQty = (milli: bigint): string => formatScaled(milli, QTY, 0);
export const formatAmount = (cents: bigint): string => formatScaled(cents, AMOUNT);
export const formatCost = (micro: bigint): string => formatScaled(micro, COST);

/** Quotient arrondi au plus proche, la moitié en s'éloignant de zéro ; `den` > 0. */
export function divRound(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('Division hors domaine');
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const q = abs / den;
  const rounded = (abs % den) * 2n >= den ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Plus petit entier ≥ num / den ; `den` > 0. */
export function divCeil(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('Division hors domaine');
  const q = num / den;
  return num > 0n && num % den !== 0n ? q + 1n : q;
}

/** Montant (centimes) de q millièmes au coût c millionièmes, signé comme q. */
export const valueOf = (milli: bigint, micro: bigint): bigint =>
  divRound(milli * micro, QTY_COST_TO_CENTS);

export const sumOf = (values: readonly bigint[]): bigint => values.reduce((s, v) => s + v, 0n);

export const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);
export const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function checkCurrency(value: unknown, what: string): StockCurrency {
  if (typeof value !== 'string' || !(STOCK_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as StockCurrency;
}

export function checkDay(value: unknown, what: string): string {
  if (!isCalendarDay(value)) {
    throw new RangeError(`${what} : date illisible ${JSON.stringify(value)}`);
  }
  return value;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

/** Horodatage UTC → clé comparable à la milliseconde (`AAAA-MM-JJTHH:MM:SS.mmm`). */
export function timestampKey(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new RangeError(`${what} : horodatage UTC attendu, reçu ${JSON.stringify(value)}`);
  }
  const m = TIMESTAMP.exec(value);
  if (m === null || !isCalendarDay(value.slice(0, 10))) {
    throw new RangeError(`${what} : horodatage UTC attendu, reçu ${JSON.stringify(value)}`);
  }
  return `${m[1]}.${(m[2] ?? '').padEnd(3, '0')}`;
}

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Unité comparée sans casse ni espaces de bord (« Carton » = « carton »). */
export const unitKey = (unit: string): string => unit.normalize('NFC').trim().toLowerCase();
