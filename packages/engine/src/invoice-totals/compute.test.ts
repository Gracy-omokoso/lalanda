// Calcul des totaux de facture (ADR-0022 § S25d.4, critères D3).
//
// Trois familles de tests : les cas de référence (attendus littéraux, calculés
// hors du code), les refus, et des propriétés vérifiées sur 1 000 factures
// générées avec une graine fixe — avec une arithmétique de contrôle propre au
// test (centimes entiers), indépendante de `decimal.ts`.

import { describe, expect, it } from 'vitest';

import {
  CALIBRATION_ROUNDING_POLICIES,
  DGI_ROUNDING_POLICY,
  INVOICE_TOTALS_REFERENCE_CASES,
  INVOICE_TOTALS_VERSION,
  TAX_GROUP_LETTERS,
  computeInvoiceTotals,
  type InvoiceLineInput,
  type InvoiceTotals,
  type InvoiceTotalsInput,
  type InvoiceTotalsResult,
  type PriceMode,
  type ReferenceExpectation,
  type RoundingPolicy,
  type TaxGroupLetter,
  type TaxRateTable,
} from '../index.js';

// ── Outils de contrôle ───────────────────────────────────────────────────────

/** « 1234.56 » → 123456n (centimes). Refuse toute autre forme. */
function cents(text: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(text);
  if (match === null) throw new Error(`Montant non canonique à 2 décimales : ${text}`);
  return BigInt(match[1] ?? '') * 100n + BigInt(match[2] ?? '');
}

function totalsOf(result: InvoiceTotalsResult): InvoiceTotals {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.totals;
}

function expectMatches(result: InvoiceTotalsResult, expected: ReferenceExpectation, id: string) {
  if (!expected.ok) {
    expect(result.ok, id).toBe(false);
    if (!result.ok)
      expect(
        result.issues.map((i) => i.code),
        id,
      ).toEqual(expected.codes);
    return;
  }
  const totals = totalsOf(result);
  const groups = Object.fromEntries(
    totals.groups.map((g) => [g.group, { total: g.total, ht: g.ht, vat: g.vat }]),
  );
  expect(groups, id).toEqual(expected.groups);
  expect(totals.specificTax, `${id} ts`).toBe(expected.specificTax);
  expect(totals.total, `${id} total`).toBe(expected.total);
  expect(totals.vatTotal, `${id} vtotal`).toBe(expected.vatTotal);
  if (expected.lineAmounts !== undefined) {
    expect(
      totals.lines.map((l) => l.amount),
      `${id} lignes`,
    ).toEqual(expected.lineAmounts);
  }
}

// ── Cas de référence ─────────────────────────────────────────────────────────

describe('constantes', () => {
  it('version du calcul et politique par défaut (ADR-0022 § S25d.3)', () => {
    expect(INVOICE_TOTALS_VERSION).toBe('1.0.0');
    expect(DGI_ROUNDING_POLICY).toEqual({
      id: 'dgi-cd-2026.1',
      lineAmount: 'per_line',
      vat: 'up',
    });
    expect(Object.isFrozen(DGI_ROUNDING_POLICY)).toBe(true);
  });
});

