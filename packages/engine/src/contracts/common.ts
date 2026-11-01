// Outils internes du module `contracts` (ADR-0050 § 7) — fichier INTERNE.
//
// Dates : celles du calendrier de la trésorerie (jour civil sans fuseau,
// ADR-0034), importées et non recopiées. Décimaux : entiers `bigint` à échelle
// fixe (montants en centimes, quantités en millièmes), aucun flottant.

import { addDays, clampedDay, dayNumber, isCalendarDay, partsOf } from '../treasury/calendar.js';
import { CONTRACT_CURRENCIES, type ContractCurrency, type ContractDay } from './types.js';

export { addDays, dayNumber };

export function checkDay(value: unknown, what: string): ContractDay {
  if (!isCalendarDay(value)) {
    throw new RangeError(`${what} : date AAAA-MM-JJ attendue, reçu ${JSON.stringify(value)}`);
  }
  return value;
}

export function checkInt(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${what} : entier de ${min} à ${max} attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function checkCurrency(value: unknown, what: string): ContractCurrency {
  if (typeof value !== 'string' || !(CONTRACT_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as ContractCurrency;
}

export const compareDays = (a: ContractDay, b: ContractDay): number => dayNumber(a) - dayNumber(b);
export const minDay = (a: ContractDay, b: ContractDay): ContractDay =>
  compareDays(a, b) <= 0 ? a : b;
export const maxDay = (a: ContractDay, b: ContractDay): ContractDay =>
  compareDays(a, b) >= 0 ? a : b;

/**
 * Anniversaire : `months` mois après `from`, au quantième `anchorDay` ramené au
 * dernier jour du mois (même règle que `occurrencesOf`, ADR-0034 § 3).
 */
export function anniversary(from: ContractDay, months: number, anchorDay: number): ContractDay {
  const p = partsOf(from);
  const m = p.month - 1 + months;
  return clampedDay(p.year + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1, anchorDay);
}

/** Quantième d'une date. */
export const dayOfMonth = (day: ContractDay): number => partsOf(day).day;

const DECIMAL = /^(\d{1,15})(?:\.(\d+))?$/;

/** Décimal positif ou nul d'au plus `decimals` décimales → entier à cette échelle. */
export function scaled(value: unknown, decimals: number, what: string): bigint {
  const match = typeof value === 'string' ? DECIMAL.exec(value) : null;
  const fraction = match?.[2] ?? '';
  if (match === null || fraction.length > decimals) {
    throw new RangeError(
      `${what} : décimal positif d’au plus ${decimals} décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return (
    BigInt(match[1] ?? '0') * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0') || '0')
  );
}

export const centsOf = (value: unknown, what: string): bigint => scaled(value, 2, what);
export const milliOf = (value: unknown, what: string): bigint => scaled(value, 3, what);

export function formatScaled(value: bigint, decimals: number, minDecimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);
  let fraction = (abs % unit).toString().padStart(decimals, '0');
  while (fraction.length > minDecimals && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  return `${negative ? '-' : ''}${(abs / unit).toString()}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Centimes → « 12.05 » (signé si négatif). */
export const formatCents = (cents: bigint): string => formatScaled(cents, 2, 2);
/** Millièmes → quantité la plus courte (« 6 », « 2.5 »). */
export const formatQuantity = (milli: bigint): string => formatScaled(milli, 3, 0);

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
