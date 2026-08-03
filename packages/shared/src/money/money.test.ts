import { describe, expect, it } from 'vitest';
import { addMoney, formatMoney, money } from './index.js';

describe('money()', () => {
  it('convertit USD en centimes', () => {
    expect(money(12.5, 'USD')).toEqual({ amount: 1250, currency: 'USD' });
  });

  it('garde CDF en entier', () => {
    expect(money(2500, 'CDF')).toEqual({ amount: 2500, currency: 'CDF' });
  });

  it('refuse un montant non fini', () => {
    expect(() => money(Number.POSITIVE_INFINITY, 'USD')).toThrow(RangeError);
  });
});

describe('addMoney()', () => {
  it('additionne deux montants de même devise', () => {
    expect(addMoney(money(1, 'USD'), money(2.5, 'USD'))).toEqual({
      amount: 350,
      currency: 'USD',
    });
  });

  it('refuse un mélange de devises', () => {
    expect(() => addMoney(money(1, 'USD'), money(2500, 'CDF'))).toThrow(TypeError);
  });
});

describe('formatMoney()', () => {
  it('formate un USD avec deux décimales', () => {
    expect(formatMoney(money(12.5, 'USD'), 'en-US')).toContain('12.50');
  });
});
