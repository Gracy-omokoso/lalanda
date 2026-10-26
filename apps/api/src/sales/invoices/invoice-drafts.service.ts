// Brouillons (pro forma) des documents de vente — ADR-0023 § S25e.1, § S25e.2,
// § S25e.7, § S25e.14.
//
// Un brouillon est composé dans la devise choisie par l'utilisateur et
// recalculé par le moteur à chaque enregistrement ; il porte une référence de
// pro forma `PF-…` (hors série fiscale) et JAMAIS de numéro de facture. Les
// instantanés (client, lignes) sont recopiés à chaque enregistrement et ne se
// figent qu'au gel (`InvoiceFreezingService`).
//
// Isolation : chaque requête porte `organizationId` ; un document d'une autre
// organisation est « introuvable » (404). Concurrence : `findOneAndUpdate`
// conditionné par la révision.
//
// Aucune opération arithmétique sur un montant : conversion TTC ↔ HT par
// `convertUnitPrice`, remise par `discountedUnitPrice`, totaux par
// `computeInvoiceTotals`, paiements par `checkPayments` (moteur), restes à
// créditer par `remainingQuantities`.

import {
  OUT_OF_SCOPE_ITEM_CODE,
  convertUnitPrice,
  discountedUnitPrice,
  remainingQuantities,
  type DecimalString,
  type LineDiscount,
  type PriceMode,
  type SpecificTax,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import { NormalizedInvoicingService } from '../../fiscal/normalized-invoicing.service.js';
import { PointsOfSaleService } from '../../fiscal/points-of-sale.service.js';
import { CatalogItem, type CatalogItemDocument } from '../catalog-item.schema.js';
import { Customer, type CustomerDocument } from '../customer.schema.js';
import {
  catalogItemNotFound,
  customerNotFound,
  invalidCursor,
  type SalesIssue,
} from '../sales.errors.js';
import { escapeRegex, isObjectIdHex, normalizeForSearch } from '../search.js';
import { assertCreditableOrigin } from './credit-note-rules.js';
import { ExchangeRateReferenceService } from './exchange-rate-reference.service.js';
import {
  InvoiceTaxRatesReader,
  calculate,
  paymentsCheckOf,
  sellerVatStatusOf,
} from './invoice-calculation.js';
import { InvoiceNumberingService } from './invoice-numbering.service.js';
import { invoiceSearchKey } from './invoice-search.js';
import { creditNoteSummary, invoiceSummary, invoiceView } from './invoice-view.js';
import type {
  EmissionMode,
  InvoicePage,
  InvoiceReadiness,
  InvoiceView,
  ReadinessBlockerCode,
  SelectablePointsOfSale,
} from './invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from './invoice.schema.js';
import type {
  InvoiceActor,
  InvoiceCampaignLabel,
  InvoiceLean,
  StoredCustomer,
  StoredLine,
  StoredTaxRates,
} from './invoice.types.js';
import type { InvoiceDraftInput, ListInvoicesQuery } from './invoices.dto.js';
import {
  invalidInvoiceRequest,
  invoiceConflict,
  invoiceNotDraft,
  invoiceNotFound,
  staleInvoiceRevision,
} from './invoices.errors.js';

type CustomerLean = Customer & { _id: Types.ObjectId };
type ItemLean = CatalogItem & { _id: Types.ObjectId };

/** Champs du brouillon recalculés à chaque enregistrement. */
export type ComposedDraft = Pick<
  SalesInvoice,
  | 'type'
  | 'currency'
  | 'priceMode'
  | 'customer'
  | 'pointOfSaleId'
  | 'lines'
  | 'payments'
  | 'comments'
  | 'creditNote'
  | 'showUsdCounterValue'
  | 'documentAmounts'
>;

const WALK_IN: Omit<StoredCustomer, 'name'> = {
  customerId: null,
  type: 'PP',
  nif: null,
  exemptionReference: null,
  phone: null,
  email: null,
  address: null,
  printContactDetails: false,
};

/** Taxe spécifique du catalogue (`{ kind, amount?, rate? }`) → forme du moteur. */
function specificTaxOf(raw: CatalogItem['specificTax']): SpecificTax | null {
  if (!raw) return null;
  if (raw.kind === 'per_unit' && raw.amount) return { kind: 'per_unit', amount: raw.amount };
  if (raw.kind === 'percent' && raw.rate) return { kind: 'percent', rate: raw.rate };
  return null;
}

/** Curseur de liste : `{ t: sortAt ISO, i: id }` en base64url. */
function encodeListCursor(sortAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: sortAt.toISOString(), i: id }), 'utf8').toString(
    'base64url',
  );
}

