// Bon de commande imprimé — ADR-0044 § 3.3 (critère 6). ADR-0044 — P3.

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import { DocumentNotPrintableError } from '../../sales/documents/invoice-document.model.js';
import type { PurchaseOrderLean } from '../orders/purchase-order.schema.js';
import {
  PURCHASE_ORDER_NOTICE,
  buildPurchaseOrderDocument,
  paymentTermsLabel,
  type PurchaseOrderDocumentContext,
} from './purchase-order-document.model.js';

function commande(over: Partial<PurchaseOrderLean> = {}): PurchaseOrderLean {
  const at = new Date('2026-10-30T09:00:00Z');
  return {
    _id: new Types.ObjectId(),
    organizationId: 'org',
    phase: 'order',
    status: 'approved',
    requestNumber: 'DA2610-000001',
    orderNumber: 'BC2610-000001',
    requestedBy: 'u1',
    title: 'Fournitures',
    justification: null,
    supplierId: 's1',
    supplierName: 'Socimex SARL',
    currency: 'USD',
    lines: [
      {
        id: 'l1',
        label: 'Ramettes A4',
        quantity: '10',
        unit: 'carton',
        unitPrice: '5.00',
        discountPercent: '10',
        kind: 'goods',
        receivable: true,
        category: 'achats',
        workProjectId: null,
        itemRef: null,
        amount: '45.00',
      },
    ],
    declaredTaxes: [{ label: 'TVA', amount: '7.20' }],
    totals: { subtotal: '45.00', taxes: '7.20', total: '52.20', engineVersion: '1.0.0' },
    expectedOn: '2026-11-15',
    deliveryAddress: null,
    requiredApprovals: 1,
    approvals: [],
    approvedTotal: '52.20',
    submittedAt: at,
    submittedOn: '2026-10-30',
    approvedAt: at,
    sentAt: null,
    sentVia: null,
    cancellation: null,
    closedAt: null,
    revision: 3,
    createdBy: 'u1',
    updatedBy: 'u2',
    _schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

const ctx: PurchaseOrderDocumentContext = {
  buyer: {
    legalName: 'Lalanda Démo SARL',
    tradeName: null,
    nif: 'A1234567B',
    rccm: null,
    address: '1, boulevard du 30 Juin, Kinshasa',
    phone: null,
    email: null,
    vatRegistered: true,
  },
  organizationName: 'Lalanda Démo',
  supplier: {
    name: 'Socimex SARL',
    nif: 'F12345',
    address: 'Gombe',
    phone: null,
    email: null,
    paymentTerms: { kind: 'end_of_month', days: 30 },
  },
  softwareVersion: '0.9.0',
  layout: null,
};

describe('bon de commande imprimé (ADR-0044 § 3.3)', () => {
  it('numéro BC, mention fixe, fournisseur destinataire, organisation émettrice', () => {
    const m = buildPurchaseOrderDocument(commande(), ctx);
    expect(m.title).toBe('BON DE COMMANDE');
    expect(m.kind).toBe('proforma');
    expect(m.reference).toEqual({ label: 'Bon de commande n°', value: 'BC2610-000001' });
    expect(m.stateMentions).toContain(PURCHASE_ORDER_NOTICE);
    expect(PURCHASE_ORDER_NOTICE).toBe('Bon de commande — ce document n’est pas une facture');
    expect(m.seller.title).toBe('Lalanda Démo SARL');
    expect(m.customer).toEqual({
      title: 'Socimex SARL',
      lines: ['Fournisseur', 'NIF : F12345', 'Gombe'],
    });
    expect(m.fileName).toBe('BC2610-000001.pdf');
  });

  it('montants du moteur mis en forme, taxes telles que déclarées, ni QR ni sécurité DGI', () => {
    const m = buildPurchaseOrderDocument(commande(), ctx);
    expect(m.lines[0]).toMatchObject({ amount: '45,00', modification: 'Remise 10 %' });
    expect(m.htTotal).toBe('45,00');
    expect(m.vatTotal).toBe('7,20');
    expect(m.total).toBe('52,20');
    expect(m.security).toBeNull();
    expect(m.test).toBeNull();
    expect(m.payments).toEqual([]);
    expect(m.comments).toEqual(
      expect.arrayContaining([
        'Adresse de livraison : 1, boulevard du 30 Juin, Kinshasa',
        'Livraison souhaitée le 15/11/2026',
        'Conditions de paiement : Paiement fin de mois + 30 jours',
        'Taxes telles qu’indiquées par le fournisseur : TVA 7,20',
      ]),
    );
  });

  it('une demande non approuvée n’a pas de bon de commande', () => {
    expect(() =>
      buildPurchaseOrderDocument(commande({ phase: 'request', orderNumber: null }), ctx),
    ).toThrow(DocumentNotPrintableError);
  });

  it('commande annulée : mentionnée', () => {
    const m = buildPurchaseOrderDocument(commande({ status: 'cancelled' }), ctx);
    expect(m.stateMentions).toContain('Commande annulée');
  });

  it('conditions de paiement lisibles', () => {
    expect(paymentTermsLabel({ kind: 'immediate' })).toBe('Paiement à réception de la facture');
    expect(paymentTermsLabel({ kind: 'net', days: 30 })).toBe(
      'Paiement à 30 jours date de facture',
    );
    expect(paymentTermsLabel({ kind: 'end_of_month', days: 0 })).toBe('Paiement fin de mois');
  });
});
