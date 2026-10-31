// ─────────────────────────────────────────────────────────────────────────────
// Grand livre des mouvements (ADR-0046 § 2.3, § 2.5, O4)
//
// - lecture et contrôle d'un mouvement (sens du type, coût, date) ;
// - `stockLevels` : quantité par article et emplacement (contrôle du cache) ;
// - `stockLevelDrift` : écarts entre le cache `stock_levels` et le grand livre ;
// - `checkStockAvailability` : refus d'un mouvement DÉCIDÉ au-delà du disponible
//   (`STOCK_INSUFFICIENT`), sauf réglage `allowNegativeManualMoves` ; les
//   mouvements CONSTATÉS (vente émise, annulation de réception) ne passent
//   jamais par ce contrôle (O4).
// ─────────────────────────────────────────────────────────────────────────────

import { byString, checkDay, COST, formatQty, parse, QTY, sumOf, timestampKey } from './decimal.js';
import {
  STOCK_COST_STATUSES,
  STOCK_MOVEMENT_KINDS,
  STOCK_VERSION,
  type AvailabilityRequestLine,
  type CachedLevelInput,
  type StockAvailabilityCheck,
  type StockCostStatus,
  type StockLevel,
  type StockLevelDrift,
  type StockLevelDriftReport,
  type StockLevels,
  type StockMovementInput,
  type StockMovementKind,
  type StockShortfall,
} from './types.js';

/** Types dont le sens habituel est une entrée (quantité > 0). */
const ENTRY_KINDS: ReadonlySet<StockMovementKind> = new Set([
  'opening',
  'purchase_receipt',
  'sale_return',
  'issue_return',
  'transfer_in',
]);
/** Types dont le sens habituel est une sortie (quantité < 0). */
const EXIT_KINDS: ReadonlySet<StockMovementKind> = new Set([
  'purchase_receipt_reversal',
  'sale_issue',
  'issue',
  'transfer_out',
  'supplier_return',
]);
export const TRANSFER_KINDS: ReadonlySet<StockMovementKind> = new Set([
  'transfer_out',
  'transfer_in',
]);

/** Mouvement contrôlé, en entiers. */
export interface Movement {
  id: string;
  itemId: string;
  locationId: string;
  kind: StockMovementKind;
  /** Millièmes, signé, jamais nul. */
  qty: bigint;
  occurredOn: string;
  /** Millionièmes ; seulement pour une entrée `valued`. */
  unitCost: bigint | null;
  costStatus: StockCostStatus;
  workProjectId: string | null;
  reversal: boolean;
  /** Clé comparable de `recordedAt`, ou `null`. */
  recordedAt: string | null;
}

export function readMovement(m: StockMovementInput): Movement {
  const what = `Mouvement ${m.id}`;
  if (typeof m.id !== 'string' || m.id === '') throw new RangeError('Mouvement sans identifiant');
  if (!(STOCK_MOVEMENT_KINDS as readonly string[]).includes(m.kind)) {
    throw new RangeError(`${what} : type inconnu ${JSON.stringify(m.kind)}`);
  }
  if (!(STOCK_COST_STATUSES as readonly string[]).includes(m.costStatus)) {
    throw new RangeError(`${what} : statut de coût inconnu ${JSON.stringify(m.costStatus)}`);
  }
  const qty = parse(m.quantity, QTY, 'nonzero', `${what} : quantité`);
  const reversal = m.reversalOf !== undefined && m.reversalOf !== null;
  const entrySense = ENTRY_KINDS.has(m.kind) !== reversal;
  const exitSense = EXIT_KINDS.has(m.kind) !== reversal;
  if (
    (ENTRY_KINDS.has(m.kind) || EXIT_KINDS.has(m.kind)) &&
    (qty > 0n ? !entrySense : !exitSense)
  ) {
    throw new RangeError(`${what} : quantité de sens contraire au type ${m.kind}`);
  }
  const hasCost = m.unitCost !== undefined && m.unitCost !== null;
  if (qty < 0n || TRANSFER_KINDS.has(m.kind)) {
    if (hasCost || m.costStatus !== 'not_applicable') {
      throw new RangeError(`${what} : une sortie ou un transfert ne porte pas de coût`);
    }
  } else if (m.costStatus === 'valued' && !hasCost) {
    throw new RangeError(`${what} : entrée valorisée sans coût unitaire`);
  } else if (m.costStatus !== 'valued' && hasCost) {
    throw new RangeError(`${what} : coût unitaire sur une entrée non valorisée`);
  }
  return {
    id: m.id,
    itemId: m.itemId,
    locationId: m.locationId,
    kind: m.kind,
    qty,
    occurredOn: checkDay(m.occurredOn, `${what} : date`),
    unitCost: hasCost ? parse(m.unitCost, COST, 'nonnegative', `${what} : coût unitaire`) : null,
    costStatus: m.costStatus,
    workProjectId: m.workProjectId ?? null,
    reversal,
    recordedAt:
      m.recordedAt === undefined ? null : timestampKey(m.recordedAt, `${what} : horodatage`),
  };
}

