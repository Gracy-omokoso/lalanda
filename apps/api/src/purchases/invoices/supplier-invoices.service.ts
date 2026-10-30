// Factures fournisseurs et rapprochement — ADR-0044 § 2.5, § 3.5, § 5. ADR-0044 — P4.
//
// Tous les montants viennent du moteur (`@lalanda/engine`, module `purchases`) :
// lignes et sous-total (`computeOrderTotals`), addition du total
// (`checkInvoiceTotal`), imputations (`checkCostAllocations`), échéance
// (`dueDateOf`), rapprochement (`matchInvoice`), reste à facturer
// (`orderRemainingToInvoice`), reste à payer (`payableSettlement`, `payablesAging`).
// Ce service ne fait que lire, contrôler l'appartenance et écrire.
//
// Isolation : toute ressource d'une autre organisation répond 404, y compris par
// identifiant forgé dans un corps (`supplierId`, `orderIds`, `orderLineId`,
// `creditedInvoiceId`, `workProjectId`).
//
// Rapprochement : recalculé à chaque écriture d'un BROUILLON (la facture, une
// réception, une autre facture qui se valide ou s'annule sur la même commande) ;
// FIGÉ à la validation — la décision (validée, ou forcée avec motif) porte sur ce
// qui a été montré. Une facture en écart bloquant ne se valide que forcée par un
// détenteur de `purchase.approve`, qui n'en est pas le créateur (sauf approbateur
// unique), motif journalisé STRICTEMENT dans la même transaction.
//
// Les commandes (lot P3) sont lues sur leur modèle (`PurchaseOrderFactsReader`), les
// réglages par `PurchaseSettingsService`, les numéros `FF` par `PurchaseCountersService`
// (lot P3) ; les paiements (lot P5) par la connexion (`supplier_payments`, ADR § 2.6).

import {
  EXPENSE_CATEGORY_CODES,
  checkCostAllocations,
  checkInvoiceTotal,
  computeOrderTotals,
  dueDateOf,
  matchInvoice,
  orderRemainingToInvoice,
  type MatchInvoiceInput,
  type MatchOrderInput,
  type PaymentTerms,
} from '@lalanda/engine';
import {
  supplierReferenceKey,
  type CreateSupplierInvoiceBody,
  type ListSupplierInvoicesQuery,
  type SupplierInvoiceListItem,
  type SupplierInvoicePage,
  type SupplierInvoicePrefill,
  type SupplierInvoiceView,
} from '@lalanda/shared/purchases';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { AuthzService } from '../../authz/authz.service.js';
import { purchaseApprovalDecision } from '../../authz/permissions.js';
import { invalidCursor, isDuplicateKey, staleRevision } from '../../sales/sales.errors.js';
import {
  PurchaseAttachmentsService,
  attachmentNotFound,
  attachmentViewOf,
  type AcceptedPurchaseAttachment,
  type PurchaseAttachmentDoc,
} from '../attachments/purchase-attachments.js';
import {
  PurchaseOrderFactsReader,
  type PurchaseOrderFacts,
} from '../receptions/purchase-order-facts.js';
import { PurchaseReception, type PurchaseReceptionLean } from '../receptions/reception.schema.js';
import { PurchaseCountersService } from '../counters/purchase-counters.service.js';
import { PurchaseSettingsService } from '../settings/purchase-settings.service.js';
import { supplierArchived } from '../suppliers/suppliers.errors.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
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
  todayInKinshasa,
  type PurchaseActor,
} from './purchase-p4.common.js';
import {
  SupplierInvoice,
  type CostAllocation,
  type StoredMatching,
  type SupplierInvoiceDocument,
  type SupplierInvoiceLean,
  type SupplierInvoiceLine,
} from './supplier-invoice.schema.js';
import {
  NO_DEBT,
  SupplierInvoiceSettlements,
  type Settlement,
} from './supplier-invoice-settlements.js';
import { SupplierInvoicesNotifier } from './supplier-invoices-notifier.js';

/** Collections lues par la connexion (autres lots). */
const PAYMENTS = 'supplier_payments';
const SUPPLIERS = 'suppliers';
const WORK_PROJECTS = 'work_projects';

/** Une commande se facture dès son approbation complète, et jusqu'après sa clôture. */
const INVOICEABLE_ORDER_STATUSES = new Set([
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
]);

const CATEGORIES = new Set<string>(EXPENSE_CATEGORY_CODES as readonly string[]);
const DAY_MS = 86_400_000;

/** Réglages lus (lot P3), défauts de l'ADR § 2.2 sinon. */
export interface InvoiceSettings {
  pricePercent: string;
  amountAbsolute: { CDF?: string; USD?: string };
  dueSoonDays: number;
  requireOrderForInvoice: boolean;
  allowSoleApprover: boolean;
}

/** Champs composés d'une facture (création ou mise à jour d'un brouillon). */
type Composed = Pick<
  SupplierInvoice,
  | 'supplierId'
  | 'supplierReference'
  | 'kind'
  | 'creditedInvoiceId'
  | 'invoiceDate'
  | 'receivedOn'
  | 'dueDate'
  | 'currency'
  | 'orderIds'
  | 'lines'
  | 'subtotal'
  | 'taxes'
  | 'total'
  | 'deductibleVat'
  | 'costAllocations'
  | 'matching'
> & { supplierReferenceKey: string };

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Compare deux montants décimaux canoniques (aucun montant n'est produit : une
 * borne seulement, § 2.5 « deductibleVat ≤ Σ taxes »).
 */
function centsCompare(a: string, b: string): number {
  // Deux montants CANONIQUES (`"12.50"`, schémas partagés et sorties du moteur).
  const x = BigInt(a.replace('.', ''));
  const y = BigInt(b.replace('.', ''));
  return x < y ? -1 : x > y ? 1 : 0;
}

