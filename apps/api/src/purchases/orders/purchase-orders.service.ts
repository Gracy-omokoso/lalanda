// Demandes d'achat et bons de commande — ADR-0044 § 2.3, § 3.2. ADR-0044 — P3.
//
// Cycle : `draft` → `submitted` (numéro `DA`, `requiredApprovals` figé par le moteur)
// → `approved` (numéro `BC`, `phase: 'order'`) | `rejected` ; puis `sent`, et
// `cancelled` à tout moment avant `received`. Un palier à 0 approbation : la
// soumission vaut approbation. Modifier une demande soumise ou approuvée efface les
// approbations et la remet à `submitted`.
//
// Séparation des tâches : `purchaseApprovalDecision` (fonction pure de
// `permissions.ts`), sur le nombre de détenteurs EFFECTIFS de `purchase.approve`
// (`AuthzService.countApprovers`, ADR-0041 G4) — jamais un `if (role === …)`.
//
// Isolation : chaque lecture porte `organizationId` ; fournisseur, projet et
// demandeur forgés d'une autre organisation répondent 404 (400 pour un membre
// inéligible). Écriture concurrente : `expectedRevision` → `409 STALE_REVISION`.
// Tous les montants viennent du moteur (`computeOrderTotals`, `requiredApprovals`).

import {
  EXPENSE_CATEGORY_CODES,
  PURCHASES_VERSION,
  computeOrderTotals,
  requiredApprovals as engineRequiredApprovals,
} from '@lalanda/engine';
import type {
  ApprovePurchaseOrderBody,
  CreatePurchaseOrderBody,
  ListPurchaseOrdersQuery,
  PendingApprovalsQuery,
  PurchaseApprovalCount,
  PurchaseCurrency,
  PurchaseOrderPage,
  PurchaseOrderStatus,
  PurchaseOrderView,
  UpdatePurchaseOrderBody,
} from '@lalanda/shared/purchases';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService, type AuditMetadataValue } from '../../authz/audit.service.js';
import { AuthzService, holdersFilter } from '../../authz/authz.service.js';
import type { CurrentOrgPermissionsValue } from '../../authz/current-org-permissions.decorator.js';
import { can, purchaseApprovalDecision, type Action } from '../../authz/permissions.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../../crm/time-cursor.js';
import { kinshasaDay } from '../../crm/crm-model.js';
import { Membership, type MembershipDocument } from '../../organizations/membership.schema.js';
import { conflict, invalidCursor, staleRevision } from '../../sales/sales.errors.js';
import { isObjectIdHex } from '../../sales/search.js';
import { PurchaseCountersService } from '../counters/purchase-counters.service.js';
import { SupplierInvoicesService } from '../invoices/supplier-invoices.service.js';
import { PurchasesNotifier } from '../purchases-notifier.js';
import { PurchaseSettingsService } from '../settings/purchase-settings.service.js';
import type { SupplierLean } from '../suppliers/supplier.schema.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import {
  CANCELLABLE_STATUSES,
  CLOSABLE_STATUSES,
  EDITABLE_STATUSES,
  approvableFilter,
  isSoleApproverOrg,
  purchaseOrderView,
} from './purchase-order-model.js';
import {
  PurchaseOrder,
  type PurchaseApproval,
  type PurchaseOrderDocument,
  type PurchaseOrderLean,
  type PurchaseOrderLine,
} from './purchase-order.schema.js';
import {
  notEditable,
  orderNotFound,
  orderStatusConflict,
  requiresManage,
  workProjectUnknown,
} from './purchase-orders.errors.js';

/** Auteur d'un geste : identité, rôle (journal) et droits EFFECTIFS (décision). */
export interface PurchaseOrderActor {
  userId: string;
  role: string;
  perms: CurrentOrgPermissionsValue | undefined;
}

const CATEGORIES = new Set<string>(EXPENSE_CATEGORY_CODES as readonly string[]);
const WORK_PROJECTS = 'work_projects';
const SUPPLIER_INVOICES = 'supplier_invoices';

function actorCan(actor: PurchaseOrderActor, action: Action): boolean {
  return actor.perms ? can(actor.perms.role, action, actor.perms.context) : false;
}

function isOwn(o: Pick<PurchaseOrderLean, 'requestedBy' | 'createdBy'>, userId: string): boolean {
  return o.requestedBy === userId || o.createdBy === userId;
}

