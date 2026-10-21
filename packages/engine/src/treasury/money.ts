// Arithmétique monétaire de la trésorerie (ADR-0034 § 9) — fichier INTERNE.
//
// Un montant est un entier de CENTIMES (`bigint`). Les entrées sont des chaînes
// décimales d'au plus deux décimales, éventuellement signées ; les sorties sont
// toujours formatées à exactement deux décimales. Les taux des scénarios sont
// convertis en points de base (1/10 000) avant toute multiplication : aucun
// flottant n'intervient dans un montant, sauf à l'entrée des prévus du plan,
// arrondis une fois au centime (`centsOfPlanNumber`).

const AMOUNT = /^(-?)(\d{1,15})(?:\.(\d{1,2}))?$/;

/** Centimes d'un montant décimal (deux décimales au plus, signe permis), ou `null`. */
export function centsOf(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = AMOUNT.exec(value);
  if (match === null) return null;
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = BigInt(match[2] ?? '0') * 100n + BigInt(fraction);
  return match[1] === '-' ? -cents : cents;
}

/** Centimes d'un montant strictement positif, ou `null`. */
export function positiveCentsOf(value: unknown): bigint | null {
  const cents = centsOf(value);
  return cents !== null && cents > 0n ? cents : null;
}

/** Comme `centsOf`, mais lève une erreur : pour les valeurs déjà validées par l'appelant. */
export function trustedCents(value: string, what: string): bigint {
  const cents = centsOf(value);
  if (cents === null) throw new RangeError(`${what} : montant invalide ${JSON.stringify(value)}`);
  return cents;
}

/** Centimes → décimal signé à deux décimales (« -12.05 », « 0.00 »). */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const integer = (abs / 100n).toString();
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

/** Centimes → nombre JSON (pour `actual_periods`, qui stocke des nombres). */
export function centsToNumber(cents: bigint): number {
  return Number(cents) / 100;
}

/**
 * Prévu du plan (nombre flottant du snapshot) → centimes, arrondi une seule fois
 * au plus proche, la moitié en s'éloignant de zéro.
 */
export function centsOfPlanNumber(value: number): bigint {
  if (!Number.isFinite(value)) throw new RangeError('Montant du plan non fini');
  const scaled = Math.abs(value) * 100;
  const rounded = BigInt(Math.round(scaled));
  return value < 0 ? -rounded : rounded;
}

/** Taux en fraction (0.9) → points de base entiers (9 000), arrondi au plus proche. */
export function basisPointsOf(rate: number): bigint {
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError('Taux invalide');
  return BigInt(Math.round(rate * 10_000));
}

/** Quotient `num / den` arrondi au plus proche, la moitié en s'éloignant de zéro ; `den` > 0. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('Dénominateur nul ou négatif');
  const negative = num < 0n;
  const abs = negative ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** `cents × taux`, arrondi au centime. */
export function applyRate(cents: bigint, rate: number): bigint {
  return divHalfUp(cents * basisPointsOf(rate), 10_000n);
}

export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((s, v) => s + v, 0n);
}
