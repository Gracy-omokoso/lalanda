import { describe, expect, it } from 'vitest';

import {
  CreateSupplierBody,
  CreateSupplierPaymentMethodBody,
  ListSuppliersQuery,
  MergeSupplierBody,
  PURCHASE_BLOCKING_VARIANCE_CODES,
  PURCHASE_CURRENCIES,
  PURCHASE_NUMBER_PATTERN,
  PURCHASE_NUMBER_PREFIXES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_SETTINGS_DEFAULTS,
  PURCHASE_VARIANCE_CODES,
  PurchaseAmount,
  PurchaseCalendarDay,
  PurchasePositiveAmount,
  PurchaseQuantity,
  SupplierPaymentTerms,
  UpdateSupplierBody,
  UpdateSupplierPaymentMethodBody,
  isPurchaseCalendarDay,
  normalizeSupplierNif,
  supplierReferenceKey,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

describe('achats — constantes (ADR-0044 § 1 et § 2)', () => {
  it('devises de la trésorerie, sans autre', () => {
    expect([...PURCHASE_CURRENCIES]).toEqual(['CDF', 'USD']);
  });

  it('statuts du cycle demande puis commande', () => {
    expect([...PURCHASE_ORDER_STATUSES]).toEqual([
      'draft',
      'submitted',
      'approved',
      'rejected',
      'sent',
      'partially_received',
      'received',
      'closed',
      'cancelled',
    ]);
  });

  it('numéros DA, BC, FF, PF au format `{P}{AA}{MM}-NNNNNN`', () => {
    expect(PURCHASE_NUMBER_PREFIXES).toEqual({
      request: 'DA',
      order: 'BC',
      invoice: 'FF',
      payment: 'PF',
    });
    for (const ok of ['DA2610-000001', 'BC2612-123456', 'FF2601-000042', 'PF2611-999999']) {
      expect(PURCHASE_NUMBER_PATTERN.test(ok), ok).toBe(true);
    }
    for (const ko of ['DV2610-000001', 'BC2613-000001', 'BC2610-00001', 'bc2610-000001']) {
      expect(PURCHASE_NUMBER_PATTERN.test(ko), ko).toBe(false);
    }
  });

  it('valeurs par défaut des réglages : une approbation par devise, tolérances nulles', () => {
    expect(PURCHASE_SETTINGS_DEFAULTS.approvalTiers).toEqual({
      CDF: [{ from: '0', approvals: 1 }],
      USD: [{ from: '0', approvals: 1 }],
    });
    expect(PURCHASE_SETTINGS_DEFAULTS.allowSoleApprover).toBe(true);
    expect(PURCHASE_SETTINGS_DEFAULTS.matchingTolerances).toEqual({
      pricePercent: '0',
      amountAbsolute: { CDF: '0', USD: '0' },
    });
    expect(PURCHASE_SETTINGS_DEFAULTS.dueSoonDays).toBe(7);
    expect(PURCHASE_SETTINGS_DEFAULTS.requireOrderForInvoice).toBe(false);
    expect(PURCHASE_SETTINGS_DEFAULTS.paymentDetailsAlertDays).toBe(7);
    expect(Object.isFrozen(PURCHASE_SETTINGS_DEFAULTS.approvalTiers.USD)).toBe(true);
  });

  it('écarts : les bloquants de l’ADR, et `TAXES_DIFFER_FROM_ORDER` en information', () => {
    expect([...PURCHASE_BLOCKING_VARIANCE_CODES]).toEqual([
      'PRICE_ABOVE_ORDER',
      'QUANTITY_ABOVE_ORDER',
      'QUANTITY_ABOVE_RECEIVED',
      'LINE_NOT_ON_ORDER',
      'TOTAL_ABOVE_ORDER',
    ]);
    expect(PURCHASE_VARIANCE_CODES).toContain('TAXES_DIFFER_FROM_ORDER');
    expect(PURCHASE_BLOCKING_VARIANCE_CODES as readonly string[]).not.toContain(
      'TAXES_DIFFER_FROM_ORDER',
    );
  });

  it('critère 9 — « fa-001 » et « FA 001 » ont la même clé de référence', () => {
    expect(supplierReferenceKey('fa-001')).toBe(supplierReferenceKey('FA 001'));
    expect(supplierReferenceKey('FA 001')).toBe('FA001');
    expect(supplierReferenceKey('FA-002')).not.toBe(supplierReferenceKey('FA 001'));
  });

  it('NIF normalisé comme celui de l’organisation', () => {
    expect(normalizeSupplierNif(' a12-34 5b ')).toBe('A12345B');
  });
});

describe('achats — briques communes', () => {
  it('montants en chaînes, canoniques, deux décimales au plus', () => {
    expect(PurchasePositiveAmount.parse('12.5')).toBe('12.50');
    expect(PurchasePositiveAmount.parse('0007')).toBe('7.00');
    expect(PurchaseAmount.parse('0')).toBe('0.00');
    expect(codes(PurchasePositiveAmount.safeParse('0.00'))).toEqual(['AMOUNT_NOT_POSITIVE']);
    expect(codes(PurchasePositiveAmount.safeParse(12.5))).toEqual(['DECIMAL_MUST_BE_STRING']);
    expect(codes(PurchasePositiveAmount.safeParse('1.234'))).toEqual(['INVALID_AMOUNT']);
    expect(codes(PurchasePositiveAmount.safeParse('-1'))).toEqual(['INVALID_AMOUNT']);
    expect(codes(PurchasePositiveAmount.safeParse('1,5'))).toEqual(['INVALID_AMOUNT']);
  });

  it('quantités : strictement positives, trois décimales au plus', () => {
    expect(PurchaseQuantity.parse('10')).toBe('10');
    expect(PurchaseQuantity.parse('2.500')).toBe('2.5');
    expect(codes(PurchaseQuantity.safeParse('0'))).toEqual(['QUANTITY_NOT_POSITIVE']);
    expect(codes(PurchaseQuantity.safeParse('1.2345'))).toEqual(['QUANTITY_INVALID']);
    expect(codes(PurchaseQuantity.safeParse(3))).toEqual(['QUANTITY_INVALID']);
  });

  it('dates civiles réelles, années bissextiles comprises', () => {
    expect(isPurchaseCalendarDay('2028-02-29')).toBe(true);
    expect(isPurchaseCalendarDay('2026-02-29')).toBe(false);
    expect(isPurchaseCalendarDay('2026-13-01')).toBe(false);
    expect(PurchaseCalendarDay.safeParse('2026-10-30').success).toBe(true);
    expect(codes(PurchaseCalendarDay.safeParse('30/10/2026'))).toEqual(['INVALID_DATE']);
  });
});

describe('achats — fournisseurs (ADR-0044 § 2.1, § 3.1)', () => {
  it('création minimale ; corps strict', () => {
    expect(CreateSupplierBody.parse({ name: '  Socimex  ' })).toEqual({ name: 'Socimex' });
    expect(CreateSupplierBody.safeParse({ name: 'X', autre: 1 }).success).toBe(false);
    expect(codes(CreateSupplierBody.safeParse({ name: '  ' }))).toEqual(['FIELD_REQUIRED']);
  });

  it('NIF facultatif, normalisé, forme seulement', () => {
    expect(CreateSupplierBody.parse({ name: 'S', nif: 'a 123-45' }).nif).toBe('A12345');
    expect(CreateSupplierBody.parse({ name: 'S', nif: '' }).nif).toBeNull();
    expect(codes(CreateSupplierBody.safeParse({ name: 'S', nif: 'AB1' }))).toEqual(['NIF_INVALID']);
  });

  it('un seul contact principal ; dix contacts au plus', () => {
    const c = { name: 'Awa', isPrimary: true };
    expect(CreateSupplierBody.safeParse({ name: 'S', contacts: [c] }).success).toBe(true);
    expect(codes(CreateSupplierBody.safeParse({ name: 'S', contacts: [c, c] }))).toEqual([
      'SUPPLIER_CONTACT_PRIMARY_DUPLICATE',
    ]);
    const onze = Array.from({ length: 11 }, (_, i) => ({ name: `C${i}` }));
    expect(CreateSupplierBody.safeParse({ name: 'S', contacts: onze }).success).toBe(false);
  });

  it('conditions de paiement : immédiat, net 1–180, fin de mois 0–180', () => {
    expect(SupplierPaymentTerms.safeParse({ kind: 'immediate' }).success).toBe(true);
    expect(SupplierPaymentTerms.safeParse({ kind: 'net', days: 30 }).success).toBe(true);
    expect(SupplierPaymentTerms.safeParse({ kind: 'net', days: 0 }).success).toBe(false);
    expect(SupplierPaymentTerms.safeParse({ kind: 'end_of_month', days: 0 }).success).toBe(true);
    expect(SupplierPaymentTerms.safeParse({ kind: 'end_of_month', days: 181 }).success).toBe(false);
  });

  it('mise à jour et fusion exigent la révision ; identifiant ramené en minuscules', () => {
    expect(UpdateSupplierBody.safeParse({ name: 'S' }).success).toBe(false);
    expect(UpdateSupplierBody.safeParse({ expectedRevision: 2, name: 'S' }).success).toBe(true);
    expect(
      MergeSupplierBody.parse({
        targetSupplierId: 'ABCDEF0123456789ABCDEF01',
        expectedRevision: 1,
      }),
    ).toEqual({ targetSupplierId: 'abcdef0123456789abcdef01', expectedRevision: 1 });
  });

  it('moyen de paiement bancaire : forme seulement, IBAN et SWIFT normalisés', () => {
    const r = CreateSupplierPaymentMethodBody.parse({
      kind: 'bank',
      label: 'Compte principal',
      details: {
        bankName: 'Rawbank',
        accountHolder: 'Socimex SARL',
        accountNumber: '0501-2345-4521',
        iban: 'cd08 0001 2345',
        swift: 'rawbcdki',
      },
      expectedRevision: 3,
    });
    expect(r.kind === 'bank' && r.details.iban).toBe('CD0800012345');
    expect(r.kind === 'bank' && r.details.swift).toBe('RAWBCDKI');
    expect(r.isDefault).toBe(false);
  });

  it('mobile money : opérateur, numéro, titulaire ; corps strict', () => {
    const ok = {
      kind: 'mobile_money',
      label: 'M-Pesa',
      details: { operator: 'M-Pesa', phoneNumber: '+243 81 234 5678', holderName: 'Awa' },
      expectedRevision: 1,
    };
    expect(CreateSupplierPaymentMethodBody.safeParse(ok).success).toBe(true);
    expect(
      CreateSupplierPaymentMethodBody.safeParse({ ...ok, details: { ...ok.details, pin: '1' } })
        .success,
    ).toBe(false);
    expect(CreateSupplierPaymentMethodBody.safeParse({ ...ok, kind: 'crypto' }).success).toBe(
      false,
    );
    expect(UpdateSupplierPaymentMethodBody.safeParse({ label: 'X' }).success).toBe(false);
  });

  it('liste : filtres connus, limite bornée', () => {
    expect(ListSuppliersQuery.parse({ active: 'false' })).toEqual({ active: false, limit: 50 });
    expect(ListSuppliersQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListSuppliersQuery.safeParse({ autre: '1' }).success).toBe(false);
  });
});
