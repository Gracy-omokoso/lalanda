// Collections `sales_quotes` et `sales_quote_counters` — ADR-0035 § 1.
//
// Un DEVIS est un document distinct du brouillon de facture (pro forma) : il a
// son propre cycle (brouillon, envoyé, accepté, refusé ; « expiré » est dérivé
// de la validité) et ses versions. Il se CONVERTIT en brouillon de facture, qui
// suit ensuite le circuit d'ADR-0023 sans rien savoir du devis.
//
// Client, lignes et montants ont EXACTEMENT les formes du brouillon de facture
// (`invoice.types.ts`) : ils sont composés et calculés par le même code
// (`InvoiceDraftsService.compose` → moteur `computeInvoiceTotals`).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type {
  StoredCustomer,
  StoredDocumentAmounts,
  StoredLine,
} from '../invoices/invoice.types.js';

export const QUOTE_STORED_STATUSES = ['draft', 'sent', 'accepted', 'refused'] as const;
export type QuoteStoredStatus = (typeof QUOTE_STORED_STATUSES)[number];
/** Statut lu : `expired` est un `sent` dont la validité est passée. */
export type QuoteStatus = QuoteStoredStatus | 'expired';

/** Instantané figé d'une version remplacée par « nouvelle version ». */
export interface QuoteVersionSnapshot {
  version: number;
  status: QuoteStatus;
  title: string | null;
  notes: string | null;
  validUntil: string;
  currency: 'CDF' | 'USD';
  priceMode: 'ttc' | 'ht';
  customer: StoredCustomer;
  lines: StoredLine[];
  documentAmounts: StoredDocumentAmounts;
  sentAt: Date | null;
  refusedAt: Date | null;
  refusalReason: string | null;
  supersededAt: Date;
  supersededBy: string;
}

export interface QuoteConversion {
  invoiceId: string;
  convertedAt: Date;
  convertedBy: string;
}

@Schema({ collection: 'sales_quotes', timestamps: true, strict: true, minimize: false })
export class SalesQuote {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `DV{AA}{MM}-NNNNNN` — hors série fiscale. */
  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: String, required: true, enum: QUOTE_STORED_STATUSES as unknown as string[] })
  status!: QuoteStoredStatus;

  @Prop({ type: String, default: null })
  opportunityId!: string | null;

  @Prop({ type: String, default: null })
  title!: string | null;

  @Prop({ type: String, default: null })
  notes!: string | null;

  /** Jour civil `AAAA-MM-JJ` (Kinshasa), dernier jour de validité inclus. */
  @Prop({ type: String, required: true })
  validUntil!: string;

  @Prop({ type: String, required: true, enum: ['CDF', 'USD'] })
  currency!: 'CDF' | 'USD';

  @Prop({ type: String, required: true, enum: ['ttc', 'ht'] })
  priceMode!: 'ttc' | 'ht';

  @Prop({ type: Object, required: true })
  customer!: StoredCustomer;

  @Prop({ type: [Object], default: [] })
  lines!: StoredLine[];

  @Prop({ type: Object, required: true })
  documentAmounts!: StoredDocumentAmounts;

  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({ type: Date, default: null })
  refusedAt!: Date | null;

  @Prop({ type: String, default: null })
  refusalReason!: string | null;

  /** Effet de l'acceptation sur l'opportunité (règle de gain, ADR-0035 § 1). */
  @Prop({ type: String, default: null })
  opportunityOutcome!: 'won' | 'disabled' | 'not_open' | 'none' | null;

  @Prop({ type: Object, default: null })
  conversion!: QuoteConversion | null;

  @Prop({ type: [Object], default: [] })
  previousVersions!: QuoteVersionSnapshot[];

  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesQuoteDocument = HydratedDocument<SalesQuote>;
export type QuoteLean = SalesQuote & { _id: Types.ObjectId };
export const SalesQuoteSchema = SchemaFactory.createForClass(SalesQuote);
SalesQuoteSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
SalesQuoteSchema.index({ organizationId: 1, number: 1 }, { unique: true });
SalesQuoteSchema.index({ organizationId: 1, status: 1, validUntil: 1 });
SalesQuoteSchema.index({ organizationId: 1, opportunityId: 1 });
SalesQuoteSchema.index({ organizationId: 1, 'customer.customerId': 1 });

/** Compteur annuel des devis (Kinshasa) ; trous admis : un devis n'est pas une pièce fiscale. */
@Schema({ collection: 'sales_quote_counters', strict: true })
export class SalesQuoteCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type SalesQuoteCounterDocument = HydratedDocument<SalesQuoteCounter>;
export const SalesQuoteCounterSchema = SchemaFactory.createForClass(SalesQuoteCounter);
SalesQuoteCounterSchema.index({ organizationId: 1, year: 1 }, { unique: true });
