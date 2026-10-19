// Arithmétique décimale exacte (ADR-0022 § S25d.3) — fichier interne `decimal.ts`.
// Attentes écrites en littéral : aucune n'est recalculée par le code testé.

import { describe, expect, it } from 'vitest';

import {
  CENT,
  SCALE,
  divRound,
  fixedOf,
  formatAmount,
  formatTrimmed,
  mulExact,
  parseFixed,
  roundDown,
  roundHalfUp,
  roundRatio,
  roundUp,
  splitDecimal,
} from './decimal.js';

describe('lecture des décimaux', () => {
  it('accepte la forme canonique, sans signe ni exposant', () => {
    expect(parseFixed('0')).toBe(0n);
    expect(parseFixed('464')).toBe(46_400_000_000n);
    expect(parseFixed('464.00')).toBe(46_400_000_000n);
    expect(parseFixed('0.00000001')).toBe(1n);
    expect(parseFixed('007.5')).toBe(750_000_000n);
  });

  it('refuse tout le reste, y compris un number', () => {
    for (const value of [
      '',
      '.5',
      '5.',
      '-1',
      '+1',
      '1e3',
      '1E3',
      ' 1',
      '1 ',
      '1,5',
      '0x10',
      'NaN',
      'Infinity',
      '1.000000001', // 9 décimales
      5,
      null,
      undefined,
      {},
    ]) {
      expect(parseFixed(value), String(value)).toBeNull();
    }
  });

  it('découpe partie entière et décimales', () => {
    expect(splitDecimal('12.345')).toEqual({ integer: '12', fraction: '345' });
    expect(splitDecimal('12')).toEqual({ integer: '12', fraction: '' });
    expect(splitDecimal(12)).toBeNull();
  });

  it('fixedOf lève une erreur sur une valeur invalide', () => {
    expect(() => fixedOf('1e3')).toThrow(RangeError);
  });
});

describe('arrondis nommés', () => {
  const v = (text: string): bigint => fixedOf(text);

  it('roundHalfUp : au plus proche, la moitié vers le haut', () => {
    expect(formatAmount(roundHalfUp(v('0.335')))).toBe('0.34');
    expect(formatAmount(roundHalfUp(v('0.334999')))).toBe('0.33');
    expect(formatAmount(roundHalfUp(v('1.005')))).toBe('1.01'); // 1.005 en flottant donnerait 1.00
    expect(formatAmount(roundHalfUp(v('4.72625')))).toBe('4.73');
    expect(formatAmount(roundHalfUp(v('0.00499999')))).toBe('0.00');
  });

  it('roundUp : centime supérieur dès qu’il reste une fraction', () => {
    expect(formatAmount(roundUp(v('68.9648')))).toBe('68.97');
    expect(formatAmount(roundUp(v('68.96000001')))).toBe('68.97');
    expect(formatAmount(roundUp(v('68.96')))).toBe('68.96');
  });

  it('roundDown : centime inférieur', () => {
    expect(formatAmount(roundDown(v('68.9699')))).toBe('68.96');
    expect(formatAmount(roundDown(v('68.96')))).toBe('68.96');
  });

  it('sont idempotents', () => {
    for (const text of ['0.335', '1.005', '68.9648', '9.90099', '123456789.123456', '0']) {
      for (const round of [roundHalfUp, roundUp, roundDown]) {
        const once = round(v(text));
        expect(round(once), text).toBe(once);
      }
    }
  });

  it('divRound est exact pour les négatifs (plancher, plafond, demi vers +∞)', () => {
    expect(divRound(-7n, 2n, 'down')).toBe(-4n);
    expect(divRound(-7n, 2n, 'up')).toBe(-3n);
    expect(divRound(-7n, 2n, 'half_up')).toBe(-3n);
    expect(divRound(7n, 2n, 'half_up')).toBe(4n);
    expect(divRound(6n, 4n, 'half_up')).toBe(2n);
    expect(divRound(5n, 4n, 'half_up')).toBe(1n);
    expect(divRound(8n, 4n, 'up')).toBe(2n);
    expect(() => divRound(1n, 0n, 'up')).toThrow(RangeError);
  });

  it('roundRatio arrondit la valeur exacte en une seule division', () => {
    // 2 000 × 16 / 116 = 275,862068… : centime supérieur 275,87, plus proche 275,86.
    const total = v('2000');
    const t = v('16');
    expect(formatAmount(roundRatio(total * t, 100n * SCALE + t, 'up'))).toBe('275.87');
    expect(formatAmount(roundRatio(total * t, 100n * SCALE + t, 'half_up'))).toBe('275.86');
  });
});

describe('produits et écriture', () => {
  it('mulExact : prix (2 déc.) × quantité (3 déc.) est exact', () => {
    expect(formatTrimmed(mulExact(fixedOf('1.99'), fixedOf('2.375')))).toBe('4.72625');
    expect(formatTrimmed(mulExact(fixedOf('999999999999.99'), fixedOf('9.999')))).toBe(
      '9998999999999.90001',
    );
  });

  it('mulExact refuse un produit au-delà de 8 décimales', () => {
    expect(() => mulExact(fixedOf('0.00001'), fixedOf('0.0001'))).toThrow(RangeError);
  });

  it('formatAmount écrit exactement deux décimales et refuse un montant non arrondi', () => {
    expect(formatAmount(0n)).toBe('0.00');
    expect(formatAmount(CENT)).toBe('0.01');
    expect(formatAmount(fixedOf('3600'))).toBe('3600.00');
    expect(formatAmount(fixedOf('9998999999999.9'))).toBe('9998999999999.90');
    expect(() => formatAmount(fixedOf('0.001'))).toThrow(RangeError);
    expect(() => formatAmount(-CENT)).toThrow(RangeError);
  });

  it('formatTrimmed écrit la forme la plus courte', () => {
    expect(formatTrimmed(fixedOf('16.00'))).toBe('16');
    expect(formatTrimmed(fixedOf('16.50'))).toBe('16.5');
    expect(formatTrimmed(0n)).toBe('0');
  });
});
