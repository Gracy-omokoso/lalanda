// ─────────────────────────────────────────────────────────────────────────────
// Passage d'un document de vente à la DEVISE DE RÉFÉRENCE des tableaux de bord
// (ADR-0056 § 3, repris par ADR-0067 pour les devis et les encaissements).
//
// Une seule règle, partagée par tous les tableaux de bord des ventes :
// - même devise : rapport 1 ;
// - référence CDF : total CDF de la normalisation (parts au prorata), sinon
//   conversion figée du document (`from` → CDF) ;
// - référence USD, document CDF : contre-valeur USD figée sur la facture ;
// - sinon `null` : aucun taux enregistré, le document est EXCLU DES MONTANTS ET
//   COMPTÉ par l'appelant. Jamais un taux du jour, d'une autre pièce ni inverse.
//
// Arithmétique exacte en virgule fixe (`bigint`, 10⁸), arrondi au centime demi
// vers le haut à chaque conversion. Fichier interne au module.
// ─────────────────────────────────────────────────────────────────────────────

import { CENT, divRound, parseFixed, type Fixed } from '../invoice-totals/decimal.js';
import type { DecimalString } from '../invoice-totals/types.js';

export type StatsCurrency = 'CDF' | 'USD';

/** Ce qu'il faut d'un document pour le convertir (valeurs figées). */
export interface ReferenceRateDocument {
  currency: StatsCurrency;
  /** Total TTC du document dans sa devise, `null` s'il n'est pas calculable. */
  total: DecimalString | null;
  /** Total TTC CDF de la normalisation (seul à valeur fiscale), sinon `null`. */
  normalizedTotalCdf: DecimalString | null;
  /** Conversion figée du document : 1 `from` = `rate` `to`. */
  conversion: { from: string; to: string; rate: string } | null;
  /** Contre-valeur USD figée d'un document CDF (montant du total). */
  usdCounterValue: DecimalString | null;
}

/** Rapport figé document → référence : montant × num / den. `null` : non convertible. */
export type Ratio = { num: Fixed; den: Fixed } | null;

const ONE: Fixed = parseFixed('1') as Fixed;

function fixed(value: string, what: string): Fixed {
  const v = parseFixed(value);
  if (v === null) throw new RangeError(`${what} illisible : ${JSON.stringify(value)}`);
  return v;
}

export function referenceRatioOf(doc: ReferenceRateDocument, ref: StatsCurrency): Ratio {
  if (doc.currency === ref) return { num: ONE, den: ONE };
  const total = doc.total === null ? null : fixed(doc.total, 'Total');
  if (ref === 'CDF') {
    if (doc.normalizedTotalCdf !== null && total !== null && total > 0n) {
      return { num: fixed(doc.normalizedTotalCdf, 'Total normalisé'), den: total };
    }
    const c = doc.conversion;
    if (c !== null && c.from === doc.currency && c.to === 'CDF') {
      const rate = fixed(c.rate, 'Taux');
      if (rate > 0n) return { num: rate, den: ONE };
    }
    return null;
  }
  // Référence USD, document CDF : contre-valeur figée sur la facture.
  if (doc.usdCounterValue !== null && total !== null && total > 0n) {
    return { num: fixed(doc.usdCounterValue, 'Contre-valeur USD'), den: total };
  }
  return null;
}

/** Montant converti, arrondi au centime demi vers le haut. */
export function convertAtRatio(amount: Fixed, ratio: { num: Fixed; den: Fixed }): Fixed {
  return divRound(amount * ratio.num, ratio.den * CENT, 'half_up') * CENT;
}

/** Mois civil décalé de `delta` mois : `2026-01` − 1 → `2025-12`. */
export function addMonths(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${year}-${String(mm + 1).padStart(2, '0')}`;
}

/** Dernier jour civil d'un mois `AAAA-MM`. */
export function lastDayOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const d = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** Numéro de jour d'une date civile (algorithme « days from civil », sans horloge). */
function dayNumber(day: string): number {
  let y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

function dayOfNumber(n: number): string {
  const era = Math.floor(n / 146097);
  const doe = n - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Jour civil décalé de `delta` jours. */
export function addDaysTo(day: string, delta: number): string {
  return dayOfNumber(dayNumber(day) + delta);
}

/** Jours de `a` à `b` (b − a), deux jours civils valides. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** Pourcentage entier arrondi demi vers le haut ; `null` si le dénominateur est nul. */
export function percentOf(num: Fixed, den: Fixed): number | null {
  if (den <= 0n) return null;
  return Number(divRound(num * 100n, den, 'half_up'));
}
