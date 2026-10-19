// Conversion de prix, remises et contre-valeur USD (ADR-0022 § S25d.3, § S25d.5, critères D3).

import { describe, expect, it } from 'vitest';

import {
  CURRENCY_REFERENCE_CASES,
  convertUnitPrice,
  discountedUnitPrice,
  isExchangeRateWithinTolerance,
  usdCounterValue,
} from '../index.js';

describe('convertUnitPrice', () => {
  it('1 000,00 HT à 16 % → 1 160,00 TTC ; 464,00 TTC → 400,00 HT', () => {
    expect(convertUnitPrice('1000.00', '16', 'ht', 'ttc')).toBe('1160.00');
    expect(convertUnitPrice('464.00', '16', 'ttc', 'ht')).toBe('400.00');
  });

  it('arrondit au plus proche', () => {
    expect(convertUnitPrice('500.00', '16', 'ttc', 'ht')).toBe('431.03'); // 431,034…
    expect(convertUnitPrice('0.05', '5', 'ht', 'ttc')).toBe('0.05'); // 0,0525
    expect(convertUnitPrice('0.10', '5', 'ht', 'ttc')).toBe('0.11'); // 0,105, demi vers le haut
  });

  it('même mode : prix inchangé, écrit à 2 décimales ; taux nul : prix inchangé', () => {
    expect(convertUnitPrice('464', '16', 'ttc', 'ttc')).toBe('464.00');
    expect(convertUnitPrice('720.00', '0', 'ttc', 'ht')).toBe('720.00');
  });

  it('refuse une entrée invalide', () => {
    expect(() => convertUnitPrice('0', '16', 'ht', 'ttc')).toThrow(RangeError);
    expect(() => convertUnitPrice('1e3', '16', 'ht', 'ttc')).toThrow(RangeError);
    expect(() => convertUnitPrice('100', '16%', 'ht', 'ttc')).toThrow(RangeError);
  });
});

describe('discountedUnitPrice', () => {
  it('10 % sur 1 000,00 → 900,00, « Remise 10 % »', () => {
    expect(
      discountedUnitPrice({
        originalPrice: '1000.00',
        quantity: '2',
        discount: { kind: 'percent', value: '10' },
      }),
    ).toEqual({
      ok: true,
      unitPrice: '900.00',
      priceModification: 'Remise 10 %',
      effectiveDiscountTotal: '200.00',
    });
  });

  it('300,00 sur 3 unités à 1 000,00 → 900,00, remise effective 300,00', () => {
    expect(
      discountedUnitPrice({
        originalPrice: '1000.00',
        quantity: '3',
        discount: { kind: 'total_amount', value: '300.00' },
      }),
    ).toEqual({
      ok: true,
      unitPrice: '900.00',
      priceModification: 'Remise 300,00 CDF',
      effectiveDiscountTotal: '300.00',
    });
  });

  it('remise globale non divisible : prix arrondi, remise effective dite telle quelle', () => {
    // 1 000 − 100 / 3 = 966,666… → 966,67 ; remise effective (1 000 − 966,67) × 3 = 99,99.
    expect(
      discountedUnitPrice({
        originalPrice: '1000.00',
        quantity: '3',
        discount: { kind: 'total_amount', value: '100' },
      }),
    ).toEqual({
      ok: true,
      unitPrice: '966.67',
      priceModification: 'Remise 99,99 CDF',
      effectiveDiscountTotal: '99.99',
    });
  });

  it('pourcentage décimal et grand montant écrits à la française', () => {
    const result = discountedUnitPrice({
      originalPrice: '20000.00',
      quantity: '1',
      discount: { kind: 'percent', value: '12.50' },
    });
    expect(result).toMatchObject({
      ok: true,
      unitPrice: '17500.00',
      priceModification: 'Remise 12,5 %',
    });
    const total = discountedUnitPrice({
      originalPrice: '20000.00',
      quantity: '1',
      discount: { kind: 'total_amount', value: '2500' },
    });
    expect(total).toMatchObject({ ok: true, priceModification: 'Remise 2 500,00 CDF' });
  });

  it('remise ≥ prix → refus', () => {
    const cases = [
      { kind: 'percent', value: '100' },
      { kind: 'percent', value: '150' },
      { kind: 'total_amount', value: '3000' },
      { kind: 'total_amount', value: '3500' },
    ] as const;
    for (const discount of cases) {
      const result = discountedUnitPrice({ originalPrice: '1000.00', quantity: '3', discount });
      expect(result, JSON.stringify(discount)).toMatchObject({
        ok: false,
        issue: { code: 'PRICE_NOT_POSITIVE', field: 'unitPrice' },
      });
    }
  });

  it('prix nul après arrondi, remise sans effet, entrées invalides → refus', () => {
    const refusal = (input: Parameters<typeof discountedUnitPrice>[0]) => {
      const result = discountedUnitPrice(input);
      return result.ok ? null : result.issue.code;
    };
    expect(
      refusal({ originalPrice: '0.01', quantity: '1', discount: { kind: 'percent', value: '60' } }),
    ).toBe('PRICE_NOT_POSITIVE'); // 0,01 × 0,4 = 0,004 → 0,00 une fois arrondi
    expect(
      refusal({
        originalPrice: '1000',
        quantity: '3',
        discount: { kind: 'total_amount', value: '0.01' },
      }),
    ).toBe('INVALID_DECIMAL');
    expect(
      refusal({ originalPrice: '0', quantity: '1', discount: { kind: 'percent', value: '10' } }),
    ).toBe('PRICE_NOT_POSITIVE');
    expect(
      refusal({ originalPrice: '10', quantity: '0', discount: { kind: 'percent', value: '10' } }),
    ).toBe('QUANTITY_NOT_POSITIVE');
    expect(
      refusal({ originalPrice: '10', quantity: '1', discount: { kind: 'percent', value: '0' } }),
    ).toBe('INVALID_DECIMAL');
    expect(
      refusal({
        originalPrice: '10',
        quantity: '1',
        discount: { kind: 'percent', value: '1.234' },
      }),
    ).toBe('INVALID_DECIMAL');
  });
});

