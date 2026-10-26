// Devis — ADR-0035 § 1.
//
// Un devis est composé et calculé par LE MÊME code que le brouillon de facture
// (`InvoiceDraftsService.compose` → moteur `computeInvoiceTotals`) : mêmes
// lignes, mêmes groupes de taxation, même conversion TTC ↔ HT, mêmes remises.
// Il ne fait AUCUNE opération sur un montant.
//
// Il se CONVERTIT en brouillon de facture par `InvoiceDraftsService.create` — la
// seule écriture du devis dans `sales_invoices` — puis la facture suit son
// propre circuit (pro forma, émission ou normalisation DGI, ADR-0023/0024), sans
// rien savoir du devis.
//
// Isolation : chaque requête porte `organizationId` ; un devis, une opportunité
// ou un client d'une autre organisation est introuvable (404). Concurrence :
// chaque écriture est conditionnée par la révision attendue.

import type { LineDiscount } from '@lalanda/engine';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { addDays, kinshasaDay } from '../../crm/crm-model.js';
import { OpportunitiesService } from '../../crm/opportunities.service.js';
import { conflict, invalidCursor, isDuplicateKey, staleRevision } from '../sales.errors.js';
import { escapeRegex, isObjectIdHex, normalizeForSearch, searchKeyOf } from '../search.js';
import { InvoiceDraftsService } from '../invoices/invoice-drafts.service.js';
import type { InvoiceActor, InvoiceLean, StoredLine } from '../invoices/invoice.types.js';
import type { InvoiceDraftInput, LineInput } from '../invoices/invoices.dto.js';
import { beforeTimeCursor, decodeTimeCursor, encodeTimeCursor } from '../../crm/time-cursor.js';
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  QUOTE_STATUS_LABELS,
  formatQuoteNumber,
  quoteActionsOf,
  quoteNumberingOf,
  quoteStatusOf,
} from './quote-model.js';
import {
  SalesQuote,
  SalesQuoteCounter,
  type QuoteLean,
  type QuoteStatus,
  type QuoteVersionSnapshot,
  type SalesQuoteCounterDocument,
  type SalesQuoteDocument,
} from './quote.schema.js';
import type { ListQuotesQuery, QuoteInput } from './quotes.dto.js';

export interface QuoteSummary {
  id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  statusLabel: string;
  title: string | null;
  customerName: string | null;
  customerId: string | null;
  opportunityId: string | null;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  total: string | null;
  validUntil: string;
  convertedInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteView extends QuoteSummary {
  notes: string | null;
  customer: QuoteLean['customer'];
  /** Lignes ; `amount` RECOPIÉ du calcul du moteur (`null` sans calcul). */
  lines: (StoredLine & { amount: string | null })[];
  /** Corps de lignes à renvoyer pour modifier le brouillon (prix saisis conservés). */
  lineInputs: LineInput[];
  documentAmounts: QuoteLean['documentAmounts'];
  sentAt: string | null;
  acceptedAt: string | null;
  refusedAt: string | null;
  refusalReason: string | null;
  opportunityOutcome: QuoteLean['opportunityOutcome'];
  opportunity: { id: string; title: string | null } | null;
  conversion: {
    invoiceId: string;
    convertedAt: string;
    /** Le brouillon créé existe encore ; sinon on peut reconvertir. */
    alive: boolean;
    invoiceStatus: string | null;
    reference: string | null;
  } | null;
  previousVersions: {
    version: number;
    status: QuoteStatus;
    total: string | null;
    sentAt: string | null;
    supersededAt: string;
  }[];
  actions: ReturnType<typeof quoteActionsOf>;
  /** Ce qui empêche de marquer le devis envoyé (brouillon seulement). */
  blockers: { code: string; message: string; lineIndex: number | null }[];
  revision: number;
}

export interface QuotePage {
  items: QuoteSummary[];
  nextCursor: string | null;
}

export interface QuoteConversionResult {
  quote: QuoteView;
  invoiceId: string;
  /** Total de la facture ≠ total du devis (taux DGI ou groupe d'article changés) : le signaler. */
  amountsDiffer: boolean;
}

export function quoteNotFound(): never {
  throw new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Devis introuvable.' });
}

function quoteNotInStatus(status: QuoteStatus, action: string): never {
  conflict(
    'QUOTE_STATUS_CONFLICT',
    `Action « ${action} » impossible : le devis est « ${QUOTE_STATUS_LABELS[status].toLowerCase()} ».`,
    { status },
  );
}

/**
 * Ligne stockée → corps de ligne de l'API. `pinPrice` : le prix avant remise
 * est envoyé explicitement (conversion : le prix du devis engage) ; sinon une
 * ligne de catalogue au prix du catalogue le reprend du catalogue.
 */
export function lineInputOf(l: StoredLine, pinPrice: boolean): LineInput {
  const base = l.originalPrice ?? l.unitPrice;
  const discount: LineDiscount | null = l.discount ?? null;
  if (l.source === 'catalog' && l.catalogItemId) {
    return {
      source: 'catalog',
      catalogItemId: l.catalogItemId,
      quantity: l.quantity,
      unitPrice: pinPrice || l.priceOverridden ? base : null,
      discount,
    };
  }
  return {
    source: 'free',
    code: l.code,
    name: l.name,
    itemType: l.itemType,
    taxGroup: l.taxGroup,
    outOfScope: l.outOfScope,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: base,
    specificTax: l.specificTax,
    discount,
  };
}

@Injectable()
export class QuotesService {
  constructor(
    @InjectModel(SalesQuote.name) private readonly quotes: Model<SalesQuoteDocument>,
    @InjectModel(SalesQuoteCounter.name)
    private readonly counters: Model<SalesQuoteCounterDocument>,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
  ) {}

