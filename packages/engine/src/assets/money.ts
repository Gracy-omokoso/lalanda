// Arithmétique et calendrier des équipements (ADR-0046 § 7.2) — fichier INTERNE.
//
// Montants : entiers `bigint` en CENTIMES ; une division n'a lieu qu'au moment
// d'un arrondi explicite (`divHalfUp`). Dates : numéros de jour et index de
// mois calculés par le calendrier de la trésorerie (jours de Kinshasa déjà
// ramenés par l'appelant, ADR-0027). Aucun flottant, aucune horloge.

import {
  addDays,
  clampedDay,
  dayNumber,
  daysInMonth,
  isCalendarDay,
  partsOf,
} from '../treasury/calendar.js';
import { ASSET_CURRENCIES, type AssetCurrency, type AssetDay } from './types.js';

export { addDays, dayNumber };

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,2}))?$/;

/** Montant positif ou nul, deux décimales au plus → centimes ; lève sinon. */
export function centsOf(value: unknown, what: string): bigint {
  const m = typeof value === 'string' ? DECIMAL.exec(value) : null;
  if (m === null) {
    throw new RangeError(
      `${what} : montant positif d’au plus deux décimales attendu, reçu ${JSON.stringify(value)}`,
    );
  }
  return BigInt(m[1] ?? '0') * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Centimes → « 12.05 » (deux décimales fixes, signé si négatif). */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Quotient `num / den` arrondi au plus proche, la moitié vers le haut ; `num` ≥ 0, `den` > 0. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new RangeError('Division hors domaine');
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

/** Pour cent à deux décimales (« 33.33 ») de `num / den` ; `den` > 0. */
export function percentOf(num: bigint, den: bigint): string {
  return formatCents(divHalfUp(num * 10_000n, den));
}

export function checkCurrency(value: unknown, what: string): AssetCurrency {
  if (typeof value !== 'string' || !(ASSET_CURRENCIES as readonly string[]).includes(value)) {
    throw new RangeError(`${what} : devise inconnue ${JSON.stringify(value)}`);
  }
  return value as AssetCurrency;
}

export function checkDay(value: unknown, what: string): AssetDay {
  if (!isCalendarDay(value))
    throw new RangeError(`${what} : date illisible ${JSON.stringify(value)}`);
  return value;
}

export function checkNullableDay(value: unknown, what: string): AssetDay | null {
  if (value === null || value === undefined) return null;
  return checkDay(value, what);
}

export function checkIntegerIn(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} : entier de ${min} à ${max} attendu`);
  }
  return value;
}

export function checkId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '')
    throw new RangeError(`${what} : identifiant attendu`);
  return value;
}

/** Index absolu du mois d'une date (année × 12 + mois − 1). */
export function monthIndexOf(day: AssetDay): number {
  const p = partsOf(day);
  return p.year * 12 + p.month - 1;
}

/** Clé `AAAA-MM` d'un index de mois. */
export function monthKeyOfIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Dernier jour du mois d'index `index`. */
export function lastDayOfMonthIndex(index: number): AssetDay {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return clampedDay(year, month, daysInMonth(year, month));
}

/** Ajoute `months` mois, quantième ramené au dernier jour du mois d'arrivée. */
export function addMonthsClamped(day: AssetDay, months: number): AssetDay {
  const p = partsOf(day);
  const index = p.year * 12 + (p.month - 1) + months;
  return clampedDay(Math.floor(index / 12), (index % 12) + 1, p.day);
}

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
