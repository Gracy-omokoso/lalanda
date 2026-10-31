// ─────────────────────────────────────────────────────────────────────────────
// Coût moyen unitaire pondéré « glissant » (ADR-0046 O2, § 7.1)
//
// Rejeu chronologique du grand livre d'UN article, tous emplacements confondus
// (un transfert ne change ni la valeur ni le coût moyen), dans la devise de
// coût de l'article, sans aucune conversion.
//
// - entrée valorisée (q > 0, coût c) : valeur += q × c (au centime) ;
//   CMUP = valeur ÷ quantité (au millionième). Si la quantité était ≤ 0 ou si
//   aucun coût moyen n'existait : le CMUP repart de c ; sur stock NÉGATIF, la
//   valeur devient (nouvelle quantité) × c et la différence est rendue comme
//   réévaluation (`negativeStockRevaluation`).
// - entrée sans coût saisi (retour, écart positif, contre-passation) : au CMUP
//   courant, qui ne change pas ; sans CMUP : entrée non valorisée.
// - entrée `pending_cost` : quantité comptée, valeur et CMUP inchangés,
//   valorisation `incomplete` (constat `UNVALUED_ENTRIES`).
// - sortie (q < 0) : coût = q × CMUP (au centime), borné à la valeur restante
//   tant que la quantité reste positive (la valeur ne devient jamais négative
//   sur un stock positif) ; la sortie qui ramène la quantité à 0 emporte toute
//   la valeur restante (reste d'arrondi rendu, `roundingResidue`) ; la part
//   au-delà du disponible est valorisée au CMUP (stock négatif, constaté).
//
// Identité, à toute étape : Σ entrées valorisées = Σ coûts de sortie + valeur
// + Σ réévaluations de stock négatif.
// ─────────────────────────────────────────────────────────────────────────────

import {
  byString,
  checkCurrency,
  checkDay,
  divRound,
  formatAmount,
  formatCost,
  formatQty,
  max,
  min,
  QTY_COST_TO_CENTS,
  valueOf,
} from './decimal.js';
import { readMovements, TRANSFER_KINDS, type Movement } from './ledger.js';
import {
  STOCK_VERSION,
  type ItemValuation,
  type StockCurrency,
  type StockDay,
  type StockItemInput,
  type StockMovementInput,
  type StockValuation,
  type ValuationFindingCode,
  type ValuationStep,
  type WeightedAverageValuation,
} from './types.js';

/** Étape de rejeu, en entiers. */
export interface ReplayStep {
  movement: Movement;
  unitCost: bigint | null;
  entryValue: bigint | null;
  exitCost: bigint | null;
  valued: boolean;
  residue: bigint;
  revaluation: bigint;
  qtyAfter: bigint;
  valueAfter: bigint;
  cmupAfter: bigint | null;
}

export interface ReplayState {
  qty: bigint;
  value: bigint;
  cmup: bigint | null;
  unvaluedEntries: number;
  unvaluedExits: number;
  entriesValue: bigint;
  exitsCost: bigint;
  residue: bigint;
  revaluation: bigint;
  transfers: bigint;
  everNegative: boolean;
  steps: ReplayStep[];
}

/** CMUP (millionièmes) = valeur (centimes) ÷ quantité (millièmes), q > 0. */
const averageOf = (value: bigint, qty: bigint): bigint => divRound(value * QTY_COST_TO_CENTS, qty);

/**
 * Rejoue les mouvements d'un article, DÉJÀ triés dans l'ordre de rejeu et
 * filtrés sur cet article.
 */
