// ─────────────────────────────────────────────────────────────────────────────
// Rapports des stocks et matériel des projets (ADR-0046 § 5.1, § 6.2, § 6.4)
//
// - `stockReport` : par article, ouverture, entrées et sorties par nature,
//   clôture ; par devise : valeurs, coût des ventes (sorties de vente − retours
//   de vente), consommations (bons de sortie − retours au magasin) ; par projet.
//   Les quantités ne s'additionnent jamais entre articles (unités différentes),
//   les valeurs jamais entre devises. Le coût des ventes est un INDICATEUR DE
//   GESTION : il n'entre ni dans le réalisé, ni dans la marge, ni dans une
//   facture. La rotation des stocks n'est pas calculée (définition à sourcer,
//   § 6.9).
// - `projectMaterials` : sorties `issue` imputées à un projet, nettes des
//   retours, valorisées au coût moyen, par devise de coût — INFORMATIF, jamais
//   soustrait de la marge (§ 6.4).
// ─────────────────────────────────────────────────────────────────────────────

import { byString, checkCurrency, checkDay, formatAmount, formatQty } from './decimal.js';
import { readMovements, TRANSFER_KINDS, type Movement } from './ledger.js';
import { replay, type ReplayStep } from './valuation.js';
import {
  STOCK_MOVEMENT_KINDS,
  STOCK_VERSION,
  type CurrencyReport,
  type ItemReport,
  type KindQuantityValue,
  type ProjectMaterials,
  type ProjectMaterialsResult,
  type StockCurrency,
  type StockItemInput,
  type StockMovementInput,
  type StockMovementKind,
  type StockPeriod,
  type StockReport,
} from './types.js';

interface KindAcc {
  qty: bigint;
  value: bigint;
  count: number;
  unvalued: number;
}

function groupByItem(movements: readonly Movement[]): Map<string, Movement[]> {
  const byItem = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemId) ?? [];
    list.push(m);
    byItem.set(m.itemId, list);
  }
  return byItem;
}

function checkPeriod(period: StockPeriod): StockPeriod {
  const from = checkDay(period.from, 'Début de période');
  const to = checkDay(period.to, 'Fin de période');
  if (from > to) throw new RangeError('Période : le début suit la fin');
  return { from, to };
}

const kindRows = (acc: Map<StockMovementKind, KindAcc>): KindQuantityValue[] =>
  STOCK_MOVEMENT_KINDS.filter((k) => acc.has(k)).map((kind) => {
    const a = acc.get(kind) as KindAcc;
    return {
      kind,
      quantity: formatQty(a.qty),
      value: formatAmount(a.value),
      count: a.count,
      unvaluedCount: a.unvalued,
    };
  });

/** Apport d'une étape à la consommation d'un projet (signé), ou `null`. */
function projectContribution(step: ReplayStep): { issue: boolean; value: bigint | null } | null {
  const m = step.movement;
  if (m.workProjectId === null) return null;
  if (m.kind === 'issue' && m.qty < 0n) return { issue: true, value: step.exitCost };
  if ((m.kind === 'issue' && m.qty > 0n) || m.kind === 'issue_return') {
    return { issue: false, value: step.entryValue === null ? null : -step.entryValue };
  }
  return null;
}

interface ProjectAcc {
  workProjectId: string;
  currency: StockCurrency;
  value: bigint;
  issues: number;
  unvalued: number;
}

function addProject(acc: Map<string, ProjectAcc>, step: ReplayStep, currency: StockCurrency): void {
  const c = projectContribution(step);
  if (c === null) return;
  const id = step.movement.workProjectId as string;
  const key = `${id}\u0000${currency}`;
  const p = acc.get(key) ?? { workProjectId: id, currency, value: 0n, issues: 0, unvalued: 0 };
  if (c.issue) p.issues += 1;
  if (c.value === null) p.unvalued += 1;
  else p.value += c.value;
  acc.set(key, p);
}

const projectRows = (acc: Map<string, ProjectAcc>): ProjectMaterials[] =>
  [...acc.values()]
    .sort((a, b) => byString(a.workProjectId, b.workProjectId) || byString(a.currency, b.currency))
    .map((p) => ({
      workProjectId: p.workProjectId,
      currency: p.currency,
      consumedValue: formatAmount(p.value),
      issueCount: p.issues,
      unvaluedCount: p.unvalued,
    }));

