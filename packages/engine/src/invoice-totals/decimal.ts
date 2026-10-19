// ─────────────────────────────────────────────────────────────────────────────
// Arithmétique décimale exacte du calcul des factures (ADR-0022 § S25d.3, O3)
//
// Fichier INTERNE : il n'est pas réexporté par le moteur. Chaque valeur est un
// entier `bigint` qui représente le décimal multiplié par 10⁸ (« virgule fixe »).
// Pourquoi 10⁸ : le produit prix (2 déc.) × quantité (3 déc.) vit à 10⁻⁵, un
// taux DGI peut porter quelques décimales ; 10⁸ les contient tous exactement.
//
// Aucune division implicite : une division ne se fait qu'au moment d'un arrondi
// explicite (`divRound`, `roundRatio`), avec le mode écrit en toutes lettres.
// Aucun type flottant natif n'apparaît dans ce fichier (test de lecture des
// sources dans `invoice-totals.test.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Décimal en virgule fixe : valeur × 10⁸. */
export type Fixed = bigint;

/** 1 en virgule fixe. */
export const SCALE: Fixed = 100_000_000n;
/** Un centime en virgule fixe. */
export const CENT: Fixed = 1_000_000n;
/** Nombre de décimales représentables exactement. */
const SCALE_DIGITS = 8;

/**
 * Modes d'arrondi nommés (ADR-0022 § S25d.3) :
 * - `half_up` : au plus proche, la moitié vers +∞ (« demi vers le haut ») ;
 * - `up` : vers +∞ (centime supérieur dès qu'il reste une fraction) ;
 * - `down` : vers −∞.
 * Les montants d'une facture étant positifs, « vers +∞ » et « en s'éloignant de
 * zéro » coïncident ; la définition reste exacte pour un négatif.
 */
export type RoundingMode = 'half_up' | 'up' | 'down';

const CANONICAL = /^(\d+)(?:\.(\d+))?$/;
const NEGATIVE = /^-\d+(?:\.\d+)?$/;
const ZERO = /^0+(?:\.0+)?$/;

/** Parties d'un décimal canonique `/^\d+(\.\d+)?$/`, ou `null`. */
export function splitDecimal(value: unknown): { integer: string; fraction: string } | null {
  if (typeof value !== 'string') return null;
  const match = CANONICAL.exec(value);
  if (match === null) return null;
  return { integer: match[1] ?? '', fraction: match[2] ?? '' };
}

/** Vrai pour une chaîne de la forme d'un décimal précédé d'un signe moins. */
export function looksNegative(value: unknown): boolean {
  return typeof value === 'string' && NEGATIVE.test(value);
}

/** Vrai pour un décimal canonique de valeur nulle (« 0 », « 0.00 », « 000.0 »). */
export function isZeroDecimal(value: string): boolean {
  return ZERO.test(value);
}

/** Vrai si le décimal canonique porte au plus `max` décimales. */
export function hasAtMostDecimals(
  parts: { fraction: string },
  max: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): boolean {
  return parts.fraction.length <= max;
}

/** Décimal canonique d'au plus 8 décimales → virgule fixe ; `null` sinon. */
export function parseFixed(value: unknown): Fixed | null {
  const parts = splitDecimal(value);
  if (parts === null || parts.fraction.length > SCALE_DIGITS) return null;
  const fraction = parts.fraction.padEnd(SCALE_DIGITS, '0');
  return BigInt(parts.integer) * SCALE + BigInt(fraction);
}

/** Comme `parseFixed`, mais lève une erreur : pour les valeurs déjà validées. */
export function fixedOf(value: string): Fixed {
  const fixed = parseFixed(value);
  if (fixed === null) throw new RangeError(`Décimal invalide : ${JSON.stringify(value)}`);
  return fixed;
}

/** Quotient entier `num / den` arrondi selon `mode` ; `den` strictement positif. */
export function divRound(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den <= 0n) throw new RangeError('Division par un dénominateur nul ou négatif');
  let floor = num / den; // division entière tronquée vers zéro
  const rest = num % den;
  if (rest < 0n) floor -= 1n; // ramène la troncature à un plancher
  const remainder = num - floor * den; // 0 ≤ remainder < den
  switch (mode) {
    case 'down':
      return floor;
    case 'up':
      return remainder === 0n ? floor : floor + 1n;
    case 'half_up':
      return remainder * 2n >= den ? floor + 1n : floor;
  }
}

/** Arrondi au centime selon `mode`. */
export function roundToCents(value: Fixed, mode: RoundingMode): Fixed {
  return divRound(value, CENT, mode) * CENT;
}

/** Arrondi au centime le plus proche, demi vers le haut. */
export function roundHalfUp(value: Fixed): Fixed {
  return roundToCents(value, 'half_up');
}

/** Arrondi au centime supérieur (vers +∞). */
export function roundUp(value: Fixed): Fixed {
  return roundToCents(value, 'up');
}

/** Arrondi au centime inférieur (vers −∞). */
export function roundDown(value: Fixed): Fixed {
  return roundToCents(value, 'down');
}

/**
 * Arrondi au centime de la valeur EXACTE `num / den`, où `num / den` est
 * exprimé en virgule fixe. Une seule division, à la toute fin : aucun résultat
 * intermédiaire n'est tronqué.
 */
export function roundRatio(num: bigint, den: bigint, mode: RoundingMode): Fixed {
  return divRound(num, den * CENT, mode) * CENT;
}

/** Produit exact de deux virgules fixes ; lève une erreur s'il dépasse 8 décimales. */
export function mulExact(a: Fixed, b: Fixed): Fixed {
  const product = a * b;
  if (product % SCALE !== 0n) {
    throw new RangeError('Produit non représentable exactement à 8 décimales');
  }
  return product / SCALE;
}

/** Virgule fixe → décimal canonique à exactement 2 décimales ; la valeur doit être au centime. */
export function formatAmount(value: Fixed): string {
  if (value < 0n) throw new RangeError('Montant négatif non représentable');
  if (value % CENT !== 0n) throw new RangeError('Montant non arrondi au centime');
  const cents = value / CENT;
  const integer = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${integer.toString()}.${fraction}`;
}

/** Virgule fixe → décimal canonique le plus court (« 16 », « 16.5 », « 0 »). */
export function formatTrimmed(value: Fixed): string {
  if (value < 0n) throw new RangeError('Valeur négative non représentable');
  const integer = (value / SCALE).toString();
  const fraction = (value % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return fraction === '' ? integer : `${integer}.${fraction}`;
}
