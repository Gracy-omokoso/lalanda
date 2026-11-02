// ─────────────────────────────────────────────────────────────────────────────
// Montants des abonnements Lalanda (ADR-0047, décision de la dirigeante du
// 3 nov. 2026)
//
// Les prix de la grille sont HORS TAXES (docs/13). La TVA RDC au taux normal
// (`SUBSCRIPTION_TAX` : groupe B, 16 %) s'y ajoute, calculée par la MÊME fonction
// que les factures de vente (`computeInvoiceTotals`, politique d'arrondi DGI) :
// le montant encaissé et la facture qui en découle ne peuvent pas diverger d'un
// centime.
//
// Frontière : les abonnements comptent en CENTIMES ENTIERS (docs/13, `billing/`),
// les factures en CHAÎNES DÉCIMALES (docs/26, `invoice-totals`). Les deux
// conversions sont exactes (aucun flottant) : `centsToDecimal` (P7) et
// `decimalToCents` ci-dessous.
// ─────────────────────────────────────────────────────────────────────────────

import { SUBSCRIPTION_TAX } from '@lalanda/shared/pricing';

import { computeInvoiceTotals } from '../invoice-totals/compute.js';
import type { DecimalString, PriceMode, TaxGroupLetter } from '../invoice-totals/types.js';
import { centsToDecimal } from '../platform-revenue/index.js';

export const SUBSCRIPTION_AMOUNTS_VERSION = '1.0.0';

const CENTS_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "22.04" → 2204 ; `null` si la chaîne n'est pas un décimal à deux chiffres au plus. */
export function decimalToCents(value: DecimalString): number | null {
  const m = CENTS_RE.exec(value);
  if (!m) return null;
  const cents = Number(`${m[1]}${(m[2] ?? '').padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

export interface SubscriptionAmounts {
  /** Base hors taxes, en centimes. */
  exclTaxCents: number;
  /** TVA, en centimes. */
  taxCents: number;
  /** Montant toutes taxes comprises, en centimes : ce que l'abonné verse. */
  totalCents: number;
  taxGroup: TaxGroupLetter;
  ratePercent: DecimalString;
  /** Politique d'arrondi du moteur des factures. */
  policyId: string | null;
  version: string;
}

/**
 * Montants d'un abonnement à partir d'un montant connu, HT (`mode: 'ht'`, le prix
 * de la grille ou d'un prorata) ou TTC (`mode: 'ttc'`, une somme encaissée).
 * Zéro donne zéro partout : aucune ligne de facture à zéro n'existe.
 */
export function subscriptionAmounts(input: {
  cents: number;
  mode: PriceMode;
  taxGroup?: TaxGroupLetter;
  ratePercent?: DecimalString;
}): SubscriptionAmounts {
  const taxGroup = input.taxGroup ?? (SUBSCRIPTION_TAX.taxGroup as TaxGroupLetter);
  const ratePercent = input.ratePercent ?? SUBSCRIPTION_TAX.ratePercent;
  const base = { taxGroup, ratePercent, version: SUBSCRIPTION_AMOUNTS_VERSION };
  if (input.cents === 0) {
    return { ...base, exclTaxCents: 0, taxCents: 0, totalCents: 0, policyId: null };
  }
  const result = computeInvoiceTotals({
    priceMode: input.mode,
    lines: [
      {
        unitPrice: centsToDecimal(input.cents),
        quantity: '1',
        taxGroup,
        itemType: 'SER',
        specificTax: null,
      },
    ],
    rates: { [taxGroup]: ratePercent },
  });
  if (!result.ok) {
    throw new RangeError(
      `Montant d'abonnement incalculable : ${result.issues.map((i) => i.code).join(', ')}`,
    );
  }
  const group = result.totals.groups.find((g) => g.group === taxGroup);
  const totalCents = decimalToCents(result.totals.total);
  const exclTaxCents = group ? decimalToCents(group.ht) : null;
  const taxCents = decimalToCents(result.totals.vatTotal);
  if (totalCents === null || exclTaxCents === null || taxCents === null) {
    throw new RangeError("Montant d'abonnement : le moteur a rendu un décimal inattendu.");
  }
  return { ...base, exclTaxCents, taxCents, totalCents, policyId: result.totals.policyId };
}
