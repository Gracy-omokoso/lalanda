// Réceptions — ADR-0044 § 2.4, § 3.4, § 6.6. ADR-0044 — P4.
//
// Une réception se constate sur une commande vivante (`approved` non envoyée : livraison
// sur appel, `sent`, `partially_received`, `received` — un excédent est un écart, pas un
// refus). Le statut de la commande est DÉRIVÉ des réceptions par le moteur
// (`orderReceptionStatus`) et dénormalisé DANS LA MÊME TRANSACTION que la réception
// (§ 2.3), par le lecteur des commandes (`PurchaseOrderFactsReader`, modèle de P3). Après la transaction : port de stock
// (nul en R3) et rapprochement des brouillons de facture qui visent la commande.
//
// Isolation : commande, ligne de commande et réception d'une autre organisation → 404.

import { orderReceptionStatus, type OrderReceptionStatus } from '@lalanda/engine';
import type {
  CreatePurchaseReceptionBody,
  ListPurchaseReceptionsQuery,
  PurchaseReceptionPage,
  PurchaseReceptionView,
  PurchaseReceptionWriteResult,
} from '@lalanda/shared/purchases';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { invalidCursor, staleRevision } from '../../sales/sales.errors.js';
import {
  PurchaseAttachmentsService,
  attachmentNotFound,
  attachmentViewOf,
  type AcceptedPurchaseAttachment,
  type PurchaseAttachmentDoc,
} from '../attachments/purchase-attachments.js';
import {
  assertNotFuture,
  badRequest,
  beforeKeyCursor,
  conflict,
  decodeKeyCursor,
  encodeKeyCursor,
  isOid,
  notFound,
  oid,
  orderLineNotFound,
  orderNotFound,
  type PurchaseActor,
} from '../invoices/purchase-p4.common.js';
import { SupplierInvoicesService } from '../invoices/supplier-invoices.service.js';
import {
  PURCHASE_RECEPTION_SINK,
  noPurchaseReceptionSink,
  type PurchaseReceptionSink,
} from '../stock-sink.port.js';
import { PurchaseOrderFactsReader, type PurchaseOrderFacts } from './purchase-order-facts.js';
import {
  PurchaseReception,
  type PurchaseReceptionDocument,
  type PurchaseReceptionLean,
} from './reception.schema.js';

/** Statuts d'une commande qui accepte une réception (§ 2.4). */
const RECEIVABLE_ORDER_STATUSES = new Set(['approved', 'sent', 'partially_received', 'received']);

@Injectable()
export class PurchaseReceptionsService {
  private readonly logger = new Logger('PurchaseReceptions');
  private readonly sink: PurchaseReceptionSink;

