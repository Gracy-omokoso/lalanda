// ─────────────────────────────────────────────────────────────────────────────
// Constats des stocks (ADR-0046 § 2.3.1, O4, § 7.1)
//
// - `NEGATIVE_STOCK` : quantité < 0 à un emplacement (mouvement constaté, O4) ;
// - `BELOW_REORDER` : disponible strictement sous le seuil ;
// - `UNVALUED_ENTRIES` : entrée en attente de coût (ou au coût moyen sans coût
//   moyen connu) — valorisation incomplète ;
// - `ENTRY_COST_DIFFERS_FROM_INVOICE` : coût d'une entrée ≠ prix de la facture
//   fournisseur ramené à l'unité de stock ; aucune révision automatique. Une
//   facture dans une autre devise ou une unité inconnue n'est pas comparée ;
// - `DORMANT_ITEM` : article suivi en stock (> 0) sans mouvement depuis au
//   moins `dormantDays` jours (réglable ; absent : pas de constat).
// ─────────────────────────────────────────────────────────────────────────────

import { dayNumber } from '../treasury/calendar.js';
import { entryUnitCost } from './conversions.js';
import { byString, checkDay, formatCost, formatQty, parse } from './decimal.js';
import { levelsOf, readMovements, type Movement } from './ledger.js';
import { replenishmentSuggestions } from './replenishment.js';
import { replay } from './valuation.js';
import {
  STOCK_VERSION,
  type StockFinding,
  type StockFindingCode,
  type StockFindings,
  type StockFindingsInput,
} from './types.js';

const ORDER: readonly StockFindingCode[] = [
  'NEGATIVE_STOCK',
  'BELOW_REORDER',
  'UNVALUED_ENTRIES',
  'ENTRY_COST_DIFFERS_FROM_INVOICE',
  'DORMANT_ITEM',
];

export function stockFindings(input: StockFindingsInput): StockFindings {
  const today = checkDay(input.today, 'Jour de référence');
  const dormantDays = input.dormantDays ?? null;
  if (dormantDays !== null && (!Number.isInteger(dormantDays) || dormantDays < 1)) {
    throw new RangeError('Jours sans mouvement : entier ≥ 1 attendu');
  }
  const tracked = input.items.filter((i) => i.tracked !== false);
  const trackedIds = new Set(tracked.map((i) => i.id));
  const movements = readMovements(input.movements).filter((m) => trackedIds.has(m.itemId));
  const byItem = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemId) ?? [];
    list.push(m);
    byItem.set(m.itemId, list);
  }
  const findings: StockFinding[] = [];
  const levels = [...levelsOf(movements).values()];

  for (const l of levels) {
    if (l.qty < 0n) {
      findings.push({
        code: 'NEGATIVE_STOCK',
        itemId: l.itemId,
        locationId: l.locationId,
        movementId: null,
        details: { quantity: formatQty(l.qty) },
      });
    }
  }

  const levelInputs = levels.map((l) => ({
    itemId: l.itemId,
    locationId: l.locationId,
    quantity: formatQty(l.qty),
  }));
  for (const s of replenishmentSuggestions(levelInputs, tracked, input.openOrders ?? [])
    .suggestions) {
    findings.push({
      code: 'BELOW_REORDER',
      itemId: s.itemId,
      locationId: s.locationId,
      movementId: null,
      details: {
        available: s.available,
        minQuantity: s.minQuantity,
        suggestedQuantity: s.suggestedQuantity,
      },
    });
  }

  for (const item of tracked) {
    const list = byItem.get(item.id) ?? [];
    const state = replay(list);
    if (state.unvaluedEntries > 0) {
      findings.push({
        code: 'UNVALUED_ENTRIES',
        itemId: item.id,
        locationId: null,
        movementId: null,
        details: { count: String(state.unvaluedEntries) },
      });
    }
    if (dormantDays !== null && state.qty + state.transfers > 0n && list.length > 0) {
      const last = list.reduce((d, m) => (m.occurredOn > d ? m.occurredOn : d), '');
      const idle = dayNumber(today) - dayNumber(last);
      if (idle >= dormantDays) {
        findings.push({
          code: 'DORMANT_ITEM',
          itemId: item.id,
          locationId: null,
          movementId: null,
          details: { lastMovementOn: last, idleDays: String(idle) },
        });
      }
    }
  }

  const itemsById = new Map(tracked.map((i) => [i.id, i]));
  const movementsById = new Map(movements.map((m) => [m.id, m]));
  for (const check of input.costChecks ?? []) {
    const m = movementsById.get(check.movementId);
    if (m === undefined) {
      throw new RangeError(`Contrôle de coût : mouvement ${check.movementId} absent`);
    }
    const item = itemsById.get(m.itemId);
    if (item === undefined || m.unitCost === null) continue;
    const invoiced = entryUnitCost(check.invoiceLine, item);
    if (invoiced.status !== 'valued') continue;
    const invoicedMicro = parse(invoiced.unitCost, 6, 'nonnegative', 'Coût facturé');
    if (invoicedMicro !== m.unitCost) {
      findings.push({
        code: 'ENTRY_COST_DIFFERS_FROM_INVOICE',
        itemId: m.itemId,
        locationId: m.locationId,
        movementId: m.id,
        details: {
          entryUnitCost: formatCost(m.unitCost),
          invoicedUnitCost: invoiced.unitCost,
        },
      });
    }
  }

  findings.sort(
    (a, b) =>
      ORDER.indexOf(a.code) - ORDER.indexOf(b.code) ||
      byString(a.itemId, b.itemId) ||
      byString(a.locationId ?? '', b.locationId ?? '') ||
      byString(a.movementId ?? '', b.movementId ?? ''),
  );
  return { version: STOCK_VERSION, findings };
}