export function replay(movements: readonly Movement[]): ReplayState {
  const s: ReplayState = {
    qty: 0n,
    value: 0n,
    cmup: null,
    unvaluedEntries: 0,
    unvaluedExits: 0,
    entriesValue: 0n,
    exitsCost: 0n,
    residue: 0n,
    revaluation: 0n,
    transfers: 0n,
    everNegative: false,
    steps: [],
  };
  for (const m of movements) {
    if (TRANSFER_KINDS.has(m.kind)) {
      s.transfers += m.qty;
      continue;
    }
    const step: ReplayStep = {
      movement: m,
      unitCost: null,
      entryValue: null,
      exitCost: null,
      valued: false,
      residue: 0n,
      revaluation: 0n,
      qtyAfter: 0n,
      valueAfter: 0n,
      cmupAfter: null,
    };
    if (m.qty > 0n) entry(s, m, step);
    else exit(s, m, step);
    if (s.qty < 0n) s.everNegative = true;
    step.qtyAfter = s.qty;
    step.valueAfter = s.value;
    step.cmupAfter = s.cmup;
    s.steps.push(step);
  }
  return s;
}

function entry(s: ReplayState, m: Movement, step: ReplayStep): void {
  const q = m.qty;
  if (m.costStatus === 'pending_cost') {
    s.qty += q;
    s.unvaluedEntries += 1;
    return;
  }
  const atAverage = m.unitCost === null;
  const cost = m.unitCost ?? s.cmup;
  if (cost === null) {
    // entrée « au coût moyen » sans coût moyen connu
    s.qty += q;
    s.unvaluedEntries += 1;
    return;
  }
  const entryValue = valueOf(q, cost);
  const newQty = s.qty + q;
  let newValue: bigint;
  if (s.qty < 0n) {
    // stock négatif : le CMUP repart de ce coût, la valeur suit la quantité
    newValue = valueOf(newQty, cost);
    step.revaluation = s.value + entryValue - newValue;
    s.cmup = cost;
  } else if (s.qty === 0n || s.cmup === null) {
    newValue = s.value + entryValue;
    s.cmup = cost;
  } else {
    newValue = s.value + entryValue;
    if (!atAverage) s.cmup = averageOf(newValue, newQty);
  }
  step.unitCost = cost;
  step.entryValue = entryValue;
  step.valued = true;
  s.entriesValue += entryValue;
  s.revaluation += step.revaluation;
  s.qty = newQty;
  s.value = newValue;
}

function exit(s: ReplayState, m: Movement, step: ReplayStep): void {
  const out = -m.qty;
  if (s.cmup === null) {
    s.qty -= out;
    s.unvaluedExits += 1;
    return;
  }
  let cost: bigint;
  if (s.qty <= 0n) {
    cost = valueOf(out, s.cmup);
  } else if (out < s.qty) {
    cost = min(valueOf(out, s.cmup), max(s.value, 0n));
  } else {
    // vide le stock : emporte toute la valeur restante, puis la part manquante au CMUP
    step.residue = s.value - valueOf(s.qty, s.cmup);
    cost = s.value + valueOf(out - s.qty, s.cmup);
  }
  step.exitCost = cost;
  step.valued = true;
  s.exitsCost += cost;
  s.residue += step.residue;
  s.qty -= out;
  s.value -= cost;
}

function itemMovements(
  movements: readonly StockMovementInput[],
  itemId: string,
  until: StockDay | null,
): Movement[] {
  return readMovements(movements.filter((m) => m.itemId === itemId)).filter(
    (m) => until === null || m.occurredOn <= until,
  );
}

export function formatStep(step: ReplayStep): ValuationStep {
  return {
    movementId: step.movement.id,
    kind: step.movement.kind,
    occurredOn: step.movement.occurredOn,
    quantity: formatQty(step.movement.qty),
    unitCost: step.unitCost === null ? null : formatCost(step.unitCost),
    entryValue: step.entryValue === null ? null : formatAmount(step.entryValue),
    exitCost: step.exitCost === null ? null : formatAmount(step.exitCost),
    valued: step.valued,
    roundingResidue: formatAmount(step.residue),
    negativeStockRevaluation: formatAmount(step.revaluation),
    quantityAfter: formatQty(step.qtyAfter),
    valueAfter: formatAmount(step.valueAfter),
    averageUnitCostAfter: step.cmupAfter === null ? null : formatCost(step.cmupAfter),
  };
}

