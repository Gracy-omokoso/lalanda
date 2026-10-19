// ─────────────────────────────────────────────────────────────────────────────
// Prix unitaires : conversion TTC ↔ HT et remises (ADR-0022 § S25d.3, O6)
//
// Le catalogue porte un prix et son mode ; une facture dans l'autre mode
// convertit le prix unitaire (arrondi au plus proche), et c'est ce prix converti
// qui part à la DGI. Une remise ne crée jamais de ligne négative (règle DGI
// n° 6) : elle se traduit par un prix unitaire réduit ; `originalPrice` et
// `priceModification` sont informatifs.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SCALE,
  formatAmount,
  formatTrimmed,
  hasAtMostDecimals,
  isZeroDecimal,
  mulExact,
  parseFixed,
  roundHalfUp,
  roundRatio,
  splitDecimal,
  type Fixed,
} from './decimal.js';
import type { DecimalString, InvoiceTotalsIssue, PriceMode } from './types.js';

const HUNDRED: Fixed = 100n * SCALE;

/** Conversion d'un prix unitaire d'un mode à l'autre, arrondi au plus proche, 2 déc. */
export function convertUnitPrice(
  unitPrice: DecimalString,
  ratePercent: DecimalString,
  from: PriceMode,
  to: PriceMode,
): DecimalString {
  const price = parseFixed(unitPrice);
  const rate = parseFixed(ratePercent);
  if (price === null || price <= 0n) {
    throw new RangeError(`Prix unitaire invalide : ${JSON.stringify(unitPrice)}`);
  }
  if (rate === null) throw new RangeError(`Taux invalide : ${JSON.stringify(ratePercent)}`);
  if (from === to) return formatAmount(roundHalfUp(price));
  return from === 'ht'
    ? formatAmount(roundRatio(price * (HUNDRED + rate), HUNDRED, 'half_up'))
    : formatAmount(roundRatio(price * HUNDRED, HUNDRED + rate, 'half_up'));
}

/** Prix unitaire après remise, pour une ligne (cas 25 de l'homologation). */
export type LineDiscount =
  | { kind: 'percent'; value: DecimalString } // > 0 et < 100
  | { kind: 'total_amount'; value: DecimalString }; // remise pour toute la quantité

export type DiscountedUnitPriceResult =
  | {
      ok: true;
      unitPrice: DecimalString;
      priceModification: string; // « Remise 10 % »
      effectiveDiscountTotal: DecimalString; // (origine − prix) × qté
    }
  | { ok: false; issue: InvoiceTotalsIssue };

/** Écriture française d'un décimal : virgule, groupes de milliers séparés d'une espace. */
function frenchNumber(text: string): string {
  const [integer = '', fraction] = text.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

function refuse(
  code: InvoiceTotalsIssue['code'],
  field: InvoiceTotalsIssue['field'],
  message: string,
): DiscountedUnitPriceResult {
  return { ok: false, issue: { code, lineIndex: null, field, message } };
}

/** Décimal strictement positif d'au plus `max` décimales, ou null. */
function strictlyPositive(value: unknown, max: 2 | 3): Fixed | null {
  const parts = splitDecimal(value);
  if (parts === null || !hasAtMostDecimals(parts, max) || isZeroDecimal(value as string)) {
    return null;
  }
  return parseFixed(value);
}

/**
 * Prix unitaire après remise. La remise en pourcentage s'applique au prix
 * d'origine ; la remise globale est répartie sur la quantité. Le prix obtenu est
 * arrondi au centime le plus proche : la remise effective, (origine − prix) ×
 * quantité, peut donc différer de quelques centimes de la remise annoncée, et
 * c'est elle que décrit `priceModification`.
 */
export function discountedUnitPrice(input: {
  originalPrice: DecimalString;
  quantity: DecimalString;
  discount: LineDiscount;
}): DiscountedUnitPriceResult {
  const original = strictlyPositive(input.originalPrice, 2);
  if (original === null) {
    return refuse(
      'PRICE_NOT_POSITIVE',
      'unitPrice',
      'Le prix d’origine doit être un décimal strictement positif d’au plus 2 décimales.',
    );
  }
  const quantity = strictlyPositive(input.quantity, 3);
  if (quantity === null) {
    return refuse(
      'QUANTITY_NOT_POSITIVE',
      'quantity',
      'La quantité doit être un décimal strictement positif d’au plus 3 décimales.',
    );
  }
  const value = strictlyPositive(input.discount.value, 2);
  if (value === null) {
    return refuse(
      'INVALID_DECIMAL',
      'unitPrice',
      'La remise doit être un décimal strictement positif d’au plus 2 décimales.',
    );
  }

  let unitPrice: Fixed;
  let modification: string;
  if (input.discount.kind === 'percent') {
    if (value >= HUNDRED) {
      return refuse(
        'PRICE_NOT_POSITIVE',
        'unitPrice',
        'Une remise de 100 % ou plus annulerait le prix : interdit.',
      );
    }
    unitPrice = roundRatio(original * (HUNDRED - value), HUNDRED, 'half_up');
    modification = `Remise ${frenchNumber(formatTrimmed(value))} %`;
  } else if (input.discount.kind === 'total_amount') {
    // Prix exact = origine − remise / quantité, en une seule division.
    const numerator = original * quantity - value * SCALE;
    if (numerator <= 0n) {
      return refuse(
        'PRICE_NOT_POSITIVE',
        'unitPrice',
        'La remise atteint ou dépasse le montant de la ligne : interdit.',
      );
    }
    unitPrice = roundRatio(numerator, quantity, 'half_up');
    modification = '';
  } else {
    return refuse('INVALID_DECIMAL', 'unitPrice', 'Type de remise inconnu.');
  }

  if (unitPrice <= 0n) {
    return refuse(
      'PRICE_NOT_POSITIVE',
      'unitPrice',
      'Le prix après remise, arrondi au centime, est nul : interdit.',
    );
  }
  if (unitPrice >= original) {
    return refuse(
      'INVALID_DECIMAL',
      'unitPrice',
      'La remise est trop faible : le prix arrondi au centime reste inchangé.',
    );
  }
  const effective = roundHalfUp(mulExact(original - unitPrice, quantity));
  if (input.discount.kind === 'total_amount') {
    modification = `Remise ${frenchNumber(formatAmount(effective))} CDF`;
  }
  return {
    ok: true,
    unitPrice: formatAmount(unitPrice),
    priceModification: modification,
    effectiveDiscountTotal: formatAmount(effective),
  };
}