function decodeListCursor(raw: string): { sortAt: Date; id: Types.ObjectId } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { t, i } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || typeof i !== 'string' || !isObjectIdHex(i)) return null;
    const sortAt = new Date(t);
    if (Number.isNaN(sortAt.getTime()) || encodeListCursor(sortAt, i) !== raw) return null;
    return { sortAt, id: new Types.ObjectId(i) };
  } catch {
    return null;
  }
}

@Injectable()
export class InvoiceDraftsService {
  constructor(
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(CatalogItem.name) private readonly items: Model<CatalogItemDocument>,
    @Inject(InvoiceNumberingService) private readonly numbering: InvoiceNumberingService,
    @Inject(InvoiceTaxRatesReader) private readonly taxRates: InvoiceTaxRatesReader,
    @Inject(ExchangeRateReferenceService) private readonly exchange: ExchangeRateReferenceService,
    @Inject(NormalizedInvoicingService) private readonly normalized: NormalizedInvoicingService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ── Lecture ────────────────────────────────────────────────────────────────

  async list(organizationId: string, query: ListInvoicesQuery): Promise<InvoicePage> {
    const and: Record<string, unknown>[] = [{ organizationId }];
    if (query.status === 'final') and.push({ status: { $in: ['issued', 'normalized'] } });
    else if (query.status !== 'all') and.push({ status: query.status });
    if (query.type) and.push({ type: query.type });
    if (query.currency) and.push({ currency: query.currency });
    if (query.customerId) and.push({ 'customer.customerId': query.customerId.toLowerCase() });
    if (query.year !== undefined) {
      // Année civile à Kinshasa (UTC+1, sans heure d'été).
      and.push({
        sortAt: {
          $gte: new Date(`${query.year}-01-01T00:00:00+01:00`),
          $lt: new Date(`${query.year + 1}-01-01T00:00:00+01:00`),
        },
      });
    }
    if (query.q !== undefined) {
      const term = normalizeForSearch(query.q);
      if (term !== '') and.push({ searchKey: { $regex: escapeRegex(term) } });
    }
    if (query.cursor !== undefined) {
      const cursor = decodeListCursor(query.cursor);
      if (cursor === null) invalidCursor();
      and.push({
        $or: [
          { sortAt: { $lt: cursor.sortAt } },
          { sortAt: cursor.sortAt, _id: { $lt: cursor.id } },
        ],
      });
    }
    const docs = await this.invoices
      .find({ $and: and })
      .sort({ sortAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<InvoiceLean[]>()
      .exec();
    const page = docs.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(invoiceSummary),
      nextCursor:
        docs.length > query.limit && last
          ? encodeListCursor(new Date(last.sortAt), String(last._id))
          : null,
    };
  }

  /**
   * Points de vente proposables pour un brouillon (ADR-0026, écart C6) : ceux
   * qui sont ACTIFS dans l'environnement DGI de l'organisation. Rien de
   * technique (jeton, état, test) : la liste est lisible en `sales.read`.
   */
  async selectablePointsOfSale(organizationId: string): Promise<SelectablePointsOfSale> {
    const [emissionMode, settings, all] = await Promise.all([
      this.normalized.emissionModeOf(organizationId),
      this.state.read(organizationId),
      this.pointsOfSale.list(organizationId),
    ]);
    return {
      emissionMode,
      environment: settings.environment,
      items: all
        .filter((p) => p.environment === settings.environment && p.status === 'active')
        .map((p) => ({
          id: p.id,
          label: p.label,
          nim: p.dgi?.nim ?? null,
          shopName: p.dgi?.shopName ?? null,
        })),
    };
  }

  /**
   * Factures émises ou normalisées datées de `[from, to[` (export du journal,
   * ADR-0026 § 6.3) — LECTURE seule, documents figés tels quels, par date.
   * `limit` + 1 documents au plus : l'appelant détecte le dépassement.
   */
  async finalBetween(
    organizationId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<InvoiceLean[]> {
    return this.invoices
      .find({
        organizationId,
        status: { $in: ['issued', 'normalized'] },
        sortAt: { $gte: from, $lt: to },
      })
      .sort({ sortAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean<InvoiceLean[]>()
      .exec();
  }

  async view(organizationId: string, invoiceId: string): Promise<InvoiceView> {
    const doc = await this.requireOwn(organizationId, invoiceId);
    return this.viewOf(organizationId, doc);
  }

  /**
   * Documents d'une campagne d'homologation (ADR-0026 § 7), tous statuts, dans
   * l'ordre de création. Lecture seule, réservée à la ligne de commande
   * `edef:homologation` (aucune route) : sert à reprendre sans renormaliser.
   */
  async campaignDocuments(organizationId: string, campaignId: string): Promise<InvoiceLean[]> {
    return this.invoices
      .find({ organizationId, 'campaign.id': campaignId })
      .sort({ createdAt: 1, _id: 1 })
      .lean<InvoiceLean[]>()
      .exec();
  }

  async viewOf(organizationId: string, doc: InvoiceLean): Promise<InvoiceView> {
    const mode = await this.normalized.emissionModeOf(organizationId);
    const isOrigin =
      (doc.status === 'issued' || doc.status === 'normalized') &&
      doc.type !== 'FA' &&
      doc.type !== 'EA';
    const [readiness, creditNotes] = await Promise.all([
      this.readinessOf(organizationId, doc, mode),
      isOrigin
        ? this.invoices
            .find({ organizationId, 'creditNote.originInvoiceId': String(doc._id) })
            .sort({ createdAt: 1 })
            .lean<InvoiceLean[]>()
            .exec()
        : Promise.resolve([] as InvoiceLean[]),
    ]);
    let creditedByLine: Map<number, { credited: string; remaining: string }> | null = null;
    if (isOrigin) {
      const credited = new Map((doc.credited ?? []).map((c) => [c.lineIndex, c.quantity]));
      const remaining = remainingQuantities(
        doc.lines.map((l) => ({ index: l.index, quantity: l.quantity, unitPrice: l.unitPrice })),
        doc.credited ?? [],
      );
      creditedByLine = new Map(
        remaining.map((r) => [
          r.lineIndex,
          { credited: credited.get(r.lineIndex) ?? '0', remaining: r.quantity },
        ]),
      );
    }
    return invoiceView(doc, {
      readiness,
      creditNotes: creditNotes.map(creditNoteSummary),
      creditedByLine,
    });
  }

  /** Ce qui empêche l'émission ou la normalisation d'un brouillon (§ S25e.14). */
  private async readinessOf(
    organizationId: string,
    doc: InvoiceLean,
    mode: EmissionMode,
  ): Promise<InvoiceReadiness> {
    const action = mode === 'normalized' ? 'normalize' : 'issue';
    if (doc.status !== 'draft') return { action, ready: false, blockers: [], warnings: [] };

    const blockers: { code: ReadinessBlockerCode; message: string; lineIndex?: number | null }[] =
      [];
    const settings = await this.state.read(organizationId);
    const [profile, rates, customer] = await Promise.all([
      this.profiles.find(organizationId),
      this.taxRates.latest(settings.environment),
      doc.customer.customerId
        ? this.customers
            .findOne({ _id: new Types.ObjectId(doc.customer.customerId), organizationId })
            .lean<CustomerLean>()
            .exec()
        : Promise.resolve(null),
    ]);
    if (profile === null) {
      blockers.push({
        code: 'FISCAL_PROFILE_REQUIRED',
        message: 'Renseignez la fiche fiscale de l’entreprise (vendeur) avant d’émettre.',
      });
    }
    if (rates === null) {
      blockers.push({
        code: 'TAX_RATES_UNAVAILABLE',
        message: 'Aucun taux de TVA DGI relevé : rafraîchissez les listes du point de vente.',
      });
    }
    if (doc.customer.customerId && (customer === null || !customer.active)) {
      blockers.push({ code: 'CUSTOMER_INACTIVE', message: 'Le client est désactivé.' });
    }
    if (doc.lines.length === 0) {
      blockers.push({ code: 'NO_LINES', message: 'Ajoutez au moins une ligne.' });
    }
    for (const i of doc.documentAmounts.calculation.issues) {
      if (i.code === 'NO_LINES') continue;
      blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex });
    }
    for (const i of doc.documentAmounts.paymentsCheck?.issues ?? []) {
      blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex });
    }
    // Groupes contre l'assujettissement de la fiche fiscale ACTUELLE (le brouillon
    // n'a pas de vendeur figé) : ce qui bloquera l'émission s'affiche dès l'éditeur.
    const warnings: InvoiceReadiness['warnings'][number][] = [];
    if (profile !== null) {
      const vat = sellerVatStatusOf(profile.vatRegistered, doc);
      for (const i of vat.issues) {
        blockers.push({ code: i.code, message: i.message, lineIndex: i.lineIndex });
      }
      for (const w of vat.warnings) {
        warnings.push({ code: w.code, message: w.message, lineIndex: w.lineIndex });
      }
    }
    if (mode === 'normalized') {
      // ADR-0026, écart C6 : un message qui dit QUOI faire selon le nombre de
      // points de vente actifs ; un point de vente choisi puis retiré bloque aussi.
      const active = (await this.pointsOfSale.list(organizationId)).filter(
        (p) => p.environment === settings.environment && p.status === 'active',
      );
      const pointOfSaleId = doc.pointOfSaleId ?? null;
      if (pointOfSaleId === null) {
        blockers.push({
          code: 'POINT_OF_SALE_REQUIRED',
          message:
            active.length === 0
              ? 'Aucun point de vente e-MCF n’est actif : un responsable fiscal doit en configurer un (Organisation › Fiscalité).'
              : active.length === 1
                ? 'Enregistrez le brouillon : le seul point de vente e-MCF actif sera retenu.'
                : 'Plusieurs points de vente e-MCF sont actifs : choisissez celui qui normalisera ce document, puis enregistrez.',
        });
      } else if (!active.some((p) => p.id === pointOfSaleId)) {
        blockers.push({
          code: 'POINT_OF_SALE_NOT_ACTIVE',
          message:
            'Le point de vente choisi n’est plus actif dans l’environnement DGI de l’entreprise : choisissez-en un autre, puis enregistrez.',
        });
      }
      const needsRate =
        (doc.currency === 'USD' || doc.showUsdCounterValue) &&
        !(doc.creditNote?.originInvoiceId ?? null);
      if (needsRate && (await this.exchange.forEnvironment(settings.environment)) === null) {
        blockers.push({
          code: 'EXCHANGE_RATE_REFERENCE_UNAVAILABLE',
          message: 'Aucun taux de référence récent : rafraîchissez les listes du point de vente.',
        });
      }
    }
    return { action, ready: blockers.length === 0, blockers, warnings };
  }

  // ── Écritures ──────────────────────────────────────────────────────────────

  /**
   * `opts.campaign` : étiquette interne de la campagne d'homologation (ADR-0026
   * § 7), passée par la ligne de commande seulement — le contrôleur ne la
   * transmet jamais. Elle ne change rien au contenu du document.
   */
  async create(
    organizationId: string,
    input: InvoiceDraftInput,
    actor: InvoiceActor,
    opts: { campaign?: InvoiceCampaignLabel } = {},
  ): Promise<InvoiceView> {
    const composed = await this.compose(organizationId, input);
    const proformaRef = await this.numbering.nextProformaRef(organizationId);
    const now = new Date();
    const doc = await this.invoices.create({
      organizationId,
      status: 'draft',
      proformaRef,
      ...composed,
      ...(opts.campaign ? { campaign: { ...opts.campaign } } : {}),
      number: null,
      credited: [],
      creditRevision: 0,
      duplicateCount: 0,
      revision: 1,
      sortAt: now,
      searchKey: invoiceSearchKey({ customer: composed.customer, proformaRef, number: null }),
      createdBy: actor.userId,
      updatedBy: actor.userId,
      _schemaVersion: 1,
    });
    return this.viewOf(organizationId, doc.toObject() as InvoiceLean);
  }

  async put(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    input: InvoiceDraftInput,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    const current = await this.requireOwn(organizationId, invoiceId);
    if (current.status !== 'draft') invoiceNotDraft(current.status);
    if (current.revision !== expectedRevision) staleInvoiceRevision(current.revision);
    const composed = await this.compose(organizationId, input);
    const updated = await this.invoices
      .findOneAndUpdate(
        { _id: current._id, organizationId, status: 'draft', revision: expectedRevision },
        {
          $set: {
            ...composed,
            searchKey: invoiceSearchKey({
              customer: composed.customer,
              proformaRef: current.proformaRef,
              number: null,
            }),
            updatedBy: actor.userId,
          },
          $inc: { revision: 1 },
        },
        { new: true },
      )
      .lean<InvoiceLean>()
      .exec();
    if (!updated) {
      const again = await this.requireOwn(organizationId, invoiceId);
      if (again.status !== 'draft') invoiceNotDraft(again.status);
      staleInvoiceRevision(again.revision);
    }
    return this.viewOf(organizationId, updated);
  }

  /** Brouillon seulement : la référence de pro forma peut laisser un trou (admis). */
  async remove(organizationId: string, invoiceId: string, actor: InvoiceActor): Promise<void> {
    const current = await this.requireOwn(organizationId, invoiceId);
    if (current.status !== 'draft') invoiceNotDraft(current.status);
    const res = await this.invoices
      .deleteOne({ _id: current._id, organizationId, status: 'draft' })
      .exec();
    if (res.deletedCount !== 1) {
      const again = await this.requireOwn(organizationId, invoiceId);
      invoiceNotDraft(again.status);
    }
    await this.audit.record({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'sales_invoice.draft_deleted',
      targetType: 'sales_invoice',
      targetId: invoiceId,
      metadata: { proformaRef: current.proformaRef, type: current.type },
    });
  }

  async requireOwn(organizationId: string, invoiceId: string): Promise<InvoiceLean> {
    if (!isObjectIdHex(invoiceId)) invoiceNotFound();
    const doc = await this.invoices
      .findOne({ _id: new Types.ObjectId(invoiceId), organizationId })
      .lean<InvoiceLean>()
      .exec();
    if (!doc) invoiceNotFound();
    return doc;
  }

  // ── Composition ────────────────────────────────────────────────────────────

  /**
   * Groupes des lignes contre l'assujettissement de la fiche fiscale ACTUELLE —
   * le contrôle que l'émission appliquera (moteur `checkSellerVatStatus`). Servi
   * aux devis (ADR-0035, amendement du 27 oct. 2026) : un vendeur non assujetti ne
   * remet pas un devis à TVA qu'il ne pourrait pas facturer tel quel. Sans fiche
   * fiscale, rien à signaler ici : l'émission l'exigera.
   */
  async sellerVatIssues(
    organizationId: string,
    lines: readonly Pick<StoredLine, 'taxGroup' | 'outOfScope'>[],
  ): Promise<{ code: string; message: string; lineIndex: number | null }[]> {
    const profile = await this.profiles.find(organizationId);
    if (profile === null) return [];
    return sellerVatStatusOf(profile.vatRegistered, { lines, creditNote: null }).issues.map(
      (i) => ({ code: i.code, message: i.message, lineIndex: i.lineIndex }),
    );
  }

  /**
   * Corps validé → champs du brouillon : instantanés client et lignes, prix
   * résolus, commentaires, calcul du moteur. Les références sont relues en base
   * (404 d'une autre organisation, 409 d'une référence désactivée).
   */
  async compose(organizationId: string, input: InvoiceDraftInput): Promise<ComposedDraft> {
    const settings = await this.state.read(organizationId);
    const mode: EmissionMode = settings.state === 'enabled' ? 'normalized' : 'standard';
    const rates = await this.taxRates.latest(settings.environment);
    const problems: SalesIssue[] = [];

    // Origine d'un avoir : relue et contrôlée ; le client est le sien.
    let origin: InvoiceLean | null = null;
    if (input.creditNote?.originInvoiceId) {
      origin = await this.requireOwn(organizationId, input.creditNote.originInvoiceId);
      assertCreditableOrigin(origin, {
        type: input.type,
        currency: input.currency,
        priceMode: input.priceMode,
        mode,
        environment: settings.environment,
      });
    }

    const customer = origin
      ? { ...origin.customer }
      : await this.customerSnapshot(organizationId, input);
    const lines = await this.composeLines(organizationId, input, origin, rates, problems);

    // Commentaires (§ S25e.7) : A automatique pour un client AO, saisissable
    // seulement avec une ligne du groupe D ; C libre ; les autres sont réservées.
    let commentA: string | null = null;
    if (customer.type === 'AO') {
      commentA = `Réf. Exo. : ${customer.exemptionReference ?? ''}`.trim();
    } else if (input.comments.A !== null) {
      if (lines.some((l) => l.taxGroup === 'D')) commentA = input.comments.A;
      else {
        problems.push({
          path: 'comments.A',
          code: 'COMMENT_LINE_RESERVED',
          message:
            'La ligne de commentaire A est réservée à la référence d’exonération (client AO ou ligne du groupe D).',
        });
      }
    }

    if (problems.length > 0) invalidInvoiceRequest(problems);

    // Point de vente : celui choisi (de l'organisation), sinon le seul actif.
    let pointOfSaleId = input.pointOfSaleId;
    if (pointOfSaleId !== null) {
      await this.pointsOfSale.requireOwn(organizationId, pointOfSaleId);
    } else {
      const active = (await this.pointsOfSale.list(organizationId)).filter(
        (p) => p.environment === settings.environment && p.status === 'active',
      );
      if (active.length === 1) pointOfSaleId = active[0]!.id;
    }

    const calculation = calculate(input.priceMode, lines, rates);
    return {
      type: input.type,
      currency: input.currency,
      priceMode: input.priceMode,
      customer,
      pointOfSaleId,
      lines,
      payments: input.payments.map((p) => ({ method: p.method, amount: p.amount })),
      comments: { A: commentA, C: input.comments.C },
      creditNote: input.creditNote
        ? {
            nature: input.creditNote.nature,
            originInvoiceId: input.creditNote.originInvoiceId,
            originNumber: null,
            reference: null,
          }
        : null,
      showUsdCounterValue: input.currency === 'CDF' ? input.showUsdCounterValue : false,
      documentAmounts: {
        currency: input.currency,
        calculation,
        paymentsCheck: paymentsCheckOf(calculation, input.payments),
      },
    };
  }

  private async customerSnapshot(
    organizationId: string,
    input: InvoiceDraftInput,
  ): Promise<StoredCustomer> {
    const c = input.customer;
    if (c.customerId === null) return { ...WALK_IN, name: c.walkInName };
    const doc = await this.customers
      .findOne({ _id: new Types.ObjectId(c.customerId), organizationId })
      .lean<CustomerLean>()
      .exec();
    if (!doc) customerNotFound();
    if (!doc.active) {
      invoiceConflict(
        'CUSTOMER_INACTIVE',
        'Ce client est désactivé : réactivez-le ou choisissez-en un autre.',
      );
    }
    return {
      customerId: String(doc._id),
      type: doc.type,
      name: doc.name,
      nif: doc.nif ?? null,
      exemptionReference: doc.exemptionReference ?? null,
      phone: doc.phone ?? null,
      email: doc.email ?? null,
      address: doc.address ?? null,
      printContactDetails: c.printContactDetails,
    };
  }

  private async composeLines(
    organizationId: string,
    input: InvoiceDraftInput,
    origin: InvoiceLean | null,
    rates: StoredTaxRates | null,
    problems: SalesIssue[],
  ): Promise<StoredLine[]> {
    const nature = input.creditNote?.nature ?? null;
    const originOnly = nature !== null && nature !== 'RRR';

    const catalogIds = [
      ...new Set(input.lines.flatMap((l) => (l.source === 'catalog' ? [l.catalogItemId] : []))),
    ];
    const items = new Map<string, ItemLean>();
    if (catalogIds.length > 0) {
      const docs = await this.items
        .find({ _id: { $in: catalogIds.map((id) => new Types.ObjectId(id)) }, organizationId })
        .lean<ItemLean[]>()
        .exec();
      for (const d of docs) items.set(String(d._id), d);
      if (items.size !== catalogIds.length) catalogItemNotFound();
      const inactive = docs.find((d) => !d.active);
      if (inactive) {
        invoiceConflict('CATALOG_ITEM_INACTIVE', `L’article « ${inactive.name} » est désactivé.`, {
          catalogItemId: String(inactive._id),
        });
      }
    }

    const lines: StoredLine[] = [];
    for (const [index, line] of input.lines.entries()) {
      const at = (field: string) => `lines.${index}.${field}`;

      if (line.source === 'origin' || originOnly) {
        if (line.source !== 'origin' || origin === null) {
          problems.push({
            path: at('source'),
            code: 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
            message:
              nature === 'RRR' || nature === null
                ? 'Seul un avoir rattaché (hors RRR) reprend des lignes de la facture d’origine.'
                : 'Un avoir hors RRR ne reprend que des lignes de la facture d’origine.',
          });
          continue;
        }
        const o = origin.lines.find((l) => l.index === line.originLineIndex);
        if (!o) {
          problems.push({
            path: at('originLineIndex'),
            code: 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
            message: 'Cette ligne n’existe pas sur la facture d’origine.',
          });
          continue;
        }
        // Code, désignation, groupe, type, taxe spécifique et PRIX UNITAIRE
        // recopiés de l'origine, non modifiables ; seule la quantité varie.
        lines.push({
          index,
          source: 'origin',
          catalogItemId: o.catalogItemId,
          originLineIndex: o.index,
          code: o.code,
          edefCode: o.edefCode,
          name: o.name,
          unit: o.unit,
          itemType: o.itemType,
          taxGroup: o.taxGroup,
          outOfScope: o.outOfScope,
          specificTax: o.specificTax,
          quantity: line.quantity,
          originalPrice: o.originalPrice,
          discount: o.discount?.kind === 'percent' ? o.discount : null,
          unitPrice: o.unitPrice,
          priceModification: o.priceModification,
          priceOverridden: o.priceOverridden,
        });
        continue;
      }

      let base: DecimalString | null;
      let priceOverridden: boolean;
      let fields: Pick<
        StoredLine,
        | 'catalogItemId'
        | 'code'
        | 'name'
        | 'unit'
        | 'itemType'
        | 'taxGroup'
        | 'outOfScope'
        | 'specificTax'
      >;
      if (line.source === 'catalog') {
        const item = items.get(line.catalogItemId)!;
        fields = {
          catalogItemId: String(item._id),
          code: item.code ?? null,
          name: item.name,
          unit: item.unit,
          itemType: item.itemType,
          taxGroup: item.taxGroup,
          outOfScope: item.outOfScope,
          specificTax: specificTaxOf(item.specificTax),
        };
        const itemCurrency: string = item.currency;
        const sameCurrency = itemCurrency === input.currency;
        if (!sameCurrency && fields.specificTax?.kind === 'per_unit') {
          problems.push({
            path: at('catalogItemId'),
            code: 'CATALOG_CURRENCY_MISMATCH',
            message: `La taxe spécifique de cet article est exprimée en ${itemCurrency} : utilisez une ligne libre dans la devise du document.`,
          });
          continue;
        }
        if (line.unitPrice !== null) {
          base = line.unitPrice;
          priceOverridden = true;
        } else if (!sameCurrency) {
          // Aucune conversion implicite au brouillon : la seule conversion est
          // celle de « Normaliser » (§ S25e.2).
          problems.push({
            path: at('unitPrice'),
            code: 'CATALOG_CURRENCY_MISMATCH',
            message: `Le prix de cet article est en ${itemCurrency} : saisissez le prix unitaire en ${input.currency}.`,
          });
          continue;
        } else {
          base = this.priceInMode(
            item.unitPrice,
            item.priceMode,
            input.priceMode,
            item.taxGroup,
            rates,
          );
          priceOverridden = false;
        }
      } else {
        fields = {
          catalogItemId: null,
          code: line.code,
          name: line.name,
          unit: line.unit,
          itemType: line.itemType,
          taxGroup: line.taxGroup,
          outOfScope: line.outOfScope,
          specificTax: line.specificTax,
        };
        base = line.unitPrice;
        priceOverridden = false;
      }

      if (rates !== null && rates.rates[fields.taxGroup] === undefined) {
        invoiceConflict(
          'TAX_GROUP_UNAVAILABLE',
          `Le groupe ${fields.taxGroup} est absent des taux relevés auprès de la DGI.`,
          { lineIndex: index, taxGroup: fields.taxGroup },
        );
      }

      const priced = this.applyDiscount(
        base,
        line.quantity,
        line.discount,
        input.currency,
        at('discount'),
        problems,
      );
      if (priced === null) continue;
      lines.push({
        index,
        source: line.source,
        originLineIndex: null,
        ...fields,
        edefCode: fields.outOfScope ? OUT_OF_SCOPE_ITEM_CODE : fields.code,
        quantity: line.quantity,
        discount: line.discount,
        priceOverridden,
        ...priced,
      });
    }
    return lines;
  }

  /** Prix de l'article dans le mode du document : `convertUnitPrice` (moteur). */
  private priceInMode(
    price: DecimalString,
    from: PriceMode,
    to: PriceMode,
    group: StoredLine['taxGroup'],
    rates: StoredTaxRates | null,
  ): DecimalString {
    if (from === to) return price;
    if (rates === null) {
      invoiceConflict(
        'TAX_RATES_UNAVAILABLE',
        'Aucun taux de TVA DGI relevé : impossible de convertir le prix de l’article entre TTC et HT.',
      );
    }
    const rate = rates.rates[group];
    if (rate === undefined) {
      invoiceConflict('TAX_GROUP_UNAVAILABLE', `Le groupe ${group} est absent des taux relevés.`);
    }
    return convertUnitPrice(price, rate, from, to);
  }

  /** Remise : `discountedUnitPrice` (moteur) ; le prix d'origine est conservé. */
  private applyDiscount(
    base: DecimalString,
    quantity: DecimalString,
    discount: LineDiscount | null,
    currency: 'CDF' | 'USD',
    path: string,
    problems: SalesIssue[],
  ): Pick<StoredLine, 'unitPrice' | 'originalPrice' | 'priceModification'> | null {
    if (discount === null) return { unitPrice: base, originalPrice: null, priceModification: null };
    const r = discountedUnitPrice({ originalPrice: base, quantity, discount, currency });
    if (!r.ok) {
      problems.push({ path, code: r.issue.code, message: r.issue.message });
      return null;
    }
    return {
      unitPrice: r.unitPrice,
      originalPrice: base,
      priceModification: r.priceModification === '' ? null : r.priceModification,
    };
  }
}