describe('cas de référence sous DGI_ROUNDING_POLICY (ADR-0022 § S25d.6)', () => {
  for (const testCase of INVOICE_TOTALS_REFERENCE_CASES) {
    it(`${testCase.id} (${testCase.origin}, ${testCase.reliability})`, () => {
      expectMatches(computeInvoiceTotals(testCase.input), testCase.expected, testCase.id);
    });
  }

  it('couvre les cas exigés par l’ADR', () => {
    const ids = new Set(INVOICE_TOTALS_REFERENCE_CASES.map((c) => c.id));
    for (const id of [
      'dgi-modele',
      'dgi-remise',
      'dgi-ts-19',
      'dgi-ts-pct-19',
      'dgi-sous-total-69',
      'mixte-b-c-ttc',
      'mixte-b-c-ht',
      'cal-tva-ht',
      'cal-tva-ttc-1pct',
      'cal-ligne',
      'cal-ts-ht',
      'qte-decimale',
      'groupe-n',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(ids.size).toBe(INVOICE_TOTALS_REFERENCE_CASES.length);
  });

  it('les exemples DGI faux sont marqués et le moteur ne reproduit pas leur valeur', () => {
    const wrong = INVOICE_TOTALS_REFERENCE_CASES.filter((c) => c.dgiPublished !== undefined);
    expect(wrong.map((c) => c.id).sort()).toEqual([
      'dgi-sous-total-69',
      'dgi-ts-19',
      'dgi-ts-pct-19',
    ]);
    for (const testCase of wrong) {
      expect(testCase.reliability, testCase.id).toBe('unreliable');
      const published = testCase.dgiPublished;
      if (published === undefined) continue;
      // Sous aucune des quatre lectures de l'arrondi le moteur ne retrouve l'exemple.
      for (const policy of CALIBRATION_ROUNDING_POLICIES) {
        const totals = totalsOf(computeInvoiceTotals({ ...testCase.input, policy }));
        const group = totals.groups.find((g) => g.group === published.group);
        if (published.total !== undefined) expect(group?.total).not.toBe(published.total);
        if (published.vat !== undefined) expect(group?.vat).not.toBe(published.vat);
        if (published.specificTax !== undefined) {
          expect(group?.specificTax).not.toBe(published.specificTax);
        }
      }
    }
  });

  it('recalculés à 19 %, les exemples de taxe spécifique tombent juste (2 357,00 et 168,07)', () => {
    const at19 = (id: string) => {
      const testCase = INVOICE_TOTALS_REFERENCE_CASES.find((c) => c.id === id);
      if (testCase === undefined) throw new Error(id);
      return totalsOf(computeInvoiceTotals(testCase.input));
    };
    expect(at19('dgi-ts-a-19').total).toBe('2357.00');
    expect(at19('dgi-ts-pct-a-19').specificTax).toBe('168.07');
  });
});

describe('cas de calibrage sous chaque variante de politique', () => {
  it('quatre politiques distinctes, la première est la politique DGI', () => {
    expect(CALIBRATION_ROUNDING_POLICIES).toHaveLength(4);
    expect(CALIBRATION_ROUNDING_POLICIES[0]).toBe(DGI_ROUNDING_POLICY);
    const axes = CALIBRATION_ROUNDING_POLICIES.map((p) => `${p.lineAmount}/${p.vat}`);
    expect(new Set(axes).size).toBe(4);
  });

  const calibration = INVOICE_TOTALS_REFERENCE_CASES.filter((c) => c.origin === 'calibration');

  it('chaque cas de calibrage porte un attendu pour chaque politique', () => {
    expect(calibration.length).toBeGreaterThanOrEqual(8);
    for (const testCase of calibration) {
      expect(Object.keys(testCase.variants ?? {}).sort(), testCase.id).toEqual(
        CALIBRATION_ROUNDING_POLICIES.map((p) => p.id).sort(),
      );
      expect(testCase.reliability, testCase.id).toBe('to_calibrate');
    }
  });

  for (const testCase of INVOICE_TOTALS_REFERENCE_CASES) {
    if (testCase.variants === undefined) continue;
    for (const policy of CALIBRATION_ROUNDING_POLICIES) {
      const expected = testCase.variants[policy.id];
      if (expected === undefined) continue;
      it(`${testCase.id} sous ${policy.id}`, () => {
        const result = computeInvoiceTotals({ ...testCase.input, policy });
        expectMatches(result, expected, `${testCase.id}/${policy.id}`);
        if (result.ok) expect(result.totals.policyId).toBe(policy.id);
      });
    }
  }

  it('les cas cal-tva-* et cal-ligne* départagent réellement les lectures', () => {
    const distinct = (id: string) => {
      const testCase = INVOICE_TOTALS_REFERENCE_CASES.find((c) => c.id === id);
      return new Set(Object.values(testCase?.variants ?? {}).map((v) => JSON.stringify(v))).size;
    };
    expect(distinct('cal-tva-ht')).toBe(2); // axe (a) seulement
    expect(distinct('cal-tva-ttc-1pct')).toBe(2);
    expect(distinct('cal-ligne')).toBe(4); // les deux axes
    expect(distinct('cal-ligne-ttc')).toBe(3);
  });
});

// ── Comportements ponctuels ──────────────────────────────────────────────────

const line = (
  taxGroup: TaxGroupLetter,
  quantity: string,
  unitPrice: string,
  extra: Partial<InvoiceLineInput> = {},
): InvoiceLineInput => ({
  unitPrice,
  quantity,
  taxGroup,
  itemType: taxGroup === 'L' || taxGroup === 'N' ? 'TAX' : 'BIE',
  specificTax: null,
  ...extra,
});

describe('exactitude', () => {
  it('0.1 + 0.2 en entrée chaîne donne "0.30"', () => {
    const totals = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('A', '1', '0.10'), line('A', '1', '0.20')],
        rates: { A: '0' },
      }),
    );
    expect(totals.total).toBe('0.30');
    expect(totals.groups).toEqual([
      { group: 'A', ratePercent: '0', total: '0.30', ht: '0.30', vat: '0.00', specificTax: '0.00' },
    ]);
  });

  it('montants de 10¹² CDF × quantités à 3 décimales exacts, en TTC et en groupe A', () => {
    const ttcA = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('A', '9.999', '999999999999.99')],
        rates: { A: '0' },
      }),
    );
    expect(ttcA.total).toBe('9998999999999.90');
    expect(ttcA.lines[0]?.amount).toBe('9998999999999.90');
    // 10¹² × 0,001 : la plus petite quantité, sans perte.
    const small = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ttc',
        lines: [line('B', '0.001', '999999999999.99')],
        rates: { B: '16' },
      }),
    );
    // 999 999 999,99999 → 1 000 000 000,00 ; TVA = 1e9 × 16 / 116 = 137 931 034,482… → 137 931 034,49
    expect(small.groups[0]).toMatchObject({
      total: '1000000000.00',
      vat: '137931034.49',
      ht: '862068965.51',
    });
  });

  it('refuse un total qui atteint 10¹³ en additionnant des groupes', () => {
    const result = computeInvoiceTotals({
      priceMode: 'ht',
      lines: [line('A', '1', '5000000000000.00'), line('E', '1', '5000000000000.00')],
      rates: { A: '0', E: '0' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toEqual(['AMOUNT_TOO_LARGE']);
  });

  it('la dernière valeur sous la borne est acceptée', () => {
    const result = computeInvoiceTotals({
      priceMode: 'ht',
      lines: [line('A', '1', '9999999999999.99')],
      rates: { A: '0' },
    });
    expect(totalsOf(result).total).toBe('9999999999999.99');
  });
});

describe('forme du résultat', () => {
  it('lignes : montant, taxe spécifique et sa forme DGI', () => {
    const totals = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [
          line('B', '4', '431.03', { specificTax: { kind: 'per_unit', amount: '75' } }),
          line('B', '1', '1000', { specificTax: { kind: 'percent', rate: '10' } }),
          line('A', '2', '3'),
        ],
        rates: { A: '0', B: '16' },
      }),
    );
    expect(totals.lines).toEqual([
      { index: 0, amount: '1724.12', specificTaxAmount: '300.00', specificTaxValue: '75.00' },
      { index: 1, amount: '1000.00', specificTaxAmount: '100.00', specificTaxValue: '10.00%' },
      { index: 2, amount: '6.00', specificTaxAmount: '0.00', specificTaxValue: null },
    ]);
    expect(totals.groups.map((g) => g.group)).toEqual(['A', 'B']); // ordre A → P
    expect(totals.groups[1]).toEqual({
      group: 'B',
      ratePercent: '16',
      total: '3623.98',
      ht: '3124.12',
      vat: '499.86',
      specificTax: '400.00',
    });
    expect(totals.specificTax).toBe('400.00');
    expect(totals.calculationVersion).toBe('1.0.0');
    expect(totals.policyId).toBe('dgi-cd-2026.1');
    expect(totals.priceMode).toBe('ht');
  });

  it('accepte un taux décimal (la documentation les laisse décimaux)', () => {
    const totals = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('B', '1', '100')],
        rates: { B: '16.5' },
      }),
    );
    expect(totals.groups[0]).toMatchObject({ ratePercent: '16.5', vat: '16.50', total: '116.50' });
  });

  it('un taux nul : TVA nulle, HT = total, en TTC comme en HT', () => {
    for (const priceMode of ['ht', 'ttc'] as const) {
      const totals = totalsOf(
        computeInvoiceTotals({ priceMode, lines: [line('E', '3', '33.33')], rates: { E: '0' } }),
      );
      expect(totals.groups[0]).toMatchObject({ total: '99.99', ht: '99.99', vat: '0.00' });
    }
  });

  it('per_group : le montant de ligne affiché reste arrondi, la somme du groupe est exacte', () => {
    const policy = CALIBRATION_ROUNDING_POLICIES.find((p) => p.lineAmount === 'per_group');
    const totals = totalsOf(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('B', '0.335', '1.00'), line('B', '0.335', '1.00'), line('B', '0.335', '1.00')],
        rates: { B: '16' },
        ...(policy === undefined ? {} : { policy }),
      }),
    );
    expect(totals.lines.map((l) => l.amount)).toEqual(['0.34', '0.34', '0.34']);
    expect(totals.groups[0]?.ht).toBe('1.01');
  });

  it('refuse une politique mal formée (erreur de programmation, pas de saisie)', () => {
    const bad = { id: 'x', lineAmount: 'per_invoice', vat: 'up' } as unknown as RoundingPolicy;
    expect(() =>
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('B', '1', '1')],
        rates: {},
        policy: bad,
      }),
    ).toThrow(RangeError);
  });
});

