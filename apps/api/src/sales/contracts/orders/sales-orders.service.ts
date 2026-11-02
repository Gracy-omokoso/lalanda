// Commandes clients — ADR-0050 § 2.2, § 3, § 4.1, § 4.3. ADR-0050 — V2.
//
// - Une commande est composée et calculée par LE MÊME code que le brouillon de facture
//   (`InvoiceDraftsService.compose` → moteur `computeInvoiceTotals`) : aucune
//   opération sur un montant ici.
// - « Préparer la facture » crée un BROUILLON (pro forma) par
//   `InvoiceDraftsService.create`, seul écrivain autorisé de `sales_invoices`, puis
//   pose un lien `order_invoice` (`sales_document_links`). Rien n'est émis, rien n'est
//   normalisé, rien n'est envoyé à la DGI : « Émettre » et « Normaliser » restent les
//   routes existantes sous `sales.invoice`.
// - Le reste à facturer vient du moteur (`orderInvoicing`), à partir des lignes
//   figées de la commande et des lignes des factures liées.
// - Devis → commande : lignes à PRIX FIXÉS (ceux du devis), le devis n'est PAS
//   modifié (lecture seule par la connexion) ; une seule commande vivante par devis.
// - Rien n'est écrit dans le réalisé, la trésorerie ni la comptabilité.
//
// Isolation : chaque requête porte `organizationId` ; toute ressource d'une autre
// organisation répond 404. Concurrence : chaque écriture est conditionnée par la
// révision attendue (`409 STALE_REVISION`).

import { orderInvoicing, type OrderInvoicingResult } from '@lalanda/engine';
import { SALES_ORDER_NUMBER_PREFIX } from '@lalanda/shared/sales-contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../../authz/audit.service.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../../../crm/time-cursor.js';
import { kinshasaDay } from '../../../crm/crm-model.js';
import { InvoiceDraftsService } from '../../invoices/invoice-drafts.service.js';
import type { InvoiceActor, StoredLine } from '../../invoices/invoice.types.js';
import type { InvoiceDraftInput, LineInput } from '../../invoices/invoices.dto.js';
import { lineInputOf } from '../../quotes/quotes.service.js';
import {
  conflict,
  invalidCursor,
  invalidRequestOf,
  isDuplicateKey,
  staleRevision,
} from '../../sales.errors.js';
import { escapeRegex, isObjectIdHex, normalizeForSearch, searchKeyOf } from '../../search.js';
import {
  READ_ONLY_COLLECTIONS,
  contractsNotFound,
  nextEngagementNumber,
  type EngagementCounter,
} from '../common/contracts.common.js';
import {
  engagementDocumentOf,
  engineOrderLines,
  storedLineOf,
  type EngagementDocument,
  type EngagementLine,
} from '../common/engagement-document.js';
import {
  SalesContractFilesService,
  salesContractFileView,
  type SalesContractFileView,
} from '../files/sales-contract-files.service.js';
import {
  SalesDocumentLinksService,
  invoiceStateOf,
  linkedInvoiceInput,
  type LiveLink,
} from '../links/sales-document-links.service.js';
import {
  SALES_ORDER_INVOICING_LABELS,
  SALES_ORDER_STATUS_LABELS,
  compareQuantities,
  orderInvoiceComment,
  salesOrderActionsOf,
  type SalesOrderActions,
} from './sales-order-model.js';
import {
  SalesOrder,
  SalesOrderCounter,
  type SalesOrderCounterDocument,
  type SalesOrderDocument,
  type SalesOrderLean,
} from './sales-order.schema.js';
import type {
  ListSalesOrdersQuery,
  PrepareOrderInvoiceInput,
  QuoteToOrderInput,
  SalesOrderInput,
} from './sales-orders.dto.js';

/** Longueur maximale de la ligne de commentaire C (ADR-0023). */
const COMMENT_C_MAX = 255;

