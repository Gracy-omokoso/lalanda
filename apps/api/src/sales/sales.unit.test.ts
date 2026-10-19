// Tests unitaires du module ventes — règles d'entrée, recherche, curseur, et
// verrou « seul `SalesUsageService` écrit `firstInvoicedAt` » (ADR-0022 § S25c.6).

import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CreateCatalogItemSchema,
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  isReservedItemCode,
  parseDecimalInput,
} from './sales.dto.js';
import { issuesOf } from './sales.errors.js';
import {
  decodeCursor,
  encodeCursor,
  escapeRegex,
  normalizeForSearch,
  searchKeyOf,
} from './search.js';
import { rateFromSnapshot } from './tax-groups.service.js';

function codes(schema: { safeParse: (v: unknown) => unknown }, body: unknown): string[] {
  const res = schema.safeParse(body) as
    { success: true } | { success: false; error: Parameters<typeof issuesOf>[0] };
  return res.success ? [] : issuesOf(res.error).map((i) => i.code);
}

const ARTICLE = {
  code: 'LAIT-1L',
  name: 'Lait demi-écrémé 1 L',
  itemType: 'BIE',
  taxGroup: 'B',
  outOfScope: false,
  unitPrice: '464',
  priceMode: 'ttc',
  currency: 'CDF',
  unit: 'pièce',
  specificTax: null,
};