describe('refus : tous les problèmes, pas le premier', () => {
  const codesOf = (input: InvoiceTotalsInput) => {
    const result = computeInvoiceTotals(input);
    if (result.ok) throw new Error('refus attendu');
    return result.issues;
  };

  it('signale chaque ligne fautive d’un coup, avec son rang et son champ', () => {
    const issues = codesOf({
      priceMode: 'ht',
      lines: [
        line('B', '1', '0'),
        line('B', '1.2345', '1.234'),
        line('L', '1', '10', { itemType: 'BIE' }),
        line('B', '1', '10'),
      ],
      rates: { B: '16', L: '0' },
    });
    expect(issues.map((i) => [i.code, i.lineIndex, i.field])).toEqual([
      ['PRICE_NOT_POSITIVE', 0, 'unitPrice'],
      ['PRICE_TOO_PRECISE', 1, 'unitPrice'],
      ['QUANTITY_TOO_PRECISE', 1, 'quantity'],
      ['ITEM_TYPE_NOT_ALLOWED', 2, 'itemType'],
    ]);
    for (const i of issues) expect(i.message.length).toBeGreaterThan(10);
  });

  it('prix ou quantité négatifs : non positifs ; type inconnu ; décimal mal formé', () => {
    const issues = codesOf({
      priceMode: 'ht',
      lines: [
        line('B', '-2', '-5.00'),
        line('B', '1', '10', { itemType: 'XYZ' as InvoiceLineInput['itemType'] }),
        line('B', '1,5', '10'),
        line('B', '1', 12 as unknown as string),
      ],
      rates: { B: '16' },
    });
    expect(issues.map((i) => [i.code, i.lineIndex])).toEqual([
      ['PRICE_NOT_POSITIVE', 0],
      ['QUANTITY_NOT_POSITIVE', 0],
      ['ITEM_TYPE_NOT_ALLOWED', 1],
      ['INVALID_DECIMAL', 2],
      ['INVALID_DECIMAL', 3],
    ]);
  });

  it('quantité nulle, zéro écrit avec trop de décimales', () => {
    const issues = codesOf({
      priceMode: 'ht',
      lines: [line('B', '0.000', '10'), line('B', '1', '0.000')],
      rates: { B: '16' },
    });
    expect(issues.map((i) => i.code)).toEqual([
      'QUANTITY_NOT_POSITIVE',
      'PRICE_TOO_PRECISE',
      'PRICE_NOT_POSITIVE',
    ]);
  });

  it('taux invalides du tableau', () => {
    for (const rate of ['16%', '-1', '1000', '1e1', '16.123456789', '']) {
      const issues = codesOf({
        priceMode: 'ht',
        lines: [line('B', '1', '10')],
        rates: { B: rate },
      });
      expect(
        issues.map((i) => [i.code, i.field]),
        rate,
      ).toEqual([['TAX_RATE_INVALID', 'rates']]);
    }
    const asNumber = { B: 16 } as unknown as TaxRateTable;
    expect(
      codesOf({ priceMode: 'ht', lines: [line('B', '1', '10')], rates: asNumber }).map(
        (i) => i.code,
      ),
    ).toEqual(['TAX_RATE_INVALID']);
    // 999,99999999 % est encore un taux admis.
    expect(
      computeInvoiceTotals({
        priceMode: 'ht',
        lines: [line('B', '1', '1')],
        rates: { B: '999.99999999' },
      }).ok,
    ).toBe(true);
  });

  it('taxes spécifiques mal formées', () => {
    const bad: unknown[] = [
      { kind: 'per_unit', amount: '0' },
      { kind: 'per_unit', amount: '1.234' },
      { kind: 'per_unit', amount: 75 },
      { kind: 'percent', rate: '100' },
      { kind: 'percent', rate: '0.00' },
      { kind: 'flat', amount: '1' },
      'TS',
    ];
    for (const specificTax of bad) {
      const issues = codesOf({
        priceMode: 'ht',
        lines: [
          line('B', '1', '10', { specificTax: specificTax as InvoiceLineInput['specificTax'] }),
        ],
        rates: { B: '16' },
      });
      expect(
        issues.map((i) => [i.code, i.field]),
        JSON.stringify(specificTax),
      ).toEqual([['SPECIFIC_TAX_INVALID', 'specificTax']]);
    }
  });

  it('taxe spécifique interdite en L comme en N', () => {
    for (const group of ['L', 'N'] as const) {
      const issues = codesOf({
        priceMode: 'ht',
        lines: [line(group, '1', '10', { specificTax: { kind: 'percent', rate: '5' } })],
        rates: { [group]: '0' },
      });
      expect(issues.map((i) => i.code)).toEqual(['SPECIFIC_TAX_NOT_ALLOWED']);
    }
  });
});