export interface SalesOrderWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SalesOrderSummary {
  id: string;
  number: string;
  status: SalesOrder['status'];
  statusLabel: string;
  customerId: string;
  customerName: string | null;
  customerReference: string | null;
  orderedOn: string;
  source: SalesOrder['source'];
  opportunityId: string | null;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  /** Total RECOPIÉ du calcul du moteur (`null` sans calcul). */
  total: string | null;
  invoicingStatus: OrderInvoicingResult['status'] | null;
  invoicingLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderLinkedInvoice {
  invoiceId: string;
  kind: string;
  type: string;
  status: string;
  state: 'draft' | 'issued';
  reference: string | null;
  currency: 'CDF' | 'USD';
  total: string | null;
  linkedAt: string;
}

export interface SalesOrderView extends SalesOrderSummary {
  customer: SalesOrderLean['customer'];
  /** Lignes ; `amount` RECOPIÉ du calcul du moteur. */
  lines: (EngagementLine & { amount: string | null })[];
  /** Corps de lignes à renvoyer pour modifier le brouillon (prix saisis conservés). */
  lineInputs: LineInput[];
  documentAmounts: SalesOrderLean['documentAmounts'];
  requestedDeliveryDate: string | null;
  notes: string | null;
  confirmedAt: string | null;
  closure: { at: string; by: string; reason: string } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  /** Reste à facturer, calculé par le moteur (`null` : calcul impossible). */
  invoicing: OrderInvoicingResult | null;
  invoices: SalesOrderLinkedInvoice[];
  files: SalesContractFileView[];
  actions: SalesOrderActions;
  /** Ce qui empêche de confirmer (brouillon seulement). */
  blockers: { code: string; message: string; lineIndex: number | null }[];
  warnings: SalesOrderWarning[];
  revision: number;
}

export interface SalesOrderPage {
  items: SalesOrderSummary[];
  nextCursor: string | null;
}

export interface SalesOrderFromQuoteResult {
  order: SalesOrderView;
  warnings: SalesOrderWarning[];
}

export interface PreparedOrderInvoice {
  invoiceId: string;
  warnings: SalesOrderWarning[];
  order: SalesOrderView;
}

export function salesOrderNotFound(): never {
  contractsNotFound('SALES_ORDER_NOT_FOUND', 'Commande client introuvable.');
}

function quoteNotFound(): never {
  contractsNotFound('QUOTE_NOT_FOUND', 'Devis introuvable.');
}

function orderNotInStatus(code: string, status: SalesOrder['status'], action: string): never {
  conflict(
    code,
    `Action « ${action} » impossible : la commande est « ${SALES_ORDER_STATUS_LABELS[
      status
    ].toLowerCase()} ».`,
    { status },
  );
}

/** Devis lu en lecture seule (champs utiles). */
interface QuoteRead {
  _id: Types.ObjectId;
  number: string;
  version: number;
  status: string;
  opportunityId: string | null;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: SalesOrderLean['customer'];
  lines: StoredLine[];
  conversion: { invoiceId: string } | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectModel(SalesOrder.name) private readonly orders: Model<SalesOrderDocument>,
    @InjectModel(SalesOrderCounter.name)
    private readonly counters: Model<SalesOrderCounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(SalesDocumentLinksService) private readonly links: SalesDocumentLinksService,
    @Inject(SalesContractFilesService) private readonly files: SalesContractFilesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async requireOwn(organizationId: string, orderId: string): Promise<SalesOrderLean> {
    if (!isObjectIdHex(orderId)) salesOrderNotFound();
    const doc = await this.orders
      .findOne({ _id: new Types.ObjectId(orderId), organizationId })
      .lean<SalesOrderLean>()
      .exec();
    if (!doc) salesOrderNotFound();
    return doc;
  }

