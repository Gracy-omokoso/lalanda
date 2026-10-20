// Total en lettres — ADR-0025 § 4 (mention DGI 2.1 q).

import { describe, expect, it } from 'vitest';

import { amountInWords, integerInWords } from './amount-in-words.js';

describe('integerInWords — orthographe traditionnelle', () => {
  it.each([
    ['0', 'zéro'],
    ['1', 'un'],
    ['16', 'seize'],
    ['17', 'dix-sept'],
    ['21', 'vingt et un'],
    ['22', 'vingt-deux'],
    ['61', 'soixante et un'],
    ['70', 'soixante-dix'],
    ['71', 'soixante et onze'],
    ['77', 'soixante-dix-sept'],
    ['80', 'quatre-vingts'],
    ['81', 'quatre-vingt-un'],
    ['91', 'quatre-vingt-onze'],
    ['99', 'quatre-vingt-dix-neuf'],
    ['100', 'cent'],
    ['101', 'cent un'],
    ['200', 'deux cents'],
    ['201', 'deux cent un'],
    ['280', 'deux cent quatre-vingts'],
    ['1000', 'mille'],
    ['1001', 'mille un'],
    ['2000', 'deux mille'],
    ['80000', 'quatre-vingt mille'],
    ['200000', 'deux cent mille'],
    ['4064', 'quatre mille soixante-quatre'],
    ['1000000', 'un million'],
    ['2000000', 'deux millions'],
    ['200000000', 'deux cents millions'],
    ['80000000', 'quatre-vingts millions'],
    ['1000000000', 'un milliard'],
    ['3000000000000', 'trois billions'],
    ['1234567', 'un million deux cent trente-quatre mille cinq cent soixante-sept'],
    ['007', 'sept'],
  ])('%s → %s', (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it('refuse ce qui n’est pas un entier, et plus de quinze chiffres', () => {
    expect(() => integerInWords('12a')).toThrow();
    expect(() => integerInWords('1000000000000000')).toThrow();
  });
});

describe('amountInWords — devise et centimes', () => {
  it.each([
    ['4064.00', 'CDF', 'quatre mille soixante-quatre francs congolais'],
    ['4064.50', 'CDF', 'quatre mille soixante-quatre francs congolais et cinquante centimes'],
    ['1.01', 'CDF', 'un franc congolais et un centime'],
    ['0.5', 'CDF', 'zéro franc congolais et cinquante centimes'],
    ['1000000.00', 'CDF', 'un million de francs congolais'],
    ['3000000.00', 'CDF', 'trois millions de francs congolais'],
    ['1000001.00', 'CDF', 'un million un francs congolais'],
    ['92.80', 'USD', 'quatre-vingt-douze dollars américains et quatre-vingts cents'],
    ['1.00', 'USD', 'un dollar américain'],
  ] as const)('%s %s', (amount, currency, words) => {
    expect(amountInWords(amount, currency)).toBe(words);
  });

  it('refuse un montant négatif ou mal formé', () => {
    expect(() => amountInWords('-1.00', 'CDF')).toThrow();
    expect(() => amountInWords('1.234', 'CDF')).toThrow();
  });
});
