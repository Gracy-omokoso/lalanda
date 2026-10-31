// ─────────────────────────────────────────────────────────────────────────────
// Conversions d'unité et coût d'entrée (ADR-0046 § 2.1, § 2.3.1, § 7.1)
//
// - `toStockQuantity` : quantité d'une ligne d'achat ou de vente exprimée dans
//   une autre unité → unité de stock, par `unitConversions` ; arrondi demi vers
//   le haut au millième ; unité absente : `UNKNOWN_UNIT` (ligne « À traiter »).
// - `entryUnitCost` : prix HT après remise ÷ facteur, six décimales ; devise de
//   la commande différente de la devise de coût de l'article : `pending_cost`,
//   AUCUN taux n'est proposé ni appliqué. Taxes et frais d'approche : non
//   incorporés (décision ouverte n° 6).
// ─────────────────────────────────────────────────────────────────────────────

import {
  checkCurrency,
  COST,
  divRound,
  formatCost,
  formatQty,
  parse,
  QTY,
  unitKey,
} from './decimal.js';
import {
  STOCK_VERSION,
  type EntryCostLineInput,
  type EntryUnitCost,
  type StockItemInput,
  type StockQuantityConversion,
} from './types.js';

const ONE_FACTOR = 10n ** BigInt(COST);

/** Facteur (millionièmes) de `unit` vers l'unité de stock ; `null` si inconnue. */
export function factorOf(unit: string, item: StockItemInput): bigint | null {
  const key = unitKey(unit);
  if (key === unitKey(item.unit)) return ONE_FACTOR;
  for (const [i, conversion] of (item.unitConversions ?? []).entries()) {
    if (unitKey(conversion.unit) === key) {
      return parse(conversion.factor, COST, 'positive', `Article ${item.id} : conversion ${i + 1}`);
    }
  }
  return null;
}

export function toStockQuantity(
  quantity: string,
  unit: string,
  item: StockItemInput,
): StockQuantityConversion {
  const milli = parse(quantity, QTY, 'positive', 'Quantité à convertir');
  const factor = factorOf(unit, item);
  if (factor === null) return { version: STOCK_VERSION, ok: false, code: 'UNKNOWN_UNIT' };
  return {
    version: STOCK_VERSION,
    ok: true,
    quantity: formatQty(divRound(milli * factor, ONE_FACTOR)),
    factor: formatCost(factor),
  };
}

/** Coût unitaire en millionièmes, par unité de stock ; erreurs déjà triées. */
export function entryUnitCostMicro(line: EntryCostLineInput, factor: bigint): bigint {
  const priceCents = parse(line.unitPrice, 2, 'nonnegative', 'Prix unitaire');
  const discount =
    line.discountPercent === undefined || line.discountPercent === null
      ? 0n
      : parse(line.discountPercent, 2, 'nonnegative', 'Remise');
  if (discount > 10_000n) throw new RangeError('Remise : au plus 100 %');
  // centimes × (10 000 − remise en centièmes de point) = millionièmes par unité de la ligne
  const netMicro = priceCents * (10_000n - discount);
  return divRound(netMicro * ONE_FACTOR, factor);
}

export function entryUnitCost(orderLine: EntryCostLineInput, item: StockItemInput): EntryUnitCost {
  const currency = checkCurrency(orderLine.currency, 'Devise de la ligne');
  const costCurrency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
  const factor = factorOf(orderLine.unit, item);
  if (factor === null) {
    return { version: STOCK_VERSION, status: 'unknown_unit', code: 'UNKNOWN_UNIT' };
  }
  if (currency !== costCurrency) {
    return { version: STOCK_VERSION, status: 'pending_cost', code: 'CURRENCY_DIFFERS' };
  }
  return {
    version: STOCK_VERSION,
    status: 'valued',
    unitCost: formatCost(entryUnitCostMicro(orderLine, factor)),
    factor: formatCost(factor),
  };
}
