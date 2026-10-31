import { describe, expect, it } from 'vitest';

import {
  STOCK_COUNT_STATUSES,
  STOCK_DEFAULT_ADJUSTMENT_REASONS,
  STOCK_DOCUMENT_NUMBER_PATTERN,
  STOCK_MOVEMENT_KINDS,
  STOCK_OBSERVED_MOVEMENT_KINDS,
  STOCK_PENDING_REASONS,
  STOCK_PENDING_REASONS_REQUIRING_MANAGE,
  STOCK_SETTINGS_DEFAULTS,
  STOCK_VOUCHER_PREFIXES,
  StockCalendarDay,
  StockConversionFactor,
  StockId,
  StockPositiveQuantity,
  StockReorderSchema,
  StockSignedQuantity,
  StockUnitConversionsSchema,
  StockUnitCost,
  canonicalStockDecimal,
  stockCodeKey,
  stockSourceKey,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

describe('stocks — constantes (ADR-0046 § 2)', () => {
  it('douze natures de mouvement ; deux sont constatées (O4)', () => {
    expect(STOCK_MOVEMENT_KINDS).toHaveLength(12);
    expect([...STOCK_OBSERVED_MOVEMENT_KINDS]).toEqual(['sale_issue', 'purchase_receipt_reversal']);
  });

  it('« À traiter » : cinq motifs, les coûts exigent `stock.manage`', () => {
    expect(STOCK_PENDING_REASONS).toHaveLength(5);
    expect([...STOCK_PENDING_REASONS_REQUIRING_MANAGE]).toEqual(['pending_cost', 'cost_differs']);
  });

  it('inventaire : brouillon, comptage, soumis, validé ou annulé', () => {
    expect([...STOCK_COUNT_STATUSES]).toEqual([
      'draft',
      'counting',
      'submitted',
      'validated',
      'cancelled',
    ]);
  });

  it('réglages par défaut : sortie automatique, négatif manuel refusé, aucun rappel', () => {
    expect(STOCK_SETTINGS_DEFAULTS).toEqual({
      salesIssueMode: 'automatic',
      allowNegativeManualMoves: false,
      countReminderDays: 0,
      alertRecipients: 'holders',
    });
    expect(STOCK_DEFAULT_ADJUSTMENT_REASONS).toHaveLength(7);
  });

  it('numéros des pièces internes BS, BT, BJ, IV', () => {
    expect(STOCK_VOUCHER_PREFIXES.transfer).toBe('BT');
    expect(STOCK_VOUCHER_PREFIXES.adjustment).toBe('BJ');
    expect(STOCK_VOUCHER_PREFIXES.issue).toBe('BS');
    expect(STOCK_DOCUMENT_NUMBER_PATTERN.test('BS2610-000001')).toBe(true);
    expect(STOCK_DOCUMENT_NUMBER_PATTERN.test('IV2610-000042')).toBe(true);
    expect(STOCK_DOCUMENT_NUMBER_PATTERN.test('FV2610-000001')).toBe(false);
  });

  it('clés d’idempotence du grand livre (§ 2.3)', () => {
    expect(stockSourceKey.receptionIn('r1', 'l1')).toBe('reception:r1:l1:in');
    expect(stockSourceKey.receptionReversal('r1', 'l1')).toBe('reception:r1:l1:reversal');
    expect(stockSourceKey.invoice('f1', 3)).toBe('invoice:f1:3');
    expect(stockSourceKey.voucher('b1', 'x', 'out')).toBe('voucher:b1:x:out');
    expect(stockSourceKey.count('c1', 'y')).toBe('count:c1:y');
  });

  it('clé de code : majuscules sans espaces, vide → null', () => {
    expect(stockCodeKey(' ab 12 ')).toBe('AB12');
    expect(stockCodeKey('   ')).toBeNull();
    expect(stockCodeKey(null)).toBeNull();
  });
});

describe('stocks — briques de schéma', () => {
  it('décimaux canoniques : trois décimales pour les quantités, six pour les coûts', () => {
    expect(canonicalStockDecimal('2.5', 3)).toBe('2.500');
    expect(canonicalStockDecimal('007', 3)).toBe('7.000');
    expect(canonicalStockDecimal('1.2345', 3)).toBeNull();
    expect(canonicalStockDecimal('-1', 3)).toBeNull();
    expect(canonicalStockDecimal('-1', 3, true)).toBe('-1.000');
    expect(canonicalStockDecimal('-0', 3, true)).toBe('0.000');
    expect(StockUnitCost.parse('1')).toBe('1.000000');
    expect(codes(StockUnitCost.safeParse('1.1234567'))).toEqual(['INVALID_UNIT_COST']);
  });

  it('quantités en chaînes, jamais en nombre ; positives ou signées non nulles', () => {
    expect(StockPositiveQuantity.parse('72')).toBe('72.000');
    expect(codes(StockPositiveQuantity.safeParse(72))).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(codes(StockPositiveQuantity.safeParse('0'))).toEqual(['QUANTITY_ZERO']);
    expect(codes(StockPositiveQuantity.safeParse('-1'))).toEqual(['INVALID_QUANTITY']);
    expect(StockSignedQuantity.parse('-72')).toBe('-72.000');
    expect(codes(StockSignedQuantity.safeParse('-0.000'))).toEqual(['QUANTITY_ZERO']);
    expect(codes(StockConversionFactor.safeParse('0'))).toEqual(['QUANTITY_ZERO']);
  });

  it('conversions : cinq au plus, unités distinctes', () => {
    expect(StockUnitConversionsSchema.parse([{ unit: 'carton', factor: '12' }])).toEqual([
      { unit: 'carton', factor: '12.000000' },
    ]);
    expect(
      codes(
        StockUnitConversionsSchema.safeParse([
          { unit: 'carton', factor: '12' },
          { unit: 'Carton', factor: '6' },
        ]),
      ),
    ).toEqual(['UNIT_CONVERSION_DUPLICATE']);
    expect(
      StockUnitConversionsSchema.safeParse(
        Array.from({ length: 6 }, (_, i) => ({ unit: `u${i}`, factor: '1' })),
      ).success,
    ).toBe(false);
  });

  it('seuil strict, identifiants en minuscules, dates réelles', () => {
    expect(
      StockReorderSchema.parse({ minQuantity: '10', targetQuantity: '30', locationId: null }),
    ).toEqual({ minQuantity: '10.000', targetQuantity: '30.000', locationId: null });
    expect(
      StockReorderSchema.safeParse({ minQuantity: '10', locationId: null, extra: 1 }).success,
    ).toBe(false);
    expect(StockId.parse('AAAAAAAAAAAAAAAAAAAAAAAA')).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(StockCalendarDay.safeParse('2026-02-29').success).toBe(false);
    expect(StockCalendarDay.safeParse('2028-02-29').success).toBe(true);
  });
});
