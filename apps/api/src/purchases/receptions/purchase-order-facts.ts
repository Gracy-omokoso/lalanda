// Lecture des commandes pour les réceptions et le rapprochement (ADR-0044 § 2.3,
// § 2.4, § 5). ADR-0044 — P4.
//
// Les demandes et commandes (`purchase_orders`) appartiennent au lot P3 : ce lecteur
// les lit par SON modèle (`PurchaseOrder`), en lecture seule, et les ramène aux faits
// dont le moteur a besoin. Seule écriture : le statut DÉRIVÉ des réceptions
// (`partially_received`, `received`), « dénormalisé dans la même transaction »
// (§ 2.3) — d'où la session.

import type { PurchaseCurrency, PurchaseOrderStatus } from '@lalanda/shared/purchases';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Model } from 'mongoose';

import { PurchaseOrder, type PurchaseOrderDocument } from '../orders/purchase-order.schema.js';

export interface PurchaseOrderLineFacts {
  id: string;
  label: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discountPercent: string | null;
  kind: 'goods' | 'service';
  receivable: boolean;
  category: string | null;
  workProjectId: string | null;
  itemRef: string | null;
}

export interface PurchaseOrderFacts {
  id: string;
  supplierId: string | null;
  phase: 'request' | 'order';
  status: PurchaseOrderStatus;
  orderNumber: string | null;
  currency: PurchaseCurrency;
  sentAt: Date | null;
  /** Total TTC à l'approbation complète ; à défaut le total courant. */
  approvedTotal: string;
  lines: PurchaseOrderLineFacts[];
  declaredTaxes: { label: string; amount: string }[];
  revision: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Montant ou quantité tels qu'enregistrés : chaîne, ou nombre ramené en chaîne. */
const dec = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

export function orderFactsOf(doc: Record<string, unknown>): PurchaseOrderFacts {
  const totals = (doc['totals'] ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(doc['lines']) ? (doc['lines'] as Record<string, unknown>[]) : [];
  const taxes = Array.isArray(doc['declaredTaxes'])
    ? (doc['declaredTaxes'] as Record<string, unknown>[])
    : [];
  return {
    id: String(doc['_id']),
    supplierId: str(doc['supplierId']),
    phase: doc['phase'] === 'order' ? 'order' : 'request',
    status: doc['status'] as PurchaseOrderStatus,
    orderNumber: str(doc['orderNumber']),
    currency: doc['currency'] as PurchaseCurrency,
    sentAt: doc['sentAt'] instanceof Date ? doc['sentAt'] : null,
    approvedTotal: dec(doc['approvedTotal']) ?? dec(totals['total']) ?? '0.00',
    lines: lines.map((l) => {
      const kind = l['kind'] === 'service' ? 'service' : 'goods';
      return {
        id: String(l['id']),
        label: str(l['label']) ?? '',
        quantity: dec(l['quantity']) ?? '0',
        unit: str(l['unit']),
        unitPrice: dec(l['unitPrice']) ?? '0.00',
        discountPercent: dec(l['discountPercent']),
        kind,
        receivable: typeof l['receivable'] === 'boolean' ? l['receivable'] : kind === 'goods',
        category: str(l['category']),
        workProjectId: str(l['workProjectId']),
        itemRef: str(l['itemRef']),
      };
    }),
    declaredTaxes: taxes.map((t) => ({
      label: str(t['label']) ?? '',
      amount: dec(t['amount']) ?? '0.00',
    })),
    revision: typeof doc['revision'] === 'number' ? doc['revision'] : 1,
  };
}

@Injectable()
export class PurchaseOrderFactsReader {
  constructor(
    @InjectModel(PurchaseOrder.name) private readonly orders: Model<PurchaseOrderDocument>,
  ) {}

  /** Commandes de l'organisation parmi `ids` (les autres sont absentes : 404 pour l'appelant). */
  async findOwn(
    organizationId: string,
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<Map<string, PurchaseOrderFacts>> {
    const oids = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const out = new Map<string, PurchaseOrderFacts>();
    if (oids.length === 0) return out;
    const docs = await this.orders
      .find({ _id: { $in: oids }, organizationId }, null, session ? { session } : {})
      .lean<Record<string, unknown>[]>()
      .exec();
    for (const doc of docs) out.set(String(doc['_id']), orderFactsOf(doc));
    return out;
  }

  /**
   * Pose le statut dérivé des réceptions. N'écrit que si le statut courant vaut encore
   * `expectedStatus` (sinon `false` : écriture concurrente).
   */
  async setReceptionStatus(
    organizationId: string,
    orderId: string,
    expectedStatus: PurchaseOrderStatus,
    status: PurchaseOrderStatus,
    actorUserId: string,
    session: ClientSession,
  ): Promise<boolean> {
    if (expectedStatus === status) return true;
    const res = await this.orders
      .updateOne(
        { _id: new Types.ObjectId(orderId), organizationId, status: expectedStatus },
        { $set: { status, updatedBy: actorUserId }, $inc: { revision: 1 } },
        { session },
      )
      .exec();
    return res.matchedCount === 1;
  }
}
