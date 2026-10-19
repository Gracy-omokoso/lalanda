// Collection `sales_invoice_journal` — journal électronique (ADR-0023 § S25e.12).
//
// AJOUT SEUL ; SEUL ÉCRIVAIN : `InvoiceJournalService` (test de lecture des
// sources). `seq` part de 1 par organisation, sans trou (tête
// `sales_journal_heads` incrémentée dans la même transaction) ; `hash` chaîne
// chaque entrée à la précédente.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { JOURNAL_EVENTS, type JournalEvent } from './invoice.contract.js';

@Schema({ collection: 'sales_invoice_journal', timestamps: false, strict: true, minimize: false })
export class SalesInvoiceJournalEntry {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Number, required: true })
  seq!: number;

  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true, enum: JOURNAL_EVENTS as unknown as string[] })
  event!: JournalEvent;

  @Prop({ type: String, default: null })
  invoiceId!: string | null;

  @Prop({ type: String, default: null })
  proformaRef!: string | null;

  @Prop({ type: String, default: null })
  number!: string | null;

  @Prop({ type: String, default: null })
  series!: string | null;

  @Prop({ type: String, default: null })
  type!: string | null;

  @Prop({ type: String, default: null })
  creditNature!: string | null;

  @Prop({ type: String, default: null })
  originNumber!: string | null;

  @Prop({ type: Object, default: null })
  documentTotals!: { currency: string; total: string; vatTotal: string } | null;

  @Prop({ type: Object, default: null })
  normalizedTotals!: { total: string; vatTotal: string; specificTax: string } | null;

  @Prop({ type: Object, default: null })
  conversion!: { rate: string; rateDate: string; rateSource: string } | null;

  @Prop({ type: String, default: null })
  contentSha256!: string | null;

  @Prop({ type: String, default: null })
  codeDefDgi!: string | null;

  @Prop({ type: String, default: null })
  nim!: string | null;

  @Prop({ type: String, default: null })
  counters!: string | null;

  @Prop({ type: Object, default: null })
  actor!: { userId: string; name: string } | null;

  @Prop({ type: String, required: true })
  prevHash!: string;

  @Prop({ type: String, required: true })
  hash!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesInvoiceJournalEntryDocument = HydratedDocument<SalesInvoiceJournalEntry>;
export const SalesInvoiceJournalEntrySchema =
  SchemaFactory.createForClass(SalesInvoiceJournalEntry);
SalesInvoiceJournalEntrySchema.index({ organizationId: 1, seq: 1 }, { unique: true });
