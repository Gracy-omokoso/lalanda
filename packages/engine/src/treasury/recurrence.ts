// Occurrences d'une dépense récurrente (ADR-0034 § 3).
//
// Règle : la date de début, puis tous les 7 jours (`weekly`), ou le MÊME
// QUANTIÈME tous les 1, 3 ou 12 mois, ramené au dernier jour du mois quand il
// n'existe pas. Le quantième est toujours celui de la date de début : un
// 31 janvier donne 28/29 février PUIS 31 mars, jamais 28 mars (l'erreur classique
// de l'itération « date précédente + 1 mois »).

import { addDays, clampedDay, dayNumber, partsOf } from './calendar.js';
import { divHalfUp, trustedCents } from './money.js';
import type { CalendarDay, RecurrenceFrequency, RecurrenceRule } from './types.js';

/** Garde-fou : une fenêtre ne produit jamais plus d'occurrences que cela. */
const MAX_OCCURRENCES = 2_000;

const MONTH_STEP: Record<Exclude<RecurrenceFrequency, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** k-ième occurrence (k ≥ 0) d'une règle, sans tenir compte de la date de fin. */
export function nthOccurrence(rule: RecurrenceRule, k: number): CalendarDay {
  if (rule.frequency === 'weekly') return addDays(rule.startDate, 7 * k);
  const start = partsOf(rule.startDate);
  const months = start.month - 1 + MONTH_STEP[rule.frequency] * k;
  const year = start.year + Math.floor(months / 12);
  const month = (months % 12) + 1;
  return clampedDay(year, month, start.day);
}

/**
 * Occurrences d'une règle dans la fenêtre fermée `[from, to]`, triées et sans
 * doublon, bornées par la date de début et la date de fin éventuelle.
 */
export function occurrencesOf(
  rule: RecurrenceRule,
  from: CalendarDay,
  to: CalendarDay,
): CalendarDay[] {
  const lower = Math.max(dayNumber(from), dayNumber(rule.startDate));
  let upper = dayNumber(to);
  if (rule.endDate !== null) upper = Math.min(upper, dayNumber(rule.endDate));
  if (lower > upper) return [];

  // Premier rang candidat : on part d'un rang qui ne peut pas dépasser `lower`,
  // pour ne pas itérer depuis le début d'une règle ancienne.
  const startN = dayNumber(rule.startDate);
  let k: number;
  if (rule.frequency === 'weekly') {
    k = Math.max(0, Math.floor((lower - startN) / 7));
  } else {
    // Une période d'au moins 28 jours × pas : rang plancher prudent.
    const step = MONTH_STEP[rule.frequency];
    k = Math.max(0, Math.floor((lower - startN) / (31 * step)) - 1);
  }

  const out: CalendarDay[] = [];
  for (let guard = 0; guard < MAX_OCCURRENCES * 4; guard += 1) {
    const occurrence = nthOccurrence(rule, k);
    const n = dayNumber(occurrence);
    if (n > upper) break;
    if (n >= lower) {
      out.push(occurrence);
      if (out.length >= MAX_OCCURRENCES) break;
    }
    k += 1;
  }
  return out;
}

/** Une date est-elle une occurrence de la règle ? */
export function isOccurrenceOf(rule: RecurrenceRule, day: CalendarDay): boolean {
  return occurrencesOf(rule, day, day).length === 1;
}

/**
 * Équivalent mensuel en centimes d'un montant récurrent (hebdomadaire × 52 ÷ 12,
 * trimestriel ÷ 3, annuel ÷ 12), arrondi au centime. Sert seulement à éviter le
 * double compte d'une charge du plan dans la prévision (ADR-0034 § 7).
 */
export function monthlyEquivalentCents(amount: string, frequency: RecurrenceFrequency): bigint {
  const cents = trustedCents(amount, 'Montant récurrent');
  switch (frequency) {
    case 'weekly':
      return divHalfUp(cents * 52n, 12n);
    case 'monthly':
      return cents;
    case 'quarterly':
      return divHalfUp(cents, 3n);
    case 'yearly':
      return divHalfUp(cents, 12n);
  }
}
