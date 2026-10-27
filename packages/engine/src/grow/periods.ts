// ─────────────────────────────────────────────────────────────────────────────
// GROW — mois civils de Kinshasa et mois d'exercice (ADR-0032 § 2)
//
// Les ventes se lisent par mois CIVIL de Kinshasa (UTC+1, sans heure d'été :
// ADR-0027) ; le réalisé BUILD par mois d'EXERCICE (docs/08, convention 1), qui
// n'est ancré sur aucune date. Les deux calendriers ne sont jamais confondus.
// ─────────────────────────────────────────────────────────────────────────────

import type { GrowActualPeriod, GrowDate, GrowMonth } from './types.js';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
/** Décalage de Kinshasa sur UTC, en millisecondes (UTC+1, sans heure d'été). */
const KINSHASA_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** `AAAA-MM-JJ` valide (calendrier grégorien), sinon `RangeError`. */
export function parseGrowDate(value: GrowDate): { year: number; month: number; day: number } {
  const m = DATE.exec(value);
  if (!m) throw new RangeError(`Date AAAA-MM-JJ attendue, reçu ${JSON.stringify(value)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Date inexistante : ${value}`);
  }
  return { year, month, day };
}

/** Nombre de jours de `from` à `to` (positif si `to` est après `from`). */
export function daysBetween(from: GrowDate, to: GrowDate): number {
  const a = parseGrowDate(from);
  const b = parseGrowDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}

/** Mois civil de Kinshasa d'un instant ISO ; `null` si l'instant est illisible. */
export function kinshasaMonthOf(instant: string): GrowMonth | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + KINSHASA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** Date civile de Kinshasa d'un instant ISO ; `null` si l'instant est illisible. */
export function kinshasaDateOf(instant: string): GrowDate | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + KINSHASA_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Décale un mois `AAAA-MM` de `delta` mois. */
export function addMonths(month: GrowMonth, delta: number): GrowMonth {
  const m = MONTH.exec(month);
  if (!m) throw new RangeError(`Mois AAAA-MM attendu, reçu ${JSON.stringify(month)}`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

/** Comparaison lexicographique, exacte pour `AAAA-MM`. */
export function compareMonths(a: GrowMonth, b: GrowMonth): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Dernier mois civil COMPLET avant la date du calcul : le mois précédent. */
export function lastCompleteMonth(asOf: GrowDate): GrowMonth {
  const { year, month } = parseGrowDate(asOf);
  return addMonths(`${year}-${pad2(month)}`, -1);
}

/** `count` mois consécutifs se terminant par `last`, dans l'ordre chronologique. */
export function monthWindow(last: GrowMonth, count: number): GrowMonth[] {
  const out: GrowMonth[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addMonths(last, -i));
  return out;
}

/** Libellé d'un mois d'exercice : `E1-M04`. */
export function exerciseLabel(p: Pick<GrowActualPeriod, 'year' | 'month'>): string {
  return `E${p.year}-M${pad2(p.month)}`;
}

/** Libellé lisible d'un mois civil : `2026-09` → « sept. 2026 ». */
export function monthLabel(month: GrowMonth): string {
  const NOMS = [
    'janv.',
    'févr.',
    'mars',
    'avr.',
    'mai',
    'juin',
    'juil.',
    'août',
    'sept.',
    'oct.',
    'nov.',
    'déc.',
  ];
  const m = MONTH.exec(month);
  if (!m) return month;
  return `${NOMS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