export function stockReport(
  movements: readonly StockMovementInput[],
  items: readonly StockItemInput[],
  period: StockPeriod,
): StockReport {
  const { from, to } = checkPeriod(period);
  const byItem = groupByItem(readMovements(movements).filter((m) => m.occurredOn <= to));
  const itemRows: ItemReport[] = [];
  const currencies = new Map<
    StockCurrency,
    {
      opening: bigint;
      entries: bigint;
      exits: bigint;
      sales: bigint;
      consumption: bigint;
      closing: bigint;
      complete: boolean;
    }
  >();
  const projects = new Map<string, ProjectAcc>();

  for (const item of [...items].sort((a, b) => byString(a.id, b.id))) {
    if (item.tracked === false) continue;
    const list = byItem.get(item.id);
    if (list === undefined) continue;
    const currency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
    const before = replay(list.filter((m) => m.occurredOn < from));
    const s = replay(list);
    const entries = new Map<StockMovementKind, KindAcc>();
    const exits = new Map<StockMovementKind, KindAcc>();
    let sales = 0n;
    let consumption = 0n;
    let periodEntries = 0n;
    let periodExits = 0n;
    for (const step of s.steps) {
      const m = step.movement;
      if (m.occurredOn < from) continue;
      const isEntry = m.qty > 0n;
      const target = isEntry ? entries : exits;
      const a = target.get(m.kind) ?? { qty: 0n, value: 0n, count: 0, unvalued: 0 };
      const value = isEntry ? step.entryValue : step.exitCost;
      a.qty += isEntry ? m.qty : -m.qty;
      a.count += 1;
      if (value === null) a.unvalued += 1;
      else a.value += value;
      target.set(m.kind, a);
      if (isEntry) periodEntries += value ?? 0n;
      else periodExits += value ?? 0n;
      if (m.kind === 'sale_issue') sales += isEntry ? -(value ?? 0n) : (value ?? 0n);
      if (m.kind === 'sale_return') sales -= value ?? 0n;
      if (m.kind === 'issue') consumption += isEntry ? -(value ?? 0n) : (value ?? 0n);
      if (m.kind === 'issue_return') consumption -= value ?? 0n;
      addProject(projects, step, currency);
    }
    const transfers = list
      .filter((m) => m.occurredOn >= from && TRANSFER_KINDS.has(m.kind) && m.qty > 0n)
      .reduce((sum, m) => sum + m.qty, 0n);
    const complete = s.unvaluedEntries === 0;
    itemRows.push({
      itemId: item.id,
      currency,
      openingQuantity: formatQty(before.qty),
      openingValue: formatAmount(before.value),
      entries: kindRows(entries),
      exits: kindRows(exits),
      transfersQuantity: formatQty(transfers),
      closingQuantity: formatQty(s.qty),
      closingValue: formatAmount(s.value),
      complete,
    });
    const c = currencies.get(currency) ?? {
      opening: 0n,
      entries: 0n,
      exits: 0n,
      sales: 0n,
      consumption: 0n,
      closing: 0n,
      complete: true,
    };
    c.opening += before.value;
    c.entries += periodEntries;
    c.exits += periodExits;
    c.sales += sales;
    c.consumption += consumption;
    c.closing += s.value;
    c.complete &&= complete;
    currencies.set(currency, c);
  }

  const byCurrency: CurrencyReport[] = [...currencies.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([currency, c]) => ({
      currency,
      openingValue: formatAmount(c.opening),
      entriesValue: formatAmount(c.entries),
      exitsCost: formatAmount(c.exits),
      costOfSales: formatAmount(c.sales),
      consumption: formatAmount(c.consumption),
      closingValue: formatAmount(c.closing),
      complete: c.complete,
    }));
  return {
    version: STOCK_VERSION,
    period: { from, to },
    items: itemRows,
    byCurrency,
    byProject: projectRows(projects),
  };
}

export function projectMaterials(
  movements: readonly StockMovementInput[],
  items: readonly StockItemInput[],
  workProjectId?: string | null,
): ProjectMaterialsResult {
  const byItem = groupByItem(readMovements(movements));
  const projects = new Map<string, ProjectAcc>();
  for (const item of [...items].sort((a, b) => byString(a.id, b.id))) {
    const list = byItem.get(item.id);
    if (list === undefined || item.tracked === false) continue;
    const currency = checkCurrency(item.costCurrency, `Article ${item.id} : devise de coût`);
    for (const step of replay(list).steps) {
      if (
        workProjectId !== undefined &&
        workProjectId !== null &&
        step.movement.workProjectId !== workProjectId
      ) {
        continue;
      }
      addProject(projects, step, currency);
    }
  }
  return { version: STOCK_VERSION, projects: projectRows(projects) };
}
