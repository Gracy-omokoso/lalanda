// Contrats des paiements fournisseurs (ADR-0044 § 2.6, § 3.6). ADR-0044 — P5.

import { describe, expect, it } from 'vitest';

import {
  CancelSupplierPaymentBody,
  CreateSupplierPaymentBody,
  PayablesQuery,
  SupplierPaymentFromExpenseBody,
} from './payments.js';

const ID = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const ID2 = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function codes(r: { success: boolean; error?: { issues: { params?: unknown }[] } }): string[] {
  return (r.error?.issues ?? []).map(
    (i) => ((i.params as { code?: string } | undefined)?.code ?? '') as string,
  );
}

describe('CreateSupplierPaymentBody', () => {
  const base = {
    supplierId: ID,
    paidOn: '2026-10-30',
    amount: '500',
    method: 'bank_transfer',
    allocations: [{ invoiceId: ID2, amount: '500.0' }],
  };

  it('canonise les montants et les identifiants', () => {
    const r = CreateSupplierPaymentBody.parse(base);
    expect(r.amount).toBe('500.00');
    expect(r.supplierId).toBe(ID.toLowerCase());
    expect(r.allocations[0]).toEqual({ invoiceId: ID2, amount: '500.00' });
  });

  it('refuse un montant en nombre, un champ inconnu, une facture en double', () => {
    expect(codes(CreateSupplierPaymentBody.safeParse({ ...base, amount: 500 }))).toContain(
      'DECIMAL_MUST_BE_STRING',
    );
    expect(CreateSupplierPaymentBody.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      codes(
        CreateSupplierPaymentBody.safeParse({
          ...base,
          allocations: [
            { invoiceId: ID2, amount: '1.00' },
            { invoiceId: ID2, amount: '2.00' },
          ],
        }),
      ),
    ).toContain('SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE');
  });

  it('exige au moins une imputation (acomptes hors R3)', () => {
    expect(CreateSupplierPaymentBody.safeParse({ ...base, allocations: [] }).success).toBe(false);
  });
});

describe('autres corps', () => {
  it('from-expense exige la révision de la dépense', () => {
    expect(
      SupplierPaymentFromExpenseBody.safeParse({
        expenseId: ID,
        allocations: [{ invoiceId: ID2, amount: '1.00' }],
      }).success,
    ).toBe(false);
  });

  it('annulation : motif obligatoire', () => {
    expect(CancelSupplierPaymentBody.safeParse({ reason: ' ', expectedRevision: 1 }).success).toBe(
      false,
    );
  });

  it('échéancier : date civile valide', () => {
    expect(PayablesQuery.safeParse({ asOf: '2026-02-30' }).success).toBe(false);
    expect(PayablesQuery.parse({})).toEqual({});
  });
});
