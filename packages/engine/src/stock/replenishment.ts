// ─────────────────────────────────────────────────────────────────────────────
// Seuils et suggestions de réapprovisionnement (ADR-0046 § 2.1, § 5.1, § 7.1)
//
// Disponible STRICTEMENT sous le seuil ⇒ suggestion = (cible, ou seuil sans
// cible) − disponible − quantités commandées non reçues, jamais négative ;
// arrondie à l'unité entière supérieure si l'unité est discrète. Seuil global
// (`locationId: null`) : disponible tous emplacements ; sinon : celui de
// l'emplacement. Aucune écriture : une suggestion n'est jamais une demande
// d'achat ni un engagement de trésorerie (décision ouverte n° 11).
// ─────────────────────────────────────────────────────────────────────────────

import { byString, divCeil, formatQty, max, parse, QTY } from './decimal.js';
import {
  STOCK_VERSION,
  type CachedLevelInput,
  type OpenOrderQuantityInput,
  type ReplenishmentSuggestion,
  type ReplenishmentSuggestions,
  type StockItemInput,
} from './types.js';

const UNIT = 10n ** BigInt(QTY);

/** Seuil lu en entiers ; `null` si l'article n'est pas surveillé. */
export interface ReorderRule {
  min: bigint;
  target: bigint | null;
  locationId: string | null;
}

export function reorderRuleOf(item: StockItemInput): ReorderRule | null {
  if (item.tracked === false || item.active === false) return null;
  const r = item.reorder;
  if (r === undefined || r === null) return null;
  const what = `Article ${item.id} : seuil`;
  const min = parse(r.minQuantity, QTY, 'nonnegative', `${what} minimal`);
  const target =
    r.targetQuantity === undefined || r.targetQuantity === null
      ? null
      : parse(r.targetQuantity, QTY, 'nonnegative', `${what} visé`);
  if (target !== null && target < min) {
    throw new RangeError(`${what} : la quantité visée est inférieure au seuil`);
  }
  return { min, target, locationId: r.locationId };
}

export function availableFor(
  levels: readonly CachedLevelInput[],
  itemId: string,
  locationId: string | null,
): bigint {
  let sum = 0n;
  for (const l of levels) {
    if (l.itemId !== itemId) continue;
    if (locationId !== null && l.locationId !== locationId) continue;
    sum += parse(l.quantity, QTY, 'any', `Niveau ${l.itemId} / ${l.locationId}`);
  }
  return sum;
}

export function replenishmentSuggestions(
  levels: readonly CachedLevelInput[],
  items: readonly StockItemInput[],
  openOrders: readonly OpenOrderQuantityInput[] = [],
): ReplenishmentSuggestions {
  const onOrder = new Map<string, bigint>();
  for (const [i, o] of openOrders.entries()) {
    const q = parse(o.quantity, QTY, 'nonnegative', `Commande ouverte ${i + 1} : quantité`);
    onOrder.set(o.itemId, (onOrder.get(o.itemId) ?? 0n) + q);
  }
  const suggestions: ReplenishmentSuggestion[] = [];
  for (const item of [...items].sort((a, b) => byString(a.id, b.id))) {
    const rule = reorderRuleOf(item);
    if (rule === null) continue;
    const available = availableFor(levels, item.id, rule.locationId);
    if (available >= rule.min) continue;
    const ordered = onOrder.get(item.id) ?? 0n;
    let suggested = max(0n, (rule.target ?? rule.min) - available - ordered);
    if (item.discreteUnit === true) suggested = divCeil(suggested, UNIT) * UNIT;
    suggestions.push({
      itemId: item.id,
      locationId: rule.locationId,
      available: formatQty(available),
      minQuantity: formatQty(rule.min),
      targetQuantity: rule.target === null ? null : formatQty(rule.target),
      onOrder: formatQty(ordered),
      suggestedQuantity: formatQty(suggested),
      preferredSupplierId: item.preferredSupplierId ?? null,
    });
  }
  return { version: STOCK_VERSION, suggestions };
}
