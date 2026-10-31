// Lecture des réceptions et des commandes d'achat (R3) par le module des stocks
// (ADR-0046 § 6.1). ADR-0046 — S4.
//
// LECTURE SEULE (`ReadOnlyCollection`) : aucun fichier des achats n'est importé ni
// modifié ; seuls les champs dont les stocks ont besoin sont relus (lignes, unité, prix
// HT, remise, devise, projet, `itemRef`, date de réception, statut).

import type { Connection } from 'mongoose';
import type { ObjectId } from 'mongodb';

import { ReadOnlyCollection } from '../links/stock-links.common.js';

export interface ReceptionRead {
  _id: ObjectId;
  organizationId: string;
  orderId: string;
  receivedOn: string;
  status: 'recorded' | 'cancelled';
  lines: { orderLineId: string; quantity: string }[];
  cancellation: { at: Date; by: string; reason: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderLineRead {
  id: string;
  label: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountPercent: string | null;
  kind: 'goods' | 'service';
  receivable: boolean;
  workProjectId: string | null;
  itemRef: string | null;
}

export interface OrderRead {
  _id: ObjectId;
  organizationId: string;
  phase: 'request' | 'order';
  status: string;
  currency: 'CDF' | 'USD';
  sentAt: Date | null;
  lines: OrderLineRead[];
}

/** Commandes dont les quantités restent à recevoir (statuts vivants, § 7.1). */
export const OPEN_ORDER_STATUSES = ['approved', 'sent', 'partially_received'] as const;

export class PurchaseFactsReader {
  private readonly receptions: ReadOnlyCollection<ReceptionRead>;
  private readonly orders: ReadOnlyCollection<OrderRead>;

  constructor(connection: Connection) {
    this.receptions = new ReadOnlyCollection<ReceptionRead>(connection, 'purchase_receptions');
    this.orders = new ReadOnlyCollection<OrderRead>(connection, 'purchase_orders');
  }

  reception(organizationId: string, receptionId: ObjectId): Promise<ReceptionRead | null> {
    return this.receptions.findOne({ _id: receptionId, organizationId });
  }

  /** Réceptions de l'organisation modifiées depuis `since` (rattrapage, § 6.1). */
  receptionsChangedSince(organizationId: string, since: Date): Promise<ReceptionRead[]> {
    return this.receptions.find(
      { organizationId, updatedAt: { $gte: since } },
      { sort: { updatedAt: 1, _id: 1 }, projection: { _id: 1, updatedAt: 1 } },
    );
  }

  order(organizationId: string, orderId: ObjectId): Promise<OrderRead | null> {
    return this.orders.findOne({ _id: orderId, organizationId });
  }

  openOrders(organizationId: string): Promise<OrderRead[]> {
    return this.orders.find({
      organizationId,
      phase: 'order',
      status: { $in: [...OPEN_ORDER_STATUSES] },
    });
  }

  receptionsOf(organizationId: string, orderIds: readonly string[]): Promise<ReceptionRead[]> {
    if (orderIds.length === 0) return Promise.resolve([]);
    return this.receptions.find({ organizationId, orderId: { $in: [...orderIds] } });
  }
}
