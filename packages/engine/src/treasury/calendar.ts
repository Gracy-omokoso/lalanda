// Calendrier civil de la trésorerie (ADR-0034) — dates `AAAA-MM-JJ` sans heure.
//
// Les dates sont déjà ramenées au jour civil de Kinshasa par l'appelant
// (ADR-0027) : ce fichier ne connaît aucun fuseau. Un jour est manipulé comme
// un numéro de jour depuis l'époque Unix, calculé en UTC pur.

import type { CalendarDay, CalendarMonthKey } from './types.js';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Nombre d'exercices d'un plan (docs/07 : horizon de 5 exercices). */
export const PLAN_EXERCISE_COUNT = 5;

export function isCalendarDay(value: unknown): value is CalendarDay {
  if (typeof value !== 'string') return false;
  const m = DAY.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isCalendarMonthKey(value: unknown): value is CalendarMonthKey {
  if (typeof value !== 'string') return false;
  const m = MONTH.exec(value);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 1900 && year <= 2999 && month >= 1 && month <= 12;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parties numériques d'une date déjà validée. */
export function partsOf(day: CalendarDay): { year: number; month: number; day: number } {
  const m = DAY.exec(day);
  if (m === null) throw new RangeError(`Date invalide : ${day}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function dayNumber(day: CalendarDay): number {
  const p = partsOf(day);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / MS_PER_DAY);
}

export function dayOfNumber(n: number): CalendarDay {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(day: CalendarDay, n: number): CalendarDay {
  return dayOfNumber(dayNumber(day) + n);
}

export function monthKeyOf(day: CalendarDay): CalendarMonthKey {
  return day.slice(0, 7);
}

/** Date de l'année et du mois donnés, au quantième `day` ramené au dernier jour du mois. */
export function clampedDay(year: number, month: number, day: number): CalendarDay {
  const d = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Index absolu d'un mois (année × 12 + mois − 1). */
export function monthIndex(key: CalendarMonthKey): number {
  const m = MONTH.exec(key);
  if (m === null) throw new RangeError(`Mois invalide : ${key}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/**
 * (Exercice, mois d'exercice) du mois civil `month`, l'exercice 1 s'ouvrant au mois
 * civil `firstMonth` : exercice `1 + ⌊écart / 12⌋`, mois `1 + écart mod 12`
 * (même règle qu'ADR-0031 § 3). `null` hors des exercices 1 à 5.
 */
export function exercisePeriodOf(
  month: CalendarMonthKey,
  firstMonth: CalendarMonthKey,
): { year: number; month: number } | null {
  const offset = monthIndex(month) - monthIndex(firstMonth);
  if (offset < 0) return null;
  const year = 1 + Math.floor(offset / 12);
  if (year > PLAN_EXERCISE_COUNT) return null;
  return { year, month: 1 + (offset % 12) };
}