export function weightedAverageValuation(
  movements: readonly StockMovementInput[],
  item: StockItemInput,
  until?: StockDay | null,
): WeightedAverageValuation {
  const currency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
  const limit =
    until === undefined || until === null ? null : checkDay(until, 'Date de valorisation');
  const s = replay(itemMovements(movements, item.id, limit));
  const findings: ValuationFindingCode[] = [];
  if (s.unvaluedEntries > 0) findings.push('UNVALUED_ENTRIES');
  if (s.qty < 0n) findings.push('NEGATIVE_STOCK');
  return {
    version: STOCK_VERSION,
    itemId: item.id,
    currency,
    until: limit,
    quantity: formatQty(s.qty),
    value: formatAmount(s.value),
    averageUnitCost: s.cmup === null ? null : formatCost(s.cmup),
    complete: s.unvaluedEntries === 0,
    unvaluedEntryCount: s.unvaluedEntries,
    unvaluedExitCount: s.unvaluedExits,
    entriesValue: formatAmount(s.entriesValue),
    exitsCost: formatAmount(s.exitsCost),
    roundingResidue: formatAmount(s.residue),
    negativeStockRevaluation: formatAmount(s.revaluation),
    unpairedTransferQuantity: formatQty(s.transfers),
    findings,
    steps: s.steps.map(formatStep),
  };
}

/**
 * Valorisation de tout le stock suivi à une date (rejeu), par article et par
 * devise. Avec `locationId` : quantités de l'emplacement, valorisées au CMUP de
 * l'article (le coût moyen reste global, § O2).
 */
export function stockValuation(input: {
  movements: readonly StockMovementInput[];
  items: readonly StockItemInput[];
  until?: StockDay | null;
  locationId?: string | null;
}): StockValuation {
  const until =
    input.until === undefined || input.until === null
      ? null
      : checkDay(input.until, 'Date de valorisation');
  const locationId = input.locationId ?? null;
  const all = readMovements(input.movements).filter((m) => until === null || m.occurredOn <= until);
  const byItem = new Map<string, Movement[]>();
  for (const m of all) {
    const list = byItem.get(m.itemId) ?? [];
    list.push(m);
    byItem.set(m.itemId, list);
  }
  const items: ItemValuation[] = [];
  const totals = new Map<StockCurrency, { value: bigint; count: number; complete: boolean }>();
  for (const item of [...input.items].sort((a, b) => byString(a.id, b.id))) {
    if (item.tracked === false) continue;
    const currency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
    const list = byItem.get(item.id) ?? [];
    const s = replay(list);
    let qty = s.qty;
    let value = s.value;
    if (locationId !== null) {
      qty = list.filter((m) => m.locationId === locationId).reduce((sum, m) => sum + m.qty, 0n);
      value = s.cmup === null ? 0n : valueOf(qty, s.cmup);
    }
    if (list.length === 0 || (locationId !== null && qty === 0n && value === 0n)) continue;
    const complete = s.unvaluedEntries === 0;
    items.push({
      itemId: item.id,
      currency,
      quantity: formatQty(qty),
      value: formatAmount(value),
      averageUnitCost: s.cmup === null ? null : formatCost(s.cmup),
      complete,
    });
    const t = totals.get(currency) ?? { value: 0n, count: 0, complete: true };
    t.value += value;
    t.count += 1;
    t.complete &&= complete;
    totals.set(currency, t);
  }
  return {
    version: STOCK_VERSION,
    until,
    locationId,
    items,
    byCurrency: [...totals.entries()]
      .sort(([a], [b]) => byString(a, b))
      .map(([currency, t]) => ({
        currency,
        value: formatAmount(t.value),
        itemCount: t.count,
        complete: t.complete,
      })),
  };
}
