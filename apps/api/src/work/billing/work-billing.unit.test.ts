// Règles pures du lot L4a (ADR-0039 § 5 et § 6.1) : lignes retenues d'un devis,
// documents de vente qui portent de l'argent.

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { StoredLine } from '../../sales/invoices/invoice.types.js';
import { isFinal, type SalesDocRead } from '../margin/project-margin.service.js';
import { pickQuoteLines, type QuoteRead } from './work-billing.service.js';

const line = (name: string) => ({ name, quantity: '1', unit: null }) as unknown as StoredLine;
const quote = {
  _id: 'q',
  number: 'DV2610-000001',
  version: 1,
  status: 'accepted',
  title: null,
  opportunityId: null,
  currency: 'USD',
  priceMode: 'ht',
  customer: {},
  lines: [line('A'), line('B'), line('C')],
} as unknown as QuoteRead;

describe('pickQuoteLines', () => {
  it('toutes les lignes par défaut, dans l’ordre du devis', () => {
    expect(pickQuoteLines(quote, undefined).map((p) => [p.index, p.line.name])).toEqual([
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
    ]);
  });

  it('lignes retenues remises dans l’ordre du devis', () => {
    expect(pickQuoteLines(quote, [2, 0]).map((p) => p.index)).toEqual([0, 2]);
  });

  it('indice hors du devis : 400 INVALID_VALUE', () => {
    expect(() => pickQuoteLines(quote, [3])).toThrow(BadRequestException);
  });
});

describe('isFinal', () => {
  const doc = (status: string, series: string | null) =>
    ({ status, series }) as unknown as SalesDocRead;
  it('émise ou normalisée, série réelle : porte de l’argent', () => {
    expect(isFinal(doc('issued', 'real'))).toBe(true);
    expect(isFinal(doc('normalized', 'real'))).toBe(true);
  });
  it('brouillon, pro forma ou série d’essai : n’apporte rien', () => {
    expect(isFinal(doc('draft', null))).toBe(false);
    expect(isFinal(doc('issued', 'test'))).toBe(false);
  });
});
