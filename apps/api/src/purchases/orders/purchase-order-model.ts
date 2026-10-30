// Règles pures des demandes et commandes — ADR-0044 § 2.3. ADR-0044 — P3.
//
// Aucune base, aucune horloge : vue servie à l'API, statuts qui permettent chaque
// geste, filtre « demandes que cet utilisateur peut approuver » (partagé par
// `GET /purchases/approvals/pending` et « Mes tâches »). La séparation des tâches
// elle-même est décidée par `purchaseApprovalDecision` (`authz/permissions.ts`).

import type { PurchaseOrderStatus, PurchaseOrderView } from '@lalanda/shared/purchases';

import type { PurchaseOrderLean } from './purchase-order.schema.js';

/** Statuts dont le CONTENU se modifie (§ 2.3) ; au-delà : on annule et on refait. */
export const EDITABLE_STATUSES: readonly PurchaseOrderStatus[] = ['draft', 'submitted', 'approved'];

/** Annulable « à tout moment avant `received` » (§ 2.3). */
export const CANCELLABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'draft',
  'submitted',
  'approved',
  'sent',
  'partially_received',
];

/** Clôture du reste à recevoir (§ 3.2). */
export const CLOSABLE_STATUSES: readonly PurchaseOrderStatus[] = ['partially_received', 'received'];

/** Bon de commande imprimable : une commande (numéro `BC`). */
export function isPrintableOrder(o: Pick<PurchaseOrderLean, 'phase' | 'orderNumber'>): boolean {
  return o.phase === 'order' && typeof o.orderNumber === 'string';
}

/** Envoyable au fournisseur (§ 3.3) : `approved` et `sent`. */
export const SENDABLE_STATUSES: readonly PurchaseOrderStatus[] = ['approved', 'sent'];

/**
 * Échappatoire « approbateur unique » (§ 2.3) : le réglage la permet et
 * l'organisation compte un seul détenteur EFFECTIF de `purchase.approve`.
 */
export function isSoleApproverOrg(allowSoleApprover: boolean, approverCount: number): boolean {
  return allowSoleApprover && approverCount <= 1;
}

/**
 * Filtre Mongo des demandes `submitted` que `userId` peut approuver : ni demandeur
 * ni créateur (sauf approbateur unique), sans approbation de sa part déjà portée.
 * La détention de `purchase.approve` est vérifiée par l'appelant.
 */
export function approvableFilter(
  organizationId: string,
  userId: string,
  soleApproverOrg: boolean,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    organizationId,
    status: 'submitted',
    'approvals.userId': { $ne: userId },
  };
  if (!soleApproverOrg) filter['$nor'] = [{ requestedBy: userId }, { createdBy: userId }];
  return filter;
}

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

export function purchaseOrderView(d: PurchaseOrderLean): PurchaseOrderView {
  return {
    id: String(d._id),
    phase: d.phase,
    status: d.status,
    requestNumber: d.requestNumber ?? null,
    orderNumber: d.orderNumber ?? null,
    requestedBy: d.requestedBy,
    createdBy: d.createdBy,
    title: d.title,
    justification: d.justification ?? null,
    supplierId: d.supplierId ?? null,
    supplierName: d.supplierName ?? null,
    currency: d.currency,
    lines: d.lines.map((l) => ({
      id: l.id,
      label: l.label,
      quantity: l.quantity,
      unit: l.unit ?? null,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? null,
      kind: l.kind,
      receivable: l.receivable,
      category: l.category ?? null,
      workProjectId: l.workProjectId ?? null,
      itemRef: l.itemRef ?? null,
      amount: l.amount,
    })),
    declaredTaxes: (d.declaredTaxes ?? []).map((t) => ({ label: t.label, amount: t.amount })),
    totals: { subtotal: d.totals.subtotal, taxes: d.totals.taxes, total: d.totals.total },
    expectedOn: d.expectedOn ?? null,
    deliveryAddress: d.deliveryAddress ?? null,
    requiredApprovals: d.requiredApprovals ?? null,
    approvals: (d.approvals ?? []).map((a) => ({
      userId: a.userId,
      decision: a.decision,
      at: new Date(a.at).toISOString(),
      comment: a.comment ?? null,
      soleApprover: a.soleApprover === true,
    })),
    approvedTotal: d.approvedTotal ?? null,
    submittedAt: iso(d.submittedAt),
    approvedAt: iso(d.approvedAt),
    sentAt: iso(d.sentAt),
    sentVia: d.sentVia ?? null,
    cancellation: d.cancellation
      ? {
          at: new Date(d.cancellation.at).toISOString(),
          by: d.cancellation.by,
          reason: d.cancellation.reason,
        }
      : null,
    closedAt: iso(d.closedAt),
    revision: d.revision,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
