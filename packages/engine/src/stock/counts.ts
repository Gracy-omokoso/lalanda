// ─────────────────────────────────────────────────────────────────────────────
// Écarts d'inventaire (ADR-0046 § 2.7, § 7.1)
//
// Pour chaque ligne comptée : quantité THÉORIQUE à l'emplacement à l'instant du
// comptage de la ligne (mouvements dont `recordedAt` ≤ `countedAt` : aucun gel
// du magasin), écart = compté − théorique, écart valorisé :
// - écart positif avec coût saisi (stock initial) : à ce coût ;
// - sinon : au CMUP de l'article à cet instant (rejeu, § O2) ;
// - écart positif d'un article jamais valorisé, sans coût saisi : non valorisé
//   (`needsUnitCost`).
// Le masquage de la quantité théorique au compteur (comptage à l'aveugle)
// appartient à l'API ; le moteur rend tout.
// ─────────────────────────────────────────────────────────────────────────────

import {
  byString,
  checkCurrency,
  COST,
  formatAmount,
  formatCost,
  formatQty,
  parse,
  QTY,
  timestampKey,
  valueOf,
} from './decimal.js';
import { readMovements } from './ledger.js';
import { replay } from './valuation.js';
import {
  STOCK_VERSION,
  type CountLineInput,
  type CountVarianceLine,
  type CountVariances,
  type StockCurrency,
  type StockItemInput,
  type StockMovementInput,
} from './types.js';

export function countVariances(input: {
  locationId: string;
  lines: readonly CountLineInput[];
  movements: readonly StockMovementInput[];
  items: readonly StockItemInput[];
}): CountVariances {
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const movements = readMovements(input.movements);
  for (const m of movements) {
    if (m.recordedAt === null) {
      throw new RangeError(`Mouvement ${m.id} : horodatage d’écriture requis pour un inventaire`);
    }
  }
  const lines: CountVarianceLine[] = [];
  const totals = new Map<StockCurrency, { gains: bigint; losses: bigint; unvalued: number }>();
  let countedLineCount = 0;
  let varianceLineCount = 0;
  for (const line of input.lines) {
    const what = `Ligne d’inventaire ${line.id}`;
    const item = itemsById.get(line.itemId);
    if (item === undefined) throw new RangeError(`${what} : article ${line.itemId} absent`);
    const currency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
    const t = totals.get(currency) ?? { gains: 0n, losses: 0n, unvalued: 0 };
    totals.set(currency, t);
    if (line.countedQuantity === null) {
      lines.push({
        lineId: line.id,
        itemId: line.itemId,
        status: 'not_counted',
        theoretical: null,
        counted: null,
        variance: null,
        currency,
        valuedVariance: null,
        adjustmentUnitCost: null,
        needsUnitCost: false,
      });
      continue;
    }
    countedLineCount += 1;
    const counted = parse(line.countedQuantity, QTY, 'nonnegative', `${what} : quantité comptée`);
    const at = timestampKey(line.countedAt, `${what} : instant du comptage`);
    const enteredCost =
      line.unitCost === undefined || line.unitCost === null
        ? null
        : parse(line.unitCost, COST, 'nonnegative', `${what} : coût unitaire`);
    const known = movements.filter(
      (m) => m.itemId === line.itemId && (m.recordedAt as string) <= at,
    );
    const theoretical = known
      .filter((m) => m.locationId === input.locationId)
      .reduce((sum, m) => sum + m.qty, 0n);
    const cmup = replay(known).cmup;
    const variance = counted - theoretical;
    if (variance !== 0n) varianceLineCount += 1;
    const cost = variance > 0n && enteredCost !== null ? enteredCost : cmup;
    const valued = variance === 0n ? 0n : cost === null ? null : valueOf(variance, cost);
    if (valued === null) t.unvalued += 1;
    else if (valued > 0n) t.gains += valued;
    else t.losses -= valued;
    lines.push({
      lineId: line.id,
      itemId: line.itemId,
      status: 'counted',
      theoretical: formatQty(theoretical),
      counted: formatQty(counted),
      variance: formatQty(variance),
      currency,
      valuedVariance: valued === null ? null : formatAmount(valued),
      adjustmentUnitCost: variance > 0n && enteredCost !== null ? formatCost(enteredCost) : null,
      needsUnitCost: variance > 0n && enteredCost === null && cmup === null,
    });
  }
  return {
    version: STOCK_VERSION,
    locationId: input.locationId,
    lines,
    byCurrency: [...totals.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([currency, t]) => ({
        currency,
        gains: formatAmount(t.gains),
        losses: formatAmount(t.losses),
        net: formatAmount(t.gains - t.losses),
        unvaluedLineCount: t.unvalued,
      })),
    countedLineCount,
    varianceLineCount,
  };
}
