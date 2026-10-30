// Contrats des demandes, commandes et réglages — ADR-0044 § 2.2, § 2.3. ADR-0044 — P3.

import { describe, expect, it } from 'vitest';

import {
  ApprovePurchaseOrderBody,
  CancelPurchaseOrderBody,
  CreatePurchaseOrderBody,
  ListPurchaseOrdersQuery,
  PurchaseDiscountPercent,
  RejectPurchaseOrderBody,
  UpdatePurchaseOrderBody,
  UpdatePurchaseSettingsBody,
  purchasesAgendaHref,
  purchasesAgendaId,
} from './index.js';

type Issues = { issues: { params?: { code?: string }; message: string }[] };
const codes = (r: { success: boolean; error?: unknown }): string[] =>
  r.success ? [] : (r.error as Issues).issues.map((i) => i.params?.code ?? i.message);

const ligne = { label: 'Ramettes A4', quantity: '10', unitPrice: '5.00', kind: 'goods' };

describe('demandes et commandes — corps (ADR-0044 § 2.3)', () => {
  it('accepte le corps minimal du web et canonise montants et quantités', () => {
    const r = CreatePurchaseOrderBody.parse({
      title: ' Fournitures ',
      currency: 'USD',
      lines: [{ ...ligne, quantity: '10.500', unitPrice: '5.5', unit: null }],
      declaredTaxes: [{ label: 'TVA', amount: '8' }],
      supplierId: null,
      justification: null,
    });
    expect(r.title).toBe('Fournitures');
    expect(r.lines[0]).toMatchObject({ quantity: '10.5', unitPrice: '5.50', unit: null });
    expect(r.declaredTaxes![0]!.amount).toBe('8.00');
  });

  it('refuse un montant en nombre, une quantité nulle, une clé inconnue', () => {
    expect(
      codes(
        CreatePurchaseOrderBody.safeParse({
          title: 'x',
          currency: 'USD',
          lines: [{ ...ligne, unitPrice: 5 }],
        }),
      ),
    ).toContain('DECIMAL_MUST_BE_STRING');
    expect(
      codes(
        CreatePurchaseOrderBody.safeParse({
          title: 'x',
          currency: 'USD',
          lines: [{ ...ligne, quantity: '0' }],
        }),
      ),
    ).toContain('QUANTITY_NOT_POSITIVE');
    expect(
      CreatePurchaseOrderBody.safeParse({ title: 'x', currency: 'USD', lines: [ligne], foo: 1 })
        .success,
    ).toBe(false);
  });

  it('exige au moins une ligne et une devise CDF ou USD', () => {
    expect(
      CreatePurchaseOrderBody.safeParse({ title: 'x', currency: 'USD', lines: [] }).success,
    ).toBe(false);
    expect(
      CreatePurchaseOrderBody.safeParse({ title: 'x', currency: 'EUR', lines: [ligne] }).success,
    ).toBe(false);
  });

  it('remise : 0 à 100, deux décimales', () => {
    expect(PurchaseDiscountPercent.parse('12.5')).toBe('12.5');
    expect(PurchaseDiscountPercent.parse('')).toBeNull();
    expect(codes(PurchaseDiscountPercent.safeParse('100.01'))).toEqual(['DISCOUNT_INVALID']);
    expect(codes(PurchaseDiscountPercent.safeParse('5.123'))).toEqual(['DISCOUNT_INVALID']);
  });

  it('modification : révision attendue obligatoire', () => {
    expect(
      UpdatePurchaseOrderBody.safeParse({ title: 'x', currency: 'USD', lines: [ligne] }).success,
    ).toBe(false);
  });

  it('refus et annulation : motif obligatoire ; approbation : commentaire facultatif', () => {
    expect(
      codes(RejectPurchaseOrderBody.safeParse({ comment: ' ', expectedRevision: 2 })),
    ).toContain('FIELD_REQUIRED');
    expect(CancelPurchaseOrderBody.safeParse({ expectedRevision: 2 }).success).toBe(false);
    expect(ApprovePurchaseOrderBody.parse({ expectedRevision: 2 }).comment).toBeUndefined();
  });

  it('liste : filtres fermés, `requestedBy=me` permis', () => {
    expect(ListPurchaseOrdersQuery.parse({ requestedBy: 'me' }).limit).toBe(50);
    expect(ListPurchaseOrdersQuery.safeParse({ status: 'payée' }).success).toBe(false);
  });
});

describe('réglages des achats — corps (ADR-0044 § 2.2)', () => {
  it('paliers par devise, 0 à 2 approbations', () => {
    const r = UpdatePurchaseSettingsBody.parse({
      approvalTiers: {
        CDF: [{ from: '0', approvals: 1 }],
        USD: [
          { from: '0', approvals: 0 },
          { from: '500', approvals: 1 },
          { from: '5000', approvals: 2 },
        ],
      },
      expectedRevision: 0,
    });
    expect(r.approvalTiers!.USD[2]).toEqual({ from: '5000.00', approvals: 2 });
    expect(
      UpdatePurchaseSettingsBody.safeParse({
        approvalTiers: { CDF: [{ from: '0', approvals: 3 }], USD: [{ from: '0', approvals: 1 }] },
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });

  it('tolérance de prix bornée à 10 %', () => {
    const base = { amountAbsolute: { CDF: '0', USD: '0' } };
    expect(
      UpdatePurchaseSettingsBody.safeParse({
        matchingTolerances: { ...base, pricePercent: '10' },
        expectedRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      codes(
        UpdatePurchaseSettingsBody.safeParse({
          matchingTolerances: { ...base, pricePercent: '10.5' },
          expectedRevision: 1,
        }),
      ),
    ).toContain('PRICE_PERCENT_INVALID');
  });
});

describe('« Mes tâches » — approbations (ADR-0044 § 6.5)', () => {
  it('identifiant préfixé et lien vers la demande', () => {
    expect(purchasesAgendaId('abc')).toBe('purchases:abc');
    expect(purchasesAgendaHref('abc')).toBe('/achats/commandes/abc');
  });
});
