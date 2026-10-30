// Arithmétique et calendrier des RH (ADR-0045 § 5, § 7) — fichier INTERNE.
//
// Une durée est un entier `bigint` en CENTIÈMES de jour (1 jour = 100). Un jour
// civil est découpé en deux demi-journées (`am`, `pm`) ; un instant de demande
// est un « créneau » = numéro de jour × 2 (+ 1 pour l'après-midi). Aucun
// flottant, aucune horloge.

import {
  addDays,
  clampedDay,
  dayNumber,
  dayOfNumber,
  isCalendarDay,
  partsOf,
} from '../treasury/calendar.js';
import {
  WEEKDAYS,
  type HalfDay,
  type HolidayInput,
  type HrDay,
  type LeaveBound,
  type LeaveYearStart,
  type Weekday,
  type WorkPattern,
} from './types.js';

export { addDays, clampedDay, dayNumber, dayOfNumber, partsOf };

/** 1 jour en centièmes. */
export const DAY = 100n;
/** Une demi-journée en centièmes. */
export const HALF = 50n;

const SIGNED_DECIMAL = /^(-?)(\d{1,9})(?:\.(\d{1,2}))?$/;

/** Durée décimale signée (deux décimales au plus) → centièmes ; `null` si illisible. */
export function centiOf(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const m = SIGNED_DECIMAL.exec(value);
  if (m === null) return null;
  const abs = BigInt(m[2] ?? '0') * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] === '-' ? -abs : abs;
}

/** Comme `centiOf`, mais lève une erreur (données déjà validées par l'appelant). */
export function trustedCenti(value: unknown, what: string): bigint {
  const c = centiOf(value);
  if (c === null) {
    throw new RangeError(
      `${what} : durée décimale d’au plus deux décimales attendue, reçu ${JSON.stringify(value)}`,
    );
  }
  return c;
}

/** Durée positive ou nulle. */
export function nonNegativeCenti(value: unknown, what: string): bigint {
  const c = trustedCenti(value, what);
  if (c < 0n) throw new RangeError(`${what} : durée positive ou nulle attendue`);
  return c;
}

/** Centièmes → décimal le plus court (« 3.5 », « 1.03 », « -2 »). */
export function formatDays(centi: bigint): string {
  const negative = centi < 0n;
  const abs = negative ? -centi : centi;
  let fraction = (abs % 100n).toString().padStart(2, '0');
  while (fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  const text = `${abs / 100n}${fraction === '' ? '' : `.${fraction}`}`;
  return negative ? `-${text}` : text;
}

/** Entier positif → « 12.34 » (deux décimales fixes) à partir de centièmes. */
export function formatFixed2(centi: bigint): string {
  const negative = centi < 0n;
  const abs = negative ? -centi : centi;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Quotient `num / den` arrondi au plus proche, la moitié vers le haut ; `num` ≥ 0, `den` > 0. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n || num < 0n) throw new RangeError('Division hors domaine');
  const q = num / den;
  return (num % den) * 2n >= den ? q + 1n : q;
}

/** Pour cent à deux décimales (« 4.17 ») de `num / den`, `null` si `den` est nul. */
export function percentOf(num: bigint, den: bigint): string | null {
  if (den === 0n) return null;
  return formatFixed2(divHalfUp(num * 10_000n, den));
}

export function checkDay(value: unknown, what: string): HrDay {
  if (!isCalendarDay(value))
    throw new RangeError(`${what} : date illisible ${JSON.stringify(value)}`);
  return value;
}

export function checkNullableDay(value: unknown, what: string): HrDay | null {
  if (value === null || value === undefined) return null;
  return checkDay(value, what);
}

/** Jour de la semaine d'une date (le 1970-01-01 est un jeudi). */
export function weekdayOf(day: HrDay): Weekday {
  const index = (((dayNumber(day) + 3) % 7) + 7) % 7; // 0 = lundi
  return WEEKDAYS[index] as Weekday;
}

