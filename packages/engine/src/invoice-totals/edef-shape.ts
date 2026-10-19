// ─────────────────────────────────────────────────────────────────────────────
// Forme des totaux de l'API e-DEF et comparaison avec la réponse de la DGI
// (ADR-0022 § S25d.3 ; règle DGI n° 8, ADR-0019 : écart ⇒ annulation).
//
// Les champs de la réponse (`InvoiceResponseDto`) : taux `ta`…`tp`, totaux
// `taa`…`tap`, HT `haa`…`hap`, TVA `vaa`…`vap`, `ts`, `total`, `vtotal`. La
// spécification v2.0 les étend jusqu'à Z ; Q à Z n'étant définis par aucun
// document, ils ne sont ni produits ni comparés.
//
// Seul ce fichier manipule des `number` JavaScript, et seulement dans le bloc
// « frontière JSON » ci-dessous : c'est la conversion vers et depuis le format
// d'échange, jamais un calcul.
// ─────────────────────────────────────────────────────────────────────────────

import { formatTrimmed, parseFixed, splitDecimal, type Fixed } from './decimal.js';
import { parseRates } from './compute.js';
import {
  TAX_GROUP_LETTERS,
  type DecimalString,
  type InvoiceTotals,
  type TaxGroupLetter,
  type TaxRateTable,
} from './types.js';

type L = Lowercase<TaxGroupLetter>;

/** Totaux au format e-DEF ; les seize groupes sont présents. */
export type EdefTotals = { [K in `t${L}`]: DecimalString | null } & {
  [K in `ta${L}` | `ha${L}` | `va${L}`]: DecimalString;
} & { ts: DecimalString; total: DecimalString; vtotal: DecimalString };

const LOWER_LETTERS = TAX_GROUP_LETTERS.map((letter) => letter.toLowerCase() as L);

/** Les 67 champs comparés, dans l'ordre de la réponse : taux, totaux, HT, TVA, puis ts, total, vtotal. */
export const EDEF_TOTALS_FIELDS: readonly (keyof EdefTotals)[] = Object.freeze([
  ...LOWER_LETTERS.map((l) => `t${l}` as const),
  ...LOWER_LETTERS.map((l) => `ta${l}` as const),
  ...LOWER_LETTERS.map((l) => `ha${l}` as const),
  ...LOWER_LETTERS.map((l) => `va${l}` as const),
  'ts',
  'total',
  'vtotal',
]);

/**
 * Forme des totaux de l'API e-DEF. Un groupe inutilisé vaut "0.00" ; un taux
 * absent du tableau vaut null. Lève une erreur si le tableau porte un taux
 * invalide (`computeInvoiceTotals` l'aurait déjà refusé).
 */
export function toEdefTotals(totals: InvoiceTotals, rates: TaxRateTable): EdefTotals {
  const parsed = parseRates(rates);
  if (parsed.issues.length > 0) {
    throw new RangeError(parsed.issues.map((i) => i.message).join(' '));
  }
  const out: Record<string, DecimalString | null> = {};
  for (const letter of TAX_GROUP_LETTERS) {
    const rate = parsed.rates.get(letter);
    out[`t${letter.toLowerCase()}`] = rate === undefined ? null : formatTrimmed(rate);
  }
  for (const letter of TAX_GROUP_LETTERS) {
    const group = totals.groups.find((g) => g.group === letter);
    const l = letter.toLowerCase();
    out[`ta${l}`] = group?.total ?? '0.00';
    out[`ha${l}`] = group?.ht ?? '0.00';
    out[`va${l}`] = group?.vat ?? '0.00';
  }
  out.ts = totals.specificTax;
  out.total = totals.total;
  out.vtotal = totals.vatTotal;
  // Réordonne selon EDEF_TOTALS_FIELDS (taux, puis totaux, HT, TVA par groupe).
  const ordered: Record<string, DecimalString | null> = {};
  for (const field of EDEF_TOTALS_FIELDS) ordered[field] = out[field] ?? null;
  return ordered as EdefTotals;
}