describe('devise', () => {
  for (const testCase of CURRENCY_REFERENCE_CASES) {
    it(`${testCase.id} (${testCase.reliability})`, () => {
      if (testCase.kind === 'counter_value') {
        expect(usdCounterValue(testCase.totalCdf, testCase.cdfPerUsd)).toBe(testCase.expected);
      } else {
        expect(
          isExchangeRateWithinTolerance(
            testCase.rate,
            testCase.referenceRate,
            testCase.tolerancePercent,
          ),
        ).toBe(testCase.expected);
      }
    });
  }

  it('contre-valeur : 4 064,00 CDF à 2 987,33 → 1,36 USD ; arrondi au plus proche', () => {
    expect(usdCounterValue('4064.00', '2987.33')).toBe('1.36');
    expect(usdCounterValue('2987.33', '2987.33')).toBe('1.00');
    expect(usdCounterValue('14.95', '1000')).toBe('0.01'); // 0,01495
    expect(usdCounterValue('15', '1000')).toBe('0.02'); // 0,015, demi vers le haut
    expect(usdCounterValue('9999999999999.99', '2987.33')).toBe('3347470818.42');
  });

  it('tolérance : bornes incluses de part et d’autre, tolérance par défaut 1 %', () => {
    expect(isExchangeRateWithinTolerance('2929', '2900')).toBe(true);
    expect(isExchangeRateWithinTolerance('2871', '2900')).toBe(true);
    expect(isExchangeRateWithinTolerance('2870.99', '2900')).toBe(false);
    expect(isExchangeRateWithinTolerance('2929.01', '2900')).toBe(false);
    expect(isExchangeRateWithinTolerance('2930', '2900')).toBe(false);
    expect(isExchangeRateWithinTolerance('2900', '2900', '0')).toBe(true);
  });

  it('refuse un taux nul ou mal formé', () => {
    expect(() => usdCounterValue('100', '0')).toThrow(RangeError);
    expect(() => usdCounterValue('100', '-1')).toThrow(RangeError);
    expect(() => usdCounterValue('1e3', '2900')).toThrow(RangeError);
    expect(() => isExchangeRateWithinTolerance('2900', '0')).toThrow(RangeError);
    expect(() => isExchangeRateWithinTolerance('2900', '2900', '-1')).toThrow(RangeError);
  });
});