/** Ordre de rejeu : date du fait, puis ordre d'écriture (identifiant). */
export const byReplayOrder = (a: Movement, b: Movement): number =>
  byString(a.occurredOn, b.occurredOn) || byString(a.id, b.id);

export function readMovements(movements: readonly StockMovementInput[]): Movement[] {
  const read = movements.map(readMovement);
  const seen = new Set<string>();
  for (const m of read) {
    if (seen.has(m.id)) throw new RangeError(`Mouvement ${m.id} : identifiant en double`);
    seen.add(m.id);
  }
  return read.sort(byReplayOrder);
}

const levelKey = (itemId: string, locationId: string): string => `${itemId}\u0000${locationId}`;

interface LevelAcc {
  itemId: string;
  locationId: string;
  qty: bigint;
  last: string;
  count: number;
}

export function levelsOf(movements: readonly Movement[]): Map<string, LevelAcc> {
  const acc = new Map<string, LevelAcc>();
  for (const m of movements) {
    const key = levelKey(m.itemId, m.locationId);
    const level = acc.get(key) ?? {
      itemId: m.itemId,
      locationId: m.locationId,
      qty: 0n,
      last: m.occurredOn,
      count: 0,
    };
    level.qty += m.qty;
    if (m.occurredOn > level.last) level.last = m.occurredOn;
    level.count += 1;
    acc.set(key, level);
  }
  return acc;
}

const byLevel = (a: { itemId: string; locationId: string }, b: typeof a): number =>
  byString(a.itemId, b.itemId) || byString(a.locationId, b.locationId);

export function stockLevels(movements: readonly StockMovementInput[]): StockLevels {
  const levels: StockLevel[] = [...levelsOf(readMovements(movements)).values()]
    .sort(byLevel)
    .map((l) => ({
      itemId: l.itemId,
      locationId: l.locationId,
      quantity: formatQty(l.qty),
      lastOccurredOn: l.last,
      movementCount: l.count,
    }));
  return { version: STOCK_VERSION, levels };
}

export function stockLevelDrift(
  cached: readonly CachedLevelInput[],
  movements: readonly StockMovementInput[],
): StockLevelDriftReport {
  const ledger = levelsOf(readMovements(movements));
  const cache = new Map<string, { itemId: string; locationId: string; qty: bigint }>();
  for (const c of cached) {
    const key = levelKey(c.itemId, c.locationId);
    if (cache.has(key)) {
      throw new RangeError(`Cache : niveau en double ${c.itemId} / ${c.locationId}`);
    }
    cache.set(key, {
      itemId: c.itemId,
      locationId: c.locationId,
      qty: parse(c.quantity, QTY, 'any', `Cache ${c.itemId} / ${c.locationId}`),
    });
  }
  const keys = new Set([...ledger.keys(), ...cache.keys()]);
  const drifts: StockLevelDrift[] = [];
  for (const key of keys) {
    const l = ledger.get(key);
    const c = cache.get(key);
    const ledgerQty = l?.qty ?? 0n;
    const cachedQty = c?.qty ?? 0n;
    if (ledgerQty !== cachedQty) {
      const ref = (l ?? c) as { itemId: string; locationId: string };
      drifts.push({
        code: 'STOCK_LEVEL_DRIFT',
        itemId: ref.itemId,
        locationId: ref.locationId,
        cached: formatQty(cachedQty),
        ledger: formatQty(ledgerQty),
        difference: formatQty(ledgerQty - cachedQty),
      });
    }
  }
  drifts.sort(byLevel);
  return { version: STOCK_VERSION, ok: drifts.length === 0, drifts };
}

export function checkStockAvailability(input: {
  movements: readonly StockMovementInput[];
  lines: readonly AvailabilityRequestLine[];
  allowNegativeManualMoves: boolean;
}): StockAvailabilityCheck {
  const ledger = levelsOf(readMovements(input.movements));
  const requested = new Map<string, { itemId: string; locationId: string; qty: bigint }>();
  for (const [i, line] of input.lines.entries()) {
    const qty = parse(line.quantity, QTY, 'positive', `Ligne ${i + 1} : quantité`);
    const key = levelKey(line.itemId, line.locationId);
    const r = requested.get(key) ?? { itemId: line.itemId, locationId: line.locationId, qty: 0n };
    r.qty += qty;
    requested.set(key, r);
  }
  const shortfalls: StockShortfall[] = [];
  for (const [key, r] of requested) {
    const available = ledger.get(key)?.qty ?? 0n;
    if (r.qty > available) {
      shortfalls.push({
        itemId: r.itemId,
        locationId: r.locationId,
        available: formatQty(available),
        requested: formatQty(r.qty),
        shortfall: formatQty(r.qty - available),
      });
    }
  }
  shortfalls.sort(byLevel);
  const short = shortfalls.length > 0;
  const refused = short && !input.allowNegativeManualMoves;
  return {
    version: STOCK_VERSION,
    ok: !refused,
    code: refused ? 'STOCK_INSUFFICIENT' : null,
    shortfalls,
    goesNegative: short && input.allowNegativeManualMoves,
  };
}

export const totalQty = (movements: readonly Movement[]): bigint =>
  sumOf(movements.map((m) => m.qty));
