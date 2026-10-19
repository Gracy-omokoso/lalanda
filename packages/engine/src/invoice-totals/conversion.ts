// ─────────────────────────────────────────────────────────────────────────────
// Conversion d'un document commercial en CDF (ADR-0023 § S25e.4 et § S25e.9)
//
// Jalon E0 : signatures seulement, figées. Les corps appartiennent au chantier E1.
// ─────────────────────────────────────────────────────────────────────────────

import type { CurrencyConversionInput, CurrencyConversionResult } from './invoice-checks.types.js';
import type { DecimalString } from './types.js';

/** Taux de change reçu de la DGI (nombre JSON) → décimal canonique, jusqu'à 8 décimales ;
 *  null si non fini, ≤ 0, en notation exponentielle ou plus précis. */
export function decimalFromJsonRate(value: number): DecimalString | null {
  throw new Error('E1');
}

export const CURRENCY_CONVERSION_VERSION = '1.0.0';

/** USD → CDF : prix × taux arrondi au plus proche (demi vers le haut), 2 déc. ;
 *  taxe spécifique par unité idem ; pourcentages inchangés ; remise en montant
 *  reconvertie et libellé recalculé par discountedUnitPrice. CDF → CDF : identité. */
export function convertDocumentToCdf(input: CurrencyConversionInput): CurrencyConversionResult {
  throw new Error('E1');
}