export function matchingViewOf(m: StoredMatching): SupplierInvoiceView['matching'] {
  return {
    version: m.version,
    mode: m.mode,
    status: m.status,
    variances: (m.variances ?? []) as unknown as SupplierInvoiceView['matching']['variances'],
    lines: (m.lines ?? []) as unknown as SupplierInvoiceView['matching']['lines'],
  };
}

@Injectable()
export class SupplierInvoicesService {
  constructor(
    @InjectModel(SupplierInvoice.name) private readonly invoices: Model<SupplierInvoiceDocument>,
    @InjectModel(PurchaseReception.name)
    private readonly receptions: Model<PurchaseReception>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(PurchaseOrderFactsReader) private readonly orders: PurchaseOrderFactsReader,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(PurchaseAttachmentsService) private readonly attachments: PurchaseAttachmentsService,
    @Inject(SupplierInvoicesNotifier) private readonly notifier: SupplierInvoicesNotifier,
    @Inject(PurchaseSettingsService) private readonly purchaseSettings: PurchaseSettingsService,
    @Inject(PurchaseCountersService) private readonly counters: PurchaseCountersService,
    @Inject(SupplierInvoiceSettlements) private readonly settlements: SupplierInvoiceSettlements,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(
    organizationId: string,
    query: ListSupplierInvoicesQuery,
    now = new Date(),
  ): Promise<SupplierInvoicePage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status) and.push({ status: query.status });
    if (query.supplierId) and.push({ supplierId: query.supplierId });
    if (query.orderId) and.push({ orderIds: query.orderId });
    if (query.matching) and.push({ 'matching.status': query.matching });
    if (query.disputed !== undefined) {
      and.push(query.disputed ? { disputed: { $ne: null } } : { disputed: null });
    }
    const today = todayInKinshasa(now);
    if (query.due === 'overdue' || query.due === 'soon') {
      and.push({ status: 'validated', kind: 'invoice' });
      if (query.due === 'overdue') and.push({ dueDate: { $lt: today } });
      else {
        const settings = await this.settings(organizationId);
        and.push({ dueDate: { $gte: today, $lte: addDays(today, settings.dueSoonDays) } });
      }
    }
    if (query.cursor !== undefined) {
      const cursor = decodeKeyCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeKeyCursor('invoiceDate', cursor));
    }
    const docs = await this.invoices
      .find({ $and: and })
      .sort({ invoiceDate: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<SupplierInvoiceLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    const settlements = await this.settlementsOf(organizationId, page);
    const names = await this.supplierNames(
      organizationId,
      page.map((d) => d.supplierId),
    );
    let items = page.map((d) =>
      this.listItemOf(d, settlements.get(String(d._id)) ?? NO_DEBT, names),
    );
    // Une facture soldée n'est ni en retard ni à payer bientôt.
    if (query.due === 'overdue' || query.due === 'soon') {
      items = items.filter((i) => i.remaining !== '0.00');
    }
    return {
      items,
      nextCursor:
        docs.length > query.limit && last
          ? encodeKeyCursor(last.invoiceDate, String(last._id))
          : null,
    };
  }

  /** Factures qui visent une commande (fiche de la commande, § 3.2), annulées comprises. */
  async forOrder(organizationId: string, orderId: string): Promise<SupplierInvoiceListItem[]> {
    const docs = await this.invoices
      .find({ organizationId, orderIds: orderId })
      .sort({ invoiceDate: 1, _id: 1 })
      .lean<SupplierInvoiceLean[]>()
      .exec();
    const settlements = await this.settlementsOf(organizationId, docs);
    const names = await this.supplierNames(
      organizationId,
      docs.map((d) => d.supplierId),
    );
    return docs.map((d) => this.listItemOf(d, settlements.get(String(d._id)) ?? NO_DEBT, names));
  }

  async get(organizationId: string, invoiceId: string): Promise<SupplierInvoiceView> {
    const doc = await this.requireOwn(organizationId, invoiceId);
    return this.viewOf(organizationId, doc);
  }

  async requireOwn(
    organizationId: string,
    invoiceId: string,
    session?: ClientSession,
  ): Promise<SupplierInvoiceLean> {
    if (!isOid(invoiceId)) this.invoiceNotFound();
    const doc = await this.invoices
      .findOne({ _id: oid(invoiceId), organizationId }, null, session ? { session } : {})
      .lean<SupplierInvoiceLean>()
      .exec();
    if (!doc) this.invoiceNotFound();
    return doc;
  }

  /**
   * Préremplissage d'une facture depuis une commande (§ 3.5) : lignes au reste à
   * facturer (moteur, factures VALIDÉES de la commande). Rien n'est enregistré.
   */
  async prefillFromOrder(organizationId: string, orderId: string): Promise<SupplierInvoicePrefill> {
    const order = (await this.orders.findOwn(organizationId, [orderId])).get(orderId);
    if (!order) orderNotFound();
    this.assertInvoiceable(order);
    const validated = await this.invoices
      .find({ organizationId, status: 'validated', kind: 'invoice', orderIds: orderId })
      .lean<SupplierInvoiceLean[]>()
      .exec();
    const remaining = orderRemainingToInvoice(
      {
        currency: order.currency,
        lines: order.lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          receivable: l.receivable,
          category: l.category,
          workProjectId: l.workProjectId,
        })),
      },
      validated.map((v) => ({
        id: String(v._id),
        status: v.status,
        kind: v.kind,
        lines: v.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })),
      })),
    );
    const supplier = order.supplierId
      ? await this.suppliers.requireOwn(organizationId, order.supplierId).catch(() => null)
      : null;
    const lines = remaining.lines
      .filter((l) => l.remainingQuantity !== '0')
      .map((l) => {
        const line = order.lines.find((o) => o.id === l.orderLineId)!;
        return {
          orderLineId: line.id,
          label: line.label,
          quantity: l.remainingQuantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          category: line.category ?? supplier?.defaultCategory ?? null,
          workProjectId: line.workProjectId,
        };
      });
    // Une imputation par couple (catégorie, projet) ; montant HT rendu par le moteur.
    const groups = new Map<string, typeof lines>();
    for (const l of lines) {
      const key = `${l.category ?? ''}|${l.workProjectId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    return {
      supplierId: order.supplierId ?? '',
      currency: order.currency,
      orderIds: [order.id],
      lines: lines.map(({ category: _c, workProjectId: _w, ...l }) => l),
      subtotal: computeOrderTotals(lines, []).subtotal,
      costAllocations: [...groups.values()].map((g) => ({
        category: g[0]!.category,
        workProjectId: g[0]!.workProjectId,
        amount: computeOrderTotals(g, []).subtotal,
      })),
      remainingToInvoice: remaining.remainingAmount,
    };
  }

  // ── Écriture ─────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreateSupplierInvoiceBody,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const composed = await this.compose(organizationId, body, null);
    await this.assertNoDuplicate(
      organizationId,
      composed.supplierId,
      composed.supplierReferenceKey,
      null,
    );
    // `FF{AA}{MM}-NNNNNN`, compteur annuel au jour de Kinshasa, trous admis (§ 2.5).
    const internalNumber = await this.counters.next(organizationId, 'invoice', new Date());
    let created: SupplierInvoiceDocument;
    try {
      created = await this.invoices.create({
        organizationId,
        internalNumber,
        ...composed,
        attachment: null,
        status: 'draft',
        forcedValidation: null,
        disputed: null,
        validatedAt: null,
        validatedBy: null,
        cancellation: null,
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        _schemaVersion: 1,
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        await this.assertNoDuplicate(
          organizationId,
          composed.supplierId,
          composed.supplierReferenceKey,
          null,
        );
      }
      throw err;
    }
    const id = String(created._id);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.created',
      targetType: 'supplier_invoice',
      targetId: id,
      metadata: {
        internalNumber,
        kind: composed.kind,
        currency: composed.currency,
        total: composed.total,
        matching: composed.matching.status,
      },
    });
    const doc = await this.requireOwn(organizationId, id);
    if (doc.matching.status === 'variance') await this.notifyVariance(doc, actor.userId);
    return this.viewOf(organizationId, doc);
  }

  async update(
    organizationId: string,
    invoiceId: string,
    body: CreateSupplierInvoiceBody & { expectedRevision: number },
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertDraft(current);
    if (current.revision !== body.expectedRevision) staleRevision(current.revision);
    const { expectedRevision, ...input } = body;
    const composed = await this.compose(organizationId, input, current);
    await this.assertNoDuplicate(
      organizationId,
      composed.supplierId,
      composed.supplierReferenceKey,
      current._id,
    );
    let updated: SupplierInvoiceLean | null;
    try {
      updated = await this.invoices
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision, status: 'draft' },
          { $set: { ...composed, updatedBy: actor.userId }, $inc: { revision: 1 } },
          { new: true },
        )
        .lean<SupplierInvoiceLean>()
        .exec();
    } catch (err) {
      if (isDuplicateKey(err)) {
        await this.assertNoDuplicate(
          organizationId,
          composed.supplierId,
          composed.supplierReferenceKey,
          current._id,
        );
      }
      throw err;
    }
    if (!updated) staleRevision((await this.requireOwn(organizationId, invoiceId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.updated',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { total: composed.total, matching: composed.matching.status },
    });
    if (updated.matching.status === 'variance' && current.matching.status !== 'variance') {
      await this.notifyVariance(updated, actor.userId);
    }
    return this.viewOf(organizationId, updated);
  }

  /** `draft` → `validated` sans écart bloquant (§ 5.3) ; sinon 409 avec les écarts. */
  async validate(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertDraft(current);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    this.assertNotDisputed(current);
    await this.assertCreditNoteTarget(organizationId, current);
    const matching = await this.matchingOf(organizationId, current);
    if (matching.status === 'variance') {
      await this.invoices
        .updateOne({ _id: current._id, organizationId, status: 'draft' }, { $set: { matching } })
        .exec();
      if (current.matching.status !== 'variance') {
        await this.notifyVariance(current, actor.userId);
      }
      conflict(
        'SUPPLIER_INVOICE_VARIANCE',
        'Cette facture s’écarte de la commande ou de la réception : corrigez-la, mettez-la en litige, ou faites-la forcer par un approbateur.',
        { variances: matching.variances.filter((v) => v['blocking'] === true) },
      );
    }
    const updated = await this.invoices
      .findOneAndUpdate(
        { _id: current._id, organizationId, revision: expectedRevision, status: 'draft' },
        {
          $set: {
            status: 'validated',
            matching,
            validatedAt: new Date(),
            validatedBy: actor.userId,
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<SupplierInvoiceLean>()
      .exec();
    if (!updated) staleRevision((await this.requireOwn(organizationId, invoiceId)).revision);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.validated',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { matching: matching.status, mode: matching.mode, total: updated.total },
    });
    await this.refreshDrafts(organizationId, updated.orderIds, actor.userId);
    return this.viewOf(organizationId, updated);
  }

  /**
   * Validation malgré un écart bloquant (§ 5.3) : `purchase.approve` (garde), motif,
   * séparation des tâches (`purchaseApprovalDecision` : le créateur ne force pas sa
   * facture, sauf approbateur unique), audit STRICT avec les écarts, dans la même
   * transaction que l'écriture.
   */
  async forceValidate(
    organizationId: string,
    invoiceId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertDraft(current);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    this.assertNotDisputed(current);
    const matching = await this.matchingOf(organizationId, current);
    if (matching.status !== 'variance') {
      conflict(
        'SUPPLIER_INVOICE_NOT_IN_VARIANCE',
        'Cette facture ne présente aucun écart bloquant : validez-la normalement.',
      );
    }
    const settings = await this.settings(organizationId);
    const decision = purchaseApprovalDecision({
      decision: 'approve',
      approverUserId: actor.userId,
      requestedBy: current.createdBy,
      createdBy: current.createdBy,
      priorApproverUserIds: [],
      requiredApprovals: 1,
      approverCountInOrg: await this.authz.countApprovers(organizationId, 'purchase.approve'),
      allowSoleApprover: settings.allowSoleApprover,
    });
    if (!decision.ok) {
      conflict(
        decision.code,
        'Le créateur d’une facture ne la force pas lui-même : un autre approbateur doit le faire.',
      );
    }
    const at = new Date();
    const blocking = matching.variances.filter((v) => v['blocking'] === true);
    const updated = await this.inTransaction(async (session) => {
      const doc = await this.invoices
        .findOneAndUpdate(
          { _id: current._id, organizationId, revision: expectedRevision, status: 'draft' },
          {
            $set: {
              status: 'validated',
              matching,
              forcedValidation: {
                by: actor.userId,
                at,
                reason,
                soleApprover: decision.soleApprover,
              },
              validatedAt: at,
              validatedBy: actor.userId,
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .lean<SupplierInvoiceLean>()
        .exec();
      if (!doc) staleRevision((await this.requireOwn(organizationId, invoiceId, session)).revision);
      await this.audit.recordStrict(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'supplier_invoice.force_validated',
          targetType: 'supplier_invoice',
          targetId: invoiceId,
          metadata: {
            reason,
            soleApprover: decision.soleApprover,
            createdBy: current.createdBy,
            variances: blocking.map((v) => ({
              code: String(v['code']),
              orderLineId: (v['orderLineId'] as string | null) ?? null,
              expected: String(v['expected']),
              actual: String(v['actual']),
              difference: String(v['difference']),
            })),
          },
        },
        { session },
      );
      return doc;
    });
    await this.refreshDrafts(organizationId, updated.orderIds, actor.userId);
    return this.viewOf(organizationId, updated);
  }

  /** Litige (§ 2.5) : bloque la validation et le paiement ; visible dans l'échéancier. */
  async dispute(
    organizationId: string,
    invoiceId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertNotCancelled(current);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    this.assertNotDisputed(current);
    const updated = await this.writeRevision(current, expectedRevision, {
      disputed: { by: actor.userId, at: new Date(), reason, soleApprover: false },
      updatedBy: actor.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.disputed',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { reason },
    });
    return this.viewOf(organizationId, updated);
  }

  async resolveDispute(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertNotCancelled(current);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    if (!current.disputed) {
      conflict('SUPPLIER_INVOICE_NOT_DISPUTED', 'Cette facture n’est pas en litige.');
    }
    const updated = await this.writeRevision(current, expectedRevision, {
      disputed: null,
      updatedBy: actor.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.dispute_resolved',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { disputedReason: current.disputed.reason },
    });
    return this.viewOf(organizationId, updated);
  }

  /** Annulation (motif) ; refusée si un paiement non annulé l'impute. */
  async cancel(
    organizationId: string,
    invoiceId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertNotCancelled(current);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    const paid = await this.connection.collection(PAYMENTS).countDocuments({
      organizationId,
      status: { $ne: 'cancelled' },
      'allocations.invoiceId': invoiceId,
    });
    if (paid > 0) {
      conflict(
        'SUPPLIER_INVOICE_PAID',
        'Un paiement est imputé à cette facture : annulez d’abord le paiement.',
      );
    }
    const updated = await this.writeRevision(current, expectedRevision, {
      status: 'cancelled',
      supplierReferenceKey: null,
      cancellation: { at: new Date(), by: actor.userId, reason },
      updatedBy: actor.userId,
    });
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.cancelled',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { reason, previousStatus: current.status },
    });
    if (current.status === 'validated') {
      await this.refreshDrafts(organizationId, current.orderIds, actor.userId);
    }
    return this.viewOf(organizationId, updated);
  }

  // ── Pièce jointe (§ 2.7) ─────────────────────────────────────────────────

  /** Facture qui peut recevoir une pièce : vérifié AVANT de lire le corps. */
  async assertAttachable(organizationId: string, invoiceId: string): Promise<void> {
    this.assertNotCancelled(await this.requireOwn(organizationId, invoiceId));
  }

  async uploadAttachment(
    organizationId: string,
    invoiceId: string,
    file: AcceptedPurchaseAttachment,
    rawFileName: unknown,
    actor: PurchaseActor,
  ): Promise<SupplierInvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    this.assertNotCancelled(current);
    const stored = await this.attachments.store(
      organizationId,
      file,
      rawFileName,
      actor.userId,
      current.attachment?.size ?? 0,
    );
    const updated = await this.invoices
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: { $ne: 'cancelled' } },
        { $set: { attachment: stored, updatedBy: actor.userId }, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SupplierInvoiceLean>()
      .exec();
    if (!updated) {
      await this.attachments.drop(stored.objectId);
      this.assertNotCancelled({ ...current, status: 'cancelled' });
    }
    if (current.attachment) await this.attachments.drop(current.attachment.objectId);
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'supplier_invoice.attachment_added',
      targetType: 'supplier_invoice',
      targetId: invoiceId,
      metadata: { contentType: stored.contentType, size: stored.size, sha256: stored.sha256 },
    });
    return this.viewOf(organizationId, updated!);
  }

  async readAttachment(
    organizationId: string,
    invoiceId: string,
  ): Promise<{ meta: PurchaseAttachmentDoc; body: Buffer }> {
    const doc = await this.requireOwn(organizationId, invoiceId);
    if (!doc.attachment) attachmentNotFound();
    const body = await this.attachments.read(doc.attachment);
    if (!body) attachmentNotFound();
    return { meta: doc.attachment, body };
  }

  // ── Rapprochement ────────────────────────────────────────────────────────

  /**
   * Recalcule le rapprochement des BROUILLONS qui visent l'une de ces commandes
   * (après une réception, une validation ou une annulation ; le lot P3 l'appelle après
   * une écriture de commande). Le rapprochement est une sortie dérivée : la révision
   * du brouillon ne change pas. Notifie une entrée en écart.
   */
  async refreshDrafts(
    organizationId: string,
    orderIds: readonly string[],
    actorUserId: string,
  ): Promise<void> {
    if (orderIds.length === 0) return;
    const drafts = await this.invoices
      .find({ organizationId, status: 'draft', orderIds: { $in: [...orderIds] } })
      .lean<SupplierInvoiceLean[]>()
      .exec();
    for (const draft of drafts) {
      const matching = await this.matchingOf(organizationId, draft);
      if (JSON.stringify(matching) === JSON.stringify(draft.matching)) continue;
      await this.invoices
        .updateOne({ _id: draft._id, organizationId, status: 'draft' }, { $set: { matching } })
        .exec();
      if (matching.status === 'variance' && draft.matching.status !== 'variance') {
        await this.notifyVariance(draft, actorUserId);
      }
    }
  }

  /** Rapprochement d'une facture par le moteur (§ 5), contre l'état courant de la base. */
  private async matchingOf(
    organizationId: string,
    invoice: Pick<
      SupplierInvoiceLean,
      'kind' | 'status' | 'currency' | 'orderIds' | 'lines' | 'taxes' | 'total'
    > & { _id?: Types.ObjectId },
  ): Promise<StoredMatching> {
    const selfId = invoice._id ? String(invoice._id) : 'nouvelle';
    const input: MatchInvoiceInput = {
      id: selfId,
      kind: invoice.kind,
      status: invoice.status,
      currency: invoice.currency,
      orderIds: invoice.orderIds,
      lines: invoice.lines.map((l) => ({
        orderLineId: l.orderLineId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      taxes: invoice.taxes.map((t) => ({ label: t.label, amount: t.amount })),
      total: invoice.total,
    };
    let orders: MatchOrderInput[] = [];
    let others: MatchInvoiceInput[] = [];
    let receptions: PurchaseReceptionLean[] = [];
    if (invoice.kind === 'invoice' && invoice.orderIds.length > 0) {
      const validated = await this.invoices
        .find({
          organizationId,
          status: 'validated',
          kind: 'invoice',
          orderIds: { $in: invoice.orderIds },
          ...(invoice._id ? { _id: { $ne: invoice._id } } : {}),
        })
        .lean<SupplierInvoiceLean[]>()
        .exec();
      const orderIds = new Set(invoice.orderIds);
      for (const v of validated) for (const id of v.orderIds) orderIds.add(id);
      const facts = await this.orders.findOwn(organizationId, [...orderIds]);
      orders = [...facts.values()].map(matchOrderOf);
      // Une facture validée dont une commande aurait disparu ne peut pas être comparée.
      others = validated
        .filter((v) => v.orderIds.every((id) => facts.has(id)))
        .map((v) => ({
          id: String(v._id),
          kind: v.kind,
          status: v.status,
          currency: v.currency,
          orderIds: v.orderIds,
          lines: v.lines.map((l) => ({
            orderLineId: l.orderLineId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
          })),
          taxes: v.taxes.map((t) => ({ label: t.label, amount: t.amount })),
          total: v.total,
        }));
      receptions = await this.receptions
        .find({ organizationId, orderId: { $in: invoice.orderIds }, status: 'recorded' })
        .lean<PurchaseReceptionLean[]>()
        .exec();
    }
    const settings = await this.settings(organizationId);
    const result = matchInvoice({
      orders,
      receptions: receptions.map((r) => ({
        id: String(r._id),
        orderId: r.orderId,
        status: r.status,
        lines: r.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })),
      })),
      invoices: others,
      invoice: input,
      tolerances: { pricePercent: settings.pricePercent, amountAbsolute: settings.amountAbsolute },
    });
    return {
      version: result.version,
      mode: result.mode,
      status: result.status,
      variances: result.variances as unknown as Record<string, unknown>[],
      lines: result.lines as unknown as Record<string, unknown>[],
    };
  }

  // ── Reste à payer (§ 2.6, moteur `payableSettlement`) ────────────────────

  /**
   * Règlement de chaque facture VALIDÉE : paiements non annulés (`supplier_payments`,
   * lot P5) et avoirs validés imputés. Une facture non validée ou un avoir ne portent
   * pas de dette.
   */
  async settlementsOf(
    organizationId: string,
    docs: readonly Pick<SupplierInvoiceLean, '_id' | 'status' | 'kind' | 'total'>[],
  ): Promise<Map<string, Settlement>> {
    return this.settlements.of(organizationId, docs);
  }

  // ── Composition et contrôles ─────────────────────────────────────────────

  private async compose(
    organizationId: string,
    body: CreateSupplierInvoiceBody,
    current: SupplierInvoiceLean | null,
  ): Promise<Composed> {
    const supplier = await this.suppliers.requireUsable(organizationId, body.supplierId);
    if (!supplier.active && current?.supplierId !== body.supplierId) supplierArchived();
    const kind = body.kind ?? 'invoice';
    const orderIds = body.orderIds ?? [];
    const settings = await this.settings(organizationId);

    // Dates (§ 2.5) : jamais futures ; échéance déduite des conditions (moteur).
    const now = new Date();
    assertNotFuture(body.invoiceDate, 'invoiceDate', now);
    const receivedOn = body.receivedOn ?? todayInKinshasa(now);
    assertNotFuture(receivedOn, 'receivedOn', now);
    const terms = (supplier.paymentTerms ?? { kind: 'immediate' }) as PaymentTerms;
    const dueDate = body.dueDate ?? dueDateOf(terms, body.invoiceDate).dueDate;
    if (dueDate < body.invoiceDate) {
      badRequest(
        'SUPPLIER_INVOICE_DUE_BEFORE_INVOICE',
        'L’échéance ne peut pas précéder la date de la facture.',
      );
    }

    // Avoir : imputé à une facture du même fournisseur et de la même devise.
    let creditedInvoiceId: string | null = null;
    if (kind === 'credit_note') {
      if (orderIds.length > 0) {
        badRequest('SUPPLIER_CREDIT_NOTE_WITH_ORDERS', 'Un avoir ne vise pas de commande.');
      }
      if (!body.creditedInvoiceId) {
        badRequest(
          'SUPPLIER_CREDIT_NOTE_TARGET_REQUIRED',
          'Un avoir est imputé à une facture du fournisseur.',
        );
      }
      const target = await this.requireOwn(organizationId, body.creditedInvoiceId);
      if (
        target.kind !== 'invoice' ||
        target.status === 'cancelled' ||
        target.supplierId !== body.supplierId ||
        target.currency !== body.currency
      ) {
        conflict(
          'SUPPLIER_CREDIT_NOTE_TARGET_MISMATCH',
          'Un avoir s’impute à une facture non annulée du même fournisseur et de la même devise.',
        );
      }
      creditedInvoiceId = String(target._id);
    } else if (body.creditedInvoiceId) {
      badRequest('SUPPLIER_CREDIT_NOTE_TARGET_REQUIRED', 'Seul un avoir vise une facture.');
    }
    if (kind === 'invoice' && orderIds.length === 0 && settings.requireOrderForInvoice) {
      conflict(
        'SUPPLIER_INVOICE_ORDER_REQUIRED',
        'Les réglages des achats exigent une commande pour toute facture.',
      );
    }

    // Commandes (P3) : de l'organisation (404), facturables, même fournisseur et devise.
    const facts = await this.orders.findOwn(organizationId, orderIds);
    const lineIndex = new Map<string, PurchaseOrderFacts['lines'][number]>();
    for (const id of orderIds) {
      const order = facts.get(id);
      if (!order) orderNotFound();
      this.assertInvoiceable(order);
      if (order.supplierId !== body.supplierId) {
        conflict(
          'SUPPLIER_INVOICE_ORDER_SUPPLIER_MISMATCH',
          'Une facture ne vise que des commandes de son fournisseur.',
          { orderId: id },
        );
      }
      if (order.currency !== body.currency) {
        conflict(
          'SUPPLIER_INVOICE_CURRENCY_MISMATCH',
          'La devise de la facture doit être celle de la commande.',
          { orderId: id, orderCurrency: order.currency },
        );
      }
      for (const line of order.lines) lineIndex.set(line.id, line);
    }

    // Lignes : obligatoires si la facture vise une commande ; libellé repris de la commande.
    const rawLines = body.lines ?? [];
    if (orderIds.length > 0 && rawLines.length === 0) {
      badRequest(
        'SUPPLIER_INVOICE_LINES_REQUIRED',
        'Une facture liée à une commande porte ses lignes (rapprochement).',
      );
    }
    const inputLines = rawLines.map((l, index) => {
      const orderLineId = l.orderLineId ?? null;
      const orderLine = orderLineId === null ? null : lineIndex.get(orderLineId);
      if (orderLineId !== null && !orderLine) orderLineNotFound();
      const label = l.label ?? orderLine?.label ?? null;
      if (!label) {
        badRequest('FIELD_REQUIRED', 'Libellé de ligne obligatoire.', { line: index });
      }
      return {
        orderLineId,
        label,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? null,
      };
    });
    const taxes = (body.taxes ?? []).map((t) => ({ label: t.label, amount: t.amount }));
    let subtotal: string;
    let lines: SupplierInvoiceLine[];
    const taxTotals = computeOrderTotals([], taxes);
    if (inputLines.length > 0) {
      const totals = computeOrderTotals(inputLines, taxes);
      subtotal = totals.subtotal;
      lines = inputLines.map((l, i) => ({ ...l, amount: totals.lines[i]!.amount }));
    } else {
      if (body.subtotal === undefined) {
        badRequest(
          'SUPPLIER_INVOICE_SUBTOTAL_REQUIRED',
          'Sans ligne, le sous-total HT de la facture est saisi.',
        );
      }
      subtotal = body.subtotal;
      lines = [];
    }
    const totalCheck = checkInvoiceTotal(subtotal, taxes, body.total);
    if (!totalCheck.ok) {
      badRequest(
        'SUPPLIER_INVOICE_TOTAL_MISMATCH',
        'Le total saisi n’est pas égal au sous-total plus les taxes.',
        {
          expected: totalCheck.expected,
          actual: totalCheck.actual,
          difference: totalCheck.difference,
        },
      );
    }
    const deductibleVat = body.deductibleVat ?? null;
    if (deductibleVat !== null && centsCompare(deductibleVat, taxTotals.taxes) > 0) {
      badRequest(
        'SUPPLIER_INVOICE_DEDUCTIBLE_VAT_ABOVE_TAXES',
        'La TVA déductible déclarée ne peut pas dépasser les taxes de la facture.',
      );
    }

    // Imputations : défaut une ligne (catégorie de la fiche ou des lignes, projet unique).
    const costAllocations = await this.allocationsOf(
      organizationId,
      body,
      supplier.defaultCategory ?? null,
      lines.map((l) => (l.orderLineId ? lineIndex.get(l.orderLineId) : undefined)),
    );
    const allocationCheck = checkCostAllocations(body.total, costAllocations);
    if (!allocationCheck.ok) {
      badRequest(
        'SUPPLIER_INVOICE_ALLOCATION_MISMATCH',
        'La somme des imputations doit être égale au total de la facture.',
        {
          allocated: allocationCheck.allocated,
          total: allocationCheck.total,
          difference: allocationCheck.difference,
        },
      );
    }

    const composed = {
      supplierId: body.supplierId,
      supplierReference: body.supplierReference,
      supplierReferenceKey: supplierReferenceKey(body.supplierReference),
      kind,
      creditedInvoiceId,
      invoiceDate: body.invoiceDate,
      receivedOn,
      dueDate,
      currency: body.currency,
      orderIds,
      lines,
      subtotal,
      taxes,
      total: body.total,
      deductibleVat,
      costAllocations,
    };
    const matching = await this.matchingOf(organizationId, {
      ...composed,
      status: 'draft',
      ...(current ? { _id: current._id } : {}),
    });
    return { ...composed, matching };
  }

  private async allocationsOf(
    organizationId: string,
    body: CreateSupplierInvoiceBody,
    supplierCategory: string | null,
    orderLines: readonly (PurchaseOrderFacts['lines'][number] | undefined)[],
  ): Promise<CostAllocation[]> {
    let allocations: CostAllocation[];
    if (body.costAllocations) {
      allocations = body.costAllocations.map((a) => ({
        category: a.category,
        workProjectId: a.workProjectId ?? null,
        amount: a.amount,
      }));
    } else {
      const lineCategories = new Set(orderLines.map((l) => l?.category).filter(Boolean));
      const projects = new Set(orderLines.map((l) => l?.workProjectId ?? null));
      const category =
        supplierCategory ?? (lineCategories.size === 1 ? ([...lineCategories][0] as string) : null);
      if (!category) {
        badRequest(
          'SUPPLIER_INVOICE_CATEGORY_REQUIRED',
          'Indiquez la catégorie de dépense de la facture (imputation).',
        );
      }
      allocations = [
        {
          category,
          workProjectId: projects.size === 1 ? ([...projects][0] ?? null) : null,
          amount: body.total,
        },
      ];
    }
    allocations.forEach((a, index) => {
      if (!CATEGORIES.has(a.category)) {
        badRequest('CATEGORY_UNKNOWN', 'Catégorie de dépense inconnue.', { allocation: index });
      }
    });
    const projectIds = [
      ...new Set(allocations.map((a) => a.workProjectId).filter((p): p is string => !!p)),
    ];
    for (const projectId of projectIds) await this.assertWorkProject(organizationId, projectId);
    return allocations;
  }

  /** Projet du RUN de l'organisation (404), non archivé (409) — lecture seule. */
  private async assertWorkProject(organizationId: string, workProjectId: string): Promise<void> {
    const project = await this.connection
      .collection(WORK_PROJECTS)
      .findOne({ _id: oid(workProjectId), organizationId }, { projection: { status: 1 } });
    if (!project) {
      notFound('PURCHASE_WORK_PROJECT_UNKNOWN', 'Projet introuvable dans cette organisation.');
    }
    if (project['status'] === 'archived') {
      conflict(
        'WORK_PROJECT_ARCHIVED',
        'Ce projet est archivé : restaurez-le avant d’y imputer une facture.',
      );
    }
  }

  private assertInvoiceable(order: PurchaseOrderFacts): void {
    if (order.phase !== 'order' || !INVOICEABLE_ORDER_STATUSES.has(order.status)) {
      conflict(
        'PURCHASE_ORDER_NOT_INVOICEABLE',
        'Seule une commande approuvée, non annulée, se facture.',
        { orderId: order.id, status: order.status },
      );
    }
  }

  private async assertCreditNoteTarget(
    organizationId: string,
    invoice: SupplierInvoiceLean,
  ): Promise<void> {
    if (invoice.kind !== 'credit_note' || !invoice.creditedInvoiceId) return;
    const target = await this.requireOwn(organizationId, invoice.creditedInvoiceId);
    if (target.status !== 'validated') {
      conflict(
        'SUPPLIER_CREDIT_NOTE_TARGET_MISMATCH',
        'Validez d’abord la facture que cet avoir diminue.',
      );
    }
  }

  private async assertNoDuplicate(
    organizationId: string,
    supplierId: string,
    key: string,
    exceptId: Types.ObjectId | null,
  ): Promise<void> {
    const other = await this.invoices
      .findOne(
        {
          organizationId,
          supplierId,
          supplierReferenceKey: key,
          ...(exceptId ? { _id: { $ne: exceptId } } : {}),
        },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    if (other) {
      conflict(
        'SUPPLIER_INVOICE_DUPLICATE',
        'Ce fournisseur a déjà une facture avec cette référence.',
        { invoiceId: String(other._id) },
      );
    }
  }

  private assertDraft(doc: SupplierInvoiceLean): void {
    this.assertNotCancelled(doc);
    if (doc.status !== 'draft') {
      conflict('SUPPLIER_INVOICE_NOT_DRAFT', 'Cette facture est déjà validée.');
    }
  }

  private assertNotCancelled(doc: Pick<SupplierInvoiceLean, 'status'>): void {
    if (doc.status === 'cancelled') {
      conflict('SUPPLIER_INVOICE_CANCELLED', 'Cette facture est annulée.');
    }
  }

  private assertNotDisputed(doc: SupplierInvoiceLean): void {
    if (doc.disputed) {
      conflict(
        'SUPPLIER_INVOICE_DISPUTED',
        'Cette facture est en litige : levez le litige avant de la valider.',
      );
    }
  }

  private invoiceNotFound(): never {
    notFound('SUPPLIER_INVOICE_NOT_FOUND', 'Facture fournisseur introuvable.');
  }

  private async writeRevision(
    current: SupplierInvoiceLean,
    expectedRevision: number,
    set: Record<string, unknown>,
  ): Promise<SupplierInvoiceLean> {
    const updated = await this.invoices
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId: current.organizationId,
          revision: expectedRevision,
          status: current.status,
        },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SupplierInvoiceLean>()
      .exec();
    if (!updated) {
      staleRevision((await this.requireOwn(current.organizationId, String(current._id))).revision);
    }
    return updated;
  }

  // ── Réglages, numérotation, vues ─────────────────────────────────────────

  async settings(organizationId: string): Promise<InvoiceSettings> {
    const e = await this.purchaseSettings.effective(organizationId);
    return {
      pricePercent: e.matchingTolerances.pricePercent,
      amountAbsolute: e.matchingTolerances.amountAbsolute,
      dueSoonDays: e.dueSoonDays,
      requireOrderForInvoice: e.requireOrderForInvoice,
      allowSoleApprover: e.allowSoleApprover,
    };
  }

  private async supplierNames(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].filter(isOid);
    if (unique.length === 0) return new Map();
    const docs = await this.connection
      .collection(SUPPLIERS)
      .find({ organizationId, _id: { $in: unique.map(oid) } }, { projection: { name: 1 } })
      .toArray();
    return new Map(docs.map((d) => [String(d._id), String(d['name'])]));
  }

  private listItemOf(
    d: SupplierInvoiceLean,
    settlement: Settlement,
    names: Map<string, string>,
  ): SupplierInvoiceListItem {
    return {
      id: String(d._id),
      internalNumber: d.internalNumber,
      supplierId: d.supplierId,
      supplierName: names.get(d.supplierId) ?? null,
      supplierReference: d.supplierReference,
      kind: d.kind,
      status: d.status,
      matchingMode: d.matching.mode,
      matchingStatus: d.matching.status,
      currency: d.currency,
      invoiceDate: d.invoiceDate,
      dueDate: d.dueDate,
      total: d.total,
      remaining: settlement.remaining,
      settlementStatus: settlement.status,
      disputed: d.disputed !== null && d.disputed !== undefined,
      forced: d.forcedValidation !== null && d.forcedValidation !== undefined,
      hasAttachment: d.attachment !== null && d.attachment !== undefined,
      orderIds: d.orderIds ?? [],
      updatedAt: new Date(d.updatedAt).toISOString(),
    };
  }

  private async viewOf(
    organizationId: string,
    d: SupplierInvoiceLean,
  ): Promise<SupplierInvoiceView> {
    const settlement =
      (await this.settlementsOf(organizationId, [d])).get(String(d._id)) ?? NO_DEBT;
    const names = await this.supplierNames(organizationId, [d.supplierId]);
    return {
      ...this.listItemOf(d, settlement, names),
      creditedInvoiceId: d.creditedInvoiceId ?? null,
      receivedOn: d.receivedOn,
      lines: d.lines.map((l) => ({
        orderLineId: l.orderLineId ?? null,
        label: l.label,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? null,
        amount: l.amount,
      })),
      subtotal: d.subtotal,
      taxes: d.taxes.map((t) => ({ label: t.label, amount: t.amount })),
      deductibleVat: d.deductibleVat ?? null,
      costAllocations: d.costAllocations.map((a) => ({
        category: a.category,
        workProjectId: a.workProjectId ?? null,
        amount: a.amount,
      })),
      attachment: attachmentViewOf(d.attachment),
      matching: matchingViewOf(d.matching),
      settlement,
      forcedValidation: d.forcedValidation
        ? {
            by: d.forcedValidation.by,
            at: new Date(d.forcedValidation.at).toISOString(),
            reason: d.forcedValidation.reason,
            soleApprover: d.forcedValidation.soleApprover === true,
          }
        : null,
      dispute: d.disputed
        ? {
            by: d.disputed.by,
            at: new Date(d.disputed.at).toISOString(),
            reason: d.disputed.reason,
          }
        : null,
      validatedAt: d.validatedAt ? new Date(d.validatedAt).toISOString() : null,
      validatedBy: d.validatedBy ?? null,
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
    };
  }

  private async notifyVariance(
    doc: Pick<SupplierInvoiceLean, '_id' | 'organizationId' | 'internalNumber' | 'supplierId'>,
    actorUserId: string,
  ): Promise<void> {
    const names = await this.supplierNames(doc.organizationId, [doc.supplierId]);
    await this.notifier.invoiceVariance({
      organizationId: doc.organizationId,
      invoiceId: String(doc._id),
      internalNumber: doc.internalNumber,
      supplierName: names.get(doc.supplierId) ?? null,
      actorUserId,
    });
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

/** Commande au format du moteur (`MatchOrderInput`). */
export function matchOrderOf(o: PurchaseOrderFacts): MatchOrderInput {
  return {
    id: o.id,
    currency: o.currency,
    approvedTotal: o.approvedTotal,
    lines: o.lines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      receivable: l.receivable,
      category: l.category,
      workProjectId: l.workProjectId,
    })),
    declaredTaxes: o.declaredTaxes,
  };
}
