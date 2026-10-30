// Données d'essai partagées par les tests des modèles des achats.

import type { PurchaseOrderView } from '@/lib/api-purchases';

export function commande(over: Partial<PurchaseOrderView> = {}): PurchaseOrderView {
  return {
    id: 'o1',
    phase: 'request',
    status: 'submitted',
    requestNumber: 'DA2610-000001',
    orderNumber: null,
    requestedBy: 'u-demandeur',
    createdBy: 'u-demandeur',
    title: 'Fournitures',
    justification: null,
    supplierId: 's1',
    supplierName: 'Socimex',
    currency: 'USD',
    lines: [],
    declaredTaxes: [],
    totals: { subtotal: '800.00', taxes: '0.00', total: '800.00' },
    expectedOn: null,
    deliveryAddress: null,
    requiredApprovals: 1,
    approvals: [],
    approvedTotal: null,
    sentAt: null,
    sentVia: null,
    cancellation: null,
    revision: 2,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T09:00:00.000Z',
    ...over,
  };
}