/** Fraction travaillée en centièmes (0, 50, 100). */
export function fractionCenti(pattern: WorkPattern, weekday: Weekday): bigint {
  const f: unknown = pattern[weekday];
  if (f === 1) return DAY;
  if (f === 0.5) return HALF;
  if (f === 0) return 0n;
  throw new RangeError(`Semaine de travail : ${weekday} vaut 0, 0.5 ou 1, reçu ${String(f)}`);
}

export function checkWorkPattern(pattern: unknown, what = 'Semaine de travail'): WorkPattern {
  if (typeof pattern !== 'object' || pattern === null) {
    throw new RangeError(`${what} : objet { mon…sun } attendu`);
  }
  for (const d of WEEKDAYS) fractionCenti(pattern as WorkPattern, d);
  return pattern as WorkPattern;
}

/** Ensemble de demi-journées : bit 1 = matin, bit 2 = après-midi. */
export type Halves = number;
export const AM = 1;
export const PM = 2;
export const BOTH = AM | PM;

export const halvesCount = (h: Halves): number => (h & AM ? 1 : 0) + (h & PM ? 1 : 0);

export function halvesList(h: Halves): HalfDay[] {
  const out: HalfDay[] = [];
  if (h & AM) out.push('am');
  if (h & PM) out.push('pm');
  return out;
}

export function halvesLabel(h: Halves): HalfDay | 'full' | null {
  if (h === BOTH) return 'full';
  if (h === AM) return 'am';
  if (h === PM) return 'pm';
  return null;
}

/**
 * Jours décomptés sur un jour : la semaine de travail donne une fraction `p`
 * (0, ½, 1) ; une demi-journée travaillée n'est pas située dans la journée, si
 * bien que le décompte vaut min(p, ½ × demi-journées couvertes et non fériées).
 */
export function countedCenti(pattern: bigint, covered: Halves): bigint {
  const halves = BigInt(halvesCount(covered)) * HALF;
  return pattern < halves ? pattern : halves;
}

/** Index des fériés : par date exacte et par `MM-JJ` récurrent. */
export interface HolidayIndex {
  /** Demi-journées fériées d'un jour (0 = aucune). */
  halvesOn(day: HrDay): Halves;
  labelOn(day: HrDay): string | null;
}

export function holidayIndex(holidays: readonly HolidayInput[]): HolidayIndex {
  const exact = new Map<string, { halves: Halves; label: string | null }>();
  const recurring = new Map<string, { halves: Halves; label: string | null }>();
  for (const [i, h] of holidays.entries()) {
    const date = checkDay(h.date, `Férié n° ${i + 1}`);
    if (h.halfDay !== null && h.halfDay !== 'am' && h.halfDay !== 'pm') {
      throw new RangeError(`Férié n° ${i + 1} : demi-journée « am », « pm » ou null attendue`);
    }
    const halves = h.halfDay === 'am' ? AM : h.halfDay === 'pm' ? PM : BOTH;
    const target = h.recurring ? recurring : exact;
    const key = h.recurring ? date.slice(5) : date;
    const prev = target.get(key);
    target.set(key, {
      halves: (prev?.halves ?? 0) | halves,
      label: prev?.label ?? h.label ?? null,
    });
  }
  return {
    halvesOn(day) {
      return (exact.get(day)?.halves ?? 0) | (recurring.get(day.slice(5))?.halves ?? 0);
    },
    labelOn(day) {
      return exact.get(day)?.label ?? recurring.get(day.slice(5))?.label ?? null;
    },
  };
}

// ─── Créneaux (demi-journées absolues) ───────────────────────────────────────

export function checkBound(bound: LeaveBound, what: string): LeaveBound {
  if (typeof bound !== 'object' || bound === null) throw new RangeError(`${what} : borne attendue`);
  checkDay(bound.date, what);
  if (bound.half !== 'full' && bound.half !== 'am' && bound.half !== 'pm') {
    throw new RangeError(`${what} : demi-journée « full », « am » ou « pm » attendue`);
  }
  return bound;
}