describe('décimaux', () => {
  it('normalise sans nombre flottant', () => {
    expect(parseDecimalInput('464', { maxIntegerDigits: 13, decimals: 2 })).toMatchObject({
      ok: true,
      canonical: '464.00',
    });
    expect(parseDecimalInput('0464.5', { maxIntegerDigits: 13, decimals: 2 })).toMatchObject({
      ok: true,
      canonical: '464.50',
    });
    expect(parseDecimalInput('0.00', { maxIntegerDigits: 13, decimals: 2 })).toMatchObject({
      ok: true,
      isZero: true,
    });
    expect(parseDecimalInput(464, { maxIntegerDigits: 13, decimals: 2 })).toEqual({
      ok: false,
      reason: 'number',
    });
    expect(parseDecimalInput('1.234', { maxIntegerDigits: 13, decimals: 2 })).toEqual({
      ok: false,
      reason: 'too_precise',
    });
    expect(parseDecimalInput('1e3', { maxIntegerDigits: 13, decimals: 2 })).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(parseDecimalInput('12345678901234', { maxIntegerDigits: 13, decimals: 2 })).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('taux d’instantané : entier ou décimal, jamais exponentiel ni négatif', () => {
    expect(rateFromSnapshot(16)).toBe('16');
    expect(rateFromSnapshot(0)).toBe('0');
    expect(rateFromSnapshot(16.5)).toBe('16.5');
    expect(rateFromSnapshot(-1)).toBeNull();
    expect(rateFromSnapshot(1e21)).toBeNull();
    expect(rateFromSnapshot('16')).toBeNull();
  });
});

describe('clients', () => {
  it('codes de problème par type', () => {
    expect(codes(CreateCustomerSchema, { type: 'PP', name: 'Jean' })).toEqual([]);
    expect(codes(CreateCustomerSchema, { type: 'PM', name: 'X SARL' })).toEqual([
      'NIF_REQUIRED_FOR_TYPE',
    ]);
    expect(codes(CreateCustomerSchema, { type: 'PM', nif: 'A0000000X' })).toEqual([
      'NAME_REQUIRED',
    ]);
    expect(codes(CreateCustomerSchema, { type: 'AO', name: 'Ambassade' })).toEqual([
      'EXEMPTION_REFERENCE_REQUIRED',
    ]);
    expect(
      codes(CreateCustomerSchema, {
        type: 'PM',
        name: 'X',
        nif: 'A0000000X',
        exemptionReference: 'EXO-1',
      }),
    ).toEqual(['EXEMPTION_REFERENCE_NOT_ALLOWED']);
    expect(codes(CreateCustomerSchema, { type: 'PP', name: 'X', nif: 'a!' })).toEqual([
      'NIF_INVALID',
    ]);
    expect(codes(CreateCustomerSchema, { type: 'PP', name: 'X', extra: 1 })).toEqual([
      'UNKNOWN_FIELD',
    ]);
  });

  it('normalise le NIF', () => {
    const res = CreateCustomerSchema.safeParse({ type: 'PM', name: 'X', nif: 'a 000-0000x' });
    expect(res.success && res.data.nif).toBe('A0000000X');
  });
});

describe('catalogue', () => {
  it('article valide, prix normalisé', () => {
    const res = CreateCatalogItemSchema.safeParse(ARTICLE);
    expect(res.success && res.data.unitPrice).toBe('464.00');
  });

  it('devise : USD admis tel quel, CDF par défaut (ADR-0023 E4)', () => {
    const usd = CreateCatalogItemSchema.safeParse({ ...ARTICLE, unitPrice: '40', currency: 'USD' });
    expect(usd.success && usd.data).toMatchObject({ currency: 'USD', unitPrice: '40.00' });
    const { currency: _omise, ...sansDevise } = ARTICLE;
    const cdf = CreateCatalogItemSchema.safeParse(sansDevise);
    expect(cdf.success && cdf.data.currency).toBe('CDF');
  });

  it.each([
    [{ itemType: 'TAX' }, 'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP'],
    [{ taxGroup: 'L' }, 'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP'],
    [{ outOfScope: true }, 'OUT_OF_SCOPE_ONLY_GROUP_A'],
    [{ code: 'hors champ' }, 'CODE_RESERVED'],
    [{ code: 'HORS-CHAMP' }, 'CODE_RESERVED'],
    [{ unitPrice: 464 }, 'DECIMAL_MUST_BE_STRING'],
    [{ unitPrice: '1.234' }, 'PRICE_TOO_PRECISE'],
    [{ unitPrice: '0' }, 'PRICE_NOT_POSITIVE'],
    [{ taxGroup: 'Q' }, 'UNKNOWN_TAX_GROUP'],
    [{ currency: 'EUR' }, 'CURRENCY_NOT_SUPPORTED'],
    [{ currency: 'usd' }, 'CURRENCY_NOT_SUPPORTED'],
    [{ currency: null }, 'CURRENCY_NOT_SUPPORTED'],
    [
      { taxGroup: 'N', itemType: 'TAX', specificTax: { kind: 'per_unit', amount: '1' } },
      'SPECIFIC_TAX_NOT_ALLOWED',
    ],
    [{ specificTax: { kind: 'percent', rate: '100' } }, 'SPECIFIC_TAX_INVALID'],
    [{ specificTax: { kind: 'per_unit', amount: 75 } }, 'DECIMAL_MUST_BE_STRING'],
  ])('%j → %s', (patch, code) => {
    expect(codes(CreateCatalogItemSchema, { ...ARTICLE, ...patch })).toContain(code);
  });

  it('« HORS CHAMP » réservé quelle que soit la graphie', () => {
    expect(isReservedItemCode('hors_champ')).toBe(true);
    expect(isReservedItemCode('HORSCHAMP')).toBe(false);
  });
});

describe('recherche et curseur', () => {
  it('normalise casse et accents', () => {
    expect(normalizeForSearch('  Élevé   KINSHASA ')).toBe('eleve kinshasa');
    expect(searchKeyOf(['Élevé', null, 'a@b.cd'])).toBe('eleve a@b.cd');
  });

  it('échappe les métacaractères', () => {
    expect(new RegExp(escapeRegex('.*')).test('abc')).toBe(false);
    expect(new RegExp(escapeRegex('.*')).test('a.*b')).toBe(true);
  });

  it('curseur aller-retour ; curseur altéré refusé', () => {
    const c = encodeCursor('abc', '6713a0c4e1a2b3c4d5e6f701');
    expect(decodeCursor(c)).toMatchObject({ sortName: 'abc' });
    expect(decodeCursor(`${c}x`)).toBeNull();
    expect(decodeCursor('pas un curseur!')).toBeNull();
    expect(decodeCursor(Buffer.from('{"s":1,"i":"x"}').toString('base64url'))).toBeNull();
  });

  it('paramètres de liste : limite bornée, champ inconnu refusé', () => {
    expect(ListCustomersQuerySchema.parse({}).limit).toBe(50);
    expect(ListCustomersQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListCustomersQuerySchema.safeParse({ foo: '1' }).success).toBe(false);
  });
});

describe('verrou firstInvoicedAt', () => {
  it('seul sales-usage.service.ts écrit firstInvoicedAt', async () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = (await readdir(dir)).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'sales-usage.service.ts',
    );
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = await readFile(resolve(dir, f), 'utf8');
      // Toute mention hors lecture est une écriture : seules sont admises la
      // déclaration du schéma, le filtre `firstInvoicedAt: null` de la
      // suppression et la lecture `doc.firstInvoicedAt`.
      const mentions = src.match(/.*firstInvoicedAt.*/g) ?? [];
      for (const line of mentions) {
        const allowed =
          /firstInvoicedAt!: Date \| null;/.test(line) ||
          /firstInvoicedAt: null \}\)/.test(line) ||
          /\.firstInvoicedAt != null/.test(line) ||
          /^\s*(\/\/|\*)/.test(line);
        expect(allowed, `${f} : ${line.trim()}`).toBe(true);
      }
    }
  });
});