export interface TotalsDifference {
  field: string;
  ours: DecimalString | null;
  dgi: string | null;
}

/** Valeur reçue de la DGI : `absent` (vaut 0), décimal lisible, ou valeur illisible. */
type Received =
  | { kind: 'absent' }
  | { kind: 'decimal'; text: DecimalString; fixed: Fixed }
  | { kind: 'unreadable'; text: string };

function readReceived(value: unknown): Received {
  if (value === undefined || value === null) return { kind: 'absent' };
  let text: DecimalString | null = null;
  if (typeof value === 'number') text = decimalFromJsonNumber(value);
  else if (typeof value === 'string' && isValidDecimal(value, 2)) text = value;
  const fixed = text === null ? null : parseFixed(text);
  if (text === null || fixed === null) {
    return { kind: 'unreadable', text: typeof value === 'string' ? value : JSON.stringify(value) };
  }
  return { kind: 'decimal', text, fixed };
}

/**
 * Compare nos totaux à la réponse brute de `POST /api/invoice` (S25f).
 *
 * - Un champ absent (ou `null`) de la réponse vaut 0.
 * - Une valeur qui n'est pas un décimal à 2 décimales au plus (nombre JSON, ou
 *   chaîne décimale canonique) est une différence : jamais d'arrondi pour
 *   « faire coïncider ».
 * - Un taux que nous ne connaissons pas (null de notre côté) n'est pas comparé :
 *   il ne concerne aucun groupe de la facture, dont tous les taux sont connus.
 */
export function compareWithEdefResponse(
  ours: InvoiceTotals,
  rates: TaxRateTable,
  response: Readonly<Record<string, unknown>>,
): { identical: boolean; differences: readonly TotalsDifference[] } {
  const edef = toEdefTotals(ours, rates);
  const differences: TotalsDifference[] = [];
  for (const field of EDEF_TOTALS_FIELDS) {
    const mine = edef[field];
    if (mine === null) continue;
    const received = readReceived(response[field]);
    const mineFixed = parseFixed(mine);
    if (received.kind === 'unreadable') {
      differences.push({ field, ours: mine, dgi: received.text });
    } else if (received.kind === 'absent') {
      if (mineFixed !== 0n) differences.push({ field, ours: mine, dgi: null });
    } else if (received.fixed !== mineFixed) {
      differences.push({ field, ours: mine, dgi: received.text });
    }
  }
  return { identical: differences.length === 0, differences };
}

// ── frontière JSON : début ───────────────────────────────────────────────────
// Seul endroit du module où un `number` JavaScript apparaît (test de lecture
// des sources). Ces fonctions convertissent, elles ne calculent pas.

/** Vrai pour un décimal canonique `/^\d+(\.\d+)?$/` d'au plus `maxDecimals` décimales. */
export function isValidDecimal(value: string, maxDecimals: number): boolean {
  const parts = splitDecimal(value);
  return parts !== null && parts.fraction.length <= maxDecimals;
}

/**
 * Nombre JSON reçu de la DGI → décimal canonique, par sa représentation la plus
 * courte (`String(n)`). null si non fini, négatif, en notation exponentielle ou
 * à plus de 2 décimales.
 */
export function decimalFromJsonNumber(value: number): DecimalString | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  return isValidDecimal(text, 2) ? text : null;
}

/**
 * Décimal canonique → nombre JSON pour l'envoi. Exact pour 15 chiffres
 * significatifs au plus ; au-delà, lève une erreur plutôt que d'envoyer un
 * nombre arrondi.
 */
export function decimalToJsonNumber(value: DecimalString): number {
  const parts = splitDecimal(value);
  if (parts === null) throw new RangeError(`Décimal invalide : ${JSON.stringify(value)}`);
  const digits = (parts.integer + parts.fraction).replace(/^0+/, '');
  if (digits.length > 15) {
    throw new RangeError(`Plus de 15 chiffres significatifs : ${value} ne serait pas exact.`);
  }
  return Number(value);
}
// ── frontière JSON : fin ─────────────────────────────────────────────────────
