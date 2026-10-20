// Conversion d'un document en CDF (ADR-0023 § S25e.4, critères E1).
//
// Attendus littéraux pour les cas nommés ; propriétés sur 1 000 documents en USD
// (graine fixe) : chaque prix converti est recoupé par une arithmétique de
// contrôle propre au test (produit d'entiers obtenus en retirant le point,
// arrondi au centime à la main), puis `computeInvoiceTotals` recalcule le
// document en CDF et les invariants d'ADR-0022 sont vérifiés.

import { describe, expect, it } from 'vitest';

import {
  CURRENCY_CONVERSION_VERSION,
  INVOICE_TOTALS_VERSION,
  PAYMENT_METHODS,
  TAX_GROUP_LETTERS,
  computeInvoiceTotals,
  convertDocumentToCdf,
  decimalFromJsonRate,
  discountedUnitPrice,
  reconcilePayments,
  type ConvertibleLine,
  type CurrencyConversionInput,
  type CurrencyConversionResult,
  type InvoiceLineInput,
  type InvoiceTotals,
  type InvoiceTotalsResult,
  type LineDiscount,
  type PaymentInput,
  type PriceMode,
  type TaxGroupLetter,
  type TaxRateTable,
} from '../index.js';

// ── Outils de contrôle (indépendants de decimal.ts) ──────────────────────────

/** « 1234.56 » → 123456n. Refuse toute autre forme. */
function cents(text: string): bigint {
  expect(text).toMatch(/^\d+\.\d{2}$/);
  return BigInt(text.replace('.', ''));
}
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

/** « 12.345 » → { units: 12345n, digits: 3 }. */
function units(text: string): { units: bigint; digits: number } {
  const [integer = '', fraction = ''] = text.split('.');
  return { units: BigInt(integer + fraction), digits: fraction.length };
}

/** a × b arrondi au centime le plus proche, demi vers le haut, en centimes. */
function productInCents(a: string, b: string): bigint {
  const x = units(a);
  const y = units(b);
  const digits = x.digits + y.digits;
  const value = x.units * y.units;
  if (digits <= 2) return value * 10n ** BigInt(2 - digits);
  const divisor = 10n ** BigInt(digits - 2);
  const quotient = value / divisor;
  return 2n * (value % divisor) >= divisor ? quotient + 1n : quotient;
}

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);
function converted(result: CurrencyConversionResult) {
  if (!result.ok) throw new Error(`conversion refusée : ${codes(result.issues).join(', ')}`);
  return result;
}
function totalsOf(result: InvoiceTotalsResult): InvoiceTotals {
  if (!result.ok) throw new Error(`calcul refusé : ${result.issues.map((i) => i.code).join(', ')}`);
  return result.totals;
}

const plain = (unitPrice: string, quantity = '1'): ConvertibleLine => ({
  unitPrice,
  originalPrice: null,
  discount: null,
  quantity,
  specificTax: null,
});
const usd = (
  lines: readonly ConvertibleLine[],
  payments: readonly PaymentInput[] = [],
  rate = '2262.32',
): CurrencyConversionInput => ({ from: 'USD', rate, lines, payments });

// ── decimalFromJsonRate ──────────────────────────────────────────────────────

