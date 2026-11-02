// Collection `subscription_invoices` — un paiement d'abonnement, sa facture et son
// avoir éventuel (ADR-0047, décision de la dirigeante du 3 nov. 2026).
//
// Le lien, pas la facture : la facture elle-même est un document de vente ORDINAIRE
// de l'organisation vendeuse (`sales_invoices`, ADR-0023), émis par le circuit
// existant. Cette ligne dit quel paiement l'a produite, pour quel abonné, et en
// garantit l'unicité : l'index unique `paymentKey` fait qu'un paiement donne une
// facture et une seule, même rejoué (confirmation relancée, rappel réémis, bouton
// « émettre » cliqué deux fois).
//
// `organizationId` est l'organisation ABONNÉE (la cliente) : c'est elle qui lit ses
// factures dans `/souscription`. L'organisation vendeuse est `sellerOrganizationId`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const SUBSCRIPTION_INVOICE_STATUSES = ['pending', 'issued', 'failed'] as const;
export type SubscriptionInvoiceStatus = (typeof SUBSCRIPTION_INVOICE_STATUSES)[number];

export const SUBSCRIPTION_CREDIT_STATUSES = ['requested', 'issued', 'failed'] as const;
export type SubscriptionCreditStatus = (typeof SUBSCRIPTION_CREDIT_STATUSES)[number];

export interface SubscriptionInvoiceError {
  code: string;
  message: string;
  at: Date;
}

/** Avoir sur remboursement décidé dans la console : motif, deux personnes. */
export interface SubscriptionCreditNoteState {
  status: SubscriptionCreditStatus;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  /** Approbation par le SEUL détenteur de l'action, marquée (ADR-0053 § 5.3). */
  soleApprover: boolean;
  draftId: string | null;
  invoiceId: string | null;
  number: string | null;
  lastError: SubscriptionInvoiceError | null;
}

@Schema({ collection: 'subscription_invoices', timestamps: true, strict: true, minimize: false })
export class SubscriptionInvoice {
  /** Organisation ABONNÉE. */
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /** `<fournisseur>:<identifiant d'événement>` — la clé d'unicité. */
  @Prop({ type: String, required: true })
  paymentKey!: string;

  @Prop({ type: String, required: true })
  provider!: string;

  @Prop({ type: String, required: true })
  eventId!: string;

  /** Référence `LLD-…` d'un dépôt manuel. */
  @Prop({ type: String, default: null })
  reference!: string | null;

  @Prop({ type: String, default: null })
  plan!: string | null;

  @Prop({ type: String, default: null })
  interval!: string | null;

  /** Somme encaissée TTC, en centimes. */
  @Prop({ type: Number, default: null })
  amountCents!: number | null;

  @Prop({ type: String, default: null })
  currency!: string | null;

  @Prop({ type: String, required: true })
  method!: string;

  @Prop({ type: Date, required: true })
  paidAt!: Date;

  @Prop({ type: Date, default: null })
  periodStart!: Date | null;

  @Prop({ type: Date, default: null })
  periodEnd!: Date | null;

  @Prop({
    type: String,
    required: true,
    enum: SUBSCRIPTION_INVOICE_STATUSES as unknown as string[],
    default: 'pending',
  })
  status!: SubscriptionInvoiceStatus;

  /** `automatic` : à l'encaissement ; `console` : émise depuis la console, avec motif. */
  @Prop({ type: String, required: true, enum: ['automatic', 'console'] })
  origin!: 'automatic' | 'console';

  @Prop({ type: String, default: null })
  sellerOrganizationId!: string | null;

  @Prop({ type: String, default: null })
  customerId!: string | null;

  /** Brouillon créé, conservé pour qu'une reprise l'émette au lieu d'en créer un second. */
  @Prop({ type: String, default: null })
  draftId!: string | null;

  @Prop({ type: String, default: null })
  invoiceId!: string | null;

  @Prop({ type: String, default: null })
  invoiceNumber!: string | null;

  @Prop({ type: Date, default: null })
  issuedAt!: Date | null;

  @Prop({ type: Object, default: null })
  lastError!: SubscriptionInvoiceError | null;

  @Prop({ type: Number, required: true, default: 0 })
  attempts!: number;

  /** Bail de traitement : deux traitements simultanés n'émettent pas deux fois. */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Émission depuis la console : opérateur et motif. */
  @Prop({ type: String, default: null })
  emittedBy!: string | null;

  @Prop({ type: String, default: null })
  emissionReason!: string | null;

  @Prop({ type: Object, default: null })
  creditNote!: SubscriptionCreditNoteState | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionInvoiceDocument = HydratedDocument<SubscriptionInvoice>;
export const SubscriptionInvoiceSchema = SchemaFactory.createForClass(SubscriptionInvoice);

// Un paiement, une facture : l'arbitre est la base, pas un `findOne` préalable.
SubscriptionInvoiceSchema.index({ paymentKey: 1 }, { unique: true });
// Espace de l'abonné : ses factures, plus récentes d'abord.
SubscriptionInvoiceSchema.index({ organizationId: 1, paidAt: -1 });
// Console : par état.
SubscriptionInvoiceSchema.index({ status: 1, updatedAt: -1 });
