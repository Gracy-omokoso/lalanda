// Moteur des stocks (ADR-0046 § 7.1). Attendus calculés à la main ; les
// propriétés utilisent un générateur pseudo-aléatoire à graine fixe : un échec
// est rejouable à l'identique.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENGINE_VERSION,
  HR_VERSION,
  PURCHASES_VERSION,
  STOCK_VERSION,
  checkStockAvailability,
  countVariances,
  entryUnitCost,
  projectMaterials,
  replenishmentSuggestions,
  stockFindings,
  stockLevelDrift,
  stockLevels,
  stockReport,
  stockValuation,
  toStockQuantity,
  weightedAverageValuation,
  type StockItemInput,
  type StockMovementInput,
} from '../index.js';

// ─── Outils ──────────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));
function shuffle<T>(r: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Décimal à échelle fixe (entier → chaîne). */
const dec = (scaled: number, decimals: number): string => {
  const neg = scaled < 0;
  const abs = String(Math.abs(scaled)).padStart(decimals + 1, '0');
  const s = decimals === 0 ? abs : `${abs.slice(0, -decimals)}.${abs.slice(-decimals)}`;
  return neg ? `-${s}` : s;
};
const cents = (s: string): bigint => {
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(i ?? '0') * 100n + BigInt(f.padEnd(2, '0'));
  return neg ? -v : v;
};

const ITEM: StockItemInput = {
  id: 'item-a',
  unit: 'pièce',
  unitConversions: [{ unit: 'carton', factor: '12' }],
  costCurrency: 'USD',
};
const MAIN = 'loc-main';
const SITE = 'loc-site';

let seq = 0;
const id = (): string => `m${String((seq += 1)).padStart(6, '0')}`;

function entry(
  quantity: string,
  unitCost: string | null,
  occurredOn = '2026-10-01',
  over: Partial<StockMovementInput> = {},
): StockMovementInput {
  return {
    id: id(),
    itemId: ITEM.id,
    locationId: MAIN,
    kind: 'purchase_receipt',
    quantity,
    occurredOn,
    unitCost,
    costStatus: unitCost === null ? 'pending_cost' : 'valued',
    ...over,
  };
}
function exit(
  quantity: string,
  occurredOn = '2026-10-01',
  over: Partial<StockMovementInput> = {},
): StockMovementInput {
  return {
    id: id(),
    itemId: ITEM.id,
    locationId: MAIN,
    kind: 'issue',
    quantity: `-${quantity}`,
    occurredOn,
    unitCost: null,
    costStatus: 'not_applicable',
    ...over,
  };
}

// ─── Versions ────────────────────────────────────────────────────────────────

describe('versions', () => {
  it('STOCK_VERSION 1.0.0, versions existantes inchangées', () => {
    expect(STOCK_VERSION).toBe('1.0.0');
    expect(ENGINE_VERSION).toBe('0.2.0');
    expect(PURCHASES_VERSION).toBe('1.0.0');
    expect(HR_VERSION).toBe('1.1.0');
  });
});

// ─── Conversions et coût d'entrée ────────────────────────────────────────────

describe('toStockQuantity', () => {
  it('convertit par le facteur ; même unité : facteur 1 (casse et espaces ignorés)', () => {
    expect(toStockQuantity('6', 'carton', ITEM)).toEqual({
      version: STOCK_VERSION,
      ok: true,
      quantity: '72',
      factor: '12.000000',
    });
    expect(toStockQuantity('2.5', ' Pièce ', ITEM)).toMatchObject({ ok: true, quantity: '2.5' });
  });

  it('arrondit demi vers le haut au millième', () => {
    const item = { ...ITEM, unitConversions: [{ unit: 'lot', factor: '0.333333' }] };
    // 1.5 × 0.333333 = 0.4999995 → 0.500
    expect(toStockQuantity('1.5', 'lot', item)).toMatchObject({ quantity: '0.5' });
    // 1 × 0.333333 = 0.333333 → 0.333
    expect(toStockQuantity('1', 'lot', item)).toMatchObject({ quantity: '0.333' });
  });

  it('unité inconnue : UNKNOWN_UNIT ; quantité invalide : erreur', () => {
    expect(toStockQuantity('1', 'palette', ITEM)).toEqual({
      version: STOCK_VERSION,
      ok: false,
      code: 'UNKNOWN_UNIT',
    });
    expect(() => toStockQuantity('0', 'pièce', ITEM)).toThrow(RangeError);
    expect(() => toStockQuantity('1.2345', 'pièce', ITEM)).toThrow(RangeError);
    expect(() =>
      toStockQuantity('1', 'lot', { ...ITEM, unitConversions: [{ unit: 'lot', factor: '0' }] }),
    ).toThrow(RangeError);
  });
});

describe('entryUnitCost (critère 3)', () => {
  it('12,00 USD le carton de 12 → 1,000000 USD la pièce', () => {
    expect(entryUnitCost({ unitPrice: '12.00', unit: 'carton', currency: 'USD' }, ITEM)).toEqual({
      version: STOCK_VERSION,
      status: 'valued',
      unitCost: '1.000000',
      factor: '12.000000',
    });
  });

  it('remise déduite ; six décimales arrondies', () => {
    // 10,00 − 15 % = 8,50 ; ÷ 12 = 0,708333…
    expect(
      entryUnitCost(
        { unitPrice: '10.00', discountPercent: '15', unit: 'carton', currency: 'USD' },
        ITEM,
      ),
    ).toMatchObject({ unitCost: '0.708333' });
    // 1,00 ÷ 3 = 0,333333… ; 2,00 ÷ 3 = 0,666667
    const third = { ...ITEM, unitConversions: [{ unit: 'lot', factor: '3' }] };
    expect(entryUnitCost({ unitPrice: '2.00', unit: 'lot', currency: 'USD' }, third)).toMatchObject(
      { unitCost: '0.666667' },
    );
    expect(
      entryUnitCost(
        { unitPrice: '5.00', discountPercent: '100', unit: 'pièce', currency: 'USD' },
        ITEM,
      ),
    ).toMatchObject({ unitCost: '0.000000' });
  });

  it('devise différente : pending_cost, AUCUN taux ; unité inconnue : unknown_unit', () => {
    expect(entryUnitCost({ unitPrice: '30000', unit: 'carton', currency: 'CDF' }, ITEM)).toEqual({
      version: STOCK_VERSION,
      status: 'pending_cost',
      code: 'CURRENCY_DIFFERS',
    });
    expect(entryUnitCost({ unitPrice: '1', unit: 'sac', currency: 'USD' }, ITEM)).toMatchObject({
      status: 'unknown_unit',
      code: 'UNKNOWN_UNIT',
    });
    expect(() =>
      entryUnitCost(
        { unitPrice: '1', discountPercent: '101', unit: 'pièce', currency: 'USD' },
        ITEM,
      ),
    ).toThrow(RangeError);
    expect(() =>
      entryUnitCost({ unitPrice: '1', unit: 'pièce', currency: 'EUR' as 'USD' }, ITEM),
    ).toThrow(RangeError);
  });
});

// ─── Grand livre : contrôles ─────────────────────────────────────────────────

describe('contrôle des mouvements', () => {
  it('refuse un sens contraire au type, une quantité nulle, un coût sur une sortie', () => {
    expect(() => weightedAverageValuation([entry('-1', '1')], ITEM)).toThrow(/sens contraire/);
    expect(() =>
      weightedAverageValuation([exit('1', '2026-10-01', { quantity: '1' })], ITEM),
    ).toThrow(/sens contraire/);
    expect(() => weightedAverageValuation([entry('0', '1')], ITEM)).toThrow(RangeError);
    expect(() =>
      weightedAverageValuation([exit('1', '2026-10-01', { unitCost: '1' })], ITEM),
    ).toThrow(/pas de coût/);
    expect(() =>
      weightedAverageValuation([entry('1', null, '2026-10-01', { costStatus: 'valued' })], ITEM),
    ).toThrow(/sans coût/);
    expect(() =>
      weightedAverageValuation(
        [entry('1', '1', '2026-10-01', { costStatus: 'not_applicable' })],
        ITEM,
      ),
    ).toThrow(/non valorisée/);
    expect(() => weightedAverageValuation([entry('1', '1', '2026-02-30')], ITEM)).toThrow(/date/);
    const m = entry('1', '1');
    expect(() => weightedAverageValuation([m, m], ITEM)).toThrow(/double/);
  });

  it('contre-passation : sens inverse du type permis', () => {
    const v = weightedAverageValuation(
      [
        entry('10', '2'),
        exit('4'),
        exit('-4', '2026-10-02', { quantity: '4', reversalOf: 'x' }),
        entry('-10', null, '2026-10-03', {
          kind: 'purchase_receipt',
          quantity: '-10',
          costStatus: 'not_applicable',
          reversalOf: 'y',
        }),
      ],
      ITEM,
    );
    expect(v.quantity).toBe('0');
    expect(v.value).toBe('0.00');
  });

  it('ajustements dans les deux sens ; transfert sans coût', () => {
    expect(() =>
      weightedAverageValuation(
        [
          entry('5', '1'),
          exit('2', '2026-10-01', { kind: 'adjustment' }),
          entry('1', null, '2026-10-01', { kind: 'adjustment', costStatus: 'not_applicable' }),
        ],
        ITEM,
      ),
    ).not.toThrow();
    expect(() =>
      stockLevels([
        entry('1', null, '2026-10-01', {
          kind: 'transfer_in',
          costStatus: 'valued',
          unitCost: '1',
        }),
      ]),
    ).toThrow(/transfert/);
  });
});

// ─── Coût moyen pondéré (critère 6) ──────────────────────────────────────────

describe('weightedAverageValuation', () => {
  it('10 à 2,00 + 10 à 3,00 → 2,50 ; sortie 5 → 37,50 ; entrée 5 à 4,00 → 2,875', () => {
    const v = weightedAverageValuation(
      [
        entry('10', '2', '2026-10-01'),
        entry('10', '3', '2026-10-02'),
        exit('5', '2026-10-03'),
        entry('5', '4', '2026-10-04'),
      ],
      ITEM,
    );
    expect(v.steps.map((s) => s.averageUnitCostAfter)).toEqual([
      '2.000000',
      '2.500000',
      '2.500000',
      '2.875000',
    ]);
    expect(v.steps[2]).toMatchObject({ exitCost: '12.50', valueAfter: '37.50', valued: true });
    expect(v).toMatchObject({
      version: STOCK_VERSION,
      currency: 'USD',
      quantity: '20',
      value: '57.50',
      averageUnitCost: '2.875000',
      complete: true,
      entriesValue: '70.00',
      exitsCost: '12.50',
      roundingResidue: '0.00',
      negativeStockRevaluation: '0.00',
      findings: [],
    });
  });

  it('corriger après coup la première entrée à 2,20 : le rejeu recalcule tout', () => {
    const v = weightedAverageValuation(
      [
        entry('10', '2.20', '2026-10-01'),
        entry('10', '3', '2026-10-02'),
        exit('5', '2026-10-03'),
        entry('5', '4', '2026-10-04'),
      ],
      ITEM,
    );
    // 22 + 30 = 52 → 2,60 ; sortie 13,00 → 39,00 ; + 20 = 59,00 / 20 = 2,95
    expect(v.steps[2]?.exitCost).toBe('13.00');
    expect(v).toMatchObject({ value: '59.00', averageUnitCost: '2.950000' });
  });

  it('quantité ramenée à 0 : valeur 0 et reste d’arrondi rendu', () => {
    const v = weightedAverageValuation(
      [entry('3', '1'), entry('1', '0.01'), exit('1'), exit('1'), exit('1'), exit('1')],
      ITEM,
    );
    // 3,01 / 4 = 0,7525 ; trois sorties à 0,75 ; la dernière emporte 0,76
    expect(v.steps.map((s) => s.exitCost)).toEqual([null, null, '0.75', '0.75', '0.75', '0.76']);
    expect(v.steps[5]?.roundingResidue).toBe('0.01');
    expect(v).toMatchObject({
      quantity: '0',
      value: '0.00',
      roundingResidue: '0.01',
      exitsCost: '3.01',
      entriesValue: '3.01',
    });
  });

  it('la valeur ne devient jamais négative sur un stock positif (borne)', () => {
    // 0,02 / 4 = 0,005 ; chaque sortie de 1 → 0,01 (demi vers le haut)
    const v = weightedAverageValuation(
      [entry('4', '0.005'), exit('1'), exit('1'), exit('1'), exit('1')],
      ITEM,
    );
    expect(v.steps.map((s) => s.valueAfter)).toEqual(['0.02', '0.01', '0.00', '0.00', '0.00']);
    expect(v.steps.map((s) => s.exitCost)).toEqual([null, '0.01', '0.01', '0.00', '0.00']);
  });

  it('stock négatif constaté : la part manquante au CMUP, puis réévaluation', () => {
    const v = weightedAverageValuation(
      [
        entry('3', '2'),
        exit('5', '2026-10-02', { kind: 'sale_issue' }),
        entry('10', '3', '2026-10-03'),
      ],
      ITEM,
    );
    expect(v.steps[1]).toMatchObject({
      exitCost: '10.00',
      valueAfter: '-4.00',
      quantityAfter: '-2',
    });
    expect(v.steps[2]).toMatchObject({
      entryValue: '30.00',
      negativeStockRevaluation: '2.00',
      valueAfter: '24.00',
      averageUnitCostAfter: '3.000000',
    });
    // identité : 6 + 30 = 10 + 24 + 2
    expect(v).toMatchObject({ entriesValue: '36.00', exitsCost: '10.00', value: '24.00' });
    const neg = weightedAverageValuation(
      [entry('3', '2'), exit('5', '2026-10-02', { kind: 'sale_issue' })],
      ITEM,
    );
    expect(neg.findings).toEqual(['NEGATIVE_STOCK']);
  });

  it('entrée à quantité nulle : le CMUP repart du coût de l’entrée', () => {
    const v = weightedAverageValuation(
      [entry('2', '5'), exit('2'), entry('3', '0.333333', '2026-10-02')],
      ITEM,
    );
    expect(v).toMatchObject({ averageUnitCost: '0.333333', value: '1.00', quantity: '3' });
  });

  it('entrée en attente de coût : quantité comptée, valorisation incomplète (critère 5)', () => {
    const pending = entry('5', null, '2026-10-02');
    const base = [entry('10', '2'), pending, exit('3', '2026-10-03')];
    const v = weightedAverageValuation(base, ITEM);
    expect(v).toMatchObject({
      quantity: '12',
      value: '14.00',
      averageUnitCost: '2.000000',
      complete: false,
      unvaluedEntryCount: 1,
      findings: ['UNVALUED_ENTRIES'],
    });
    // le coût saisi dans la devise de l'article rétablit la valeur
    const fixed = base.map((m) =>
      m.id === pending.id ? { ...m, unitCost: '3.20', costStatus: 'valued' as const } : m,
    );
    const w = weightedAverageValuation(fixed, ITEM);
    // 20 + 16 = 36 / 15 = 2,40 ; sortie 7,20 → 28,80
    expect(w).toMatchObject({ complete: true, value: '28.80', averageUnitCost: '2.400000' });
  });

  it('retour sans coût saisi : au CMUP courant, qui ne change pas ; sans CMUP : non valorisé', () => {
    const ret = (q: string, on: string): StockMovementInput =>
      entry(q, null, on, { kind: 'issue_return', costStatus: 'not_applicable' });
    const v = weightedAverageValuation(
      [entry('3', '1'), entry('3', '2'), exit('2', '2026-10-02'), ret('1', '2026-10-03')],
      ITEM,
    );
    expect(v.steps[3]).toMatchObject({ unitCost: '1.500000', entryValue: '1.50' });
    expect(v).toMatchObject({ averageUnitCost: '1.500000', value: '7.50', quantity: '5' });
    const none = weightedAverageValuation([ret('1', '2026-10-01'), exit('1', '2026-10-02')], ITEM);
    expect(none).toMatchObject({
      complete: false,
      unvaluedEntryCount: 1,
      unvaluedExitCount: 1,
      averageUnitCost: null,
      value: '0.00',
    });
  });

  it('transferts : ni valeur ni coût moyen ; appariement contrôlé', () => {
    const out = exit('4', '2026-10-02', { kind: 'transfer_out' });
    const inn = entry('4', null, '2026-10-02', {
      kind: 'transfer_in',
      locationId: SITE,
      costStatus: 'not_applicable',
    });
    const v = weightedAverageValuation([entry('4', '2'), out, inn], ITEM);
    expect(v).toMatchObject({
      quantity: '4',
      value: '8.00',
      averageUnitCost: '2.000000',
      unpairedTransferQuantity: '0',
    });
    expect(v.steps).toHaveLength(1);
    expect(weightedAverageValuation([entry('4', '2'), out], ITEM).unpairedTransferQuantity).toBe(
      '-4',
    );
  });

  it('jusqu’à une date ; ordre : date puis identifiant ; autres articles ignorés', () => {
    const late = entry('10', '9', '2026-10-05');
    const early = entry('10', '1', '2026-10-01');
    const other = entry('10', '5', '2026-10-01', { itemId: 'item-b' });
    const v = weightedAverageValuation([late, other, early], ITEM, '2026-10-04');
    expect(v).toMatchObject({ until: '2026-10-04', quantity: '10', value: '10.00' });
    expect(weightedAverageValuation([late, early], ITEM).steps.map((s) => s.movementId)).toEqual([
      early.id,
      late.id,
    ]);
    expect(() => weightedAverageValuation([], ITEM, '2026-13-01')).toThrow(RangeError);
    expect(weightedAverageValuation([], ITEM)).toMatchObject({
      quantity: '0',
      value: '0.00',
      averageUnitCost: null,
      complete: true,
    });
  });
});

describe('stockValuation', () => {
  it('par article et par devise, sans total toutes devises ; par emplacement', () => {
    const cdf: StockItemInput = { id: 'item-c', unit: 'kg', costCurrency: 'CDF' };
    const off: StockItemInput = { id: 'item-z', unit: 'kg', costCurrency: 'CDF', tracked: false };
    const movements = [
      entry('10', '2'),
      exit('4', '2026-10-02', { kind: 'transfer_out' }),
      entry('4', null, '2026-10-02', {
        kind: 'transfer_in',
        locationId: SITE,
        costStatus: 'not_applicable',
      }),
      entry('3', '1500', '2026-10-01', { itemId: 'item-c' }),
      entry('1', '1', '2026-10-01', { itemId: 'item-z' }),
      entry('100', '9', '2026-12-01'),
    ];
    const all = stockValuation({ movements, items: [cdf, ITEM, off], until: '2026-11-30' });
    expect(all.items.map((i) => [i.itemId, i.quantity, i.value])).toEqual([
      ['item-a', '10', '20.00'],
      ['item-c', '3', '4500.00'],
    ]);
    expect(all.byCurrency).toEqual([
      { currency: 'CDF', value: '4500.00', itemCount: 1, complete: true },
      { currency: 'USD', value: '20.00', itemCount: 1, complete: true },
    ]);
    const site = stockValuation({
      movements,
      items: [cdf, ITEM],
      until: '2026-11-30',
      locationId: SITE,
    });
    expect(site.items).toEqual([
      {
        itemId: 'item-a',
        currency: 'USD',
        quantity: '4',
        value: '8.00',
        averageUnitCost: '2.000000',
        complete: true,
      },
    ]);
  });
});

// ─── Niveaux et cache ────────────────────────────────────────────────────────

describe('stockLevels, stockLevelDrift', () => {
  it('quantités par article et emplacement, transferts compris (critère 9)', () => {
    const movements = [
      entry('10', '2', '2026-10-01'),
      exit('4', '2026-10-03', { kind: 'transfer_out' }),
      entry('4', null, '2026-10-03', {
        kind: 'transfer_in',
        locationId: SITE,
        costStatus: 'not_applicable',
      }),
      exit('1', '2026-10-04', { locationId: SITE }),
    ];
    expect(stockLevels(movements)).toEqual({
      version: STOCK_VERSION,
      levels: [
        {
          itemId: 'item-a',
          locationId: MAIN,
          quantity: '6',
          lastOccurredOn: '2026-10-03',
          movementCount: 2,
        },
        {
          itemId: 'item-a',
          locationId: SITE,
          quantity: '3',
          lastOccurredOn: '2026-10-04',
          movementCount: 2,
        },
      ],
    });
    // coût moyen inchangé par le transfert
    expect(weightedAverageValuation(movements, ITEM).averageUnitCost).toBe('2.000000');
  });

  it('écart de cache STOCK_LEVEL_DRIFT (critère 12)', () => {
    const movements = [entry('10', '2'), exit('3', '2026-10-02', { locationId: MAIN })];
    expect(
      stockLevelDrift([{ itemId: 'item-a', locationId: MAIN, quantity: '7' }], movements),
    ).toEqual({ version: STOCK_VERSION, ok: true, drifts: [] });
    expect(
      stockLevelDrift(
        [
          { itemId: 'item-a', locationId: MAIN, quantity: '9' },
          { itemId: 'item-b', locationId: SITE, quantity: '1.5' },
        ],
        movements,
      ).drifts,
    ).toEqual([
      {
        code: 'STOCK_LEVEL_DRIFT',
        itemId: 'item-a',
        locationId: MAIN,
        cached: '9',
        ledger: '7',
        difference: '-2',
      },
      {
        code: 'STOCK_LEVEL_DRIFT',
        itemId: 'item-b',
        locationId: SITE,
        cached: '1.5',
        ledger: '0',
        difference: '-1.5',
      },
    ]);
    // ligne de cache manquante
    expect(stockLevelDrift([], movements).drifts[0]).toMatchObject({ cached: '0', ledger: '7' });
    expect(() =>
      stockLevelDrift(
        [
          { itemId: 'a', locationId: 'l', quantity: '1' },
          { itemId: 'a', locationId: 'l', quantity: '1' },
        ],
        [],
      ),
    ).toThrow(/double/);
  });
});

// ─── Stock négatif (O4, critère 8) ───────────────────────────────────────────

describe('checkStockAvailability', () => {
  const movements = [entry('3', '2')];
  const lines = [{ itemId: 'item-a', locationId: MAIN, quantity: '5' }];

  it('bon de sortie de 5 avec 3 en stock : STOCK_INSUFFICIENT', () => {
    expect(checkStockAvailability({ movements, lines, allowNegativeManualMoves: false })).toEqual({
      version: STOCK_VERSION,
      ok: false,
      code: 'STOCK_INSUFFICIENT',
      shortfalls: [
        { itemId: 'item-a', locationId: MAIN, available: '3', requested: '5', shortfall: '2' },
      ],
      goesNegative: false,
    });
  });

  it('négatif manuel permis : accepté avec alerte', () => {
    expect(
      checkStockAvailability({ movements, lines, allowNegativeManualMoves: true }),
    ).toMatchObject({ ok: true, code: null, goesNegative: true });
  });

  it('les lignes d’un même article et emplacement se cumulent ; autre emplacement : 0', () => {
    const r = checkStockAvailability({
      movements,
      lines: [
        { itemId: 'item-a', locationId: MAIN, quantity: '2' },
        { itemId: 'item-a', locationId: MAIN, quantity: '1' },
      ],
      allowNegativeManualMoves: false,
    });
    expect(r).toMatchObject({ ok: true, shortfalls: [] });
    expect(
      checkStockAvailability({
        movements,
        lines: [{ itemId: 'item-a', locationId: SITE, quantity: '0.001' }],
        allowNegativeManualMoves: false,
      }).ok,
    ).toBe(false);
  });
});

// ─── Inventaires (critère 10) ────────────────────────────────────────────────

describe('countVariances', () => {
  const at = (t: string): string => `2026-10-10T${t}Z`;
  const opening = entry('20', '5', '2026-10-01', { kind: 'opening', recordedAt: at('07:00:00') });
  const sold = exit('3', '2026-10-10', { kind: 'sale_issue', recordedAt: at('09:00:00.5') });
  const later = exit('2', '2026-10-10', { kind: 'sale_issue', recordedAt: at('11:00:00') });
  const elsewhere = entry('7', '5', '2026-10-01', { locationId: SITE, recordedAt: at('07:00:00') });

  it('théorique au comptage de la ligne : 20 − 3 = 17 ; compté 16 → −1, −5,00', () => {
    const r = countVariances({
      locationId: MAIN,
      lines: [{ id: 'l1', itemId: 'item-a', countedQuantity: '16', countedAt: at('10:00:00') }],
      movements: [opening, sold, later, elsewhere],
      items: [ITEM],
    });
    expect(r.lines).toEqual([
      {
        lineId: 'l1',
        itemId: 'item-a',
        status: 'counted',
        theoretical: '17',
        counted: '16',
        variance: '-1',
        currency: 'USD',
        valuedVariance: '-5.00',
        adjustmentUnitCost: null,
        needsUnitCost: false,
      },
    ]);
    expect(r.byCurrency).toEqual([
      { currency: 'USD', gains: '0.00', losses: '5.00', net: '-5.00', unvaluedLineCount: 0 },
    ]);
    expect(r).toMatchObject({ countedLineCount: 1, varianceLineCount: 1 });
  });

  it('ligne non comptée ; écart nul ; horodatage à la milliseconde', () => {
    const r = countVariances({
      locationId: MAIN,
      lines: [
        { id: 'l1', itemId: 'item-a', countedQuantity: null, countedAt: null },
        { id: 'l2', itemId: 'item-a', countedQuantity: '20', countedAt: at('09:00:00.4') },
        { id: 'l3', itemId: 'item-a', countedQuantity: '17', countedAt: at('09:00:00.500') },
      ],
      movements: [opening, sold],
      items: [ITEM],
    });
    expect(r.lines.map((l) => [l.status, l.variance, l.valuedVariance])).toEqual([
      ['not_counted', null, null],
      ['counted', '0', '0.00'],
      ['counted', '0', '0.00'],
    ]);
  });

  it('stock initial : écart positif valorisé au coût saisi ; sans coût ni historique : à saisir', () => {
    const r = countVariances({
      locationId: MAIN,
      lines: [
        {
          id: 'a',
          itemId: 'item-a',
          countedQuantity: '12',
          countedAt: at('08:00:00'),
          unitCost: '2.5',
        },
        { id: 'b', itemId: 'item-b', countedQuantity: '4', countedAt: at('08:00:00') },
      ],
      movements: [],
      items: [ITEM, { id: 'item-b', unit: 'kg', costCurrency: 'CDF' }],
    });
    expect(r.lines[0]).toMatchObject({
      variance: '12',
      valuedVariance: '30.00',
      adjustmentUnitCost: '2.500000',
      needsUnitCost: false,
    });
    expect(r.lines[1]).toMatchObject({ variance: '4', valuedVariance: null, needsUnitCost: true });
    expect(r.byCurrency).toEqual([
      { currency: 'CDF', gains: '0.00', losses: '0.00', net: '0.00', unvaluedLineCount: 1 },
      { currency: 'USD', gains: '30.00', losses: '0.00', net: '30.00', unvaluedLineCount: 0 },
    ]);
  });

  it('écart positif d’un article valorisé : au CMUP, coût du mouvement laissé au moteur', () => {
    const r = countVariances({
      locationId: MAIN,
      lines: [{ id: 'l', itemId: 'item-a', countedQuantity: '18', countedAt: at('10:00:00') }],
      movements: [opening, sold],
      items: [ITEM],
    });
    expect(r.lines[0]).toMatchObject({
      variance: '1',
      valuedVariance: '5.00',
      adjustmentUnitCost: null,
    });
  });

  it('erreurs : horodatage manquant, article absent, horodatage illisible', () => {
    expect(() =>
      countVariances({ locationId: MAIN, lines: [], movements: [entry('1', '1')], items: [ITEM] }),
    ).toThrow(/horodatage/);
    expect(() =>
      countVariances({
        locationId: MAIN,
        lines: [{ id: 'x', itemId: 'nope', countedQuantity: '1', countedAt: at('08:00:00') }],
        movements: [],
        items: [ITEM],
      }),
    ).toThrow(/absent/);
    expect(() =>
      countVariances({
        locationId: MAIN,
        lines: [{ id: 'x', itemId: 'item-a', countedQuantity: '1', countedAt: '2026-10-10 08:00' }],
        movements: [],
        items: [ITEM],
      }),
    ).toThrow(/horodatage/);
  });
});

// ─── Réapprovisionnement (critère 11) ────────────────────────────────────────

describe('replenishmentSuggestions', () => {
  const item = (over: Partial<StockItemInput>): StockItemInput => ({
    ...ITEM,
    reorder: { minQuantity: '10', targetQuantity: '30', locationId: null },
    preferredSupplierId: 'sup-1',
    ...over,
  });

  it('seuil 10, cible 30, disponible 4, 8 commandés → 18', () => {
    const r = replenishmentSuggestions(
      [
        { itemId: 'item-a', locationId: MAIN, quantity: '3' },
        { itemId: 'item-a', locationId: SITE, quantity: '1' },
      ],
      [item({})],
      [{ itemId: 'item-a', quantity: '8' }],
    );
    expect(r).toEqual({
      version: STOCK_VERSION,
      suggestions: [
        {
          itemId: 'item-a',
          locationId: null,
          available: '4',
          minQuantity: '10',
          targetQuantity: '30',
          onOrder: '8',
          suggestedQuantity: '18',
          preferredSupplierId: 'sup-1',
        },
      ],
    });
  });

  it('sans cible : vise le seuil ; unité discrète : entier supérieur ; jamais négatif', () => {
    const levels = [{ itemId: 'item-a', locationId: MAIN, quantity: '2.4' }];
    const noTarget = item({ reorder: { minQuantity: '5', locationId: null } });
    expect(replenishmentSuggestions(levels, [noTarget]).suggestions[0]?.suggestedQuantity).toBe(
      '2.6',
    );
    expect(
      replenishmentSuggestions(levels, [{ ...noTarget, discreteUnit: true }]).suggestions[0]
        ?.suggestedQuantity,
    ).toBe('3');
    expect(
      replenishmentSuggestions(levels, [noTarget], [{ itemId: 'item-a', quantity: '50' }])
        .suggestions[0]?.suggestedQuantity,
    ).toBe('0');
  });

  it('seuil par emplacement ; au seuil : rien ; non suivi ou archivé : rien', () => {
    const levels = [
      { itemId: 'item-a', locationId: MAIN, quantity: '100' },
      { itemId: 'item-a', locationId: SITE, quantity: '2' },
    ];
    const local = item({ reorder: { minQuantity: '5', targetQuantity: '8', locationId: SITE } });
    expect(replenishmentSuggestions(levels, [local]).suggestions[0]).toMatchObject({
      locationId: SITE,
      available: '2',
      suggestedQuantity: '6',
    });
    const exact = [{ itemId: 'item-a', locationId: MAIN, quantity: '10' }];
    expect(replenishmentSuggestions(exact, [item({})]).suggestions).toEqual([]);
    expect(replenishmentSuggestions([], [item({ tracked: false })]).suggestions).toEqual([]);
    expect(replenishmentSuggestions([], [item({ active: false })]).suggestions).toEqual([]);
    expect(replenishmentSuggestions([], [item({ reorder: null })]).suggestions).toEqual([]);
    expect(() =>
      replenishmentSuggestions(
        [],
        [item({ reorder: { minQuantity: '10', targetQuantity: '5', locationId: null } })],
      ),
    ).toThrow(/visée/);
  });
});

// ─── Constats ────────────────────────────────────────────────────────────────

describe('stockFindings', () => {
  it('rend les cinq constats, dans un ordre stable', () => {
    const a: StockItemInput = {
      ...ITEM,
      reorder: { minQuantity: '50', locationId: null },
    };
    const b: StockItemInput = { id: 'item-b', unit: 'kg', costCurrency: 'CDF' };
    const receipt = entry('12', '1', '2026-06-01');
    const movements = [
      receipt,
      exit('15', '2026-10-01', { kind: 'sale_issue' }),
      entry('5', null, '2026-06-01', { itemId: 'item-b' }),
    ];
    const r = stockFindings({
      items: [b, a],
      movements,
      today: '2026-10-31',
      dormantDays: 90,
      costChecks: [
        {
          movementId: receipt.id,
          invoiceLine: { unitPrice: '13.20', unit: 'carton', currency: 'USD' },
        },
      ],
    });
    expect(r.findings).toEqual([
      {
        code: 'NEGATIVE_STOCK',
        itemId: 'item-a',
        locationId: MAIN,
        movementId: null,
        details: { quantity: '-3' },
      },
      {
        code: 'BELOW_REORDER',
        itemId: 'item-a',
        locationId: null,
        movementId: null,
        details: { available: '-3', minQuantity: '50', suggestedQuantity: '53' },
      },
      {
        code: 'UNVALUED_ENTRIES',
        itemId: 'item-b',
        locationId: null,
        movementId: null,
        details: { count: '1' },
      },
      {
        code: 'ENTRY_COST_DIFFERS_FROM_INVOICE',
        itemId: 'item-a',
        locationId: MAIN,
        movementId: receipt.id,
        details: { entryUnitCost: '1.000000', invoicedUnitCost: '1.100000' },
      },
      {
        code: 'DORMANT_ITEM',
        itemId: 'item-b',
        locationId: null,
        movementId: null,
        details: { lastMovementOn: '2026-06-01', idleDays: '152' },
      },
    ]);
  });

  it('même prix, autre devise, sans seuil de dormance : rien', () => {
    const receipt = entry('12', '1', '2026-10-01');
    const r = stockFindings({
      items: [ITEM],
      movements: [receipt],
      today: '2026-10-31',
      costChecks: [
        {
          movementId: receipt.id,
          invoiceLine: { unitPrice: '12', unit: 'carton', currency: 'USD' },
        },
        {
          movementId: receipt.id,
          invoiceLine: { unitPrice: '9', unit: 'carton', currency: 'CDF' },
        },
      ],
    });
    expect(r.findings).toEqual([]);
    expect(() =>
      stockFindings({ items: [ITEM], movements: [], today: '2026-10-31', dormantDays: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      stockFindings({
        items: [ITEM],
        movements: [],
        today: '2026-10-31',
        costChecks: [
          { movementId: 'x', invoiceLine: { unitPrice: '1', unit: 'pièce', currency: 'USD' } },
        ],
      }),
    ).toThrow(/absent/);
  });

  it('dormance : à N jours exactement oui, avant non ; stock nul : non', () => {
    const run = (today: string, movements: StockMovementInput[]) =>
      stockFindings({ items: [ITEM], movements, today, dormantDays: 30 }).findings.map(
        (f) => f.code,
      );
    const m = [entry('1', '1', '2026-10-01')];
    expect(run('2026-10-31', m)).toEqual(['DORMANT_ITEM']);
    expect(run('2026-10-30', m)).toEqual([]);
    expect(run('2026-12-31', [...m, exit('1', '2026-10-01')])).toEqual([]);
  });
});

// ─── Rapports et matériel des projets ────────────────────────────────────────

describe('stockReport, projectMaterials', () => {
  const movements = (): StockMovementInput[] => [
    entry('10', '2', '2026-09-15'),
    exit('2', '2026-09-20', { kind: 'sale_issue' }),
    entry('10', '4', '2026-10-02'),
    exit('3', '2026-10-05', { kind: 'sale_issue' }),
    entry('1', null, '2026-10-06', { kind: 'sale_return', costStatus: 'not_applicable' }),
    exit('5', '2026-10-07', { workProjectId: 'p1' }),
    entry('1', null, '2026-10-08', {
      kind: 'issue_return',
      costStatus: 'not_applicable',
      workProjectId: 'p1',
    }),
    exit('2', '2026-10-09', { kind: 'transfer_out' }),
    entry('2', null, '2026-10-09', {
      kind: 'transfer_in',
      locationId: SITE,
      costStatus: 'not_applicable',
    }),
    exit('1', '2026-11-02', { workProjectId: 'p1' }),
  ];

  it('ouverture, entrées et sorties par nature, clôture, coût des ventes, consommation', () => {
    // ouverture : 8 à 2,00 = 16,00 ; + 10 à 4 → 56,00 / 18 = 3,111111
    // vente 3 → 9,33 ; retour 1 → 3,11 ; sortie p1 5 → 15,56 ; retour p1 1 → 3,11
    const r = stockReport(movements(), [ITEM], { from: '2026-10-01', to: '2026-10-31' });
    expect(r.items).toEqual([
      {
        itemId: 'item-a',
        currency: 'USD',
        openingQuantity: '8',
        openingValue: '16.00',
        entries: [
          { kind: 'purchase_receipt', quantity: '10', value: '40.00', count: 1, unvaluedCount: 0 },
          { kind: 'sale_return', quantity: '1', value: '3.11', count: 1, unvaluedCount: 0 },
          { kind: 'issue_return', quantity: '1', value: '3.11', count: 1, unvaluedCount: 0 },
        ],
        exits: [
          { kind: 'sale_issue', quantity: '3', value: '9.33', count: 1, unvaluedCount: 0 },
          { kind: 'issue', quantity: '5', value: '15.56', count: 1, unvaluedCount: 0 },
        ],
        transfersQuantity: '2',
        closingQuantity: '12',
        closingValue: '37.33',
        complete: true,
      },
    ]);
    expect(r.byCurrency).toEqual([
      {
        currency: 'USD',
        openingValue: '16.00',
        entriesValue: '46.22',
        exitsCost: '24.89',
        costOfSales: '6.22',
        consumption: '12.45',
        closingValue: '37.33',
        complete: true,
      },
    ]);
    // ouverture + entrées − sorties = clôture
    expect(16_00n + 46_22n - 24_89n).toBe(37_33n);
    expect(r.byProject).toEqual([
      {
        workProjectId: 'p1',
        currency: 'USD',
        consumedValue: '12.45',
        issueCount: 1,
        unvaluedCount: 0,
      },
    ]);
    expect(() => stockReport([], [ITEM], { from: '2026-11-01', to: '2026-10-01' })).toThrow(
      RangeError,
    );
  });

  it('projectMaterials : toute la durée, par projet et par devise (critère 18)', () => {
    const r = projectMaterials(movements(), [ITEM]);
    // + sortie du 2 nov. : 1 × 3,111111 = 3,11
    expect(r.projects).toEqual([
      {
        workProjectId: 'p1',
        currency: 'USD',
        consumedValue: '15.56',
        issueCount: 2,
        unvaluedCount: 0,
      },
    ]);
    expect(projectMaterials(movements(), [ITEM], 'p2').projects).toEqual([]);
    const single = projectMaterials(
      [entry('10', '3'), exit('10', '2026-10-02', { workProjectId: 'P' })],
      [ITEM],
    );
    expect(single.projects[0]).toMatchObject({ consumedValue: '30.00' });
    const unvalued = projectMaterials([exit('1', '2026-10-02', { workProjectId: 'P' })], [ITEM]);
    expect(unvalued.projects[0]).toMatchObject({ consumedValue: '0.00', unvaluedCount: 1 });
  });
});

// ─── Propriétés à graine fixe ────────────────────────────────────────────────

/** Grand livre aléatoire d'un article ; `allowNegative` : sorties au-delà du disponible. */
function randomLedger(r: () => number, allowNegative: boolean, n = 40): StockMovementInput[] {
  const out: StockMovementInput[] = [];
  let qty = 0;
  let day = 1;
  for (let i = 0; i < n; i += 1) {
    if (r() < 0.3) day += 1;
    const on = `2026-${day > 28 ? '11' : '10'}-${String(((day - 1) % 28) + 1).padStart(2, '0')}`;
    const roll = r();
    if (roll < 0.45 || qty === 0) {
      const q = int(r, 1, 5000);
      out.push(entry(dec(q, 3), dec(int(r, 0, 9_999_999), 6), on));
      qty += q;
    } else if (roll < 0.55) {
      const q = int(r, 1, 3000);
      out.push(entry(dec(q, 3), null, on, { kind: 'sale_return', costStatus: 'not_applicable' }));
      qty += q;
    } else {
      const q = allowNegative ? int(r, 1, 6000) : int(r, 1, qty);
      out.push(exit(dec(q, 3), on, { kind: r() < 0.5 ? 'issue' : 'sale_issue' }));
      qty -= q;
    }
  }
  return out;
}

describe('propriétés', () => {
  it('stock jamais négatif : valeur ≥ 0, valeur 0 à quantité 0, Σ sorties + valeur = Σ entrées (graine 46)', () => {
    const r = rng(46);
    for (let run = 0; run < 150; run += 1) {
      const v = weightedAverageValuation(randomLedger(r, false), ITEM);
      for (const s of v.steps) {
        expect(cents(s.valueAfter) >= 0n).toBe(true);
        if (s.quantityAfter === '0') expect(s.valueAfter).toBe('0.00');
      }
      expect(cents(v.exitsCost) + cents(v.value)).toBe(cents(v.entriesValue));
      expect(v.negativeStockRevaluation).toBe('0.00');
      expect(v.complete).toBe(true);
    }
  });

  it('stock négatif permis : entrées = sorties + valeur + réévaluations (graine 7)', () => {
    const r = rng(7);
    for (let run = 0; run < 150; run += 1) {
      const v = weightedAverageValuation(randomLedger(r, true), ITEM);
      expect(cents(v.exitsCost) + cents(v.value) + cents(v.negativeStockRevaluation)).toBe(
        cents(v.entriesValue),
      );
      for (const s of v.steps) {
        if (!s.quantityAfter.startsWith('-')) expect(cents(s.valueAfter) >= 0n).toBe(true);
      }
    }
  });

  it('la valorisation ne dépend pas de l’ordre des sorties entre deux entrées (graine 2026)', () => {
    const r = rng(2026);
    for (let run = 0; run < 100; run += 1) {
      const blocks: { entries: StockMovementInput[]; exits: number[] }[] = [];
      let qty = 0;
      for (let b = 0; b < 5; b += 1) {
        const q = int(r, 1, 9000);
        qty += q;
        const exits: number[] = [];
        let room = qty;
        const k = int(r, 0, 5);
        for (let e = 0; e < k && room > 0; e += 1) {
          const x = int(r, 1, room);
          exits.push(x);
          room -= x;
        }
        qty = room;
        blocks.push({
          entries: [entry(dec(q, 3), dec(int(r, 1, 9_999_999), 6), '2026-10-01')],
          exits,
        });
      }
      const build = (order: (xs: number[]) => number[]): StockMovementInput[] => {
        seq = 0;
        const list: StockMovementInput[] = [];
        for (const blk of blocks) {
          list.push({ ...(blk.entries[0] as StockMovementInput), id: id() });
          for (const x of order(blk.exits)) list.push(exit(dec(x, 3), '2026-10-01'));
        }
        return list;
      };
      const a = weightedAverageValuation(
        build((xs) => xs),
        ITEM,
      );
      const b = weightedAverageValuation(
        build((xs) => shuffle(r, xs)),
        ITEM,
      );
      expect(b.value).toBe(a.value);
      expect(b.quantity).toBe(a.quantity);
      expect(b.exitsCost).toBe(a.exitsCost);
      expect(b.averageUnitCost).toBe(a.averageUnitCost);
    }
  });

  it('la somme des mouvements donne le niveau ; l’ordre d’entrée ne change rien (graine 12)', () => {
    const r = rng(12);
    const locations = [MAIN, SITE, 'loc-van'];
    const items = ['item-a', 'item-b'];
    for (let run = 0; run < 60; run += 1) {
      const movements: StockMovementInput[] = [];
      const expected = new Map<string, number>();
      for (let i = 0; i < 50; i += 1) {
        const itemId = items[int(r, 0, 1)] as string;
        const loc = locations[int(r, 0, 2)] as string;
        const q = int(r, -4000, 4000) || 1;
        movements.push(
          q > 0
            ? entry(dec(q, 3), '1', `2026-10-${String(int(r, 1, 28)).padStart(2, '0')}`, {
                itemId,
                locationId: loc,
                kind: 'adjustment',
              })
            : exit(dec(-q, 3), `2026-10-${String(int(r, 1, 28)).padStart(2, '0')}`, {
                itemId,
                locationId: loc,
                kind: 'adjustment',
              }),
        );
        const key = `${itemId}|${loc}`;
        expected.set(key, (expected.get(key) ?? 0) + q);
      }
      const levels = stockLevels(movements).levels;
      for (const l of levels) {
        expect(l.quantity).toBe(
          dec(expected.get(`${l.itemId}|${l.locationId}`) ?? 0, 3).replace(/\.?0+$/, '') || '0',
        );
      }
      expect(levels).toHaveLength(expected.size);
      expect(stockLevels(shuffle(r, movements))).toEqual(stockLevels(movements));
      for (const itemId of items) {
        const item = { ...ITEM, id: itemId };
        const v = weightedAverageValuation(movements, item);
        expect(weightedAverageValuation(shuffle(r, movements), item)).toEqual(v);
        const sum = levels
          .filter((l) => l.itemId === itemId)
          .reduce((s, l) => s + Number(l.quantity) * 1000, 0);
        expect(v.quantity).toBe(dec(Math.round(sum), 3).replace(/\.?0+$/, '') || '0');
        expect(stockLevelDrift(levels, movements).ok).toBe(true);
      }
    }
  });

  it('jusqu’à une date = rejeu du préfixe ; résultat déterministe (graine 99)', () => {
    const r = rng(99);
    for (let run = 0; run < 60; run += 1) {
      const ledger = randomLedger(r, true);
      const until = `2026-10-${String(int(r, 1, 28)).padStart(2, '0')}`;
      const cut = weightedAverageValuation(ledger, ITEM, until);
      const prefix = weightedAverageValuation(
        ledger.filter((m) => m.occurredOn <= until),
        ITEM,
      );
      expect({ ...cut, until: null }).toEqual(prefix);
      expect(weightedAverageValuation(ledger, ITEM)).toEqual(
        weightedAverageValuation(ledger, ITEM),
      );
    }
  });

  it('contrôle du disponible : refus si et seulement si un manque existe (graine 3)', () => {
    const r = rng(3);
    for (let run = 0; run < 100; run += 1) {
      const have = int(r, 0, 5000);
      const want = int(r, 1, 5000);
      const movements = have > 0 ? [entry(dec(have, 3), '1')] : [];
      const res = checkStockAvailability({
        movements,
        lines: [{ itemId: 'item-a', locationId: MAIN, quantity: dec(want, 3) }],
        allowNegativeManualMoves: false,
      });
      expect(res.ok).toBe(want <= have);
    }
  });
});

// ─── Pureté ──────────────────────────────────────────────────────────────────

describe('pureté du module', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

  it('aucune horloge, aucun flottant, aucun taux de change (critère 20)', () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/new Date\(|Date\.now|parseFloat|\bNumber\(|Math\.|toFixed/);
      expect(text, f).not.toMatch(/exchangeRate|fxRate|DUREES_SYSCOHADA/);
    }
  });
});