describe('decimalFromJsonRate (frontière JSON)', () => {
  it('lit le taux réel relevé le 19 oct. 2026', () => {
    const body = JSON.parse('[{"type":"USD","rate":2262.320000}]') as { rate: number }[];
    expect(decimalFromJsonRate(body[0]?.rate ?? 0)).toBe('2262.32');
    expect(decimalFromJsonRate(2262.32)).toBe('2262.32');
  });

  it('accepte jusqu’à 8 décimales, rendues sous forme canonique', () => {
    expect(decimalFromJsonRate(2262.3215)).toBe('2262.3215');
    expect(decimalFromJsonRate(1.12345678)).toBe('1.12345678');
    expect(decimalFromJsonRate(2900)).toBe('2900');
    expect(decimalFromJsonRate(0.5)).toBe('0.5');
  });

  it('refuse plus de 8 décimales', () => {
    expect(decimalFromJsonRate(1.123456789)).toBeNull();
    expect(decimalFromJsonRate(2262.123456789)).toBeNull();
  });

  it.each([0, -0, -1, -2262.32, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuse %s (non fini ou ≤ 0)',
    (value) => {
      expect(decimalFromJsonRate(value)).toBeNull();
    },
  );

  it('refuse toute représentation exponentielle', () => {
    expect(String(1e-7)).toBe('1e-7');
    expect(decimalFromJsonRate(1e-7)).toBeNull();
    expect(decimalFromJsonRate(1e21)).toBeNull();
    expect(decimalFromJsonRate(1.5e300)).toBeNull();
  });

  it('refuse ce qui n’est pas un nombre JSON (chaîne « 1e3 », « 2262.32 », null)', () => {
    for (const value of ['1e3', '2262.32', null, undefined, {}]) {
      expect(decimalFromJsonRate(value as unknown as number)).toBeNull();
    }
  });

  it('« 1e3 » écrit dans le JSON vaut 1000 après JSON.parse : indiscernable, donc lu 1000', () => {
    expect(decimalFromJsonRate(JSON.parse('1e3') as number)).toBe('1000');
  });
});

// ── convertDocumentToCdf : cas nommés ────────────────────────────────────────

describe('convertDocumentToCdf', () => {
  it('40,00 USD à 2 262,32 → 90 492,80 CDF ; version de conversion', () => {
    const result = converted(
      convertDocumentToCdf(
        usd([plain('40.00', '2.375')], [{ method: 'VIREMENT', amount: '40.00' }]),
      ),
    );
    expect(result).toEqual({
      ok: true,
      conversionVersion: '1.0.0',
      lines: [
        {
          index: 0,
          unitPrice: '90492.80',
          originalPrice: null,
          priceModification: null,
          specificTax: null,
        },
      ],
      payments: [{ method: 'VIREMENT', amount: '90492.80' }],
    });
    expect(CURRENCY_CONVERSION_VERSION).toBe('1.0.0');
    // Versions distinctes : l'étalonnage (calcul 1.1.0) n'a pas touché la conversion.
    expect(INVOICE_TOTALS_VERSION).toBe('1.1.0');
  });

  it('arrondi au plus proche, demi vers le haut, sur la valeur exacte', () => {
    // 0,335 × 1 = 0,335 → 0,34 (demi exact) ; 0,334 → 0,33 ; prix 0,67 × 0,5 = 0,335 → 0,34.
    const result = converted(
      convertDocumentToCdf(usd([plain('0.67'), plain('1.00'), plain('0.50')], [], '0.5')),
    );
    expect(result.lines.map((l) => l.unitPrice)).toEqual(['0.34', '0.50', '0.25']);
    const half = converted(convertDocumentToCdf(usd([plain('0.50')], [], '2262.33')));
    expect(half.lines[0]?.unitPrice).toBe('1131.17'); // 1 131,165
    const below = converted(convertDocumentToCdf(usd([plain('1.00')], [], '0.33499999')));
    expect(below.lines[0]?.unitPrice).toBe('0.33');
  });

  it('taux à 8 décimales : produit exact, arrondi une seule fois', () => {
    // 9 999 999,99 × 2 262,12345678 = 22 621 234 545 017,…  → refusé ensuite par le calcul
    // (≥ 10¹³), mais la conversion reste exacte au centime.
    const result = converted(convertDocumentToCdf(usd([plain('9999999.99')], [], '2262.12345678')));
    expect(cents(result.lines[0]?.unitPrice ?? '')).toBe(
      productInCents('9999999.99', '2262.12345678'),
    );
  });

  it('remise en pourcentage : même pourcentage, prix recalculé depuis l’origine convertie', () => {
    const result = converted(
      convertDocumentToCdf(
        usd([
          {
            unitPrice: '90.00',
            originalPrice: '100.00',
            discount: { kind: 'percent', value: '10' },
            quantity: '2',
            specificTax: null,
          },
        ]),
      ),
    );
    expect(result.lines[0]).toEqual({
      index: 0,
      unitPrice: '203608.80',
      originalPrice: '226232.00',
      priceModification: 'Remise 10 %',
      specificTax: null,
    });
  });

  it('remise en montant : montant reconverti, prix et libellé recalculés en CDF', () => {
    const result = converted(
      convertDocumentToCdf(
        usd([
          {
            unitPrice: '46.67',
            originalPrice: '50.00',
            discount: { kind: 'total_amount', value: '10.00' },
            quantity: '3',
            specificTax: null,
          },
        ]),
      ),
    );
    expect(result.lines[0]).toEqual({
      index: 0,
      unitPrice: '105574.93',
      originalPrice: '113116.00',
      priceModification: 'Remise 22 623,21 CDF',
      specificTax: null,
    });
  });

  it('prix d’origine sans remise (prix modifié) : converti, sans libellé', () => {
    const result = converted(
      convertDocumentToCdf(
        usd([
          {
            unitPrice: '35.00',
            originalPrice: '40.00',
            discount: null,
            quantity: '1',
            specificTax: null,
          },
        ]),
      ),
    );
    expect(result.lines[0]).toMatchObject({
      unitPrice: '79181.20',
      originalPrice: '90492.80',
      priceModification: null,
    });
  });

  it('taxe spécifique par unité convertie ; en pourcentage, inchangée', () => {
    const result = converted(
      convertDocumentToCdf(
        usd([
          { ...plain('2.00', '4'), specificTax: { kind: 'per_unit', amount: '0.75' } },
          { ...plain('1.00'), specificTax: { kind: 'percent', rate: '10' } },
        ]),
      ),
    );
    expect(result.lines.map((l) => l.specificTax)).toEqual([
      { kind: 'per_unit', amount: '1696.74' },
      { kind: 'percent', rate: '10' },
    ]);
  });

  it('CDF → CDF : identité (taux 1 ou 1.00), aucune ligne ni paiement modifié', () => {
    const lines: ConvertibleLine[] = [
      plain('720', '5'),
      {
        unitPrice: '900.00',
        originalPrice: '1000.00',
        discount: { kind: 'percent', value: '10' },
        quantity: '1',
        specificTax: { kind: 'per_unit', amount: '75.00' },
      },
    ];
    const payments: PaymentInput[] = [{ method: 'ESPECES', amount: '4500' }];
    for (const rate of ['1', '1.00', '1.00000000']) {
      const result = converted(convertDocumentToCdf({ from: 'CDF', rate, lines, payments }));
      expect(result.lines).toEqual([
        {
          index: 0,
          unitPrice: '720',
          originalPrice: null,
          priceModification: null,
          specificTax: null,
        },
        {
          index: 1,
          unitPrice: '900.00',
          originalPrice: '1000.00',
          priceModification: 'Remise 10 %',
          specificTax: { kind: 'per_unit', amount: '75.00' },
        },
      ]);
      expect(result.payments).toEqual(payments);
    }
  });

  it.each(['0', '0.00', '-2262.32', '2262,32', 'abc', '', '1e3', '2262.123456789', ' 2262.32'])(
    'taux %j → EXCHANGE_RATE_INVALID',
    (rate) => {
      const result = convertDocumentToCdf(usd([plain('1.00')], [], rate));
      expect(result.ok === false && codes(result.issues)).toEqual(['EXCHANGE_RATE_INVALID']);
    },
  );

  it('taux non textuel → EXCHANGE_RATE_INVALID', () => {
    const result = convertDocumentToCdf(usd([plain('1.00')], [], 2262.32 as unknown as string));
    expect(result.ok === false && codes(result.issues)).toEqual(['EXCHANGE_RATE_INVALID']);
  });

  it('document en CDF avec un taux ≠ 1, ou devise inconnue → EXCHANGE_RATE_INVALID', () => {
    const cdf = convertDocumentToCdf({ from: 'CDF', rate: '2262.32', lines: [], payments: [] });
    expect(cdf.ok === false && codes(cdf.issues)).toEqual(['EXCHANGE_RATE_INVALID']);
    const eur = convertDocumentToCdf({
      from: 'EUR' as 'USD',
      rate: '2500',
      lines: [],
      payments: [],
    });
    expect(eur.ok === false && codes(eur.issues)).toEqual(['EXCHANGE_RATE_INVALID']);
  });

  it('prix converti à 0,00 → CONVERTED_AMOUNT_ZERO, tous les problèmes d’un coup', () => {
    const result = convertDocumentToCdf(
      usd(
        [
          plain('0.01'),
          plain('1.00'),
          { ...plain('1.00'), specificTax: { kind: 'per_unit', amount: '0.01' } },
          {
            unitPrice: '0.99',
            originalPrice: '1.00',
            discount: { kind: 'total_amount', value: '0.01' },
            quantity: '1',
            specificTax: null,
          },
        ],
        [{ method: 'ESPECES', amount: '0.01' }],
        '0.4',
      ),
    );
    if (result.ok) throw new Error('refus attendu');
    expect(result.issues.map((i) => [i.code, i.lineIndex, i.details?.field])).toEqual([
      ['CONVERTED_AMOUNT_ZERO', 0, 'unitPrice'],
      ['CONVERTED_AMOUNT_ZERO', 2, 'specificTax'],
      ['CONVERTED_AMOUNT_ZERO', 3, 'discount'],
      ['CONVERTED_AMOUNT_ZERO', null, 'payment'],
    ]);
    expect(result.issues[3]?.details?.paymentIndex).toBe('0');
    expect(result.issues[0]?.message).toMatch(/0,00 CDF/);
  });

  it('remise qui disparaît à un taux absurde : signalée, jamais ignorée', () => {
    // 1,00 → 0,01 au taux 0,01 ; remise de 10 % : 0,009 → 0,01, prix inchangé.
    const result = convertDocumentToCdf(
      usd(
        [
          {
            unitPrice: '0.90',
            originalPrice: '1.00',
            discount: { kind: 'percent', value: '10' },
            quantity: '1',
            specificTax: null,
          },
        ],
        [],
        '0.01',
      ),
    );
    expect(result.ok === false && codes(result.issues)).toEqual(['EXCHANGE_RATE_INVALID']);
  });

  it('paiement illisible → PAYMENT_AMOUNT_INVALID', () => {
    const result = convertDocumentToCdf(usd([plain('1.00')], [{ method: 'ESPECES', amount: '0' }]));
    expect(result.ok === false && codes(result.issues)).toEqual(['PAYMENT_AMOUNT_INVALID']);
  });

  it('ligne illisible : erreur de programmation (le document a déjà passé le calcul)', () => {
    expect(() => convertDocumentToCdf(usd([plain('1.005')]))).toThrow(RangeError);
    expect(() => convertDocumentToCdf(usd([plain('1.00', '0')]))).toThrow(RangeError);
    expect(() =>
      convertDocumentToCdf(usd([{ ...plain('0.90'), discount: { kind: 'percent', value: '10' } }])),
    ).toThrow(/prix d’origine/);
  });

  it('ne modifie pas l’entrée', () => {
    const input = usd(
      [{ ...plain('2.00'), specificTax: { kind: 'per_unit', amount: '0.75' } }],
      [{ method: 'ESPECES', amount: '2.75' }],
    );
    const copy = structuredClone(input);
    convertDocumentToCdf(input);
    expect(input).toEqual(copy);
  });
});

// ── Propriétés sur 1 000 documents en USD ────────────────────────────────────

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
const decimalText = (value: number, digits: number) => {
  const raw = String(value).padStart(digits + 1, '0');
  return digits === 0 ? raw : `${raw.slice(0, -digits)}.${raw.slice(-digits)}`;
};

/** Taux des seize groupes tels que la DGI les publie (relevé du 19 oct. 2026). */
const DGI_RATES: TaxRateTable = {
  A: '0',
  B: '16',
  C: '5',
  D: '0',
  E: '0',
  F: '16',
  G: '5',
  H: '0',
  I: '0',
  J: '0',
  K: '0',
  L: '0',
  M: '0',
  N: '16',
  O: '1',
  P: '1',
};

interface Document {
  priceMode: PriceMode;
  rate: string;
  groups: TaxGroupLetter[];
  lines: (ConvertibleLine & { taxGroup: TaxGroupLetter })[];
}

function randomDocument(random: ReturnType<typeof generator>): Document {
  const priceMode = random.pick(['ht', 'ttc'] as const);
  // Taux de 2 000 à 3 000 CDF pour 1 USD, de 0 à 8 décimales.
  const digits = random.int(0, 8);
  const rate =
    decimalText(random.int(2000, 2999), 0) +
    (digits === 0
      ? ''
      : `.${String(random.int(0, 10 ** Math.min(digits, 8) - 1)).padStart(digits, '0')}`);
  const count = random.int(1, 6);
  const lines: Document['lines'] = [];
  for (let i = 0; i < count; i += 1) {
    const taxGroup = random.pick(TAX_GROUP_LETTERS);
    const isTax = taxGroup === 'L' || taxGroup === 'N';
    const quantity = decimalText(random.int(1, 50_000), 3);
    const price = decimalText(random.int(1, 1_000_000), 2);
    const roll = random.next();
    let line: ConvertibleLine = { ...plain(price, quantity) };
    if (!isTax && roll < 0.15) {
      line = {
        ...line,
        specificTax: { kind: 'per_unit', amount: decimalText(random.int(1, 50_000), 2) },
      };
    } else if (!isTax && roll < 0.3) {
      line = {
        ...line,
        specificTax: { kind: 'percent', rate: decimalText(random.int(1, 9_999), 2) },
      };
    }
    if (random.next() < 0.25) {
      const discount: LineDiscount =
        random.next() < 0.5
          ? { kind: 'percent', value: String(random.int(1, 50)) }
          : { kind: 'total_amount', value: decimalText(random.int(1, 1_000), 2) };
      const result = discountedUnitPrice({ originalPrice: price, quantity, discount });
      if (result.ok)
        line = { ...line, unitPrice: result.unitPrice, originalPrice: price, discount };
    }
    lines.push({ ...line, taxGroup });
  }
  return { priceMode, rate, groups: [...new Set(lines.map((l) => l.taxGroup))], lines };
}

function invoiceLines(
  doc: Document,
  prices: readonly { unitPrice: string; specificTax: ConvertibleLine['specificTax'] }[],
): InvoiceLineInput[] {
  return doc.lines.map((line, i) => ({
    unitPrice: prices[i]?.unitPrice ?? '',
    quantity: line.quantity,
    taxGroup: line.taxGroup,
    itemType: line.taxGroup === 'L' || line.taxGroup === 'N' ? 'TAX' : 'BIE',
    specificTax: prices[i]?.specificTax ?? null,
  }));
}

/** Paiements qui couvrent exactement `total` (1 à 3, modes au hasard). */
function randomPayments(total: string, random: ReturnType<typeof generator>): PaymentInput[] {
  const whole = cents(total);
  const count = whole >= 3n ? random.int(1, 3) : 1;
  const parts: bigint[] = [];
  let left = whole;
  for (let i = count; i > 1; i -= 1) {
    const share = 1n + BigInt(Math.floor(random.next() * Number(left - BigInt(i)) * 0.6));
    parts.push(share);
    left -= share;
  }
  parts.push(left);
  return parts.map((amount) => ({ method: random.pick(PAYMENT_METHODS), amount: money(amount) }));
}

describe('propriétés (1 000 documents en USD, graine fixe)', () => {
  const random = generator(20261019);
  const documents = Array.from({ length: 1000 }, () => {
    const doc = randomDocument(random);
    const usdTotals = totalsOf(
      computeInvoiceTotals({
        priceMode: doc.priceMode,
        lines: invoiceLines(doc, doc.lines),
        rates: DGI_RATES,
      }),
    );
    const payments = randomPayments(usdTotals.total, random);
    const input: CurrencyConversionInput = {
      from: 'USD',
      rate: doc.rate,
      lines: doc.lines,
      payments,
    };
    return { doc, usdTotals, payments, input, result: converted(convertDocumentToCdf(input)) };
  });

  it('chaque prix sans remise, prix d’origine, taxe par unité et paiement = arrondi(montant × taux)', () => {
    for (const { doc, payments, result } of documents) {
      doc.lines.forEach((line, i) => {
        const out = result.lines[i];
        if (out === undefined) throw new Error('ligne manquante');
        expect(out.index).toBe(i);
        if (line.discount === null) {
          expect(cents(out.unitPrice)).toBe(productInCents(line.unitPrice, doc.rate));
          expect(out.priceModification).toBeNull();
        }
        if (line.originalPrice !== null) {
          expect(cents(out.originalPrice ?? '')).toBe(productInCents(line.originalPrice, doc.rate));
        }
        if (line.specificTax?.kind === 'per_unit') {
          expect(out.specificTax?.kind).toBe('per_unit');
          if (out.specificTax?.kind === 'per_unit') {
            expect(cents(out.specificTax.amount)).toBe(
              productInCents(line.specificTax.amount, doc.rate),
            );
          }
        } else {
          expect(out.specificTax).toEqual(line.specificTax);
        }
      });
      payments.forEach((p, i) => {
        expect(result.payments[i]?.method).toBe(p.method);
        expect(cents(result.payments[i]?.amount ?? '')).toBe(productInCents(p.amount, doc.rate));
      });
    }
  });

  it('remise en pourcentage : prix CDF = arrondi(origine CDF × (100 − p) / 100), libellé inchangé', () => {
    let seen = 0;
    for (const { doc, result } of documents) {
      doc.lines.forEach((line, i) => {
        if (line.discount?.kind !== 'percent') return;
        seen += 1;
        const out = result.lines[i];
        const original = cents(out?.originalPrice ?? '');
        const p = BigInt(line.discount.value);
        const num = original * (100n - p);
        const expected = num / 100n + (2n * (num % 100n) >= 100n ? 1n : 0n);
        expect(cents(out?.unitPrice ?? '')).toBe(expected);
        expect(out?.priceModification).toBe(`Remise ${line.discount.value} %`);
      });
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('remise en montant : (origine − prix) × quantité ≈ remise convertie, à ½ centime × quantité près', () => {
    let seen = 0;
    for (const { doc, result } of documents) {
      doc.lines.forEach((line, i) => {
        if (line.discount?.kind !== 'total_amount') return;
        seen += 1;
        const out = result.lines[i];
        const gap = cents(out?.originalPrice ?? '') - cents(out?.unitPrice ?? '');
        const milli = BigInt(line.quantity.replace('.', '')); // quantité × 1 000
        const discount = productInCents(line.discount.value, doc.rate) * 1000n; // en 10⁻⁵
        const effective = gap * milli; // en 10⁻⁵
        const diff = effective > discount ? effective - discount : discount - effective;
        expect(diff * 2n <= milli).toBe(true); // ≤ ½ centime × quantité
        expect(out?.priceModification).toMatch(/^Remise [\d ]+,\d{2} CDF$/);
      });
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('le document CDF passe computeInvoiceTotals ; invariants d’ADR-0022 vérifiés', () => {
    for (const { doc, result } of documents) {
      const totals = totalsOf(
        computeInvoiceTotals({
          priceMode: doc.priceMode,
          lines: invoiceLines(doc, result.lines),
          rates: DGI_RATES,
        }),
      );
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
      expect(totals.groups.map((g) => g.group)).toEqual(
        TAX_GROUP_LETTERS.filter((l) => doc.groups.includes(l)),
      );
    }
  });

  it('total CDF proche de total USD × taux (borne des arrondis)', () => {
    for (const { doc, usdTotals, result } of documents) {
      const cdf = cents(
        totalsOf(
          computeInvoiceTotals({
            priceMode: doc.priceMode,
            lines: invoiceLines(doc, result.lines),
            rates: DGI_RATES,
          }),
        ).total,
      );
      // Valeur exacte total USD × taux, en centimes × 10^chiffres du taux.
      const rate = units(doc.rate);
      const scale = 10n ** BigInt(rate.digits);
      const exact = cents(usdTotals.total) * rate.units; // centimes × scale
      const gap = cdf * scale > exact ? cdf * scale - exact : exact - cdf * scale;
      // Borne : chaque arrondi USD (ligne, taxe, groupe) coûte au plus 2 centimes × taux ;
      // chaque arrondi CDF 2 centimes ; chaque prix converti ½ centime par unité (× 2,2 pour
      // TVA et taxe en %) ; un prix remisé USD arrondi ½ centime USD par unité, soit × taux.
      const rateCeil = rate.units / scale + 1n;
      const n = BigInt(doc.lines.length + doc.groups.length);
      let bound = (rateCeil + 1n) * 4n * n;
      for (const line of doc.lines) {
        const quantity = units(line.quantity).units / 1000n + 1n;
        bound += quantity * 3n * (line.discount === null ? 1n : rateCeil + 1n);
      }
      expect(gap <= bound * scale).toBe(true);
    }
  });

  it('paiements convertis réconciliés : somme = total CDF exactement, checkPayments accepte', () => {
    for (const { doc, result } of documents) {
      const totals = totalsOf(
        computeInvoiceTotals({
          priceMode: doc.priceMode,
          lines: invoiceLines(doc, result.lines),
          rates: DGI_RATES,
        }),
      );
      const reconciled = reconcilePayments(totals.total, result.payments);
      if (!reconciled.ok) throw new Error('réconciliation refusée');
      expect(reconciled.payments.reduce((s, p) => s + cents(p.amount), 0n)).toBe(
        cents(totals.total),
      );
    }
  });

  it('un document CDF converti est inchangé (identité), même calcul au centime', () => {
    for (const { doc, payments } of documents.slice(0, 300)) {
      const result = converted(
        convertDocumentToCdf({ from: 'CDF', rate: '1', lines: doc.lines, payments }),
      );
      expect(result.lines.map((l) => l.unitPrice)).toEqual(doc.lines.map((l) => l.unitPrice));
      expect(result.lines.map((l) => l.specificTax)).toEqual(doc.lines.map((l) => l.specificTax));
      expect(result.payments).toEqual(payments);
    }
  });

  it('calcul déterministe', () => {
    for (const { input, result } of documents.slice(0, 100)) {
      expect(convertDocumentToCdf(input)).toEqual(result);
    }
  });
});
