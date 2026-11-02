// ─────────────────────────────────────────────────────────────────────────────
// FACTURES DES ABONNEMENTS LALANDA (ADR-0047, décision de la dirigeante du
// 3 nov. 2026 — « fais ce qui s'applique en RDC Congo », à revoir avec
// l'expert-comptable)
//
// Option A : chaque paiement d'abonnement confirmé produit une facture ÉMISE PAR
// L'ORGANISATION VENDEUSE (Go freelance SARLU) DANS LALANDA MÊME, par le circuit
// des factures de vente existant (brouillon → émission, ADR-0023). Rien n'est
// recalculé ici : le moteur `invoice-totals` calcule la facture, la série
// `IN{AA}{MM}-NNNNNN` la numérote (ADR-0027), le PDF est celui des ventes.
//
// ── Ce qui est garanti ───────────────────────────────────────────────────────
//
// 1. UN PAIEMENT, UNE FACTURE. L'index unique `paymentKey` de
//    `subscription_invoices` est l'arbitre ; un bail (`lockedUntil`) empêche deux
//    traitements simultanés ; le brouillon créé est retenu (`draftId`) pour qu'une
//    reprise l'émette au lieu d'en créer un second.
// 2. LA FACTURE SUIT LE PAIEMENT, ELLE NE LE CONDITIONNE JAMAIS. Une facture
//    impossible (vendeur non désigné, fiche fiscale absente, taux DGI absents…)
//    laisse une ligne `failed` visible dans la console, où « émettre la facture »
//    la reprend ; l'abonnement, lui, est déjà prolongé.
// 3. AUCUNE NORMALISATION (décision n° 5) : l'émission passe par `issue` (mode
//    ordinaire). Une organisation vendeuse en facture normalisée est refusée par le
//    circuit lui-même (`NORMALIZATION_REQUIRED`) : la normalisation des abonnements
//    attend l'homologation (lot N7).
// 4. PONT ENTRE LOCATAIRES À SENS UNIQUE ET BORNÉ : seuls raison sociale, NIF et
//    adresse de l'abonné entrent dans l'organisation vendeuse, comme fiche client.
//    Aucune donnée du vendeur ne remonte chez l'abonné, sauf la facture qui lui
//    est destinée. Le téléchargement par l'abonné est journalisé chez lui avec son
//    identité, et chez le vendeur sous l'acteur système (aucun identifiant
//    d'utilisateur d'une autre organisation dans le journal du vendeur).
// ─────────────────────────────────────────────────────────────────────────────

import { centsToDecimal, decimalToCents } from '@lalanda/engine';
import { SUBSCRIPTION_TAX } from '@lalanda/shared/pricing';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { AdminService, type AdminActor } from '../admin/admin.service.js';
import { newPlatformEventRef, PlatformMirrorService } from '../admin/mirror.js';
import { AuditService } from '../authz/audit.service.js';
import { Subscription, type SubscriptionDocument } from '../billing/subscription.schema.js';
import { FiscalProfileService } from '../fiscal/fiscal-profile.service.js';
import { NormalizedInvoicingService } from '../fiscal/normalized-invoicing.service.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { Organization, type OrganizationDocument } from '../organizations/organization.schema.js';
import {
  ManualPaymentRequest,
  type ManualPaymentRequestDocument,
} from '../payments/manual-payment.schema.js';
import type { PaymentEventDocument } from '../payments/payment-event.schema.js';
import { PaymentsService, type PaymentSucceededFact } from '../payments/payments.service.js';
import { Customer, type CustomerDocument } from '../sales/customer.schema.js';
import { CustomersService } from '../sales/customers.service.js';
import { InvoiceDocumentsService } from '../sales/documents/invoice-documents.service.js';
import { InvoiceDraftsService } from '../sales/invoices/invoice-drafts.service.js';
import { InvoiceFreezingService } from '../sales/invoices/invoice-freezing.service.js';
import type { InvoiceActor, InvoiceLean } from '../sales/invoices/invoice.types.js';
import type { CustomerInput } from '../sales/sales.dto.js';
import {
  SubscriptionBillingProfile,
  SubscriptionInvoiceCustomer,
  type SubscriptionBillingProfileDocument,
  type SubscriptionInvoiceCustomerDocument,
} from './subscription-billing-profile.schema.js';
import {
  billingIdentityOf,
  creditApprovalDecision,
  customerTypeOf,
  invoicePaymentMethodOf,
  isValidSubscriberNif,
  normalizeSubscriberNif,
  subscriptionComment,
  subscriptionLineCode,
  subscriptionLineName,
  type BillingIdentity,
} from './subscription-invoice-rules.js';
import {
  SubscriptionInvoice,
  type SubscriptionInvoiceDocument,
  type SubscriptionInvoiceError,
} from './subscription-invoice.schema.js';
import {
  SubscriptionInvoicingSettings,
  type SubscriptionInvoicingSettingsDocument,
} from './subscription-invoicing-settings.schema.js';

/** Acteur des documents créés chez le vendeur : jamais un opérateur ni un abonné. */
export const SUBSCRIPTION_INVOICING_ACTOR: InvoiceActor = Object.freeze({
  userId: 'system:subscription-invoicing',
  name: 'Lalanda — facturation des abonnements',
  role: 'system',
});

/** Durée du bail d'un traitement : au-delà, une reprise est permise. */
const LEASE_MS = 2 * 60 * 1000;
/** État « facture émise » d'une ligne de `subscription_invoices` (pas d'un document de vente). */
const LINK_ISSUED = 'issued' as const;
const LIST_MAX = 200;

class InvoicingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── Vues ─────────────────────────────────────────────────────────────────────

export interface SubscriberInvoiceView {
  /** Identifiant du document dans l'espace de l'abonné : `<lien>` ou `<lien>-avoir`. */
  id: string;
  kind: 'invoice' | 'credit_note';
  number: string;
  issuedAt: string | null;
  plan: string | null;
  interval: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  exclTaxCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  /** Mention du mode d'émission : facture ordinaire, non normalisée (décision n° 5). */
  normalized: boolean;
}

