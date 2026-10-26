// Dates civiles et passage du mois civil au mois d'exercice (ADR-0031 § 3).
//
// Les dates sont des chaînes `AAAA-MM-JJ` déjà ramenées au jour de Kinshasa par
// l'appelant : ici, aucune horloge et aucun fuseau.

import type { CalendarDate, CalendarMonth, FiscalPeriod } from './types.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
/** Exercices publiés par le plan (docs/08, convention 1 ; horizon de 5 exercices). */
export const PLAN_EXERCISES = 5;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Date civile réelle `AAAA-MM-JJ` (années 2000 à 2999). */
export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (match === null) return false;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (year < 2000 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 && isLeap(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= max;
}

/** Mois civil `AAAA-MM` (années 2000 à 2999). */
export function isCalendarMonth(value: unknown): value is CalendarMonth {
  if (typeof value !== 'string') return false;
  const match = MONTH.exec(value);
  if (match === null) return false;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  return year >= 2000 && year <= 2999 && month >= 1 && month <= 12;
}

/** `2026-10-21` → `2026-10`. */
export function monthOfDate(date: CalendarDate): CalendarMonth {
  if (!isCalendarDate(date)) throw new RangeError(`Date civile illisible : ${date}`);
  return date.slice(0, 7);
}

function monthIndex(month: CalendarMonth): number {
  const match = MONTH.exec(month);
  if (match === null || !isCalendarMonth(month)) {
    throw new RangeError(`Mois civil illisible : ${month}`);
  }
  return Number.parseInt(match[1] ?? '', 10) * 12 + (Number.parseInt(match[2] ?? '', 10) - 1);
}

/**
 * Exercice et mois d'exercice d'un mois civil, l'exercice 1 s'ouvrant au mois
 * `exerciseStart`. `null` avant l'ouverture ou au-delà des 5 exercices du plan.
 */
export function fiscalPeriodOfMonth(
  month: CalendarMonth,
  exerciseStart: CalendarMonth,
): FiscalPeriod | null {
  const offset = monthIndex(month) - monthIndex(exerciseStart);
  if (offset < 0) return null;
  const year = Math.floor(offset / 12) + 1;
  if (year > PLAN_EXERCISES) return null;
  return { year, month: (offset % 12) + 1 };
}