describe('les seize groupes A–P', () => {
  const RATES: TaxRateTable = Object.fromEntries(TAX_GROUP_LETTERS.map((l) => [l, '16']));

  for (const letter of TAX_GROUP_LETTERS) {
    for (const priceMode of ['ht', 'ttc'] as const) {
      it(`${letter} en ${priceMode.toUpperCase()}`, () => {
        const totals = totalsOf(
          computeInvoiceTotals({ priceMode, lines: [line(letter, '1', '116.00')], rates: RATES }),
        );
        const group = totals.groups[0];
        if (letter === 'N') {
          // Entièrement de la TVA, quel que soit le mode et le taux.
          expect(group).toMatchObject({ total: '116.00', ht: '0.00', vat: '116.00' });
        } else if (priceMode === 'ht') {
          expect(group).toMatchObject({ total: '134.56', ht: '116.00', vat: '18.56' });
        } else {
          expect(group).toMatchObject({ total: '116.00', ht: '100.00', vat: '16.00' });
        }
        expect(totals.vatTotal).toBe(group?.vat);
      });
    }
  }
});

// ── Propriétés sur 1 000 factures générées ───────────────────────────────────

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  return { next, int, pick };
}

/** Écrit un entier de « dixièmes de taux » (165 → « 16.5 »). */
const RATE_TENTHS = [0, 10, 50, 80, 160, 165, 200] as const;
const rateText = (tenths: number) =>
  tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