  async list(organizationId: string, query: ListSalesOrdersQuery): Promise<SalesOrderPage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status !== 'all') and.push({ status: query.status });
    if (query.customerId) and.push({ customerId: query.customerId.toLowerCase() });
    if (query.quoteId) and.push({ 'source.quoteId': query.quoteId.toLowerCase() });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.orders
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<SalesOrderLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const live = await this.links.liveLinks(
      organizationId,
      page.map((o) => ({ orderId: String(o._id) })),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((o) =>
        this.summary(
          o,
          this.invoicingOf(
            o,
            live.filter((l) => l.link.orderId === String(o._id)),
          ),
        ),
      ),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  async view(organizationId: string, orderId: string): Promise<SalesOrderView> {
    return this.viewOf(organizationId, await this.requireOwn(organizationId, orderId));
  }

  /** Reste à facturer par le moteur ; `null` si une donnée liée est illisible. */
  private invoicingOf(
    order: SalesOrderLean,
    live: readonly LiveLink[],
  ): OrderInvoicingResult | null {
    if (order.lines.length === 0) return null;
    try {
      return orderInvoicing(
        engineOrderLines(order.lines),
        live.filter((l) => l.link.kind === 'order_invoice').map(linkedInvoiceInput),
      );
    } catch {
      return null;
    }
  }

  private summary(o: SalesOrderLean, invoicing: OrderInvoicingResult | null): SalesOrderSummary {
    return {
      id: String(o._id),
      number: o.number,
      status: o.status,
      statusLabel: SALES_ORDER_STATUS_LABELS[o.status],
      customerId: o.customerId,
      customerName: o.customer.name ?? null,
      customerReference: o.customerReference ?? null,
      orderedOn: o.orderedOn,
      source: o.source ?? null,
      opportunityId: o.opportunityId ?? null,
      currency: o.currency,
      priceMode: o.priceMode,
      total: o.documentAmounts.calculation.totals?.total ?? null,
      invoicingStatus: o.status === 'draft' ? null : (invoicing?.status ?? null),
      invoicingLabel:
        o.status === 'draft' || invoicing === null
          ? null
          : SALES_ORDER_INVOICING_LABELS[invoicing.status],
      createdAt: new Date(o.createdAt).toISOString(),
      updatedAt: new Date(o.updatedAt).toISOString(),
    };
  }

  private async viewOf(organizationId: string, o: SalesOrderLean): Promise<SalesOrderView> {
    const orderId = String(o._id);
    const [live, files] = await Promise.all([
      this.links.liveLinks(organizationId, [{ orderId }]),
      this.files.list(organizationId, { orderId }),
    ]);
    const invoicing = this.invoicingOf(o, live);
    const hasIssued = live.some((l) => invoiceStateOf(l.invoice.status) === 'issued');
    const blockers: SalesOrderView['blockers'] = [];
    if (o.status === 'draft') {
      if (o.lines.length === 0) {
        blockers.push({
          code: 'NO_LINES',
          message: 'Ajoutez au moins une ligne.',
          lineIndex: null,
        });
      }
      const calc = o.documentAmounts.calculation;
      if (!calc.ok && calc.issues.length === 0 && o.lines.length > 0) {
        blockers.push({
          code: 'TAX_RATES_UNAVAILABLE',
          message: 'Aucun taux de TVA DGI relevé : impossible de calculer la commande.',
          lineIndex: null,
        });
      }
      for (const i of calc.issues) {
        if (i.code === 'NO_LINES') continue;
        blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex });
      }
      // Le contrôle que l'émission appliquera (vendeur non assujetti), motif des devis.
      blockers.push(...(await this.drafts.sellerVatIssues(organizationId, o.lines)));
    }
    const warnings: SalesOrderWarning[] = [];
    const unmatched = (invoicing?.issues ?? []).filter((i) => i.code === 'UNMATCHED_LINE');
    if (unmatched.length > 0) {
      warnings.push({
        code: 'UNMATCHED_LINE',
        message:
          'Une ligne de facture liée ne correspond plus à la commande (article ou prix) : elle n’est pas comptée dans le reste à facturer.',
        details: {
          lines: unmatched.map((i) => ({
            invoiceId: i.invoiceId,
            lineRef: i.lineRef,
            invoiceLineIndex: i.invoiceLineIndex,
          })),
        },
      });
    }
    const totals = o.documentAmounts.calculation.totals;
    return {
      ...this.summary(o, invoicing),
      customer: o.customer,
      lines: o.lines.map((l) => ({
        ...l,
        amount: totals?.lines.find((t) => t.index === l.index)?.amount ?? null,
      })),
      lineInputs: o.lines.map((l) => lineInputOf(storedLineOf(l), false)),
      documentAmounts: o.documentAmounts,
      requestedDeliveryDate: o.requestedDeliveryDate ?? null,
      notes: o.notes ?? null,
      confirmedAt: iso(o.confirmedAt),
      closure: o.closure
        ? { at: iso(o.closure.at)!, by: o.closure.by, reason: o.closure.reason }
        : null,
      cancellation: o.cancellation
        ? { at: iso(o.cancellation.at)!, by: o.cancellation.by, reason: o.cancellation.reason }
        : null,
      invoicing: o.status === 'draft' ? null : invoicing,
      invoices: live.map(({ link, invoice }) => ({
        invoiceId: link.invoiceId,
        kind: link.kind,
        type: invoice.type,
        status: invoice.status,
        state: invoiceStateOf(invoice.status),
        reference: invoice.number ?? invoice.proformaRef ?? null,
        currency: invoice.currency,
        total: invoice.documentAmounts?.calculation?.totals?.total ?? null,
        linkedAt: new Date(link.linkedAt).toISOString(),
      })),
      files: files.map(salesContractFileView),
      actions: salesOrderActionsOf(o.status, invoicing, hasIssued),
      blockers,
      warnings,
      revision: o.revision,
    };
  }

  // ── Lectures d'autres modules (lecture seule) ────────────────────────────

  private async quoteOf(organizationId: string, quoteId: string): Promise<QuoteRead> {
    if (!isObjectIdHex(quoteId)) quoteNotFound();
    const doc = await this.connection.collection(READ_ONLY_COLLECTIONS.quotes).findOne(
      { _id: new Types.ObjectId(quoteId), organizationId },
      {
        projection: {
          number: 1,
          version: 1,
          status: 1,
          opportunityId: 1,
          currency: 1,
          priceMode: 1,
          customer: 1,
          lines: 1,
          conversion: 1,
        },
      },
    );
    if (!doc) quoteNotFound();
    return doc as unknown as QuoteRead;
  }

  private async assertOpportunity(organizationId: string, opportunityId: string): Promise<void> {
    const found = isObjectIdHex(opportunityId)
      ? await this.connection
          .collection(READ_ONLY_COLLECTIONS.opportunities)
          .findOne(
            { _id: new Types.ObjectId(opportunityId), organizationId },
            { projection: { _id: 1 } },
          )
      : null;
    if (!found) contractsNotFound('OPPORTUNITY_NOT_FOUND', 'Opportunité introuvable.');
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private auditBase(organizationId: string, actor: InvoiceActor, orderId: string) {
    return {
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetType: 'sales_order',
      targetId: orderId,
    };
  }

  private async compose(
    organizationId: string,
    draft: InvoiceDraftInput,
  ): Promise<EngagementDocument> {
    return engagementDocumentOf(await this.drafts.compose(organizationId, draft));
  }

  private searchKeyOf(
    number: string,
    doc: { customer: { name: string | null } },
    ref: string | null,
  ) {
    return searchKeyOf([number, doc.customer.name, ref]);
  }

  async create(
    organizationId: string,
    input: SalesOrderInput,
    actor: InvoiceActor,
  ): Promise<SalesOrderView> {
    if (input.header.opportunityId !== null) {
      await this.assertOpportunity(organizationId, input.header.opportunityId);
    }
    const doc = await this.compose(organizationId, input.draft);
    const created = await this.insert(
      organizationId,
      {
        ...input.header,
        ...doc,
        source: null,
        liveQuoteId: null,
      },
      actor,
    );
    await this.audit.record({
      ...this.auditBase(organizationId, actor, String(created._id)),
      action: 'sales_order.created',
      metadata: { number: created.number, currency: created.currency, source: null },
    });
    return this.viewOf(organizationId, created);
  }

  private async insert(
    organizationId: string,
    fields: Omit<SalesOrderInput['header'], never> &
      EngagementDocument & { source: SalesOrder['source']; liveQuoteId: string | null },
    actor: InvoiceActor,
  ): Promise<SalesOrderLean> {
    const customerId = fields.customer.customerId;
    if (!customerId) {
      conflict(
        'CUSTOMER_REQUIRED',
        'Un client est exigé : convertissez d’abord le prospect en client.',
      );
    }
    const number = await nextEngagementNumber(
      this.counters as unknown as Model<EngagementCounter>,
      organizationId,
      SALES_ORDER_NUMBER_PREFIX,
      new Date(),
    );
    const doc = await this.orders.create({
      organizationId,
      number,
      status: 'draft',
      customerId,
      customerReference: fields.customerReference,
      orderedOn: fields.orderedOn,
      source: fields.source,
      liveQuoteId: fields.liveQuoteId,
      opportunityId: fields.opportunityId,
      currency: fields.currency,
      priceMode: fields.priceMode,
      customer: fields.customer,
      lines: fields.lines,
      documentAmounts: fields.documentAmounts,
      requestedDeliveryDate: fields.requestedDeliveryDate,
      notes: fields.notes,
      confirmedAt: null,
      confirmedBy: null,
      closure: null,
      cancellation: null,
      searchKey: this.searchKeyOf(number, fields, fields.customerReference),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    return doc.toObject() as SalesOrderLean;
  }

  /**
   * `POST /sales/quotes/:id/to-order` (§ 4.1) : commande `draft` aux PRIX DU DEVIS
   * (même si le catalogue a changé), devis inchangé. Une seule commande vivante par
   * devis (`409 ORDER_EXISTS_FOR_QUOTE`). Une conversion du devis en facture déjà
   * faite est signalée (`QUOTE_ALREADY_CONVERTED`), jamais refusée.
   */
  async createFromQuote(
    organizationId: string,
    quoteId: string,
    input: QuoteToOrderInput,
    actor: InvoiceActor,
  ): Promise<SalesOrderFromQuoteResult> {
    const quote = await this.quoteOf(organizationId, quoteId);
    const id = String(quote._id);
    if (quote.status !== 'accepted') {
      conflict('QUOTE_NOT_ACCEPTED', 'Seul un devis accepté donne une commande.', {
        status: quote.status,
      });
    }
    if (!quote.customer?.customerId) {
      conflict(
        'CUSTOMER_REQUIRED',
        'Ce devis est adressé à un client de passage : créez d’abord la fiche client.',
      );
    }
    await this.assertNoLiveOrder(organizationId, id);
    const warnings: SalesOrderWarning[] = [];
    const convertedId = quote.conversion?.invoiceId ?? null;
    if (
      convertedId &&
      (await this.links.invoicesOf(organizationId, [convertedId])).has(convertedId)
    ) {
      warnings.push({
        code: 'QUOTE_ALREADY_CONVERTED',
        message:
          'Ce devis a déjà été converti en facture : vérifiez que la commande ne fait pas double emploi.',
        details: { invoiceId: convertedId },
      });
    }
    const doc = await this.compose(organizationId, {
      type: 'FV',
      currency: quote.currency,
      priceMode: quote.priceMode,
      customer: {
        customerId: quote.customer.customerId,
        printContactDetails: quote.customer.printContactDetails,
      },
      pointOfSaleId: null,
      lines: quote.lines.map((l) => lineInputOf(l, true)),
      payments: [],
      comments: { A: null, C: null },
      creditNote: null,
      showUsdCounterValue: false,
    });
    let created: SalesOrderLean;
    try {
      created = await this.insert(
        organizationId,
        {
          customerReference: input.customerReference,
          orderedOn: input.orderedOn ?? kinshasaDay(new Date()),
          opportunityId: quote.opportunityId ?? null,
          requestedDeliveryDate: input.requestedDeliveryDate,
          notes: input.notes,
          ...doc,
          source: { kind: 'quote', quoteId: id, quoteVersion: quote.version },
          liveQuoteId: id,
        },
        actor,
      );
    } catch (err) {
      if (isDuplicateKey(err)) await this.assertNoLiveOrder(organizationId, id);
      throw err;
    }
    await this.audit.record({
      ...this.auditBase(organizationId, actor, String(created._id)),
      action: 'sales_order.created',
      metadata: {
        number: created.number,
        currency: created.currency,
        source: 'quote',
        quoteId: id,
        quoteNumber: quote.number,
        quoteVersion: quote.version,
      },
    });
    return { order: await this.viewOf(organizationId, created), warnings };
  }

  private async assertNoLiveOrder(organizationId: string, quoteId: string): Promise<void> {
    const existing = await this.orders
      .findOne({ organizationId, liveQuoteId: quoteId }, { _id: 1, number: 1 })
      .lean<{ _id: Types.ObjectId; number: string }>()
      .exec();
    if (existing) {
      conflict('ORDER_EXISTS_FOR_QUOTE', 'Une commande existe déjà pour ce devis : ouvrez-la.', {
        orderId: String(existing._id),
        number: existing.number,
      });
    }
  }

  /** Écriture conditionnée par statut ET révision ; perte → 409 explicite. */
  private async transition(
    organizationId: string,
    current: SalesOrderLean,
    expectedRevision: number,
    set: Record<string, unknown>,
  ): Promise<SalesOrderLean> {
    const updated = await this.orders
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: current.status, revision: expectedRevision },
        { $set: set, $inc: { revision: 1 } },
        { new: true },
      )
      .lean<SalesOrderLean>()
      .exec();
    if (!updated) {
      const again = await this.requireOwn(organizationId, String(current._id));
      if (again.status !== current.status) {
        orderNotInStatus('SALES_ORDER_STATUS_CONFLICT', again.status, 'modifier');
      }
      staleRevision(again.revision);
    }
    return updated;
  }

  private async load(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
  ): Promise<SalesOrderLean> {
    const current = await this.requireOwn(organizationId, orderId);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    return current;
  }

  async put(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    input: SalesOrderInput,
    actor: InvoiceActor,
  ): Promise<SalesOrderView> {
    const current = await this.load(organizationId, orderId, expectedRevision);
    if (current.status !== 'draft') orderNotInStatus('ORDER_NOT_DRAFT', current.status, 'modifier');
    if (
      input.header.opportunityId !== null &&
      input.header.opportunityId !== (current.opportunityId ?? null)
    ) {
      await this.assertOpportunity(organizationId, input.header.opportunityId);
    }
    const doc = await this.compose(organizationId, input.draft);
    if (!doc.customer.customerId) {
      conflict(
        'CUSTOMER_REQUIRED',
        'Un client est exigé : convertissez d’abord le prospect en client.',
      );
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      ...input.header,
      ...doc,
      customerId: doc.customer.customerId,
      searchKey: this.searchKeyOf(current.number, doc, input.header.customerReference),
      updatedBy: actor.userId,
    });
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.updated',
      metadata: {
        number: current.number,
        total: doc.documentAmounts.calculation.totals?.total ?? null,
      },
    });
    return this.viewOf(organizationId, updated);
  }

  /** Brouillon seulement : la commande et ses pièces disparaissent (trou de numéro admis). */
  async remove(organizationId: string, orderId: string, actor: InvoiceActor): Promise<void> {
    const current = await this.requireOwn(organizationId, orderId);
    if (current.status !== 'draft')
      orderNotInStatus('ORDER_NOT_DRAFT', current.status, 'supprimer');
    const res = await this.orders
      .deleteOne({ _id: current._id, organizationId, status: 'draft' })
      .exec();
    if (res.deletedCount !== 1) salesOrderNotFound();
    await this.files.removeAll(organizationId, { orderId });
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.deleted',
      metadata: { number: current.number },
    });
  }

  /** « Confirmer » fige les lignes : calcul sans bloquant exigé. */
  async confirm(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<SalesOrderView> {
    const current = await this.load(organizationId, orderId, expectedRevision);
    if (current.status !== 'draft')
      orderNotInStatus('ORDER_NOT_DRAFT', current.status, 'confirmer');
    const view = await this.viewOf(organizationId, current);
    if (view.blockers.length > 0) {
      conflict('ORDER_NOT_READY', 'Cette commande ne peut pas encore être confirmée.', {
        blockers: view.blockers,
      });
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedBy: actor.userId,
      updatedBy: actor.userId,
    });
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.confirmed',
      metadata: { number: current.number, total: view.total },
    });
    return this.viewOf(organizationId, updated);
  }

  /** « Clore » : confirmée seulement, motif exigé (reliquat abandonné ou tout facturé). */
  async close(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    reason: string,
    actor: InvoiceActor,
  ): Promise<SalesOrderView> {
    const current = await this.load(organizationId, orderId, expectedRevision);
    if (current.status !== 'confirmed') {
      orderNotInStatus('ORDER_NOT_CONFIRMED', current.status, 'clore');
    }
    const live = await this.links.liveLinks(organizationId, [{ orderId }]);
    const invoicing = this.invoicingOf(current, live);
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'closed',
      closure: { at: new Date(), by: actor.userId, reason },
      updatedBy: actor.userId,
    });
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.closed',
      metadata: {
        number: current.number,
        reason,
        invoicingStatus: invoicing?.status ?? null,
        remaining: (invoicing?.lines ?? []).map((l) => ({
          lineRef: l.lineRef,
          remainingToInvoice: l.remainingToInvoice,
        })),
      },
    });
    return this.viewOf(organizationId, updated);
  }

  /** « Annuler » : brouillon, ou confirmée sans facture ÉMISE liée ; motif exigé. */
  async cancel(
    organizationId: string,
    orderId: string,
    expectedRevision: number,
    reason: string,
    actor: InvoiceActor,
  ): Promise<SalesOrderView> {
    const current = await this.load(organizationId, orderId, expectedRevision);
    if (current.status !== 'draft' && current.status !== 'confirmed') {
      orderNotInStatus('SALES_ORDER_STATUS_CONFLICT', current.status, 'annuler');
    }
    const live = await this.links.liveLinks(organizationId, [{ orderId }]);
    const issued = live.filter((l) => invoiceStateOf(l.invoice.status) === 'issued');
    if (issued.length > 0) {
      conflict(
        'ORDER_HAS_ISSUED_INVOICE',
        'Une facture émise est liée à cette commande : clôturez-la au lieu de l’annuler.',
        { invoiceIds: issued.map((l) => l.link.invoiceId) },
      );
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'cancelled',
      liveQuoteId: null,
      cancellation: { at: new Date(), by: actor.userId, reason },
      updatedBy: actor.userId,
    });
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.cancelled',
      metadata: { number: current.number, reason, previousStatus: current.status },
    });
    return this.viewOf(organizationId, updated);
  }

  /**
   * `POST /sales/orders/:id/prepare-invoice` (§ 3, § 4.3) : BROUILLON `FV`/`EV` aux
   * prix FIGÉS de la commande, pour les quantités demandées (par défaut tout le reste
   * à préparer calculé par le moteur), commentaire C « Commande CC… ». Rien n'est émis.
   */
  async prepareInvoice(
    organizationId: string,
    orderId: string,
    input: PrepareOrderInvoiceInput,
    actor: InvoiceActor,
  ): Promise<PreparedOrderInvoice> {
    const current = await this.load(organizationId, orderId, input.expectedRevision);
    if (current.status !== 'confirmed') {
      orderNotInStatus('ORDER_NOT_CONFIRMED', current.status, 'préparer une facture');
    }
    const live = await this.links.liveLinks(organizationId, [{ orderId }]);
    const invoicing = this.invoicingOf(current, live);
    if (invoicing === null) {
      conflict(
        'ORDER_INVOICING_UNAVAILABLE',
        'Le reste à facturer de cette commande ne peut pas être calculé : vérifiez les factures liées.',
      );
    }
    const remaining = new Map(invoicing.lines.map((l) => [l.lineRef, l.remainingToPrepare]));
    const byRef = new Map(current.lines.map((l) => [l.lineRef, l]));
    let selection: { line: EngagementLine; quantity: string }[];
    if (input.lines !== null) {
      const issues = input.lines.flatMap((l, i) =>
        byRef.has(l.lineRef)
          ? []
          : [
              {
                path: `lines.${i}.lineRef`,
                code: 'UNKNOWN_LINE_REF',
                message: 'Cette ligne n’existe pas dans la commande.',
              },
            ],
      );
      if (issues.length > 0) invalidRequestOf(issues);
      const exceeding = input.lines.filter(
        (l) => compareQuantities(l.quantity, remaining.get(l.lineRef) ?? '0') > 0,
      );
      if (exceeding.length > 0) {
        conflict(
          'ORDER_QUANTITY_EXCEEDS_REMAINING',
          'La quantité demandée dépasse le reste à facturer de la commande.',
          {
            lines: exceeding.map((l) => ({
              lineRef: l.lineRef,
              requested: l.quantity,
              remainingToPrepare: remaining.get(l.lineRef) ?? '0',
            })),
          },
        );
      }
      selection = input.lines.map((l) => ({ line: byRef.get(l.lineRef)!, quantity: l.quantity }));
    } else {
      selection = current.lines.flatMap((line) => {
        const q = remaining.get(line.lineRef) ?? '0';
        return compareQuantities(q, '0') > 0 ? [{ line, quantity: q }] : [];
      });
    }
    if (selection.length === 0) {
      conflict(
        'ORDER_NOTHING_TO_INVOICE',
        'Tout est déjà facturé ou en brouillon pour cette commande.',
      );
    }

    // Réservation par la révision : deux préparations concurrentes ne dépassent pas le reste.
    await this.transition(organizationId, current, input.expectedRevision, {
      updatedBy: actor.userId,
    });

    const warnings: SalesOrderWarning[] = [];
    const comment = orderInvoiceComment(current, COMMENT_C_MAX);
    if (comment.truncated) {
      warnings.push({
        code: 'COMMENT_TRUNCATED',
        message: `Le commentaire C dépassait ${COMMENT_C_MAX} caractères : il a été tronqué.`,
      });
    }
    const draft: InvoiceDraftInput = {
      type: input.type,
      currency: current.currency,
      priceMode: current.priceMode,
      customer: {
        customerId: current.customerId,
        printContactDetails: current.customer.printContactDetails,
      },
      pointOfSaleId: null,
      lines: selection.map(({ line, quantity }) => ({
        ...lineInputOf(storedLineOf(line), true),
        quantity,
      })),
      payments: [],
      comments: { A: null, C: comment.text },
      creditNote: null,
      showUsdCounterValue: false,
    };
    const invoice = await this.drafts.create(organizationId, draft, actor);
    const stored = (await this.links.invoicesOf(organizationId, [invoice.id])).get(invoice.id);
    try {
      if (!stored) throw new NotFoundException();
      await this.links.link(organizationId, {
        invoiceId: invoice.id,
        kind: 'order_invoice',
        orderId,
        lineMap: selection.map(({ line, quantity }, i) => ({
          invoiceLineIndex: stored.lines[i]!.index,
          lineRef: line.lineRef,
          quantity,
        })),
        linkedBy: actor.userId,
      });
    } catch (err) {
      // Sans lien, le brouillon fausserait le reste à facturer : il est retiré.
      await this.drafts.remove(organizationId, invoice.id, actor).catch(() => undefined);
      throw err;
    }
    // Comparaison des totaux (recopiés, jamais recalculés) quand tout est repris d'un coup.
    const whole =
      selection.length === current.lines.length &&
      selection.every((s) => compareQuantities(s.quantity, s.line.quantity) === 0);
    const ours = whole ? (current.documentAmounts.calculation.totals?.total ?? null) : null;
    const theirs = invoice.documentAmounts.calculation.totals?.total ?? null;
    if (ours !== null && theirs !== null && ours !== theirs) {
      warnings.push({
        code: 'AMOUNTS_DIFFER',
        message:
          'Le total du brouillon diffère de celui de la commande (taux DGI ou quantités) : vérifiez-le avant de l’émettre.',
        details: { order: ours, invoice: theirs },
      });
    }
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.invoice_prepared',
      metadata: {
        number: current.number,
        invoiceId: invoice.id,
        type: input.type,
        lines: selection.map(({ line, quantity }) => ({ lineRef: line.lineRef, quantity })),
      },
    });
    return {
      invoiceId: invoice.id,
      warnings,
      order: await this.view(organizationId, orderId),
    };
  }

  // ── Pièces du client (§ 2.6 : `customer_order`) ─────────────────────────

  /** Vérifie qu'une pièce peut être jointe AVANT de lire le corps. */
  async assertFileAttachable(organizationId: string, orderId: string): Promise<void> {
    const current = await this.requireOwn(organizationId, orderId);
    if (current.status !== 'draft' && current.status !== 'confirmed') {
      orderNotInStatus('SALES_ORDER_STATUS_CONFLICT', current.status, 'joindre une pièce');
    }
  }

  async addFile(
    organizationId: string,
    orderId: string,
    bytes: Buffer,
    rawFileName: unknown,
    actor: InvoiceActor,
  ): Promise<SalesContractFileView> {
    await this.assertFileAttachable(organizationId, orderId);
    const meta = await this.files.add(
      organizationId,
      { orderId },
      'customer_order',
      bytes,
      rawFileName,
      actor.userId,
    );
    await this.audit.record({
      ...this.auditBase(organizationId, actor, orderId),
      action: 'sales_order.file_added',
      metadata: { fileId: String(meta._id), size: meta.size, sha256: meta.sha256 },
    });
    return salesContractFileView(meta);
  }

  async readFile(organizationId: string, orderId: string, fileId: string) {
    await this.requireOwn(organizationId, orderId);
    return this.files.read(organizationId, { orderId }, fileId);
  }
}