/** Premier créneau couvert par une borne de début. */
export const startSlot = (b: LeaveBound): number =>
  dayNumber(b.date) * 2 + (b.half === 'pm' ? 1 : 0);
/** Dernier créneau couvert par une borne de fin. */
export const endSlot = (b: LeaveBound): number => dayNumber(b.date) * 2 + (b.half === 'am' ? 0 : 1);

/** Intervalle de créneaux `[first, last]` d'une période, après contrôle. */
export function slotsOf(start: LeaveBound, end: LeaveBound, what: string): [number, number] {
  checkBound(start, `${what} (début)`);
  checkBound(end, `${what} (fin)`);
  const first = startSlot(start);
  const last = endSlot(end);
  if (last < first) throw new RangeError(`${what} : la fin précède le début`);
  return [first, last];
}

/** Demi-journées du jour `n` couvertes par l'intervalle `[first, last]`. */
export function halvesOfDay(n: number, first: number, last: number): Halves {
  let h = 0;
  if (2 * n >= first && 2 * n <= last) h |= AM;
  if (2 * n + 1 >= first && 2 * n + 1 <= last) h |= PM;
  return h;
}

/** Borne de début d'un créneau. */
export function boundOfStartSlot(slot: number): LeaveBound {
  return { date: dayOfNumber(Math.floor(slot / 2)), half: slot % 2 === 0 ? 'full' : 'pm' };
}

/** Borne de fin d'un créneau. */
export function boundOfEndSlot(slot: number): LeaveBound {
  return { date: dayOfNumber(Math.floor(slot / 2)), half: slot % 2 === 1 ? 'full' : 'am' };
}

// ─── Années de congé ─────────────────────────────────────────────────────────

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

export function checkLeaveYearStart(value: unknown): { month: number; day: number } {
  const m = typeof value === 'string' ? MONTH_DAY.exec(value) : null;
  if (m === null) throw new RangeError(`Début d’année de congé : « MM-JJ » attendu`);
  const month = Number.parseInt(m[1] ?? '', 10);
  const day = Number.parseInt(m[2] ?? '', 10);
  if (month < 1 || month > 12 || day < 1 || day > 28 + (month === 2 ? 0 : 3)) {
    throw new RangeError(
      `Début d’année de congé : ${String(value)} invalide (le 29 février exclu)`,
    );
  }
  const limit = clampedDay(2001, month, day); // année non bissextile
  if (Number.parseInt(limit.slice(8), 10) !== day) {
    throw new RangeError(`Début d’année de congé : ${String(value)} invalide`);
  }
  return { month, day };
}

/** Premier jour de l'année de congé `year`. */
export function leaveYearStartDay(year: number, start: LeaveYearStart): HrDay {
  const { month, day } = checkLeaveYearStart(start);
  return clampedDay(year, month, day);
}

/** Année de congé (année civile de son premier jour) qui contient `day`. */
export function leaveYearContaining(day: HrDay, start: LeaveYearStart): number {
  const { year } = partsOf(day);
  return day >= leaveYearStartDay(year, start) ? year : year - 1;
}

/** Ajoute `months` mois à une date, quantième ramené au dernier jour du mois. */
export function addMonths(day: HrDay, months: number): HrDay {
  const p = partsOf(day);
  const index = p.year * 12 + (p.month - 1) + months;
  return clampedDay(Math.floor(index / 12), (index % 12) + 1, p.day);
}

/** Jours civils de `from` à `to`, bornes comprises (0 si vide). */
export function spanDays(from: HrDay, to: HrDay): number {
  const n = dayNumber(to) - dayNumber(from) + 1;
  return n > 0 ? n : 0;
}

export const maxDay = (a: HrDay, b: HrDay): HrDay => (a > b ? a : b);
export const minDay = (a: HrDay, b: HrDay): HrDay => (a < b ? a : b);

/** Comparateur de chaînes stable (ordre des points de code). */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function checkId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '')
    throw new RangeError(`${what} : identifiant attendu`);
  return value;
}

export function checkIntegerIn(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} : entier de ${min} à ${max} attendu`);
  }
  return value;
}
