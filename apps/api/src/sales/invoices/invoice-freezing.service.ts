// Émettre (mode ordinaire), Normaliser (mode normalisé), Reprendre en brouillon
// — ADR-0023 § S25e.4, § S25e.5, § S25e.6.
//
// Une seule mécanique de GEL, dans UNE transaction MongoDB : relecture du
// brouillon à la révision attendue, mode d'émission lu DANS la transaction,
// prérequis (fiche fiscale, point de vente, taux), calculs et contrôles par le
// moteur (TOUS les problèmes ensemble → 422), numéro définitif (émission
// seulement), écriture du contenu figé et de son empreinte, `markInvoiced`,
// entrée de journal, audit. Un échec n'importe où annule tout, y compris
// l'incrément du compteur.
//
// L'API NE CALCULE RIEN : totaux, paiements, conversion, contre-valeur et
// contrôles d'avoir viennent du moteur (`@lalanda/engine`).

import {
  INVOICE_TOTALS_VERSION,
  checkCreditNote,
  checkPayments,
  computeInvoiceTotals,
  convertDocumentToCdf,
  isExchangeRateWithinTolerance,
  reconcilePayments,
  remainingQuantities,
  usdCounterValue,
  type DecimalString,
  type InvoiceTotals,
  type PaymentInput,
} from '@lalanda/engine';
import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';

import { AuditService } from '../../authz/audit.service.js';
import { inFiscalTransactionWithReplay } from '../../fiscal/fiscal-transaction.js';
import { FiscalProfileService } from '../../fiscal/fiscal-profile.service.js';
import { NormalizedInvoicingStateReader } from '../../fiscal/normalized-invoicing-state.reader.js';
import { NormalizedInvoicingService } from '../../fiscal/normalized-invoicing.service.js';
import { PointsOfSaleService } from '../../fiscal/points-of-sale.service.js';
import { APP_VERSION } from '../../health/app-version.js';
import {
  DGI_PLATFORM_CONFIG,
  type DgiPlatformConfig,
} from '../../platform-config/dgi-platform.config.js';
import { Customer, type CustomerDocument } from '../customer.schema.js';
import { SalesUsageService } from '../sales-usage.service.js';
import { isObjectIdHex } from '../search.js';
import { contentSha256Of } from './canonical.js';
import { assertCreditableOrigin, isZeroQuantity } from './credit-note-rules.js';
import {
  EXCHANGE_RATE_TOLERANCE_PERCENT,
  ExchangeRateReferenceService,
  kinshasaDay,
  type ExchangeRateReferenceValue,
} from './exchange-rate-reference.service.js';
import {
  InvoiceTaxRatesReader,
  calculate,
  engineLines,
  sellerVatStatusOf,
} from './invoice-calculation.js';
import { InvoiceDraftsService } from './invoice-drafts.service.js';
import { InvoiceJournalService, type JournalAppendInput } from './invoice-journal.service.js';
import { InvoiceNumberingService } from './invoice-numbering.service.js';
import { invoiceSearchKey } from './invoice-search.js';
import type { DgiEnvironment, EmissionMode, InvoiceView } from './invoice.contract.js';
import { SalesInvoice, type SalesInvoiceDocument } from './invoice.schema.js';
import type {
  InvoiceActor,
  InvoiceLean,
  StoredConversion,
  StoredNormalizedAmounts,
  StoredNormalizedLine,
  StoredSeller,
} from './invoice.types.js';
import {
  invoiceConflict,
  invoiceNotDraft,
  invoiceNotFound,
  notIssuable,
  staleInvoiceRevision,
  type NotIssuableIssue,
} from './invoices.errors.js';
import { SALES_INVOICE_NORMALIZER, type SalesInvoiceNormalizer } from './normalization.port.js';

type CustomerLean = Customer & { _id: Types.ObjectId };

type Route = 'issue' | 'normalize';

/** Statuts atteints par chaque route : un rejeu idempotent y trouve le document. */
const FROZEN_BY: Record<Route, readonly string[]> = {
  issue: ['issued'],
  normalize: ['pending_normalization', 'normalized', 'normalization_failed'],
};