  constructor(
    @InjectModel(PurchaseReception.name)
    private readonly receptions: Model<PurchaseReceptionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(PurchaseOrderFactsReader) private readonly orders: PurchaseOrderFactsReader,
    @Inject(SupplierInvoicesService) private readonly invoices: SupplierInvoicesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PurchaseAttachmentsService) private readonly attachments: PurchaseAttachmentsService,
    @Inject(PURCHASE_RECEPTION_SINK) sink: PurchaseReceptionSink | null,
  ) {
    this.sink = sink ?? noPurchaseReceptionSink;
  }

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListPurchaseReceptionsQuery,
  ): Promise<PurchaseReceptionPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.orderId) and.push({ orderId: query.orderId });
    if (query.from) and.push({ receivedOn: { $gte: query.from } });
    if (query.to) and.push({ receivedOn: { $lte: query.to } });
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeKeyCursor('receivedOn', cursor));
    }
    const docs = await this.receptions
      .find({ $and: and })
      .sort({ receivedOn: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<PurchaseReceptionLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const orders = await this.orders.findOwn(organizationId, [
      ...new Set(page.map((d) => d.orderId)),
    ]);
    return {
      items: page.map((d) => viewOf(d, orders.get(d.orderId))),
      nextCursor:
        docs.length > query.limit && last
          ? encodeKeyCursor(last.receivedOn, String(last._id))
          : null,
    };
  }

  async get(organizationId: string, receptionId: string): Promise<PurchaseReceptionView> {
    const doc = await this.requireOwn(organizationId, receptionId);
    const order = (await this.orders.findOwn(organizationId, [doc.orderId])).get(doc.orderId);
    return viewOf(doc, order);
  }

  /** Réceptions d'une commande (fiche de la commande, § 3.2), annulées comprises. */
  async forOrder(organizationId: string, order: PurchaseOrderFacts): Promise<PurchaseReceptionView[]> {
    const docs = await this.receptions
      .find({ organizationId, orderId: order.id })
      .sort({ receivedOn: 1, _id: 1 })
      .lean<PurchaseReceptionLean[]>()
      .exec();
    return docs.map((d) => viewOf(d, order));
  }

  /** Faits d'une commande de l'organisation, ou `null`. */
  async orderFacts(organizationId: string, orderId: string): Promise<PurchaseOrderFacts | null> {
    return (await this.orders.findOwn(organizationId, [orderId])).get(orderId) ?? null;
  }

  private async requireOwn(
    organizationId: string,
    receptionId: string,
    session?: ClientSession,
  ): Promise<PurchaseReceptionLean> {
    if (!isOid(receptionId)) receptionNotFound();
    const doc = await this.receptions
      .findOne({ _id: oid(receptionId), organizationId }, null, session ? { session } : {})
      .lean<PurchaseReceptionLean>()
      .exec();
    if (!doc) receptionNotFound();
    return doc;
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreatePurchaseReceptionBody,
    actor: PurchaseActor,
  ): Promise<PurchaseReceptionWriteResult> {
    const order = (await this.orders.findOwn(organizationId, [body.orderId])).get(body.orderId);
    if (!order) orderNotFound();
    if (order.phase !== 'order' || !RECEIVABLE_ORDER_STATUSES.has(order.status)) {
      conflict(
        'PURCHASE_ORDER_NOT_RECEIVABLE',
        'Seule une commande approuvée, non clôturée ni annulée, se réceptionne.',
        { status: order.status },
      );
    }
    assertNotFuture(body.receivedOn, 'receivedOn');
    const lineIds = new Set(order.lines.map((l) => l.id));
    const seen = new Set<string>();
    for (const line of body.lines) {
      if (!lineIds.has(line.orderLineId)) orderLineNotFound();
      if (seen.has(line.orderLineId)) {
        badRequest('DUPLICATE_LINE', 'Une ligne de commande figure deux fois.', {
          orderLineId: line.orderLineId,
        });
      }
      seen.add(line.orderLineId);
    }

    const { reception, status } = await this.inTransaction(async (session) => {
      const [created] = await this.receptions.create(
        [
          {
            organizationId,
            orderId: order.id,
            supplierId: order.supplierId,
            receivedOn: body.receivedOn,
            lines: body.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })),
            deliveryNoteRef: body.deliveryNoteRef ?? null,
            note: body.note ?? null,
            attachment: null,
            status: 'recorded',
            cancellation: null,
            revision: 1,
            createdBy: actor.userId,
            updatedBy: actor.userId,
            _schemaVersion: 1,
          },
        ],
        { session },
      );
      const id = String(created!._id);
      const status = await this.deriveOrderStatus(organizationId, order, actor.userId, session);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'purchase_reception.recorded',
          targetType: 'purchase_reception',
          targetId: id,
          metadata: {
            orderId: order.id,
            lines: body.lines.length,
            orderStatus: status.status,
            orderWasSent: order.sentAt !== null,
          },
        },
        { session },
      );
      return { reception: await this.requireOwn(organizationId, id, session), status };
    });
    await this.afterChange(organizationId, reception, order, actor.userId);
    return { reception: viewOf(reception, order), order: orderView(order.id, status) };
  }

  async cancel(
    organizationId: string,
    receptionId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<PurchaseReceptionWriteResult> {
    const current = await this.requireOwn(organizationId, receptionId);
    if (current.status === 'cancelled') {
      conflict('PURCHASE_RECEPTION_CANCELLED', 'Cette réception est déjà annulée.');
    }
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const order = (await this.orders.findOwn(organizationId, [current.orderId])).get(
      current.orderId,
    );
    if (!order) orderNotFound();
    const { reception, status } = await this.inTransaction(async (session) => {
      const updated = await this.receptions
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision, status: 'recorded' },
          {
            $set: {
              status: 'cancelled',
              cancellation: { at: new Date(), by: actor.userId, reason },
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<PurchaseReceptionLean>()
        .exec();
      if (!updated) staleRevision((await this.requireOwn(organizationId, receptionId)).revision);
      const status = await this.deriveOrderStatus(organizationId, order, actor.userId, session);
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'purchase_reception.cancelled',
          targetType: 'purchase_reception',
          targetId: receptionId,
          metadata: { orderId: order.id, reason, orderStatus: status.status },
        },
        { session },
      );
      return { reception: updated, status };
    });
    await this.afterChange(organizationId, reception, order, actor.userId);
    return { reception: viewOf(reception, order), order: orderView(order.id, status) };
  }

  // ── Pièce jointe (§ 2.7) ─────────────────────────────────────────────────

  async assertAttachable(organizationId: string, receptionId: string): Promise<void> {
    const doc = await this.requireOwn(organizationId, receptionId);
    if (doc.status === 'cancelled') {
      conflict('PURCHASE_RECEPTION_CANCELLED', 'Cette réception est annulée.');
    }
  }

  async uploadAttachment(
    organizationId: string,
    receptionId: string,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    actor: PurchaseActor,
  ): Promise<PurchaseReceptionView> {
    const current = await this.requireOwn(organizationId, receptionId);
    if (current.status === 'cancelled') {
      conflict('PURCHASE_RECEPTION_CANCELLED', 'Cette réception est annulée.');
    }
    const stored = await this.attachments.store(
      organizationId,
      file,
      rawFileName,
      actor.userId,
      current.attachment?.size ?? 0,
    );
    const updated = await this.receptions
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'recorded' },
        { $set: { attachment: stored, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<PurchaseReceptionLean>()
      .exec();
    if (!updated) {
      await this.attachments.drop(stored.objectId);
      conflict('PURCHASE_RECEPTION_CANCELLED', 'Cette réception est annulée.');
    }
    if (current.attachment) await this.attachments.drop(current.attachment.objectId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'purchase_reception.attachment_added',
      targetType: 'purchase_reception',
      targetId: receptionId,
      metadata: { contentType: stored.contentType, size: stored.size, sha256: stored.sha256 },
    });
    const order = (await this.orders.findOwn(organizationId, [updated.orderId])).get(
      updated.orderId,
    );
    return viewOf(updated, order);
  }

  async readAttachment(
    organizationId: string,
    receptionId: string,
  ): Promise<{ meta: PurchaseAttachmentDoc; body: Buffer }> {
    const doc = await this.requireOwn(organizationId, receptionId);
    if (!doc.attachment) attachmentNotFound();
    const body = await this.attachments.read(doc.attachment);
    if (!body) attachmentNotFound();
    return { meta: doc.attachment, body };
  }

  // ── Interne ──────────────────────────────────────────────────────────────

  /** Statut dérivé des réceptions non annulées (moteur), posé dans la transaction. */
  private async deriveOrderStatus(
    organizationId: string,
    order: PurchaseOrderFacts,
    actorUserId: string,
    session: ClientSession,
  ): Promise<OrderReceptionStatus> {
    const all = await this.receptions
      .find({ organizationId, orderId: order.id }, null, { session })
      .lean<PurchaseReceptionLean[]>()
      .exec();
    const status = orderReceptionStatus(
      {
        status: order.status,
        sent: order.sentAt !== null,
        lines: order.lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          receivable: l.receivable,
        })),
      },
      all.map((r) => ({
        id: String(r._id),
        status: r.status,
        lines: r.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })),
      })),
    );
    const written = await this.orders.setReceptionStatus(
      organizationId,
      order.id,
      order.status,
      status.status,
      actorUserId,
      session,
    );
    if (!written) {
      conflict(
        'STALE_REVISION',
        'La commande a changé entre-temps : rechargez-la avant d’enregistrer la réception.',
      );
    }
    return status;
  }

  /** Après la transaction : port de stock (nul en R3), puis rapprochement des brouillons. */
  private async afterChange(
    organizationId: string,
    reception: PurchaseReceptionLean,
    order: PurchaseOrderFacts,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.sink.onReceptionChanged({
        organizationId,
        receptionId: String(reception._id),
        status: reception.status,
        lines: reception.lines.map((l) => {
          const line = order.lines.find((o) => o.id === l.orderLineId);
          return {
            orderLineId: l.orderLineId,
            itemRef: line?.itemRef ?? null,
            quantity: l.quantity,
            unit: line?.unit ?? null,
          };
        }),
      });
    } catch (err) {
      this.logger.warn(
        `Port de stock en échec (réception ${String(reception._id)}) : ${(err as Error).message}`,
      );
    }
    await this.invoices.refreshDrafts(organizationId, [order.id], actorUserId);
  }

  private async inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      await session.endSession();
    }
  }
}

