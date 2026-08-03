// Argent — jamais de flottant. Brief §5-5 + §5-6, ADR-0004.
// Montants en entiers (centimes). Pourcentages/taux via string ou Decimal128 côté DB.

import { z } from 'zod';

export const CURRENCIES = ['USD', 'CDF'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Sous-schéma Zod pour la valeur d'un montant. */
export const MoneySchema = z.object({
  /** Montant en plus petite unité (centimes USD, francs CDF entiers). */
  amount: z.number().int().finite(),
  currency: z.enum(CURRENCIES),
});

export type Money = z.infer<typeof MoneySchema>;

/** Construit un Money à partir d'une unité principale (dollars, francs) — utilisé aux frontières. */
export function money(amountInMajorUnit: number, currency: Currency): Money {
  if (!Number.isFinite(amountInMajorUnit)) {
    throw new RangeError('money(): amount must be finite');
  }
  // 1 USD = 100 cents ; 1 CDF est déjà indivisible en pratique → conversion identique.
  const factor = currency === 'USD' ? 100 : 1;
  return { amount: Math.round(amountInMajorUnit * factor), currency };
}

/** Somme sûre — même devise obligatoire. */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`addMoney(): currency mismatch ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Formatage humain — utilisé pour l'affichage UNIQUEMENT, jamais pour du stockage. */
export function formatMoney(m: Money, locale = 'fr-CD'): string {
  const factor = m.currency === 'USD' ? 100 : 1;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: m.currency === 'USD' ? 2 : 0,
  }).format(m.amount / factor);
}