  // ── Lecture ──────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListQuotesQuery): Promise<QuotePage> {
    const today = kinshasaDay(new Date());
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status === 'expired') and.push({ status: 'sent', validUntil: { $lt: today } });
    else if (query.status === 'sent') and.push({ status: 'sent', validUntil: { $gte: today } });
    else if (query.status !== 'all') and.push({ status: query.status });
    if (query.customerId) and.push({ 'customer.customerId': query.customerId.toLowerCase() });
    if (query.opportunityId) and.push({ opportunityId: query.opportunityId.toLowerCase() });
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeTimeCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push(beforeTimeCursor('createdAt', cursor));
    }
    const docs = await this.quotes
      .find({ $and: and })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<QuoteLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((q) => this.summary(q, today)),
      nextCursor:
        docs.length > query.limit && last
          ? encodeTimeCursor(new Date(last.createdAt), String(last._id))
          : null,
    };
  }

  private summary(q: QuoteLean, today: string): QuoteSummary {
    const status = quoteStatusOf(q.status, q.validUntil, today);
    return {
      id: String(q._id),
      number: q.number,
      version: q.version,
      status,
      statusLabel: QUOTE_STATUS_LABELS[status],
      title: q.title ?? null,
      customerName: q.customer.name ?? null,
      customerId: q.customer.customerId ?? null,
      opportunityId: q.opportunityId ?? null,
      currency: q.currency,
      priceMode: q.priceMode,
      total: q.documentAmounts.calculation.totals?.total ?? null,
      validUntil: q.validUntil,
      convertedInvoiceId: q.conversion?.invoiceId ?? null,
      createdAt: new Date(q.createdAt).toISOString(),
      updatedAt: new Date(q.updatedAt).toISOString(),
    };
  }

  async view(organizationId: string, quoteId: string): Promise<QuoteView> {
    return this.viewOf(organizationId, await this.requireOwn(organizationId, quoteId));
  }

  async requireOwn(organizationId: string, quoteId: string): Promise<QuoteLean> {
    if (!isObjectIdHex(quoteId)) quoteNotFound();
    const doc = await this.quotes
      .findOne({ _id: new Types.ObjectId(quoteId), organizationId })
      .lean<QuoteLean>()
      .exec();
    if (!doc) quoteNotFound();
    return doc;
  }

  /** Brouillon de facture issu de la conversion, s'il existe encore. */
  private async convertedInvoice(
    organizationId: string,
    q: QuoteLean,
  ): Promise<InvoiceLean | null> {
    const id = q.conversion?.invoiceId;
    if (!id || !isObjectIdHex(id)) return null;
    // Lecture par le service des brouillons : le devis n'injecte pas le modèle
    // `sales_invoices`, dont les écrivains sont comptés (invoices.sources.test.ts).
    try {
      return await this.drafts.requireOwn(organizationId, id);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }

  private async viewOf(organizationId: string, q: QuoteLean): Promise<QuoteView> {
    const now = new Date();
    const today = kinshasaDay(now);
    const status = quoteStatusOf(q.status, q.validUntil, today);
    const [invoice, opportunity] = await Promise.all([
      this.convertedInvoice(organizationId, q),
      q.opportunityId
        ? this.opportunities.requireOwn(organizationId, q.opportunityId).catch(() => null)
        : Promise.resolve(null),
    ]);
    const blockers: QuoteView['blockers'] = [];
    if (status === 'draft') {
      if (q.lines.length === 0) {
        blockers.push({
          code: 'NO_LINES',
          message: 'Ajoutez au moins une ligne.',
          lineIndex: null,
        });
      }
      const calc = q.documentAmounts.calculation;
      if (!calc.ok && calc.issues.length === 0 && q.lines.length > 0) {
        blockers.push({
          code: 'TAX_RATES_UNAVAILABLE',
          message: 'Aucun taux de TVA DGI relevé : impossible de calculer le devis.',
          lineIndex: null,
        });
      }
      for (const i of calc.issues) {
        if (i.code === 'NO_LINES') continue;
        blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex });
      }
      // Vendeur non assujetti (amendement du 27 oct. 2026) : les groupes réservés
      // aux assujettis bloqueraient l'émission de la facture convertie — le devis
      // ne part pas avec eux.
      blockers.push(...(await this.drafts.sellerVatIssues(organizationId, q.lines)));
      if (q.validUntil < today) {
        blockers.push({
          code: 'QUOTE_VALIDITY_PASSED',
          message: 'La date de validité est passée : choisissez une date à venir.',
          lineIndex: null,
        });
      }
    }
    return {
      ...this.summary(q, today),
      notes: q.notes ?? null,
      customer: q.customer,
      lines: q.lines.map((l) => ({
        ...l,
        amount:
          q.documentAmounts.calculation.totals?.lines.find((t) => t.index === l.index)?.amount ??
          null,
      })),
      lineInputs: q.lines.map((l) => lineInputOf(l, false)),
      documentAmounts: q.documentAmounts,
      sentAt: q.sentAt ? new Date(q.sentAt).toISOString() : null,
      acceptedAt: q.acceptedAt ? new Date(q.acceptedAt).toISOString() : null,
      refusedAt: q.refusedAt ? new Date(q.refusedAt).toISOString() : null,
      refusalReason: q.refusalReason ?? null,
      opportunityOutcome: q.opportunityOutcome ?? null,
      opportunity: q.opportunityId
        ? { id: q.opportunityId, title: opportunity?.title ?? null }
        : null,
      conversion: q.conversion
        ? {
            invoiceId: q.conversion.invoiceId,
            convertedAt: new Date(q.conversion.convertedAt).toISOString(),
            alive: invoice !== null,
            invoiceStatus: invoice?.status ?? null,
            reference: invoice ? (invoice.number ?? invoice.proformaRef) : null,
          }
        : null,
      previousVersions: (q.previousVersions ?? []).map((v) => ({
        version: v.version,
        status: v.status,
        total: v.documentAmounts.calculation.totals?.total ?? null,
        sentAt: v.sentAt ? new Date(v.sentAt).toISOString() : null,
        supersededAt: new Date(v.supersededAt).toISOString(),
      })),
      actions: quoteActionsOf(status, invoice !== null),
      blockers,
      revision: q.revision,
    };
  }

  // ── Écritures ────────────────────────────────────────────────────────────

  private async nextNumber(organizationId: string, now: Date): Promise<string> {
    const { year, period } = quoteNumberingOf(now);
    const bump = () =>
      this.counters
        .findOneAndUpdate(
          { organizationId, year },
          { $inc: { last: 1 }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true, new: true },
        )
        .lean<SalesQuoteCounter>()
        .exec();
    let counter: SalesQuoteCounter | null;
    try {
      counter = await bump();
    } catch (err) {
      // Première création concurrente du compteur : la seconde bute sur l'index unique.
      if (!isDuplicateKey(err)) throw err;
      counter = await bump();
    }
    return formatQuoteNumber(period, counter!.last);
  }

  /** Champs composés : instantané client, lignes, calcul du moteur (code des factures). */
  private async compose(organizationId: string, input: QuoteInput) {
    if (input.opportunityId !== null) {
      await this.opportunities.requireOwn(organizationId, input.opportunityId);
    }
    const composed = await this.drafts.compose(organizationId, input.draft);
    return {
      opportunityId: input.opportunityId,
      title: input.title,
      notes: input.notes,
      currency: composed.currency,
      priceMode: composed.priceMode,
      customer: composed.customer,
      lines: composed.lines,
      documentAmounts: {
        currency: composed.documentAmounts.currency,
        calculation: composed.documentAmounts.calculation,
        paymentsCheck: null,
      },
    };
  }

  private searchKeyOf(
    number: string,
    c: { customer: { name: string | null }; title: string | null },
  ) {
    return searchKeyOf([number, c.customer.name, c.title]);
  }

  async create(organizationId: string, input: QuoteInput, actor: InvoiceActor): Promise<QuoteView> {
    const composed = await this.compose(organizationId, input);
    const now = new Date();
    const number = await this.nextNumber(organizationId, now);
    const doc = await this.quotes.create({
      organizationId,
      number,
      version: 1,
      status: 'draft',
      ...composed,
      validUntil: input.validUntil ?? addDays(kinshasaDay(now), DEFAULT_QUOTE_VALIDITY_DAYS),
      sentAt: null,
      acceptedAt: null,
      refusedAt: null,
      refusalReason: null,
      opportunityOutcome: null,
      conversion: null,
      previousVersions: [],
      searchKey: this.searchKeyOf(number, composed),
      revision: 1,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    return this.viewOf(organizationId, doc.toObject() as QuoteLean);
  }

  /** Écriture conditionnée par statut ET révision ; perte → 409 explicite. */
  private async transition(
    organizationId: string,
    current: QuoteLean,
    expectedRevision: number,
    set: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Promise<QuoteLean> {
    const updated = await this.quotes
      .findOneAndUpdate(
        {
          _id: current._id,
          organizationId,
          status: current.status,
          revision: expectedRevision,
        },
        { $set: set, $inc: { revision: 1 }, ...extra },
        { new: true },
      )
      .lean<QuoteLean>()
      .exec();
    if (!updated) {
      const again = await this.requireOwn(organizationId, String(current._id));
      if (again.status !== current.status) {
        quoteNotInStatus(
          quoteStatusOf(again.status, again.validUntil, kinshasaDay(new Date())),
          'modifier',
        );
      }
      staleRevision(again.revision);
    }
    return updated;
  }

  private async load(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
  ): Promise<{ current: QuoteLean; status: QuoteStatus; today: string }> {
    const current = await this.requireOwn(organizationId, quoteId);
    const today = kinshasaDay(new Date());
    const status = quoteStatusOf(current.status, current.validUntil, today);
    if (current.revision !== expectedRevision) staleRevision(current.revision);
    return { current, status, today };
  }

  async put(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    input: QuoteInput,
    actor: InvoiceActor,
  ): Promise<QuoteView> {
    const { current, status } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'draft') quoteNotInStatus(status, 'modifier');
    const composed = await this.compose(organizationId, input);
    const updated = await this.transition(organizationId, current, expectedRevision, {
      ...composed,
      validUntil: input.validUntil ?? current.validUntil,
      searchKey: this.searchKeyOf(current.number, composed),
      updatedBy: actor.userId,
    });
    return this.viewOf(organizationId, updated);
  }

  /** Brouillon de première version, jamais envoyé : sinon, on le refuse. */
  async remove(organizationId: string, quoteId: string): Promise<void> {
    const current = await this.requireOwn(organizationId, quoteId);
    if (current.status !== 'draft' || current.version !== 1 || current.sentAt !== null) {
      conflict(
        'QUOTE_NOT_DELETABLE',
        'Seul un devis jamais envoyé se supprime ; sinon, marquez-le refusé.',
        { status: current.status, version: current.version },
      );
    }
    const res = await this.quotes
      .deleteOne({ _id: current._id, organizationId, status: 'draft', version: 1 })
      .exec();
    if (res.deletedCount !== 1) quoteNotFound();
  }

  async send(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<QuoteView> {
    const { current, status } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'draft') quoteNotInStatus(status, 'marquer envoyé');
    const view = await this.viewOf(organizationId, current);
    if (view.blockers.length > 0) {
      conflict('QUOTE_NOT_READY', 'Ce devis ne peut pas encore être envoyé.', {
        blockers: view.blockers,
      });
    }
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'sent',
      sentAt: new Date(),
      updatedBy: actor.userId,
    });
    return this.viewOf(organizationId, updated);
  }

  /**
   * Acceptation : `sent` non expiré seulement. Règle de gain (ADR-0035 § 1) :
   * l'opportunité ouverte rattachée passe à « gagnée » si le réglage le permet.
   */
  async accept(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<QuoteView> {
    const { current, status } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'sent') quoteNotInStatus(status, 'accepter');
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'accepted',
      acceptedAt: new Date(),
      updatedBy: actor.userId,
    });
    const outcome = await this.opportunities.markWonFromQuote(
      organizationId,
      current.opportunityId ?? null,
      String(current._id),
      { userId: actor.userId, role: actor.role },
    );
    await this.quotes
      .updateOne(
        { _id: current._id, organizationId },
        { $set: { opportunityOutcome: outcome } },
        { timestamps: false },
      )
      .exec();
    return this.viewOf(organizationId, { ...updated, opportunityOutcome: outcome });
  }

  async refuse(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    reason: string | null,
    actor: InvoiceActor,
  ): Promise<QuoteView> {
    const { current, status } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'sent' && status !== 'expired') quoteNotInStatus(status, 'refuser');
    const updated = await this.transition(organizationId, current, expectedRevision, {
      status: 'refused',
      refusedAt: new Date(),
      refusalReason: reason,
      updatedBy: actor.userId,
    });
    return this.viewOf(organizationId, updated);
  }

  /** Nouvelle version : l'actuelle est figée dans l'historique, un brouillon reprend son contenu. */
  async newVersion(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<QuoteView> {
    const { current, status, today } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'sent' && status !== 'refused' && status !== 'expired') {
      quoteNotInStatus(status, 'nouvelle version');
    }
    const now = new Date();
    const snapshot: QuoteVersionSnapshot = {
      version: current.version,
      status,
      title: current.title ?? null,
      notes: current.notes ?? null,
      validUntil: current.validUntil,
      currency: current.currency,
      priceMode: current.priceMode,
      customer: current.customer,
      lines: current.lines,
      documentAmounts: current.documentAmounts,
      sentAt: current.sentAt ?? null,
      refusedAt: current.refusedAt ?? null,
      refusalReason: current.refusalReason ?? null,
      supersededAt: now,
      supersededBy: actor.userId,
    };
    const updated = await this.transition(
      organizationId,
      current,
      expectedRevision,
      {
        status: 'draft',
        version: current.version + 1,
        validUntil:
          current.validUntil > today
            ? current.validUntil
            : addDays(today, DEFAULT_QUOTE_VALIDITY_DAYS),
        sentAt: null,
        refusedAt: null,
        refusalReason: null,
        updatedBy: actor.userId,
      },
      { $push: { previousVersions: snapshot } },
    );
    return this.viewOf(organizationId, updated);
  }

  /**
   * Conversion en brouillon de facture `FV` (ADR-0035 § 1, O3) : client, devise,
   * mode de prix, lignes à PRIX FIXÉS (ceux du devis), objet en commentaire C.
   * La facture suit ensuite son propre circuit. Une seule conversion vivante.
   */
  async convert(
    organizationId: string,
    quoteId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<QuoteConversionResult> {
    const { current, status } = await this.load(organizationId, quoteId, expectedRevision);
    if (status !== 'accepted') quoteNotInStatus(status, 'convertir en facture');
    if ((await this.convertedInvoice(organizationId, current)) !== null) {
      conflict(
        'QUOTE_ALREADY_CONVERTED',
        'Ce devis a déjà été converti : ouvrez la facture créée.',
        { invoiceId: current.conversion!.invoiceId },
      );
    }
    // Réservation par la révision : deux conversions concurrentes ne créent pas deux factures.
    const claimed = await this.transition(organizationId, current, expectedRevision, {
      updatedBy: actor.userId,
    });

    const reference = `Devis ${current.number} v${current.version}${current.title ? ` — ${current.title}` : ''}`;
    const c = current.customer;
    const input: InvoiceDraftInput = {
      type: 'FV',
      currency: current.currency,
      priceMode: current.priceMode,
      customer: c.customerId
        ? { customerId: c.customerId, printContactDetails: c.printContactDetails }
        : { customerId: null, walkInName: c.name },
      pointOfSaleId: null,
      lines: current.lines.map((l) => lineInputOf(l, true)),
      payments: [],
      comments: { A: null, C: reference.slice(0, 255) },
      creditNote: null,
      showUsdCounterValue: false,
    };
    const invoice = await this.drafts.create(organizationId, input, actor);
    await this.quotes
      .updateOne(
        { _id: current._id, organizationId, revision: claimed.revision },
        {
          $set: {
            conversion: {
              invoiceId: invoice.id,
              convertedAt: new Date(),
              convertedBy: actor.userId,
            },
          },
          $inc: { revision: 1 },
        },
      )
      .exec();
    const ours = current.documentAmounts.calculation.totals?.total ?? null;
    const theirs = invoice.documentAmounts.calculation.totals?.total ?? null;
    return {
      quote: await this.view(organizationId, quoteId),
      invoiceId: invoice.id,
      amountsDiffer: ours !== theirs,
    };
  }
}