const decimalText = (units: number, digits: number) => {
  const raw = String(units).padStart(digits + 1, '0');
  return `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
};

function randomInvoice(random: ReturnType<typeof generator>) {
  const rateTenths = Object.fromEntries(
    TAX_GROUP_LETTERS.map((l) => [l, random.pick(RATE_TENTHS)]),
  ) as Record<TaxGroupLetter, number>;
  const rates: TaxRateTable = Object.fromEntries(
    TAX_GROUP_LETTERS.map((l) => [l, rateText(rateTenths[l])]),
  );
  const priceMode: PriceMode = random.pick(['ht', 'ttc'] as const);
  const groups = TAX_GROUP_LETTERS.slice(0, random.int(1, 16));
  const lines: InvoiceLineInput[] = [];
  const count = random.int(1, 8);
  for (let i = 0; i < count; i += 1) {
    const taxGroup = random.pick(groups);
    const isTax = taxGroup === 'L' || taxGroup === 'N';
    const roll = random.next();
    lines.push({
      unitPrice: decimalText(random.int(100, 100_000_000), 2),
      quantity: decimalText(random.int(1, 50_000), 3),
      taxGroup,
      itemType: isTax ? 'TAX' : random.pick(['BIE', 'SER'] as const),
      specificTax:
        isTax || roll > 0.3
          ? null
          : roll < 0.15
            ? { kind: 'per_unit', amount: decimalText(random.int(1, 50_000), 2) }
            : { kind: 'percent', rate: decimalText(random.int(1, 9_999), 2) },
    });
  }
  const policy = random.pick(CALIBRATION_ROUNDING_POLICIES);
  return { input: { priceMode, lines, rates, policy } as InvoiceTotalsInput, rateTenths };
}

function shuffled<T>(items: readonly T[], random: ReturnType<typeof generator>): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = random.int(0, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('propriétés (1 000 factures, graine fixe)', () => {
  const random = generator(20261019);
  const invoices = Array.from({ length: 1000 }, () => randomInvoice(random));

  it('toutes les factures générées sont acceptées', () => {
    for (const { input } of invoices) expect(computeInvoiceTotals(input).ok).toBe(true);
  });

  it('ht + TVA = total par groupe ; total = Σ total_g ; vtotal = Σ TVA_g ; ts = Σ TS_g ; tout ≥ 0', () => {
    for (const { input } of invoices) {
      const totals = totalsOf(computeInvoiceTotals(input));
      let total = 0n;
      let vat = 0n;
      let ts = 0n;
      for (const group of totals.groups) {
        expect(cents(group.ht) + cents(group.vat)).toBe(cents(group.total));
        total += cents(group.total);
        vat += cents(group.vat);
        ts += cents(group.specificTax);
      }
      expect(cents(totals.total)).toBe(total);
      expect(cents(totals.vatTotal)).toBe(vat);
      expect(cents(totals.specificTax)).toBe(ts);
      expect(total > 0n).toBe(true);
    }
  });

  it('résultat identique quel que soit l’ordre des lignes', () => {
    const order = generator(7);
    for (const { input } of invoices) {
      const a = totalsOf(computeInvoiceTotals(input));
      const b = totalsOf(computeInvoiceTotals({ ...input, lines: shuffled(input.lines, order) }));
      expect(b.groups).toEqual(a.groups);
      expect([b.total, b.vatTotal, b.specificTax]).toEqual([a.total, a.vatTotal, a.specificTax]);
    }
  });

  it('additivité : chaque groupe se calcule comme s’il était seul sur la facture', () => {
    for (const { input } of invoices.slice(0, 300)) {
      const all = totalsOf(computeInvoiceTotals(input));
      for (const group of all.groups) {
        const alone = totalsOf(
          computeInvoiceTotals({
            ...input,
            lines: input.lines.filter((l) => l.taxGroup === group.group),
          }),
        );
        expect(alone.groups).toEqual([group]);
      }
    }
  });

  it('TVA « up » jamais inférieure à la TVA exacte ; « half_up » à un demi-centime au plus', () => {
    for (const { input, rateTenths } of invoices) {
      const totals = totalsOf(computeInvoiceTotals(input));
      for (const group of totals.groups) {
        if (group.group === 'N') continue;
        const t = BigInt(rateTenths[group.group]); // taux × 10
        const vat = cents(group.vat);
        // TVA exacte = num / den (en centimes)
        const [num, den] =
          input.priceMode === 'ht'
            ? [cents(group.ht) * t, 1000n]
            : [cents(group.total) * t, 1000n + t];
        if (input.policy?.vat === 'up') {
          expect(vat * den >= num).toBe(true);
          expect((vat - 1n) * den < num).toBe(true); // et c'est le plus petit centime qui convient
        } else {
          const gap = vat * den - num;
          expect(2n * (gap < 0n ? -gap : gap) <= den).toBe(true);
        }
      }
    }
  });

  it('le montant de ligne est l’arrondi au plus proche de prix × quantité', () => {
    for (const { input } of invoices.slice(0, 200)) {
      const totals = totalsOf(computeInvoiceTotals(input));
      totals.lines.forEach((l, i) => {
        const source = input.lines[i];
        if (source === undefined) throw new Error('ligne manquante');
        // prix en centimes × quantité en millièmes = montant en 10⁻⁵
        const exact = cents(source.unitPrice) * BigInt(source.quantity.replace('.', ''));
        const rounded = (exact + 500n) / 1000n;
        expect(cents(l.amount)).toBe(rounded);
      });
    }
  });

  it('calcul déterministe : deux appels, même résultat', () => {
    for (const { input } of invoices.slice(0, 100)) {
      expect(computeInvoiceTotals(input)).toEqual(computeInvoiceTotals(input));
    }
  });
});