function receptionNotFound(): never {
  notFound('PURCHASE_RECEPTION_NOT_FOUND', 'Réception introuvable.');
}

function orderView(
  orderId: string,
  status: OrderReceptionStatus,
): PurchaseReceptionWriteResult['order'] {
  return {
    id: orderId,
    status: status.status,
    lines: status.lines.map((l) => ({
      orderLineId: l.orderLineId,
      receivable: l.receivable,
      ordered: l.ordered,
      received: l.received,
      remaining: l.remaining,
      overReceived: l.overReceived,
    })),
  };
}

function viewOf(d: PurchaseReceptionLean, order?: PurchaseOrderFacts): PurchaseReceptionView {
  return {
    id: String(d._id),
    orderId: d.orderId,
    orderNumber: order?.orderNumber ?? null,
    supplierId: d.supplierId ?? order?.supplierId ?? '',
    receivedOn: d.receivedOn,
    lines: d.lines.map((l) => {
      const line = order?.lines.find((o) => o.id === l.orderLineId);
      return {
        orderLineId: l.orderLineId,
        label: line?.label ?? null,
        unit: line?.unit ?? null,
        quantity: l.quantity,
      };
    }),
    deliveryNoteRef: d.deliveryNoteRef ?? null,
    note: d.note ?? null,
    attachment: attachmentViewOf(d.attachment),
    status: d.status,
    cancellation: d.cancellation
      ? {
          at: new Date(d.cancellation.at).toISOString(),
          by: d.cancellation.by,
          reason: d.cancellation.reason,
        }
      : null,
    revision: d.revision,
    createdBy: d.createdBy,
    createdAt: new Date(d.createdAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
