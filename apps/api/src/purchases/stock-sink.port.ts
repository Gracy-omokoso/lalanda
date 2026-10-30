// Accroche des stocks (ADR-0044 § 6.6). ADR-0044 — P4.
//
// Aucune quantité n'est tenue en R3. Chaque réception enregistrée ou annulée appelle,
// APRÈS sa transaction, `onReceptionChanged` ; le fournisseur est NUL en R3. R5
// branchera le sien (article de stock porté par `itemRef`) sans toucher aux achats.
// Une erreur du fournisseur est journalisée par l'appelant, jamais remontée.

export const PURCHASE_RECEPTION_SINK = Symbol('PURCHASE_RECEPTION_SINK');

export interface PurchaseReceptionChange {
  organizationId: string;
  receptionId: string;
  status: 'recorded' | 'cancelled';
  lines: { orderLineId: string; itemRef: string | null; quantity: string; unit: string | null }[];
}

export interface PurchaseReceptionSink {
  onReceptionChanged(change: PurchaseReceptionChange): Promise<void>;
}

export const noPurchaseReceptionSink: PurchaseReceptionSink = {
  onReceptionChanged: async () => undefined,
};