/** Statuts d'un avoir dont les quantités comptent encore sur l'origine. */
const COUNTED_CREDIT_STATUSES = [
  'issued',
  'pending_normalization',
  'normalized',
  'normalization_failed',
];

/** Total d'un document gelé, dans la grandeur qui fait foi pour son mode. */
function totalOf(doc: InvoiceLean, mode: EmissionMode): DecimalString | null {
  return mode === 'normalized'
    ? (doc.normalizedAmounts?.calculation.total ?? null)
    : (doc.documentAmounts.calculation.totals?.total ?? null);
}

function freshNormalization(pointOfSaleId: string) {
  return {
    pointOfSaleId,
    attempts: 0,
    lastAttemptAt: null,
    reservedNumber: null,
    uid: null,
    dgiTotals: null,
    codeDefDgi: null,
    nim: null,
    counters: null,
    dgiDateTime: null,
    qrCode: null,
    lastError: null,
    normalizedAt: null,
    // ADR-0024 § 10 : la normalisation part de la phase `queued`.
    phase: 'queued' as const,
  };
}

function headOfficeAddress(h: {
  line1: string;
  line2: string | null;
  commune: string | null;
  city: string;
  province: string | null;
  country: string;
}): string {
  return [h.line1, h.line2, h.commune, h.city, h.province, h.country]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(', ');
}