export interface ConsoleSubscriptionInvoiceView {
  id: string;
  organizationId: string;
  organizationName: string | null;
  provider: string;
  eventId: string;
  reference: string | null;
  plan: string | null;
  interval: string | null;
  amountCents: number | null;
  currency: string | null;
  method: string;
  paidAt: string;
  status: SubscriptionInvoiceDocument['status'];
  origin: 'automatic' | 'console';
  invoiceNumber: string | null;
  issuedAt: string | null;
  lastError: { code: string; message: string } | null;
  emissionReason: string | null;
  creditNote: {
    status: string;
    reason: string;
    requestedBy: string;
    approvedBy: string | null;
    soleApprover: boolean;
    number: string | null;
    lastError: { code: string; message: string } | null;
  } | null;
}

export interface UninvoicedPaymentView {
  provider: string;
  eventId: string;
  organizationId: string;
  organizationName: string | null;
  reference: string | null;
  plan: string | null;
  interval: string | null;
  amountCents: number | null;
  currency: string | null;
  paidAt: string;
  /** État de la tentative précédente, s'il y en a eu une. */
  attempt: { status: string; lastError: { code: string; message: string } | null } | null;
}

export interface SellerView {
  sellerOrganizationId: string | null;
  organizationName: string | null;
  designatedAt: string | null;
  reason: string | null;
  readiness: { ready: boolean; blockers: { code: string; message: string }[] };
}

export interface BillingProfileView {
  /** Fiche saisie par l'abonné, ou `null`. */
  profile: {
    legalName: string;
    nif: string | null;
    address: string | null;
    revision: number;
  } | null;
  /** Ce qui figurera sur la prochaine facture. */
  effective: BillingIdentity;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function errorView(e: SubscriptionInvoiceError | null): { code: string; message: string } | null {
  return e ? { code: e.code, message: e.message } : null;
}

/** Une erreur quelconque → code et message lisibles, sans pile ni donnée brute. */
function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof InvoicingFailure) return { code: error.code, message: error.message };
  if (error instanceof HttpException) {
    const body = error.getResponse() as {
      code?: string;
      message?: string;
      details?: { issues?: { code?: string; message?: string }[] };
    };
    const issues = (body.details?.issues ?? [])
      .map((i) => i.message ?? i.code)
      .filter((m): m is string => typeof m === 'string');
    const base = typeof body.message === 'string' ? body.message : error.message;
    return {
      code: typeof body.code === 'string' ? body.code : 'INVOICE_REFUSED',
      message: (issues.length > 0 ? `${base} ${issues.join(' ; ')}` : base).slice(0, 500),
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Erreur interne pendant l’émission : réessayez depuis la console.',
  };
}

