// Lecture des commandes pour les réceptions et le rapprochement (ADR-0044 § 2.3,
// § 2.4, § 5). ADR-0044 — P4.
//
// Les demandes et commandes (`purchase_orders`) appartiennent au lot P3. Ce lot n'en
// importe aucun modèle : il les lit par ce PORT, dont le fournisseur par défaut lit la
// collection par la connexion, champ par champ COMME L'ADR LES DÉCRIT (§ 2.3). Si le
// modèle de P3 diverge, seul ce fichier change (ou P3 fournit son propre lecteur sous
// le même jeton).
//
// Seule écriture : le statut DÉRIVÉ des réceptions (`partially_received`,
// `received`), « dénormalisé dans la même transaction » (§ 2.3) — d'où la session.

import type { PurchaseCurrency, PurchaseOrderStatus } from '@lalanda/shared/purchases';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection } from 'mongoose';

export const PURCHASE_ORDERS_READER = Symbol('PURCHASE_ORDERS_READER');

/** Collection du lot P3 (ADR-0044 § 1). */
export const PURCHASE_ORDERS_COLLECTION = 'purchase_orders';

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

export interface PurchaseOrdersReader {
  /** Commandes de l'organisation parmi `ids` (les autres sont absentes : 404 pour l'appelant). */
  findOwn(
    organizationId: string,
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<Map<string, PurchaseOrderFacts>>;
  /**
   * Pose le statut dérivé des réceptions. N'écrit que si le statut courant vaut encore
   * `expectedStatus` (sinon `false` : écriture concurrente).
   */
  setReceptionStatus(
    organizationId: string,
    orderId: string,
    expectedStatus: PurchaseOrderStatus,
    status: PurchaseOrderStatus,
    actorUserId: string,
    session: ClientSession,
  ): Promise<boolean>;
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
export class MongoPurchaseOrdersReader implements PurchaseOrdersReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findOwn(
    organizationId: string,
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<Map<string, PurchaseOrderFacts>> {
    const oids = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const out = new Map<string, PurchaseOrderFacts>();
    if (oids.length === 0) return out;
    const docs = await this.connection
      .collection(PURCHASE_ORDERS_COLLECTION)
      .find({ _id: { $in: oids }, organizationId }, session ? { session } : {})
      .toArray();
    for (const doc of docs) out.set(String(doc._id), orderFactsOf(doc));
    return out;
  }

  async setReceptionStatus(
    organizationId: string,
    orderId: string,
    expectedStatus: PurchaseOrderStatus,
    status: PurchaseOrderStatus,
    actorUserId: string,
    session: ClientSession,
  ): Promise<boolean> {
    if (expectedStatus === status) return true;
    const res = await this.connection.collection(PURCHASE_ORDERS_COLLECTION).updateOne(
      { _id: new Types.ObjectId(orderId), organizationId, status: expectedStatus },
      {
        $set: { status, updatedBy: actorUserId, updatedAt: new Date() },
        $inc: { revision: 1 },
      },
      { session },
    );
    return res.matchedCount === 1;
  }
}