@Injectable()
export class InvoiceFreezingService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesInvoice.name) private readonly invoices: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(InvoiceNumberingService) private readonly numbering: InvoiceNumberingService,
    @Inject(InvoiceJournalService) private readonly journal: InvoiceJournalService,
    @Inject(InvoiceTaxRatesReader) private readonly taxRates: InvoiceTaxRatesReader,
    @Inject(ExchangeRateReferenceService) private readonly exchange: ExchangeRateReferenceService,
    @Inject(NormalizedInvoicingService) private readonly normalized: NormalizedInvoicingService,
    @Inject(NormalizedInvoicingStateReader) private readonly state: NormalizedInvoicingStateReader,
    @Inject(PointsOfSaleService) private readonly pointsOfSale: PointsOfSaleService,
    @Inject(FiscalProfileService) private readonly profiles: FiscalProfileService,
    @Inject(SalesUsageService) private readonly usage: SalesUsageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DGI_PLATFORM_CONFIG) private readonly config: DgiPlatformConfig,
    @Inject(SALES_INVOICE_NORMALIZER) private readonly normalizer: SalesInvoiceNormalizer,
  ) {}

  /** `POST …/issue` — organisation ordinaire : numéro définitif, contenu figé. */
  async issue(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    await this.freeze('issue', organizationId, invoiceId, expectedRevision, null, actor);
    return this.drafts.view(organizationId, invoiceId);
  }

  /**
   * `POST …/normalize` — organisation en facture normalisée : conversion en CDF,
   * contenu figé, AUCUN numéro définitif ; puis le port de normalisation (S25f).
   */
  async normalize(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    exchangeRate: { rate: DecimalString; date: string } | null,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    await this.freeze(
      'normalize',
      organizationId,
      invoiceId,
      expectedRevision,
      exchangeRate,
      actor,
    );
    const doc = await this.drafts.requireOwn(organizationId, invoiceId);
    if (doc.status === 'pending_normalization') {
      // Idempotent, ne lève pas pour un refus DGI (contrat du port).
      await this.normalizer.normalizeNow(organizationId, invoiceId);
    }
    return this.drafts.view(organizationId, invoiceId);
  }

  /**
   * `POST …/back-to-draft` — seulement depuis `normalization_failed` et sans
   * numéro réservé : efface la conversion et le gel, restitue les quantités
   * d'un avoir, journalise `returned_to_draft`.
   */
  async backToDraft(
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    actor: InvoiceActor,
  ): Promise<InvoiceView> {
    if (!isObjectIdHex(invoiceId)) invoiceNotFound();
    const _id = new Types.ObjectId(invoiceId);
    await inFiscalTransactionWithReplay(this.connection, async (session) => {
      const doc = await this.invoices
        .findOne({ _id, organizationId }, null, { session })
        .lean<InvoiceLean>()
        .exec();
      if (!doc) invoiceNotFound();
      if (doc.status !== 'normalization_failed') {
        invoiceConflict(
          'NOT_RETURNABLE_TO_DRAFT',
          'Seul un document dont la normalisation a échoué peut revenir en brouillon.',
          { status: doc.status },
        );
      }
      if (doc.revision !== expectedRevision) staleInvoiceRevision(doc.revision);
      if (doc.normalization?.reservedNumber) {
        invoiceConflict(
          'NUMBER_RESERVED',
          'Un numéro de facture est encore réservé pour ce document : sa reprise appartient à la normalisation.',
        );
      }

      // Avoir hors RRR : ses quantités sont restituées à l'origine, dans la même
      // transaction. Soustraction par le moteur : le « reste » des quantités
      // créditées une fois retirées celles de cet avoir.
      const origin = await this.originOf(organizationId, doc, session);
      if (origin && doc.creditNote?.nature !== 'RRR') {
        const credited = remainingQuantities(
          (origin.credited ?? [])
            .filter((c) => !isZeroQuantity(c.quantity))
            .map((c) => ({
              index: c.lineIndex,
              quantity: c.quantity,
              unitPrice: origin.lines.find((l) => l.index === c.lineIndex)?.unitPrice ?? '0',
            })),
          doc.lines.map((l) => ({ lineIndex: l.originLineIndex ?? -1, quantity: l.quantity })),
        );
        await this.updateOrigin(organizationId, origin, [...credited], session);
      }

      const res = await this.invoices
        .updateOne(
          { _id, organizationId, status: 'normalization_failed', revision: expectedRevision },
          {
            $set: {
              status: 'draft',
              conversion: null,
              normalizedAmounts: null,
              calculationVersion: null,
              roundingPolicyId: null,
              taxRates: null,
              emissionMode: null,
              environment: null,
              isf: null,
              seller: null,
              operator: null,
              softwareVersion: null,
              frozenAt: null,
              frozenFromRevision: null,
              contentSha256: null,
              amountOnCredit: null,
              normalization: null,
              ...(doc.creditNote
                ? { creditNote: { ...doc.creditNote, originNumber: null, reference: null } }
                : {}),
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleInvoiceRevision(doc.revision);

      await this.journal.append(
        organizationId,
        this.journalInput('returned_to_draft', doc, actor),
        { session },
      );
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'sales_invoice.returned_to_draft',
          targetType: 'sales_invoice',
          targetId: invoiceId,
          metadata: {
            proformaRef: doc.proformaRef,
            type: doc.type,
            nature: doc.creditNote?.nature ?? null,
            mode: doc.emissionMode ?? null,
            currency: doc.currency,
          },
        },
        { session },
      );
    });
    return this.drafts.view(organizationId, invoiceId);
  }

  // ── Gel ────────────────────────────────────────────────────────────────────

  private async freeze(
    route: Route,
    organizationId: string,
    invoiceId: string,
    expectedRevision: number,
    exchangeRate: { rate: DecimalString; date: string } | null,
    actor: InvoiceActor,
  ): Promise<void> {
    if (!isObjectIdHex(invoiceId)) invoiceNotFound();
    const _id = new Types.ObjectId(invoiceId);

    await inFiscalTransactionWithReplay(this.connection, async (session) => {
      // 1. Relire le brouillon à la révision attendue.
      const doc = await this.invoices
        .findOne({ _id, organizationId }, null, { session })
        .lean<InvoiceLean>()
        .exec();
      if (!doc) invoiceNotFound();
      if (doc.status !== 'draft') {
        // Rejeu de la même demande : 200 avec l'état courant, sans réécriture.
        if (doc.frozenFromRevision === expectedRevision && FROZEN_BY[route].includes(doc.status)) {
          return;
        }
        invoiceNotDraft(doc.status);
      }
      if (doc.revision !== expectedRevision) staleInvoiceRevision(doc.revision);

      // 2. Mode d'émission, lu DANS la transaction.
      const mode = await this.normalized.emissionModeOf(organizationId, { session });
      if (route === 'issue' && mode !== 'standard') {
        invoiceConflict(
          'NORMALIZATION_REQUIRED',
          'Votre entreprise émet des factures normalisées : utilisez « Normaliser ».',
        );
      }
      if (route === 'normalize' && mode !== 'normalized') {
        invoiceConflict(
          'NORMALIZATION_NOT_ENABLED',
          'La facture normalisée n’est pas activée : utilisez « Émettre ».',
        );
      }
      const settings = await this.state.read(organizationId, { session });
      const environment = settings.environment;

      // 3. Fiche fiscale ; en normalisé, point de vente actif de l'environnement.
      const profile = await this.profiles.find(organizationId);
      if (profile === null) {
        invoiceConflict(
          'FISCAL_PROFILE_REQUIRED',
          'Renseignez la fiche fiscale de l’entreprise avant d’émettre une facture.',
        );
      }
      let sellerAddress = headOfficeAddress(profile.headOffice);
      if (mode === 'normalized') {
        if (!doc.pointOfSaleId) {
          invoiceConflict(
            'POINT_OF_SALE_REQUIRED',
            'Aucun point de vente n’est choisi pour ce document : choisissez dans l’éditeur le point de vente e-MCF qui le normalisera, puis enregistrez.',
          );
        }
        const pos = doc.pointOfSaleId
          ? await this.pointsOfSale.view(organizationId, doc.pointOfSaleId).catch(() => null)
          : null;
        if (pos === null || pos.status !== 'active' || pos.environment !== environment) {
          invoiceConflict(
            'POINT_OF_SALE_NOT_ACTIVE',
            'Le point de vente de ce document n’est pas actif dans l’environnement DGI de l’entreprise.',
            { pointOfSaleId: doc.pointOfSaleId },
          );
        }
        const posAddress = (pos.dgi?.address ?? []).filter((a) => a.trim() !== '').join(', ');
        if (posAddress !== '') sellerAddress = posAddress;
      }
      if (doc.customer.customerId) {
        const customer = await this.customers
          .findOne({ _id: new Types.ObjectId(doc.customer.customerId), organizationId }, null, {
            session,
          })
          .lean<CustomerLean>()
          .exec();
        if (!customer || !customer.active) {
          invoiceConflict('CUSTOMER_INACTIVE', 'Le client de ce document est désactivé.');
        }
      }

      // 4. Taux de TVA figés : dernier instantané, lettres A à P seulement.
      const taxRates = await this.taxRates.latest(environment);
      if (taxRates === null) {
        invoiceConflict(
          'TAX_RATES_UNAVAILABLE',
          'Aucun taux de TVA DGI relevé : rafraîchissez les listes du point de vente.',
        );
      }

      // 5. Avoir : origine relue avec la session et recontrôlée.
      const origin = await this.originOf(organizationId, doc, session);
      if (origin) {
        assertCreditableOrigin(origin, {
          type: doc.type,
          currency: doc.currency,
          priceMode: doc.priceMode,
          mode,
          environment,
        });
      }

      // 6. Moteur : TOUS les problèmes, ensemble.
      const issues: NotIssuableIssue[] = [];
      const documentCalculation = calculate(doc.priceMode, doc.lines, taxRates);
      issues.push(...documentCalculation.issues);
      // Groupes contre l'assujettissement lu sur la fiche fiscale (celui qui sera
      // figé dans `seller`) : bloquant en émission comme en normalisation.
      issues.push(...sellerVatStatusOf(profile.vatRegistered, doc).issues);
      const documentTotals = documentCalculation.totals;
      const paymentsCheck = documentTotals
        ? checkPayments(documentTotals.total, doc.payments)
        : null;
      if (paymentsCheck) issues.push(...paymentsCheck.issues);

      let conversion: StoredConversion | null = null;
      let normalizedAmounts: StoredNormalizedAmounts | null = null;
      if (route === 'normalize' && documentTotals) {
        const n = await this.normalizeAmounts(
          doc,
          origin,
          environment,
          exchangeRate,
          taxRates.rates,
          issues,
        );
        conversion = n?.conversion ?? null;
        normalizedAmounts = n?.amounts ?? null;
      }

      let creditedAfter: { lineIndex: number; quantity: string }[] | null = null;
      if (origin && doc.creditNote && doc.creditNote.nature !== 'RRR') {
        const creditTotal =
          mode === 'normalized'
            ? (normalizedAmounts?.calculation.total ?? null)
            : (documentTotals?.total ?? null);
        const originTotal = totalOf(origin, mode);
        if (creditTotal !== null && originTotal !== null) {
          const previous = await this.invoices
            .find(
              {
                organizationId,
                'creditNote.originInvoiceId': String(origin._id),
                status: { $in: COUNTED_CREDIT_STATUSES },
                _id: { $ne: doc._id },
              },
              null,
              { session },
            )
            .lean<InvoiceLean[]>()
            .exec();
          const check = checkCreditNote({
            originLines: origin.lines.map((l) => ({
              index: l.index,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
            alreadyCredited: origin.credited ?? [],
            lines: doc.lines.map((l) => ({
              originLineIndex: l.originLineIndex ?? -1,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
            originTotal,
            previousCreditTotals: previous
              .map((p) => totalOf(p, mode))
              .filter((t): t is string => t !== null),
            creditTotal,
          });
          issues.push(...check.issues);
          creditedAfter = [...check.creditedAfter];
        }
      }

      if (issues.length > 0) notIssuable(issues);
      // Inatteignable : un calcul sans problème a des totaux.
      if (!documentTotals || !paymentsCheck) notIssuable(issues);

      // Origine : quantités créditées, conditionnées par sa révision.
      if (origin && creditedAfter) {
        await this.updateOrigin(organizationId, origin, creditedAfter, session);
      }

      // 7. Numéro définitif (émission seulement).
      const now = new Date();
      const numbered =
        route === 'issue'
          ? await this.numbering.assignOnIssue(organizationId, { session, now })
          : null;

      // 8. Contenu figé, empreinte, statut.
      const seller: StoredSeller = {
        legalName: profile.legalName,
        tradeName: profile.tradeName,
        nif: profile.nif,
        rccm: profile.rccm,
        address: sellerAddress === '' ? null : sellerAddress,
        phone: profile.phone,
        email: profile.email,
        vatRegistered: profile.vatRegistered,
      };
      const creditNote = doc.creditNote
        ? {
            ...doc.creditNote,
            originNumber: origin?.number ?? null,
            reference:
              doc.creditNote.nature === 'RRR'
                ? 'RRR'
                : origin?.status === 'normalized'
                  ? (origin.normalization?.codeDefDgi ?? null)
                  : (origin?.number ?? null),
          }
        : null;
      const frozen = {
        documentAmounts: {
          currency: doc.currency,
          calculation: documentCalculation,
          paymentsCheck,
        },
        conversion,
        normalizedAmounts,
        calculationVersion: documentTotals.calculationVersion ?? INVOICE_TOTALS_VERSION,
        roundingPolicyId: documentTotals.policyId,
        taxRates,
        emissionMode: mode,
        environment: mode === 'normalized' ? environment : null,
        isf: mode === 'normalized' ? (this.config.isf[environment] ?? null) : null,
        seller,
        operator: { userId: actor.userId, name: actor.name },
        // ADR-0026 § 6.2 : la version qui a gelé le document, imprimée en pied de PDF.
        softwareVersion: APP_VERSION.version,
        frozenFromRevision: expectedRevision,
        creditNote,
      };
      const contentSha256 = contentSha256Of({ ...doc, ...frozen });
      const status = route === 'issue' ? 'issued' : 'pending_normalization';
      const res = await this.invoices
        .updateOne(
          { _id, organizationId, status: 'draft', revision: expectedRevision },
          {
            $set: {
              ...frozen,
              status,
              contentSha256,
              frozenAt: now,
              amountOnCredit: paymentsCheck.amountOnCredit,
              normalization:
                route === 'normalize' ? freshNormalization(doc.pointOfSaleId ?? '') : null,
              ...(numbered
                ? {
                    number: numbered.number,
                    series: numbered.series,
                    fiscalYear: numbered.fiscalYear,
                    issuedAt: numbered.issuedAt,
                    sortAt: numbered.issuedAt,
                    searchKey: invoiceSearchKey({ ...doc, number: numbered.number }),
                  }
                : {}),
              updatedBy: actor.userId,
            },
            $inc: { revision: 1 },
          },
          { session },
        )
        .exec();
      if (res.matchedCount !== 1) staleInvoiceRevision(doc.revision);

      // 9. Usage en facturation, dans la même transaction.
      await this.usage.markInvoiced(
        organizationId,
        {
          customerId: doc.customer.customerId,
          catalogItemIds: doc.lines.flatMap((l) => (l.catalogItemId ? [l.catalogItemId] : [])),
        },
        { session },
      );

      // 10. Journal électronique.
      const frozenDoc: InvoiceLean = {
        ...doc,
        ...frozen,
        status,
        contentSha256,
        number: numbered?.number ?? null,
        series: numbered?.series ?? null,
      };
      await this.journal.append(
        organizationId,
        this.journalInput(route === 'issue' ? 'issued' : 'submitted', frozenDoc, actor),
        { session },
      );

      // 11. Audit — jamais de donnée personnelle du client.
      await this.audit.record(
        {
          organizationId,
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: route === 'issue' ? 'sales_invoice.issued' : 'sales_invoice.submitted',
          targetType: 'sales_invoice',
          targetId: invoiceId,
          metadata: {
            proformaRef: doc.proformaRef,
            number: numbered?.number ?? null,
            type: doc.type,
            nature: doc.creditNote?.nature ?? null,
            mode,
            currency: doc.currency,
          },
        },
        { session },
      );
    });
  }

  /**
   * Conversion en CDF et montants normalisés (§ S25e.4, O6). Les problèmes du
   * moteur sont ajoutés à `issues` ; un prérequis manquant lève un 409.
   */
  private async normalizeAmounts(
    doc: InvoiceLean,
    origin: InvoiceLean | null,
    environment: DgiEnvironment,
    exchangeRate: { rate: DecimalString; date: string } | null,
    rates: StoredNormalizedAmountsRates,
    issues: NotIssuableIssue[],
  ): Promise<{ conversion: StoredConversion; amounts: StoredNormalizedAmounts } | null> {
    let conversion: StoredConversion;
    let reference: ExchangeRateReferenceValue | null = null;
    let normalizedLines: StoredNormalizedLine[] | null = null;
    let cdfPayments: readonly PaymentInput[];

    const originConversion = origin?.status === 'normalized' ? (origin.conversion ?? null) : null;
    if (origin && originConversion) {
      // Avoir d'une origine normalisée : taux de l'origine, AUCUNE reconversion
      // des lignes reprises (prix CDF identiques, exigence DGI).
      conversion = {
        ...originConversion,
        rateSource: 'origin_invoice',
        originInvoiceId: String(origin._id),
      };
      if (doc.creditNote?.nature !== 'RRR') {
        normalizedLines = [];
        for (const l of doc.lines) {
          const o = origin.normalizedAmounts?.lines.find((x) => x.index === l.originLineIndex);
          if (!o) {
            issues.push({
              code: 'CREDIT_NOTE_LINE_NOT_IN_ORIGIN',
              lineIndex: l.index,
              message: 'Cette ligne n’existe pas sur la facture d’origine normalisée.',
            });
            continue;
          }
          normalizedLines.push({
            index: l.index,
            unitPrice: o.unitPrice,
            originalPrice: o.originalPrice,
            priceModification: o.priceModification,
            specificTax: o.specificTax,
          });
        }
      }
    } else if (doc.currency === 'CDF' && !doc.showUsdCounterValue) {
      conversion = this.identity(null);
    } else {
      reference = await this.exchange.forEnvironment(environment);
      if (reference === null) {
        invoiceConflict(
          'EXCHANGE_RATE_REFERENCE_UNAVAILABLE',
          'Aucun taux de référence récent : rafraîchissez les listes du point de vente avant de normaliser.',
        );
      }
      let rate = reference.rate;
      let rateDate = reference.date;
      let rateSource: StoredConversion['rateSource'] = 'dgi_currency_rates';
      if (exchangeRate !== null) {
        // Garde-fou seulement : ±1 % du taux officiel.
        if (
          !isExchangeRateWithinTolerance(
            exchangeRate.rate,
            reference.rate,
            EXCHANGE_RATE_TOLERANCE_PERCENT,
          )
        ) {
          notIssuable([
            {
              code: 'EXCHANGE_RATE_OUT_OF_TOLERANCE',
              lineIndex: null,
              message: `Le taux saisi s’écarte de plus de ${EXCHANGE_RATE_TOLERANCE_PERCENT} % du taux de référence (${reference.rate}).`,
              details: { rate: exchangeRate.rate, referenceRate: reference.rate },
            },
          ]);
        }
        rate = exchangeRate.rate;
        rateDate = exchangeRate.date;
        rateSource = 'user_within_tolerance';
      }
      const ref = {
        rate: reference.rate,
        date: reference.date,
        environment: reference.environment,
        sha256: reference.sha256,
      };
      conversion =
        doc.currency === 'CDF'
          ? this.identity(ref)
          : {
              from: 'USD',
              to: 'CDF',
              rate,
              rateDate,
              rateSource,
              reference: ref,
              originInvoiceId: null,
              conversionVersion: '',
            };
      // Document CDF avec contre-valeur : le taux USD sert à la seule contre-valeur.
      if (doc.currency === 'CDF') {
        conversion = { ...conversion, reference: { ...ref, rate, date: rateDate } };
      }
    }

    // Conversion par le moteur (sauf lignes reprises d'une origine normalisée).
    const converted = convertDocumentToCdf({
      from: doc.currency,
      rate: doc.currency === 'CDF' ? '1' : conversion.rate,
      lines:
        normalizedLines === null
          ? doc.lines.map((l) => ({
              unitPrice: l.unitPrice,
              originalPrice: l.originalPrice,
              discount: l.discount,
              quantity: l.quantity,
              specificTax: l.specificTax,
            }))
          : [],
      payments: doc.payments,
    });
    if (!converted.ok) {
      issues.push(...converted.issues);
      return null;
    }
    if (conversion.conversionVersion === '') {
      conversion = { ...conversion, conversionVersion: converted.conversionVersion };
    }
    if (normalizedLines === null) {
      normalizedLines = converted.lines.map((l) => ({
        index: doc.lines[l.index]?.index ?? l.index,
        unitPrice: l.unitPrice,
        originalPrice: l.originalPrice,
        priceModification: l.priceModification,
        specificTax: l.specificTax,
      }));
    }
    cdfPayments = converted.payments;

    // Calcul CDF par le moteur : les montants que S25f enverra et comparera.
    const cdfLines = doc.lines.map((l) => {
      const n = normalizedLines!.find((x) => x.index === l.index);
      return {
        unitPrice: n?.unitPrice ?? l.unitPrice,
        quantity: l.quantity,
        taxGroup: l.taxGroup,
        itemType: l.itemType,
        specificTax: n ? n.specificTax : l.specificTax,
      };
    });
    const cdf = computeInvoiceTotals({
      priceMode: doc.priceMode,
      lines: engineLines(cdfLines),
      rates,
    });
    if (!cdf.ok) {
      issues.push(...cdf.issues);
      return null;
    }
    const totals: InvoiceTotals = cdf.totals;

    // Paiements CDF : écart d'arrondi porté sur le plus gros, somme = total.
    const reconciled = reconcilePayments(totals.total, cdfPayments);
    if (!reconciled.ok) {
      issues.push(...reconciled.issues);
      return null;
    }
    const check = checkPayments(totals.total, reconciled.payments);
    issues.push(...check.issues);

    // Contre-valeur USD (`curCode`, `curRate`, `curDate`).
    let counterValueUsd: StoredNormalizedAmounts['counterValueUsd'] = null;
    if (doc.currency === 'USD') {
      counterValueUsd = {
        amount: usdCounterValue(totals.total, conversion.rate),
        rate: conversion.rate,
        date: conversion.rateDate,
      };
    } else if (doc.showUsdCounterValue) {
      const usd = origin?.normalizedAmounts?.counterValueUsd ?? null;
      const rate = usd?.rate ?? conversion.reference?.rate ?? null;
      const date = usd?.date ?? conversion.reference?.date ?? null;
      if (rate !== null && date !== null) {
        counterValueUsd = { amount: usdCounterValue(totals.total, rate), rate, date };
      }
    }

    return {
      conversion,
      amounts: {
        currency: 'CDF',
        lines: normalizedLines,
        payments: reconciled.payments.map((p) => ({ method: p.method, amount: p.amount })),
        calculation: totals,
        counterValueUsd,
      },
    };
  }

  /** Conversion identité d'un document en CDF (taux `1`). */
  private identity(reference: StoredConversion['reference']): StoredConversion {
    return {
      from: 'CDF',
      to: 'CDF',
      rate: '1',
      rateDate: kinshasaDay(new Date()),
      rateSource: 'identity',
      reference,
      originInvoiceId: null,
      conversionVersion: '',
    };
  }

  private async originOf(
    organizationId: string,
    doc: InvoiceLean,
    session: ClientSession,
  ): Promise<InvoiceLean | null> {
    const id = doc.creditNote?.originInvoiceId ?? null;
    if (id === null) return null;
    const origin = await this.invoices
      .findOne({ _id: new Types.ObjectId(id), organizationId }, null, { session })
      .lean<InvoiceLean>()
      .exec();
    if (!origin) invoiceNotFound();
    return origin;
  }

  /**
   * Quantités créditées de l'origine, conditionnées par la révision lue : deux
   * avoirs simultanés se heurtent, le second est rejoué et se recontrôle.
   */
  private async updateOrigin(
    organizationId: string,
    origin: InvoiceLean,
    credited: { lineIndex: number; quantity: string }[],
    session: ClientSession,
  ): Promise<void> {
    const res = await this.invoices
      .updateOne(
        { _id: origin._id, organizationId, creditRevision: origin.creditRevision ?? 0 },
        {
          $set: {
            credited: credited.map((c) => ({ lineIndex: c.lineIndex, quantity: c.quantity })),
          },
          $inc: { creditRevision: 1 },
        },
        { session },
      )
      .exec();
    if (res.matchedCount !== 1) staleInvoiceRevision(origin.revision);
  }

  private journalInput(
    event: JournalAppendInput['event'],
    doc: InvoiceLean,
    actor: InvoiceActor,
  ): JournalAppendInput {
    const totals = doc.documentAmounts.calculation.totals;
    const n = doc.normalizedAmounts;
    return {
      event,
      invoiceId: String(doc._id),
      proformaRef: doc.proformaRef,
      number: doc.number ?? null,
      series: doc.series ?? null,
      type: doc.type,
      creditNature: doc.creditNote?.nature ?? null,
      originNumber: doc.creditNote?.originNumber ?? null,
      documentTotals: totals
        ? { currency: doc.currency, total: totals.total, vatTotal: totals.vatTotal }
        : null,
      normalizedTotals: n
        ? {
            total: n.calculation.total,
            vatTotal: n.calculation.vatTotal,
            specificTax: n.calculation.specificTax,
          }
        : null,
      conversion: doc.conversion
        ? {
            rate: doc.conversion.rate,
            rateDate: doc.conversion.rateDate,
            rateSource: doc.conversion.rateSource,
          }
        : null,
      contentSha256: doc.contentSha256 ?? null,
      codeDefDgi: null,
      nim: null,
      counters: null,
      actor: { userId: actor.userId, name: actor.name },
    };
  }
}

type StoredNormalizedAmountsRates = Parameters<typeof computeInvoiceTotals>[0]['rates'];