function headOffice(h: {
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
export class SubscriptionInvoicingService implements OnModuleInit {
  private readonly logger = new Logger('SubscriptionInvoicing');

  constructor(
    @InjectModel(SubscriptionInvoice.name)
    private readonly links: Model<SubscriptionInvoiceDocument>,
    @InjectModel(SubscriptionInvoicingSettings.name)
    private readonly settings: Model<SubscriptionInvoicingSettingsDocument>,
    @InjectModel(SubscriptionBillingProfile.name)
    private readonly profiles: Model<SubscriptionBillingProfileDocument>,
    @InjectModel(SubscriptionInvoiceCustomer.name)
    private readonly customerLinks: Model<SubscriptionInvoiceCustomerDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Organization.name) private readonly orgs: Model<OrganizationDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(ManualPaymentRequest.name)
    private readonly manualRequests: Model<ManualPaymentRequestDocument>,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(InvoiceDraftsService) private readonly drafts: InvoiceDraftsService,
    @Inject(InvoiceFreezingService) private readonly freezing: InvoiceFreezingService,
    @Inject(CustomersService) private readonly customersService: CustomersService,
    @Inject(InvoiceDocumentsService) private readonly documents: InvoiceDocumentsService,
    @Inject(FiscalProfileService) private readonly fiscal: FiscalProfileService,
    @Inject(NormalizedInvoicingService) private readonly normalized: NormalizedInvoicingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PlatformAuditService) private readonly platformAudit: PlatformAuditService,
    @Inject(PlatformMirrorService) private readonly mirrors: PlatformMirrorService,
    @Inject(AdminService) private readonly admin: AdminService,
  ) {}

  onModuleInit(): void {
    // Décision n° 2 : la pièce naît à l'encaissement confirmé (dépôt manuel
    // confirmé dans la console, ou paiement Stripe ou PayPal réussi).
    this.payments.onPaymentSucceeded((fact) => this.onPaymentSucceeded(fact));
  }

  private async onPaymentSucceeded(fact: PaymentSucceededFact): Promise<void> {
    const link = await this.invoiceForPayment(fact, { origin: 'automatic' });
    if (link.status !== 'issued') {
      this.logger.warn(
        `Facture d'abonnement non émise (${link.paymentKey}) : ${link.lastError?.code ?? '?'}`,
      );
    }
  }

  // ── Le pont paiement → facture ─────────────────────────────────────────────

  /**
   * Émet (ou retrouve) LA facture d'un paiement. Idempotent : rejouer renvoie la
   * même ligne, sans nouvelle facture. Ne lève jamais pour un échec d'émission :
   * la ligne passe `failed`, avec son motif.
   */
  async invoiceForPayment(
    fact: PaymentSucceededFact,
    opts: { origin: 'automatic' | 'console'; operatorId?: string; reason?: string },
  ): Promise<SubscriptionInvoiceDocument> {
    const paymentKey = `${fact.provider}:${fact.eventId}`;
    let link = await this.links.findOne({ paymentKey }).exec();
    if (!link) {
      try {
        link = await this.links.create({
          organizationId: fact.organizationId,
          paymentKey,
          provider: fact.provider,
          eventId: fact.eventId,
          reference: fact.reference,
          plan: fact.plan,
          interval: fact.interval,
          amountCents: fact.amountCents,
          currency: fact.currency,
          method: fact.method,
          paidAt: fact.paidAt,
          status: 'pending',
          origin: opts.origin,
          attempts: 0,
          _schemaVersion: 1,
        });
      } catch (error) {
        if ((error as { code?: unknown }).code !== 11000) throw error;
        link = await this.links.findOne({ paymentKey }).exec();
        if (!link) throw error;
      }
    }
    if (link.status === 'issued') return link;

    const now = new Date();
    const leased = await this.links
      .findOneAndUpdate(
        {
          _id: link._id,
          status: { $ne: 'issued' },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
        },
        {
          $set: {
            lockedUntil: new Date(now.getTime() + LEASE_MS),
            status: 'pending',
            // Un montant connu depuis (console) complète une ligne qui n'en avait pas.
            ...(link.amountCents === null && fact.amountCents !== null
              ? { amountCents: fact.amountCents, currency: fact.currency }
              : {}),
            ...(opts.origin === 'console'
              ? {
                  origin: 'console',
                  emittedBy: opts.operatorId ?? null,
                  emissionReason: opts.reason ?? null,
                }
              : {}),
          },
          $inc: { attempts: 1 },
        },
        { new: true },
      )
      .exec();
    // Un autre traitement tient le bail, ou a déjà émis : son état fait foi.
    if (!leased) return (await this.links.findById(link._id).exec()) ?? link;

    try {
      const issued = await this.issue(leased);
      await this.links
        .updateOne(
          { _id: leased._id },
          {
            $set: {
              status: LINK_ISSUED,
              invoiceId: issued.invoiceId,
              invoiceNumber: issued.number,
              issuedAt: issued.issuedAt,
              lastError: null,
              lockedUntil: null,
            },
          },
        )
        .exec();
      await this.audit.record({
        organizationId: leased.organizationId,
        actorUserId: 'system',
        actorRole: 'system',
        action: 'subscription.invoice_issued',
        targetType: 'subscription',
        targetId: leased.organizationId,
        metadata: { number: issued.number, paymentKey: leased.paymentKey },
      });
    } catch (error) {
      const failure = failureOf(error);
      if (!(error instanceof InvoicingFailure) && !(error instanceof HttpException)) {
        this.logger.error(
          `Facture d'abonnement ${leased.paymentKey} : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await this.links
        .updateOne(
          { _id: leased._id },
          {
            $set: {
              status: 'failed',
              lastError: { ...failure, at: new Date() },
              lockedUntil: null,
            },
          },
        )
        .exec();
    }
    return (await this.links.findById(leased._id).exec())!;
  }

  /** Le travail réel : client chez le vendeur, brouillon, émission. */
  private async issue(
    link: SubscriptionInvoiceDocument,
  ): Promise<{ invoiceId: string; number: string; issuedAt: Date | null }> {
    const seller = await this.sellerOrganizationId();
    if (seller === null) {
      throw new InvoicingFailure(
        'SELLER_NOT_DESIGNATED',
        'Aucune organisation vendeuse n’est désignée : désignez celle de Go freelance SARLU dans la console (Abonnements › Factures).',
      );
    }
    if (seller === link.organizationId) {
      throw new InvoicingFailure(
        'SELLER_IS_SUBSCRIBER',
        'L’organisation vendeuse ne se facture pas elle-même.',
      );
    }
    if (link.amountCents === null || link.amountCents <= 0) {
      throw new InvoicingFailure(
        'AMOUNT_UNKNOWN',
        'Le montant encaissé n’est pas connu pour ce paiement : aucune facture n’est émise sur un montant deviné.',
      );
    }
    const currency = link.currency ?? 'USD';
    if (currency !== 'USD' && currency !== 'CDF') {
      throw new InvoicingFailure(
        'CURRENCY_UNSUPPORTED',
        `Devise « ${currency} » non prise en charge par les factures de vente (USD ou CDF).`,
      );
    }

    // Reprise : un brouillon existe déjà pour ce paiement.
    if (link.draftId) {
      const existing = await this.readInvoice(seller, link.draftId);
      if (existing && existing.status === 'issued' && existing.number) {
        return { invoiceId: link.draftId, number: existing.number, issuedAt: existing.issuedAt };
      }
      if (existing && existing.status === 'draft') {
        return this.freeze(seller, link.draftId, existing.revision);
      }
      // Brouillon supprimé à la main chez le vendeur : on repart d'un nouveau.
    }

    // Période couverte, lue sur l'abonnement après l'effet du paiement.
    if (link.periodStart === null || link.periodEnd === null) {
      const sub = await this.subscriptions
        .findOne({ organizationId: link.organizationId })
        .lean<Subscription>()
        .exec();
      link.periodStart = sub?.currentPeriodStart ?? null;
      link.periodEnd = sub?.currentPeriodEnd ?? null;
      await this.links
        .updateOne(
          { _id: link._id },
          { $set: { periodStart: link.periodStart, periodEnd: link.periodEnd } },
        )
        .exec();
    }

    const customerId = await this.ensureCustomer(seller, link.organizationId);
    const amount = centsToDecimal(link.amountCents);
    const draft = await this.drafts.create(
      seller,
      {
        type: 'FV',
        currency,
        // La facture part de la somme ENCAISSÉE (TTC) : total facturé = somme reçue au
        // centime. Le moteur en dégage la base HT (le prix de la grille) et la TVA 16 %.
        priceMode: 'ttc',
        customer: { customerId, printContactDetails: true },
        pointOfSaleId: null,
        lines: [
          {
            source: 'free',
            code: subscriptionLineCode(link.plan, link.interval),
            name: subscriptionLineName(link.plan, link.interval),
            itemType: SUBSCRIPTION_TAX.itemType,
            taxGroup: SUBSCRIPTION_TAX.taxGroup,
            outOfScope: false,
            unit: null,
            quantity: '1',
            unitPrice: amount,
            specificTax: null,
            discount: null,
          },
        ],
        payments: [{ method: invoicePaymentMethodOf(link.method), amount }],
        comments: {
          A: null,
          C: subscriptionComment({
            reference: link.reference,
            eventId: link.eventId,
            periodStart: link.periodStart,
            periodEnd: link.periodEnd,
          }),
        },
        creditNote: null,
        showUsdCounterValue: false,
      },
      SUBSCRIPTION_INVOICING_ACTOR,
    );
    await this.links
      .updateOne(
        { _id: link._id },
        { $set: { draftId: draft.id, sellerOrganizationId: seller, customerId } },
      )
      .exec();
    return this.freeze(seller, draft.id, draft.revision);
  }

  private async freeze(
    seller: string,
    invoiceId: string,
    revision: number,
  ): Promise<{ invoiceId: string; number: string; issuedAt: Date | null }> {
    const view = await this.freezing.issue(
      seller,
      invoiceId,
      revision,
      SUBSCRIPTION_INVOICING_ACTOR,
    );
    if (!view.number) {
      throw new InvoicingFailure('NUMBER_MISSING', 'Facture émise sans numéro définitif.');
    }
    return {
      invoiceId,
      number: view.number,
      issuedAt: view.issuedAt ? new Date(view.issuedAt) : null,
    };
  }

  /** Fiche client de l'abonné chez le vendeur : créée, mise à jour, réactivée au besoin. */
  private async ensureCustomer(seller: string, subscriberOrgId: string): Promise<string> {
    const identity = await this.identityOf(subscriberOrgId);
    const input: CustomerInput = {
      type: customerTypeOf(identity),
      name: identity.legalName.slice(0, 200),
      nif: identity.nif,
      exemptionReference: null,
      phone: null,
      email: null,
      address: identity.address ? identity.address.slice(0, 255) : null,
    };
    const actor = { userId: SUBSCRIPTION_INVOICING_ACTOR.userId, role: 'system' };

    const mapping = await this.customerLinks
      .findOne({ organizationId: subscriberOrgId, sellerOrganizationId: seller })
      .exec();
    let current = mapping
      ? await this.customers
          .findOne({ _id: new Types.ObjectId(mapping.customerId), organizationId: seller })
          .lean<Customer & { _id: Types.ObjectId }>()
          .exec()
      : null;

    // Un contribuable n'a qu'une fiche par organisation (index unique du NIF).
    const byNif = async () =>
      input.nif
        ? this.customers
            .findOne({ organizationId: seller, nif: input.nif })
            .lean<Customer & { _id: Types.ObjectId }>()
            .exec()
        : null;

    if (current === null) {
      const sameNif = await byNif();
      const id = sameNif
        ? String(sameNif._id)
        : (await this.customersService.create(seller, input, actor)).id;
      await this.customerLinks
        .updateOne(
          { organizationId: subscriberOrgId, sellerOrganizationId: seller },
          { $set: { customerId: id }, $setOnInsert: { _schemaVersion: 1 } },
          { upsert: true },
        )
        .exec();
      current = await this.customers
        .findOne({ _id: new Types.ObjectId(id), organizationId: seller })
        .lean<Customer & { _id: Types.ObjectId }>()
        .exec();
      if (!current) throw new InvoicingFailure('CUSTOMER_MISSING', 'Fiche client introuvable.');
    } else if (
      current.type !== input.type ||
      current.name !== input.name ||
      (current.nif ?? null) !== input.nif ||
      (current.address ?? null) !== input.address
    ) {
      try {
        await this.customersService.put(
          seller,
          String(current._id),
          current.revision,
          input,
          actor,
        );
      } catch (error) {
        // Le NIF appartient déjà à une autre fiche du vendeur : on s'y rattache.
        const other = error instanceof ConflictException ? await byNif() : null;
        if (!other) throw error;
        await this.customerLinks
          .updateOne(
            { organizationId: subscriberOrgId, sellerOrganizationId: seller },
            { $set: { customerId: String(other._id) } },
          )
          .exec();
        current = other;
      }
    }
    if (!current.active) {
      await this.customersService.setActive(seller, String(current._id), true, actor);
    }
    return String(current._id);
  }

  /** Décision n° 6 : fiche de facturation, sinon fiche fiscale, sinon nom de l'organisation. */
  private async identityOf(organizationId: string): Promise<BillingIdentity> {
    const [profile, fiscal, org] = await Promise.all([
      this.profiles.findOne({ organizationId }).lean<SubscriptionBillingProfile>().exec(),
      this.fiscal.find(organizationId),
      this.orgs.findById(organizationId).lean<Organization>().exec(),
    ]);
    return billingIdentityOf({
      profile: profile
        ? { legalName: profile.legalName, nif: profile.nif, address: profile.address }
        : null,
      fiscal: fiscal
        ? { legalName: fiscal.legalName, nif: fiscal.nif, address: headOffice(fiscal.headOffice) }
        : null,
      organizationName: org?.name ?? '',
    });
  }

  // ── Organisation vendeuse ─────────────────────────────────────────────────

  async sellerOrganizationId(): Promise<string | null> {
    const doc = await this.settings.findOne({ key: 'seller' }).lean().exec();
    return doc?.sellerOrganizationId ?? null;
  }

  async sellerView(): Promise<SellerView> {
    const doc = await this.settings.findOne({ key: 'seller' }).lean().exec();
    if (!doc) {
      return {
        sellerOrganizationId: null,
        organizationName: null,
        designatedAt: null,
        reason: null,
        readiness: {
          ready: false,
          blockers: [
            {
              code: 'SELLER_NOT_DESIGNATED',
              message: 'Aucune organisation vendeuse n’est désignée.',
            },
          ],
        },
      };
    }
    const org = await this.orgs.findById(doc.sellerOrganizationId).lean<Organization>().exec();
    return {
      sellerOrganizationId: doc.sellerOrganizationId,
      organizationName: org?.name ?? null,
      designatedAt: iso(doc.designatedAt),
      reason: doc.reason,
      readiness: await this.readinessOf(doc.sellerOrganizationId),
    };
  }

  /** Ce qui empêchera l'émission, dit à la désignation et dans la console. */
  private async readinessOf(
    sellerOrganizationId: string,
  ): Promise<{ ready: boolean; blockers: { code: string; message: string }[] }> {
    const blockers: { code: string; message: string }[] = [];
    const profile = await this.fiscal.find(sellerOrganizationId);
    if (profile === null) {
      blockers.push({
        code: 'FISCAL_PROFILE_REQUIRED',
        message:
          'L’organisation vendeuse n’a pas de fiche fiscale : la facture reprend dénomination, NIF, siège, téléphone et e-mail de cette fiche (Organisation › Fiscalité).',
      });
    } else if (!profile.vatRegistered) {
      blockers.push({
        code: 'SELLER_NOT_VAT_REGISTERED',
        message:
          'La fiche fiscale du vendeur le déclare non assujetti à la TVA : le groupe B (16 %) lui est refusé.',
      });
    }
    if ((await this.normalized.emissionModeOf(sellerOrganizationId)) === 'normalized') {
      blockers.push({
        code: 'NORMALIZATION_REQUIRED',
        message:
          'La facture normalisée est activée pour l’organisation vendeuse : tant que l’homologation n’est pas obtenue, les abonnements sont facturés en mode ordinaire. Désactivez-la, ou désignez une autre organisation.',
      });
    }
    return { ready: blockers.length === 0, blockers };
  }

  async designateSeller(
    input: { organizationId: string; reason: string },
    actor: AdminActor,
  ): Promise<SellerView> {
    if (!Types.ObjectId.isValid(input.organizationId)) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation inconnue.',
      });
    }
    const org = await this.orgs.findById(input.organizationId).lean<Organization>().exec();
    if (!org) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organisation inconnue.',
      });
    }
    const before = await this.sellerOrganizationId();
    const now = new Date();
    await this.settings
      .updateOne(
        { key: 'seller' },
        {
          $set: {
            sellerOrganizationId: input.organizationId,
            designatedBy: actor.userId,
            designatedAt: now,
            reason: input.reason,
          },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
    await this.platformAudit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.subscription_invoice.seller_designated',
      targetType: 'organization',
      targetId: input.organizationId,
      metadata: { previous: before, internalNote: input.reason },
    });
    return this.sellerView();
  }

  // ── Espace de l'abonné ─────────────────────────────────────────────────────

  async listForSubscriber(organizationId: string): Promise<SubscriberInvoiceView[]> {
    const links = await this.links
      .find({ organizationId, status: LINK_ISSUED })
      .sort({ paidAt: -1 })
      .limit(LIST_MAX)
      .lean<SubscriptionInvoice[]>()
      .exec();
    const docs = new Map<string, InvoiceLean>();
    for (const l of links) {
      if (!l.sellerOrganizationId) continue;
      for (const id of [l.invoiceId, l.creditNote?.invoiceId ?? null]) {
        if (!id) continue;
        const doc = await this.readInvoice(l.sellerOrganizationId, id);
        if (doc) docs.set(id, doc);
      }
    }
    const out: SubscriberInvoiceView[] = [];
    for (const l of links) {
      const base = {
        plan: l.plan,
        interval: l.interval,
        periodStart: iso(l.periodStart),
        periodEnd: iso(l.periodEnd),
      };
      const doc = l.invoiceId ? docs.get(l.invoiceId) : undefined;
      out.push({
        id: String((l as unknown as { _id: Types.ObjectId })._id),
        kind: 'invoice',
        number: l.invoiceNumber ?? '',
        issuedAt: iso(l.issuedAt),
        ...base,
        ...this.amountsOf(doc, l.currency),
      });
      const cn = l.creditNote;
      if (cn?.status === 'issued' && cn.invoiceId && cn.number) {
        const cdoc = docs.get(cn.invoiceId);
        out.push({
          id: `${String((l as unknown as { _id: Types.ObjectId })._id)}-avoir`,
          kind: 'credit_note',
          number: cn.number,
          issuedAt: iso(cdoc?.issuedAt ?? cn.approvedAt),
          ...base,
          ...this.amountsOf(cdoc, l.currency),
        });
      }
    }
    return out;
  }

  /** Document de vente du vendeur, lu par le circuit des ventes ; `null` s'il n'existe plus. */
  private async readInvoice(seller: string, invoiceId: string): Promise<InvoiceLean | null> {
    try {
      return await this.drafts.requireOwn(seller, invoiceId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  private amountsOf(
    doc: InvoiceLean | undefined,
    fallbackCurrency: string | null,
  ): Pick<
    SubscriberInvoiceView,
    'currency' | 'exclTaxCents' | 'taxCents' | 'totalCents' | 'normalized'
  > {
    const totals = doc?.documentAmounts.calculation.totals ?? null;
    const ht = totals?.groups.reduce<number | null>((sum, g) => {
      const c = decimalToCents(g.ht);
      return sum === null || c === null ? null : sum + c;
    }, 0);
    return {
      currency: doc?.currency ?? fallbackCurrency ?? 'USD',
      exclTaxCents: ht ?? null,
      taxCents: totals ? decimalToCents(totals.vatTotal) : null,
      totalCents: totals ? decimalToCents(totals.total) : null,
      normalized: doc?.status === 'normalized',
    };
  }

  /** PDF d'une facture (ou de son avoir) de l'abonné — jamais celle d'un autre. */
  async pdfForSubscriber(
    organizationId: string,
    documentId: string,
    user: { id: string; role: string },
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const isCredit = documentId.endsWith('-avoir');
    const linkId = isCredit ? documentId.slice(0, -'-avoir'.length) : documentId;
    if (!Types.ObjectId.isValid(linkId)) this.notFound();
    const link = await this.links
      .findOne({ _id: new Types.ObjectId(linkId), organizationId, status: LINK_ISSUED })
      .exec();
    if (!link || !link.sellerOrganizationId) this.notFound();
    const invoiceId = isCredit
      ? link.creditNote?.status === 'issued'
        ? link.creditNote.invoiceId
        : null
      : link.invoiceId;
    if (!invoiceId) this.notFound();
    const rendered = await this.documents.original(
      link.sellerOrganizationId,
      invoiceId,
      SUBSCRIPTION_INVOICING_ACTOR,
    );
    await this.audit.record({
      organizationId,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'subscription.invoice_downloaded',
      targetType: 'subscription',
      targetId: organizationId,
      metadata: { fileName: rendered.fileName, kind: isCredit ? 'credit_note' : 'invoice' },
    });
    return { pdf: rendered.pdf, fileName: rendered.fileName };
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'SUBSCRIPTION_INVOICE_NOT_FOUND',
      message: 'Facture introuvable.',
    });
  }

  async billingProfile(organizationId: string): Promise<BillingProfileView> {
    const profile = await this.profiles
      .findOne({ organizationId })
      .lean<SubscriptionBillingProfile>()
      .exec();
    return {
      profile: profile
        ? {
            legalName: profile.legalName,
            nif: profile.nif,
            address: profile.address,
            revision: profile.revision,
          }
        : null,
      effective: await this.identityOf(organizationId),
    };
  }

  async saveBillingProfile(
    organizationId: string,
    input: { legalName: string; nif: string | null; address: string | null },
    user: { id: string; role: string },
  ): Promise<BillingProfileView> {
    const nif = normalizeSubscriberNif(input.nif);
    if (nif !== null && !isValidSubscriberNif(nif)) {
      throw new BadRequestException({
        code: 'NIF_INVALID',
        message: 'NIF : 5 à 20 lettres ou chiffres.',
      });
    }
    await this.profiles
      .updateOne(
        { organizationId },
        {
          $set: {
            legalName: input.legalName,
            nif,
            address: input.address,
            updatedBy: user.id,
          },
          $inc: { revision: 1 },
          $setOnInsert: { _schemaVersion: 1 },
        },
        { upsert: true },
      )
      .exec();
    await this.audit.record({
      organizationId,
      actorUserId: user.id,
      actorRole: user.role,
      action: 'subscription.billing_profile_updated',
      targetType: 'subscription',
      targetId: organizationId,
      metadata: { nif: nif !== null, address: input.address !== null },
    });
    return this.billingProfile(organizationId);
  }

  // ── Console ────────────────────────────────────────────────────────────────

  async listForConsole(filter: {
    status?: string;
    limit?: number;
  }): Promise<ConsoleSubscriptionInvoiceView[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) {
      if (!['pending', 'issued', 'failed'].includes(filter.status)) {
        throw new BadRequestException({ code: 'INVALID_STATUS', message: 'État inconnu.' });
      }
      query['status'] = filter.status;
    }
    const docs = await this.links
      .find(query)
      .sort({ paidAt: -1 })
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), LIST_MAX))
      .exec();
    const names = await this.namesOf(docs.map((d) => d.organizationId));
    return docs.map((d) => this.consoleView(d, names.get(d.organizationId) ?? null));
  }

  private consoleView(
    d: SubscriptionInvoiceDocument,
    organizationName: string | null,
  ): ConsoleSubscriptionInvoiceView {
    const cn = d.creditNote;
    return {
      id: String(d._id),
      organizationId: d.organizationId,
      organizationName,
      provider: d.provider,
      eventId: d.eventId,
      reference: d.reference,
      plan: d.plan,
      interval: d.interval,
      amountCents: d.amountCents,
      currency: d.currency,
      method: d.method,
      paidAt: d.paidAt.toISOString(),
      status: d.status,
      origin: d.origin,
      invoiceNumber: d.invoiceNumber,
      issuedAt: iso(d.issuedAt),
      lastError: errorView(d.lastError),
      emissionReason: d.emissionReason,
      creditNote: cn
        ? {
            status: cn.status,
            reason: cn.reason,
            requestedBy: cn.requestedBy,
            approvedBy: cn.approvedBy,
            soleApprover: cn.soleApprover,
            number: cn.number,
            lastError: errorView(cn.lastError),
          }
        : null,
    };
  }

  /**
   * Décision n° 10 : paiements réussis SANS facture émise — y compris ceux d'avant
   * la décision. Rien n'est régularisé automatiquement : la console les liste, et
   * un opérateur émet, paiement par paiement, avec un motif.
   */
  async uninvoicedPayments(limit = LIST_MAX): Promise<UninvoicedPaymentView[]> {
    const events = await this.payments.listSucceededEvents(limit);
    const keys = events.map((e) => `${e.provider}:${e.eventId}`);
    const links = await this.links
      .find({ paymentKey: { $in: keys } })
      .lean<SubscriptionInvoice[]>()
      .exec();
    const byKey = new Map(links.map((l) => [l.paymentKey, l]));
    const pending = events.filter(
      (e) => byKey.get(`${e.provider}:${e.eventId}`)?.status !== 'issued',
    );
    const names = await this.namesOf(pending.map((e) => e.organizationId!));
    const out: UninvoicedPaymentView[] = [];
    for (const e of pending) {
      const fact = await this.factOf(e);
      const link = byKey.get(`${e.provider}:${e.eventId}`);
      out.push({
        provider: e.provider,
        eventId: e.eventId,
        organizationId: fact.organizationId,
        organizationName: names.get(fact.organizationId) ?? null,
        reference: fact.reference,
        plan: fact.plan,
        interval: fact.interval,
        amountCents: fact.amountCents,
        currency: fact.currency,
        paidAt: fact.paidAt.toISOString(),
        attempt: link ? { status: link.status, lastError: errorView(link.lastError) } : null,
      });
    }
    return out;
  }

  /** Faits d'un paiement passé, relus dans `payment_events` et la demande manuelle. */
  private async factOf(e: PaymentEventDocument): Promise<PaymentSucceededFact> {
    const reference = e.provider === 'manual' ? e.eventId.replace(/^manual:/, '') : null;
    const request = reference
      ? await this.manualRequests.findOne({ reference }).lean<ManualPaymentRequest>().exec()
      : null;
    return {
      provider: e.provider,
      eventId: e.eventId,
      organizationId: e.organizationId ?? request?.organizationId ?? '',
      plan: (e.plan ?? request?.plan ?? null) as PaymentSucceededFact['plan'],
      interval: (e.interval ?? request?.interval ?? null) as PaymentSucceededFact['interval'],
      amountCents: e.amountCents ?? request?.amountDueCents ?? null,
      currency: e.currency ?? request?.currency ?? null,
      method:
        request?.method ??
        (e.provider === 'stripe' ? 'card' : e.provider === 'paypal' ? 'paypal' : 'other'),
      reference,
      paidAt: request?.decidedAt ?? e.createdAt,
    };
  }

  /** « Émettre la facture » d'un paiement, depuis la console, avec motif. */
  async emitFromConsole(
    input: { provider: string; eventId: string; reason: string },
    actor: AdminActor,
  ): Promise<{ alreadyIssued: boolean; invoice: ConsoleSubscriptionInvoiceView }> {
    const event = await this.payments.findEvent(input.provider, input.eventId);
    if (
      !event ||
      event.mappedEvent !== 'payment.succeeded' ||
      event.status !== 'processed' ||
      !event.organizationId
    ) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Paiement réussi introuvable pour cette référence.',
      });
    }
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.confirm',
      'platform.billing.confirm',
      event.organizationId,
      actor,
    );
    const existing = await this.links
      .findOne({ paymentKey: `${event.provider}:${event.eventId}` })
      .exec();
    const names = await this.namesOf([event.organizationId]);
    if (existing?.status === 'issued') {
      return {
        alreadyIssued: true,
        invoice: this.consoleView(existing, names.get(event.organizationId) ?? null),
      };
    }
    const link = await this.invoiceForPayment(await this.factOf(event), {
      origin: 'console',
      operatorId: actor.userId,
      reason: input.reason,
    });
    const ref = newPlatformEventRef();
    await this.platformAudit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action:
        link.status === 'issued'
          ? 'billing.subscription_invoice.emitted'
          : 'billing.subscription_invoice.emission_failed',
      targetType: 'organization',
      targetId: event.organizationId,
      metadata: {
        paymentKey: link.paymentKey,
        number: link.invoiceNumber,
        error: link.lastError?.code ?? null,
        internalNote: input.reason,
        ref,
        soleOperator,
      },
    });
    if (link.status === 'issued') {
      await this.mirrors.mirror({
        organizationId: event.organizationId,
        action: 'platform.billing.subscription_invoice_issued',
        targetType: 'organization',
        targetId: event.organizationId,
        platformEventRef: ref,
        soleOperator,
        facts: { number: link.invoiceNumber },
      });
    }
    return {
      alreadyIssued: false,
      invoice: this.consoleView(link, names.get(event.organizationId) ?? null),
    };
  }

  /** PDF d'une facture ou d'un avoir d'abonnement, depuis la console. */
  async pdfForConsole(
    id: string,
    kind: 'invoice' | 'credit_note',
    actor: AdminActor,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const link = await this.linkOrThrow(id);
    const invoiceId =
      kind === 'credit_note'
        ? link.creditNote?.status === 'issued'
          ? link.creditNote.invoiceId
          : null
        : link.status === 'issued'
          ? link.invoiceId
          : null;
    if (!invoiceId || !link.sellerOrganizationId) this.notFound();
    const rendered = await this.documents.original(
      link.sellerOrganizationId,
      invoiceId,
      SUBSCRIPTION_INVOICING_ACTOR,
    );
    await this.platformAudit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.subscription_invoice.pdf_exported',
      targetType: 'organization',
      targetId: link.organizationId,
      metadata: { fileName: rendered.fileName, kind },
    });
    return { pdf: rendered.pdf, fileName: rendered.fileName };
  }

  // ── Avoirs sur remboursement (décision n° 7) ──────────────────────────────

  /** Demande d'avoir : motif obligatoire ; une seconde personne l'approuve. */
  async requestCreditNote(
    id: string,
    input: { reason: string },
    actor: AdminActor,
  ): Promise<ConsoleSubscriptionInvoiceView> {
    const link = await this.linkOrThrow(id);
    if (link.status !== 'issued' || !link.invoiceId) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_INVOICE_NOT_ISSUED',
        message: 'Aucune facture émise pour ce paiement : rien à créditer.',
      });
    }
    if (link.creditNote && link.creditNote.status !== 'failed') {
      throw new ConflictException({
        code: 'CREDIT_NOTE_ALREADY_REQUESTED',
        message:
          link.creditNote.status === 'issued'
            ? 'Un avoir a déjà été émis pour cette facture.'
            : 'Un avoir est déjà demandé : une seconde personne doit l’approuver.',
      });
    }
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.confirm',
      'platform.billing.confirm',
      link.organizationId,
      actor,
    );
    const now = new Date();
    const res = await this.links
      .updateOne(
        {
          _id: link._id,
          $or: [{ creditNote: null }, { 'creditNote.status': 'failed' }],
        },
        {
          $set: {
            creditNote: {
              status: 'requested',
              reason: input.reason,
              requestedBy: actor.userId,
              requestedAt: now,
              approvedBy: null,
              approvedAt: null,
              soleApprover: false,
              draftId: link.creditNote?.draftId ?? null,
              invoiceId: null,
              number: null,
              lastError: null,
            },
          },
        },
      )
      .exec();
    if (res.modifiedCount !== 1) {
      throw new ConflictException({ code: 'CREDIT_NOTE_ALREADY_REQUESTED' });
    }
    await this.platformAudit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action: 'billing.subscription_credit_note.requested',
      targetType: 'organization',
      targetId: link.organizationId,
      metadata: { number: link.invoiceNumber, internalNote: input.reason, soleOperator },
    });
    // Seul détenteur de l'action sur la plateforme : l'approbation suit, marquée.
    if ((await this.admin.effectiveHoldersCount('platform.billing.confirm')) <= 1) {
      return this.approveCreditNote(id, actor);
    }
    const names = await this.namesOf([link.organizationId]);
    return this.consoleView(
      (await this.links.findById(link._id).exec())!,
      names.get(link.organizationId) ?? null,
    );
  }

  /** Approbation par une SECONDE personne, puis émission de l'avoir (annulation). */
  async approveCreditNote(id: string, actor: AdminActor): Promise<ConsoleSubscriptionInvoiceView> {
    const link = await this.linkOrThrow(id);
    const cn = link.creditNote;
    if (!cn || cn.status !== 'requested') {
      throw new ConflictException({
        code: 'CREDIT_NOTE_NOT_REQUESTED',
        message: 'Aucun avoir n’attend d’approbation pour cette facture.',
      });
    }
    const decision = creditApprovalDecision({
      requestedBy: cn.requestedBy,
      approverUserId: actor.userId,
      holdersCount: await this.admin.effectiveHoldersCount('platform.billing.confirm'),
    });
    if (!decision.ok) {
      throw new ConflictException({
        code: decision.code,
        message:
          'La personne qui a demandé l’avoir ne l’approuve pas : une seconde personne est requise.',
      });
    }
    const { soleOperator } = await this.admin.assertNoSelfDealing(
      'billing.confirm',
      'platform.billing.confirm',
      link.organizationId,
      actor,
    );
    const now = new Date();
    const claimed = await this.links
      .findOneAndUpdate(
        { _id: link._id, 'creditNote.status': 'requested', 'creditNote.approvedBy': null },
        {
          $set: {
            'creditNote.approvedBy': actor.userId,
            'creditNote.approvedAt': now,
            'creditNote.soleApprover': decision.soleApprover,
          },
        },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new ConflictException({ code: 'CREDIT_NOTE_NOT_REQUESTED' });
    }

    let outcome: 'issued' | 'failed' = 'failed';
    try {
      const issued = await this.issueCreditNote(claimed);
      await this.links
        .updateOne(
          { _id: link._id },
          {
            $set: {
              'creditNote.status': 'issued',
              'creditNote.invoiceId': issued.invoiceId,
              'creditNote.number': issued.number,
              'creditNote.lastError': null,
            },
          },
        )
        .exec();
      outcome = 'issued';
    } catch (error) {
      await this.links
        .updateOne(
          { _id: link._id },
          {
            $set: {
              'creditNote.status': 'failed',
              'creditNote.approvedBy': null,
              'creditNote.approvedAt': null,
              'creditNote.lastError': { ...failureOf(error), at: new Date() },
            },
          },
        )
        .exec();
    }
    const fresh = (await this.links.findById(link._id).exec())!;
    const ref = newPlatformEventRef();
    await this.platformAudit.record({
      actorUserId: actor.userId,
      actorRole: actor.platformRole,
      action:
        outcome === 'issued'
          ? 'billing.subscription_credit_note.issued'
          : 'billing.subscription_credit_note.failed',
      targetType: 'organization',
      targetId: link.organizationId,
      metadata: {
        invoiceNumber: link.invoiceNumber,
        creditNoteNumber: fresh.creditNote?.number ?? null,
        requestedBy: cn.requestedBy,
        soleApprover: decision.soleApprover,
        error: fresh.creditNote?.lastError?.code ?? null,
        ref,
        soleOperator,
      },
    });
    if (outcome === 'issued') {
      await this.audit.record({
        organizationId: link.organizationId,
        actorUserId: 'system',
        actorRole: 'system',
        action: 'subscription.credit_note_issued',
        targetType: 'subscription',
        targetId: link.organizationId,
        metadata: { number: fresh.creditNote?.number ?? null, invoiceNumber: link.invoiceNumber },
      });
    }
    const names = await this.namesOf([link.organizationId]);
    return this.consoleView(fresh, names.get(link.organizationId) ?? null);
  }

  /** Avoir d'annulation (`RAN`) reprenant toute la facture, émis par le circuit des ventes. */
  private async issueCreditNote(
    link: SubscriptionInvoiceDocument,
  ): Promise<{ invoiceId: string; number: string }> {
    const seller = link.sellerOrganizationId;
    if (!seller || !link.invoiceId) {
      throw new InvoicingFailure('SUBSCRIPTION_INVOICE_NOT_ISSUED', 'Facture d’origine absente.');
    }
    const cn = link.creditNote!;
    if (cn.draftId) {
      const existing = await this.readInvoice(seller, cn.draftId);
      if (existing?.status === 'issued' && existing.number) {
        return { invoiceId: cn.draftId, number: existing.number };
      }
      if (existing?.status === 'draft') {
        const r = await this.freeze(seller, cn.draftId, existing.revision);
        return { invoiceId: r.invoiceId, number: r.number };
      }
    }
    const origin = await this.drafts.requireOwn(seller, link.invoiceId);
    const total = origin.documentAmounts.calculation.totals?.total;
    const line = origin.lines[0];
    if (!total || !line) {
      throw new InvoicingFailure(
        'ORIGIN_UNREADABLE',
        'Montants de la facture d’origine illisibles.',
      );
    }
    const draft = await this.drafts.create(
      seller,
      {
        type: 'FA',
        currency: origin.currency,
        priceMode: origin.priceMode,
        customer: { customerId: null, walkInName: null },
        pointOfSaleId: origin.pointOfSaleId ?? null,
        lines: [{ source: 'origin', originLineIndex: line.index, quantity: line.quantity }],
        payments: [
          {
            method: origin.payments[0]?.method ?? invoicePaymentMethodOf(link.method),
            amount: total,
          },
        ],
        comments: { A: null, C: `Avoir sur remboursement — ${cn.reason}`.slice(0, 255) },
        creditNote: { nature: 'RAN', originInvoiceId: link.invoiceId },
        showUsdCounterValue: false,
      },
      SUBSCRIPTION_INVOICING_ACTOR,
    );
    await this.links
      .updateOne({ _id: link._id }, { $set: { 'creditNote.draftId': draft.id } })
      .exec();
    const r = await this.freeze(seller, draft.id, draft.revision);
    return { invoiceId: r.invoiceId, number: r.number };
  }

  // ── Interne ────────────────────────────────────────────────────────────────

  private async linkOrThrow(id: string): Promise<SubscriptionInvoiceDocument> {
    if (!Types.ObjectId.isValid(id)) this.notFound();
    const link = await this.links.findById(id).exec();
    if (!link) this.notFound();
    return link;
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids)].filter((i) => Types.ObjectId.isValid(i));
    if (valid.length === 0) return new Map();
    const orgs = await this.orgs
      .find({ _id: { $in: valid.map((i) => new Types.ObjectId(i)) } }, { name: 1 })
      .lean<(Organization & { _id: Types.ObjectId })[]>()
      .exec();
    return new Map(orgs.map((o) => [String(o._id), o.name]));
  }
}