type OrderContent = Pick<
  PurchaseOrder,
  | 'title'
  | 'justification'
  | 'supplierId'
  | 'supplierName'
  | 'currency'
  | 'lines'
  | 'declaredTaxes'
  | 'totals'
  | 'expectedOn'
  | 'deliveryAddress'
>;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger('PurchaseOrders');

  constructor(
    @InjectModel(PurchaseOrder.name) private readonly orders: Model<PurchaseOrderDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthzService) private readonly authz: AuthzService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(PurchaseSettingsService) private readonly settings: PurchaseSettingsService,
    @Inject(PurchaseCountersService) private readonly counters: PurchaseCountersService,
    @Inject(PurchasesNotifier) private readonly notifier: PurchasesNotifier,
    // ADR-0044 — P6 : recalcul du rapprochement des brouillons de facture liés. Pas de
    // cycle : le service des factures ne dépend pas de celui des commandes (il lit les
    // commandes par `PurchaseOrderFactsReader`).
    @Inject(SupplierInvoicesService) private readonly invoices: SupplierInvoicesService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  /** Demande ou commande de l'organisation, ou 404. */
  async requireOwn(organizationId: string, orderId: string): Promise<PurchaseOrderLean> {
    if (typeof orderId !== 'string' || !isObjectIdHex(orderId)) orderNotFound();
    const doc = await this.orders
      .findOne({ _id: new Types.ObjectId(orderId), organizationId })
      .lean<PurchaseOrderLean>()
      .exec();
    if (!doc) orderNotFound();
    return doc;
  }

  async get(organizationId: string, orderId: string): Promise<PurchaseOrderView> {
    return purchaseOrderView(await this.requireOwn(organizationId, orderId));
  }

  async list(
    organizationId: string,
    query: ListPurchaseOrdersQuery,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.phase !== undefined) and.push({ phase: query.phase });
    if (query.status !== undefined) and.push({ status: query.status });
    if (query.supplierId !== undefined) and.push({ supplierId: query.supplierId });
    if (query.requestedBy !== undefined) {
      and.push({ requestedBy: query.requestedBy === 'me' ? actor.userId : query.requestedBy });
    }
    if (query.workProjectId !== undefined) and.push({ 'lines.workProjectId': query.workProjectId });
    return this.page(and, query.cursor, query.limit);
  }

  /** `GET /purchases/approvals/pending` — demandes que l'appelant peut approuver. */
  async pendingApprovals(
    organizationId: string,
    query: PendingApprovalsQuery,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderPage> {
    const sole = await this.soleApproverOrg(organizationId);
    return this.page(
      [approvableFilter(organizationId, actor.userId, sole)],
      query.cursor,
      query.limit,
    );
  }

  private async page(
    and: Record<string, unknown>[],
    rawCursor: string | undefined,
    limit: number,
  ): Promise<PurchaseOrderPage> {
    if (rawCursor !== undefined) {
      const cursor = decodeTimeCursor(rawCursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('updatedAt', cursor));
    }
    const docs = await this.orders
      .find({ $and: and })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean<PurchaseOrderLean[]>()
      .exec();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(purchaseOrderView),
      nextCursor:
        docs.length > limit && last
          ? encodeTimeCursor(new Date(last.updatedAt), String(last._id))
          : null,
    };
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    body: CreatePurchaseOrderBody,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const requestedBy = await this.resolveRequester(organizationId, body.requestedBy, actor);
    const content = await this.compose(organizationId, body, []);
    const now = new Date();
    const [doc] = await this.orders.create([
      {
        organizationId,
        phase: 'request',
        status: 'draft',
        requestNumber: null,
        orderNumber: null,
        requestedBy,
        ...content,
        requiredApprovals: null,
        approvals: [],
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        _schemaVersion: 1,
      },
    ]);
    const lean = doc!.toObject() as unknown as PurchaseOrderLean;
    await this.audit.record({
      ...this.auditBase(organizationId, actor, String(lean._id)),
      action: 'purchase_order.created',
      metadata: { currency: lean.currency, total: lean.totals.total, requestedBy },
    });
    return purchaseOrderView(lean);
  }

  async update(
    organizationId: string,
    orderId: string,
    body: UpdatePurchaseOrderBody,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (!EDITABLE_STATUSES.includes(o.status)) notEditable(o.status);
    this.assertMayEdit(o, actor);
    if (o.revision !== body.expectedRevision) staleRevision(o.revision);
    if (o.status !== 'draft' && body.currency !== o.currency) {
      conflict(
        'PURCHASE_ORDER_CURRENCY_LOCKED',
        'La devise d’une demande soumise ne change plus : dupliquez-la dans l’autre devise.',
        { currency: o.currency },
      );
    }
    const requestedBy =
      body.requestedBy === undefined || body.requestedBy === o.requestedBy
        ? o.requestedBy
        : await this.resolveRequester(organizationId, body.requestedBy, actor);
    const content = await this.compose(organizationId, body, o.lines);
    const draft = o.status === 'draft';
    if (!draft && content.supplierId === null) supplierRequired();
    const now = new Date();
    const settings = draft ? null : await this.settings.effective(organizationId);
    const required = settings
      ? this.requiredOf(settings.approvalTiers, content.currency, content.totals.total)
      : null;
    const cleared = (o.approvals ?? []).length;

    const updated = await this.inTransaction(async (session) => {
      const set: Record<string, unknown> = {
        ...content,
        requestedBy,
        updatedBy: actor.userId,
        updatedAt: now,
      };
      if (!draft) {
        // § 2.3 : toute modification efface les approbations et remet à `submitted`.
        Object.assign(set, {
          phase: 'request',
          status: 'submitted',
          approvals: [],
          requiredApprovals: required,
          approvedTotal: null,
          approvedAt: null,
        });
        if (required === 0) {
          Object.assign(set, await this.approvalFields(organizationId, o, content, now, session));
        }
      }
      const doc = await this.orders
        .findOneAndUpdate(
          { _id: o._id, organizationId, revision: o.revision },
          { $set: set, $inc: { revision: 1 } },
          { new: true, session },
        )
        .lean<PurchaseOrderLean>()
        .exec();
      if (!doc) staleRevision(o.revision + 1);
      await this.audit.recordStrict(
        {
          ...this.auditBase(organizationId, actor, orderId),
          action: 'purchase_order.updated',
          metadata: {
            status: doc.status,
            total: doc.totals.total,
            approvalsCleared: draft ? 0 : cleared,
            requiredApprovals: doc.requiredApprovals ?? null,
          },
        },
        { session },
      );
      if (!draft && required === 0) {
        await this.audit.recordStrict(
          {
            ...this.auditBase(organizationId, actor, orderId),
            action: 'purchase_order.approved',
            metadata: {
              orderNumber: doc.orderNumber,
              complete: true,
              autoApproved: true,
              reason: 'Palier à 0 approbation : la soumission vaut approbation.',
              approvedTotal: doc.approvedTotal,
            },
          },
          { session },
        );
      }
      return doc;
    });
    if (updated.status === 'submitted') await this.notifyApprovers(updated, actor);
    await this.refreshInvoiceDrafts(organizationId, orderId, actor.userId);
    return purchaseOrderView(updated);
  }

  async remove(organizationId: string, orderId: string, actor: PurchaseOrderActor): Promise<void> {
    const o = await this.requireOwn(organizationId, orderId);
    if (o.status !== 'draft') {
      orderStatusConflict(o.status, 'Seul un brouillon se supprime ; annulez une demande soumise.');
    }
    this.assertMayEdit(o, actor);
    const r = await this.orders
      .deleteOne({ _id: o._id, organizationId, status: 'draft', revision: o.revision })
      .exec();
    if (r.deletedCount === 0) staleRevision(o.revision + 1);
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'purchase_order.deleted',
      metadata: { title: o.title },
    });
  }

  async submit(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (o.status !== 'draft') {
      orderStatusConflict(o.status, 'Seul un brouillon se soumet.');
    }
    this.assertMayEdit(o, actor);
    if (o.revision !== expectedRevision) staleRevision(o.revision);
    if (o.supplierId === null) supplierRequired();
    // Fournisseur relu : actif au moment de la soumission, nom d'affichage à jour.
    const supplier = await this.activeSupplier(organizationId, o.supplierId);
    const totals = this.totalsOf(o.lines, o.declaredTaxes ?? []);
    const settings = await this.settings.effective(organizationId);
    const required = this.requiredOf(settings.approvalTiers, o.currency, totals.total);
    const now = new Date();

    const updated = await this.inTransaction(async (session) => {
      const requestNumber =
        o.requestNumber ?? (await this.counters.next(organizationId, 'request', now, session));
      const set: Record<string, unknown> = {
        status: 'submitted',
        requestNumber,
        requiredApprovals: required,
        approvals: [],
        supplierName: supplier.name,
        totals,
        submittedAt: now,
        submittedOn: kinshasaDay(now),
        updatedBy: actor.userId,
        updatedAt: now,
      };
      if (required === 0) {
        // § 2.3 : palier à 0 approbation, la soumission vaut approbation.
        Object.assign(set, await this.approvalFields(organizationId, o, { totals }, now, session));
      }
      const doc = await this.orders
        .findOneAndUpdate(
          { _id: o._id, organizationId, revision: o.revision, status: 'draft' },
          { $set: set, $inc: { revision: 1 } },
          { new: true, session },
        )
        .lean<PurchaseOrderLean>()
        .exec();
      if (!doc) staleRevision(o.revision + 1);
      const base = this.auditBase(organizationId, actor, orderId);
      await this.audit.recordStrict(
        {
          ...base,
          action: 'purchase_order.submitted',
          metadata: {
            requestNumber,
            currency: doc.currency,
            total: totals.total,
            requiredApprovals: required,
          },
        },
        { session },
      );
      if (required === 0) {
        await this.audit.recordStrict(
          {
            ...base,
            action: 'purchase_order.approved',
            metadata: {
              orderNumber: doc.orderNumber,
              complete: true,
              autoApproved: true,
              reason: 'Palier à 0 approbation : la soumission vaut approbation.',
              approvedTotal: doc.approvedTotal,
            },
          },
          { session },
        );
      }
      return doc;
    });
    if (updated.status === 'submitted') await this.notifyApprovers(updated, actor);
    return purchaseOrderView(updated);
  }

  async approve(
    organizationId: string,
    orderId: string,
    body: ApprovePurchaseOrderBody,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    return this.decide(
      organizationId,
      orderId,
      'approve',
      body.comment ?? null,
      body.expectedRevision,
      actor,
    );
  }

  async reject(
    organizationId: string,
    orderId: string,
    comment: string,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    return this.decide(organizationId, orderId, 'reject', comment, expectedRevision, actor);
  }

  private async decide(
    organizationId: string,
    orderId: string,
    decision: 'approve' | 'reject',
    comment: string | null,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (o.status !== 'submitted') {
      orderStatusConflict(o.status, 'Seule une demande soumise s’approuve ou se refuse.');
    }
    if (o.revision !== expectedRevision) staleRevision(o.revision);
    const [settings, approverCount] = await Promise.all([
      this.settings.effective(organizationId),
      this.authz.countApprovers(organizationId, 'purchase.approve'),
    ]);
    const prior = (o.approvals ?? []).filter((a) => a.decision === 'approved');
    const verdict = purchaseApprovalDecision({
      decision,
      approverUserId: actor.userId,
      requestedBy: o.requestedBy,
      createdBy: o.createdBy,
      priorApproverUserIds: prior.map((a) => a.userId),
      requiredApprovals: o.requiredApprovals ?? 1,
      approverCountInOrg: approverCount,
      allowSoleApprover: settings.allowSoleApprover,
    });
    if (!verdict.ok) {
      conflict(
        verdict.code,
        verdict.code === 'SELF_APPROVAL_FORBIDDEN'
          ? 'Vous avez demandé cet achat : une autre personne doit l’approuver.'
          : 'Vous avez déjà approuvé cette demande : la seconde approbation revient à une autre personne.',
      );
    }
    const now = new Date();
    const approval: PurchaseApproval = {
      userId: actor.userId,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      at: now,
      comment,
      soleApprover: verdict.soleApprover,
    };
    const complete = decision === 'approve' && verdict.complete;

    const updated = await this.inTransaction(async (session) => {
      const set: Record<string, unknown> = { updatedBy: actor.userId, updatedAt: now };
      if (decision === 'reject') set['status'] = 'rejected';
      if (complete) {
        Object.assign(set, await this.approvalFields(organizationId, o, o, now, session));
      }
      const doc = await this.orders
        .findOneAndUpdate(
          { _id: o._id, organizationId, revision: o.revision, status: 'submitted' },
          { $set: set, $push: { approvals: approval }, $inc: { revision: 1 } },
          { new: true, session },
        )
        .lean<PurchaseOrderLean>()
        .exec();
      if (!doc) staleRevision(o.revision + 1);
      const metadata: Record<string, AuditMetadataValue> = {
        requestNumber: doc.requestNumber,
        soleApprover: verdict.soleApprover,
        requiredApprovals: o.requiredApprovals ?? null,
        effectiveRequired: verdict.effectiveRequired,
        approvalsCount: prior.length + (decision === 'approve' ? 1 : 0),
        comment: comment !== null,
      };
      if (decision === 'approve') {
        metadata['complete'] = complete;
        if (complete) {
          metadata['orderNumber'] = doc.orderNumber;
          metadata['approvedTotal'] = doc.approvedTotal;
        }
      }
      await this.audit.recordStrict(
        {
          ...this.auditBase(organizationId, actor, orderId),
          action: decision === 'approve' ? 'purchase_order.approved' : 'purchase_order.rejected',
          metadata,
        },
        { session },
      );
      return doc;
    });
    if (decision === 'reject' || complete) {
      await this.notifier.decided(
        this.notice(updated, actor),
        [updated.requestedBy, updated.createdBy],
        decision === 'approve' ? 'approved' : 'rejected',
      );
    }
    // L'approbation complète fige `approvedTotal`, que le rapprochement compare.
    if (complete) await this.refreshInvoiceDrafts(organizationId, orderId, actor.userId);
    return purchaseOrderView(updated);
  }

  async duplicate(
    organizationId: string,
    orderId: string,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    // Fournisseur repris s'il est encore utilisable ; sinon le brouillon le redemande.
    let supplierId: string | null = o.supplierId;
    if (supplierId !== null) {
      const s = await this.suppliers.requireOwn(organizationId, supplierId);
      if (!s.active || s.mergedInto) supplierId = null;
    }
    const content = await this.compose(
      organizationId,
      {
        title: o.title,
        justification: o.justification,
        supplierId,
        currency: o.currency,
        lines: o.lines.map((l) => ({
          label: l.label,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          kind: l.kind,
          receivable: l.receivable,
          category: l.category,
          workProjectId: l.workProjectId,
          itemRef: l.itemRef,
        })),
        declaredTaxes: (o.declaredTaxes ?? []).map((t) => ({ label: t.label, amount: t.amount })),
        expectedOn: o.expectedOn,
        deliveryAddress: o.deliveryAddress,
      },
      [],
      // Un projet archivé depuis : la ligne le perd plutôt que de refuser la copie.
      { dropArchivedProjects: true },
    );
    const now = new Date();
    const [doc] = await this.orders.create([
      {
        organizationId,
        phase: 'request',
        status: 'draft',
        requestNumber: null,
        orderNumber: null,
        requestedBy: actor.userId,
        ...content,
        requiredApprovals: null,
        approvals: [],
        revision: 1,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        _schemaVersion: 1,
      },
    ]);
    const lean = doc!.toObject() as unknown as PurchaseOrderLean;
    await this.audit.record({
      ...this.auditBase(organizationId, actor, String(lean._id)),
      action: 'purchase_order.created',
      metadata: { duplicatedFrom: orderId, currency: lean.currency, total: lean.totals.total },
    });
    return purchaseOrderView(lean);
  }

  async markSent(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (o.status !== 'approved') {
      orderStatusConflict(
        o.status,
        'Seule une commande approuvée, pas encore envoyée, se marque envoyée.',
      );
    }
    if (o.revision !== expectedRevision) staleRevision(o.revision);
    return this.transition(organizationId, o, actor, {
      expectStatus: 'approved',
      set: { status: 'sent', sentAt: new Date(), sentVia: 'manual' },
      action: 'purchase_order.sent',
      metadata: { orderNumber: o.orderNumber, via: 'manual' },
    });
  }

  /** Après un envoi par e-mail réussi d'une commande `approved` (§ 3.3, décision n° 8). */
  async markSentByEmail(
    organizationId: string,
    orderId: string,
    actor: PurchaseOrderActor,
  ): Promise<void> {
    const o = await this.requireOwn(organizationId, orderId);
    if (o.status !== 'approved') return;
    try {
      await this.transition(organizationId, o, actor, {
        expectStatus: 'approved',
        set: { status: 'sent', sentAt: new Date(), sentVia: 'email' },
        action: 'purchase_order.sent',
        metadata: { orderNumber: o.orderNumber, via: 'email' },
      });
    } catch (err) {
      // Une écriture concurrente a changé la commande : l'e-mail est parti, l'envoi
      // reste journalisé (`purchase_order.emailed`) ; on ne fait pas échouer la requête.
      const code = (err as { response?: { code?: string } }).response?.code;
      if (code !== 'STALE_REVISION') throw err;
    }
  }

  async cancel(
    organizationId: string,
    orderId: string,
    reason: string,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (!CANCELLABLE_STATUSES.includes(o.status)) {
      orderStatusConflict(o.status, 'Cette demande ou commande ne s’annule plus.');
    }
    if (o.revision !== expectedRevision) staleRevision(o.revision);
    // Une facture VALIDÉE qui vise la commande l'empêche d'être annulée (§ 3.2).
    const invoiced = await this.connection.collection(SUPPLIER_INVOICES).countDocuments({
      organizationId,
      status: 'validated',
      orderIds: { $in: [orderId, new Types.ObjectId(orderId)] },
    });
    if (invoiced > 0) {
      conflict(
        'PURCHASE_ORDER_INVOICED',
        'Une facture fournisseur validée vise cette commande : elle ne s’annule plus.',
        { invoices: invoiced },
      );
    }
    const now = new Date();
    return this.transition(organizationId, o, actor, {
      expectStatus: o.status,
      set: { status: 'cancelled', cancellation: { at: now, by: actor.userId, reason } },
      action: 'purchase_order.cancelled',
      metadata: {
        previousStatus: o.status,
        requestNumber: o.requestNumber,
        orderNumber: o.orderNumber,
        reason,
      },
    });
  }

  async close(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    actor: PurchaseOrderActor,
  ): Promise<PurchaseOrderView> {
    const o = await this.requireOwn(organizationId, orderId);
    if (!CLOSABLE_STATUSES.includes(o.status)) {
      orderStatusConflict(
        o.status,
        'Seule une commande reçue, en partie ou en totalité, se clôture.',
      );
    }
    if (o.revision !== expectedRevision) staleRevision(o.revision);
    return this.transition(organizationId, o, actor, {
      expectStatus: o.status,
      set: { status: 'closed', closedAt: new Date() },
      action: 'purchase_order.closed',
      metadata: { orderNumber: o.orderNumber, previousStatus: o.status },
    });
  }

  // ── Aides ────────────────────────────────────────────────────────────────

  /** Une transition simple : écriture conditionnelle + audit strict dans la transaction. */
  private async transition(
    organizationId: string,
    o: PurchaseOrderLean,
    actor: PurchaseOrderActor,
    t: {
      expectStatus: PurchaseOrderStatus;
      set: Record<string, unknown>;
      action: string;
      metadata: Record<string, AuditMetadataValue>;
    },
  ): Promise<PurchaseOrderView> {
    const now = new Date();
    const doc = await this.inTransaction(async (session) => {
      const d = await this.orders
        .findOneAndUpdate(
          { _id: o._id, organizationId, revision: o.revision, status: t.expectStatus },
          { $set: { ...t.set, updatedBy: actor.userId, updatedAt: now }, $inc: { revision: 1 } },
          { new: true, session },
        )
        .lean<PurchaseOrderLean>()
        .exec();
      if (!d) staleRevision(o.revision + 1);
      await this.audit.recordStrict(
        {
          ...this.auditBase(organizationId, actor, String(o._id)),
          action: t.action,
          metadata: t.metadata,
        },
        { session },
      );
      return d;
    });
    // Annulation, clôture, envoi : les brouillons de facture liés sont recalculés.
    await this.refreshInvoiceDrafts(organizationId, String(o._id), actor.userId);
    return purchaseOrderView(doc);
  }

  /**
   * ADR-0044 — P6 : après une écriture de commande (APRÈS sa transaction), recalcule
   * le rapprochement des brouillons de facture qui la visent
   * (`SupplierInvoicesService.refreshDrafts`). Sortie dérivée : un échec est
   * journalisé et ne défait pas l'écriture de la commande, déjà validée.
   */
  private async refreshInvoiceDrafts(
    organizationId: string,
    orderId: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.invoices.refreshDrafts(organizationId, [orderId], actorUserId);
    } catch (err) {
      this.logger.warn(
        `Rapprochement des brouillons non recalculé (commande ${orderId}) : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Champs posés à l'approbation complète : `phase: 'order'`, numéro `BC`. */
  private async approvalFields(
    organizationId: string,
    o: Pick<PurchaseOrderLean, 'orderNumber'>,
    content: Pick<PurchaseOrderLean, 'totals'>,
    now: Date,
    session: ClientSession,
  ): Promise<Record<string, unknown>> {
    return {
      phase: 'order',
      status: 'approved',
      // Une commande déjà numérotée (modifiée puis réapprouvée) garde son numéro.
      orderNumber:
        o.orderNumber ?? (await this.counters.next(organizationId, 'order', now, session)),
      approvedTotal: content.totals.total,
      approvedAt: now,
    };
  }

  /**
   * Le contenu d'une demande : fournisseur de l'organisation (actif), lignes
   * (identifiants conservés, catégorie par défaut du fournisseur, projets non
   * archivés de l'organisation), totaux du moteur.
   */
  private async compose(
    organizationId: string,
    body: Omit<CreatePurchaseOrderBody, 'requestedBy'>,
    previousLines: readonly PurchaseOrderLine[],
    opts: { dropArchivedProjects?: boolean } = {},
  ): Promise<OrderContent> {
    const supplierId = body.supplierId ?? null;
    let supplier: SupplierLean | null = null;
    if (supplierId !== null) {
      // Le fournisseur déjà posé et toujours le même reste permis s'il a été archivé
      // depuis ? Non : § 2.3, « fiche active de l'organisation » à chaque écriture.
      supplier = await this.activeSupplier(organizationId, supplierId);
    }
    const projectIds = [
      ...new Set(
        body.lines
          .map((l) => l.workProjectId ?? null)
          .filter((v): v is string => typeof v === 'string'),
      ),
    ];
    const liveProjects = await this.liveProjects(organizationId, projectIds);
    if (!opts.dropArchivedProjects && liveProjects.size !== projectIds.length) workProjectUnknown();

    const known = new Set(previousLines.map((l) => l.id));
    const used = new Set<string>();
    const lines: Omit<PurchaseOrderLine, 'amount'>[] = body.lines.map((l, i) => {
      const category = l.category ?? supplier?.defaultCategory ?? null;
      if (category !== null && !CATEGORIES.has(category)) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: 'Corps de requête invalide.',
          details: {
            issues: [
              {
                path: `lines.${i}.category`,
                code: 'PURCHASE_CATEGORY_UNKNOWN',
                message: 'Catégorie de dépense inconnue.',
              },
            ],
          },
        });
      }
      const id =
        l.id !== undefined && known.has(l.id) && !used.has(l.id)
          ? l.id
          : new Types.ObjectId().toHexString();
      used.add(id);
      const project = l.workProjectId ?? null;
      return {
        id,
        label: l.label,
        quantity: l.quantity,
        unit: l.unit ?? null,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? null,
        kind: l.kind,
        receivable: l.receivable ?? l.kind === 'goods',
        category,
        workProjectId: project !== null && liveProjects.has(project) ? project : null,
        itemRef: l.itemRef ?? null,
      };
    });
    const declaredTaxes = (body.declaredTaxes ?? []).map((t) => ({
      label: t.label,
      amount: t.amount,
    }));
    const { totals, lineAmounts } = this.computed(lines, declaredTaxes);
    return {
      title: body.title,
      justification: body.justification ?? null,
      supplierId,
      supplierName: supplier?.name ?? null,
      currency: body.currency,
      lines: lines.map((l, i) => ({ ...l, amount: lineAmounts[i]! })),
      declaredTaxes,
      totals,
      expectedOn: body.expectedOn ?? null,
      deliveryAddress: body.deliveryAddress ?? null,
    };
  }

  private totalsOf(
    lines: readonly Pick<PurchaseOrderLine, 'id' | 'quantity' | 'unitPrice' | 'discountPercent'>[],
    declaredTaxes: readonly { label: string; amount: string }[],
  ): PurchaseOrder['totals'] {
    return this.computed(lines, declaredTaxes).totals;
  }

  /** Totaux et montants de ligne du moteur (`computeOrderTotals`), jamais calculés ici. */
  private computed(
    lines: readonly Pick<PurchaseOrderLine, 'id' | 'quantity' | 'unitPrice' | 'discountPercent'>[],
    declaredTaxes: readonly { label: string; amount: string }[],
  ): { totals: PurchaseOrder['totals']; lineAmounts: string[] } {
    let t: ReturnType<typeof computeOrderTotals>;
    try {
      t = computeOrderTotals(
        lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
        })),
        declaredTaxes,
      );
    } catch (err) {
      if (err instanceof RangeError) {
        throw new BadRequestException({
          code: 'INVALID_REQUEST',
          message: `Montants invalides : ${err.message}`,
        });
      }
      throw err;
    }
    return {
      totals: {
        subtotal: t.subtotal,
        taxes: t.taxes,
        total: t.total,
        engineVersion: PURCHASES_VERSION,
      },
      lineAmounts: t.lines.map((l) => l.amount),
    };
  }

  /** Palier du moteur (`requiredApprovals`) dans la devise de la demande. */
  private requiredOf(
    tiers: Record<PurchaseCurrency, { from: string; approvals: PurchaseApprovalCount }[]>,
    currency: PurchaseCurrency,
    total: string,
  ): PurchaseApprovalCount {
    return engineRequiredApprovals(tiers, currency, total).approvals as PurchaseApprovalCount;
  }

  private async activeSupplier(organizationId: string, supplierId: string): Promise<SupplierLean> {
    const s = await this.suppliers.requireUsable(organizationId, supplierId);
    if (!s.active) {
      conflict(
        'PURCHASE_ORDER_SUPPLIER_INACTIVE',
        'Ce fournisseur est archivé : restaurez sa fiche ou choisissez-en un autre.',
        { supplierId },
      );
    }
    return s;
  }

  /** Projets RUN de l'organisation, non archivés, parmi `ids`. */
  private async liveProjects(organizationId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    if (!ids.every(isObjectIdHex)) workProjectUnknown();
    const rows = await this.connection
      .collection(WORK_PROJECTS)
      .find(
        {
          organizationId,
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          status: { $ne: 'archived' },
        },
        { projection: { _id: 1 } },
      )
      .toArray();
    return new Set(rows.map((r) => String(r['_id'])));
  }

  /**
   * Demandeur : l'appelant, ou un autre membre si l'appelant détient
   * `purchase.manage` ; il doit détenir EFFECTIVEMENT `purchase.request`.
   */
  private async resolveRequester(
    organizationId: string,
    requestedBy: string | undefined,
    actor: PurchaseOrderActor,
  ): Promise<string> {
    if (requestedBy === undefined || requestedBy === actor.userId) return actor.userId;
    if (!actorCan(actor, 'purchase.manage')) requiresManage(actor.role);
    const resolved = await this.authz.resolveOrgRole(requestedBy, organizationId);
    if (!resolved || !can(resolved.role, 'purchase.request', resolved.context)) {
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_REQUESTER_INELIGIBLE',
        message: 'Ce membre ne peut pas demander d’achat dans cette organisation.',
      });
    }
    return requestedBy;
  }

  /**
   * `purchase.request` couvre SA demande en brouillon ; tout le reste (demande d'un
   * autre, demande soumise ou approuvée) exige `purchase.manage` (§ 3.2).
   */
  private assertMayEdit(o: PurchaseOrderLean, actor: PurchaseOrderActor): void {
    if (actorCan(actor, 'purchase.manage')) return;
    if (o.status === 'draft' && isOwn(o, actor.userId)) return;
    requiresManage(actor.role);
  }

  private async soleApproverOrg(organizationId: string): Promise<boolean> {
    const [settings, count] = await Promise.all([
      this.settings.effective(organizationId),
      this.authz.countApprovers(organizationId, 'purchase.approve'),
    ]);
    return isSoleApproverOrg(settings.allowSoleApprover, count);
  }

  /** Détenteurs effectifs de `purchase.approve` éligibles pour cette demande (§ 6.5). */
  private async notifyApprovers(o: PurchaseOrderLean, actor: PurchaseOrderActor): Promise<void> {
    try {
      const sole = await this.soleApproverOrg(o.organizationId);
      const holders = await this.memberships
        .find(holdersFilter(o.organizationId, 'purchase.approve'), { userId: 1 })
        .lean<{ userId: string }[]>()
        .exec();
      const recipients = holders
        .map((m) => m.userId)
        .filter((u) => sole || (u !== o.requestedBy && u !== o.createdBy));
      await this.notifier.approvalRequested(this.notice(o, actor), recipients);
    } catch {
      // Les notifications ne défont jamais le geste (contrat du port).
    }
  }

  private notice(o: PurchaseOrderLean, actor: PurchaseOrderActor) {
    return {
      organizationId: o.organizationId,
      orderId: String(o._id),
      number: o.orderNumber ?? o.requestNumber ?? null,
      title: o.title,
      revision: o.revision,
      actorUserId: actor.userId,
    };
  }

  private auditBase(organizationId: string, actor: PurchaseOrderActor, orderId: string) {
    return {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetType: 'purchase_order',
      targetId: orderId,
    };
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

function supplierRequired(): never {
  conflict(
    'PURCHASE_ORDER_SUPPLIER_REQUIRED',
    'Choisissez le fournisseur avant de soumettre la demande.',
  );
}
