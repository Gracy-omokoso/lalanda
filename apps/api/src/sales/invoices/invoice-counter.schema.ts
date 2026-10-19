// Collection `sales_invoice_counters` — compteurs de numérotation (ADR-0023 § S25e.3).
//
// SEUL ÉCRIVAIN : `InvoiceNumberingService` (test de lecture des sources). Une
// ligne par organisation, série (`real`, `test`, `proforma`) et année de gestion.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'sales_invoice_counters', timestamps: true, strict: true, minimize: false })
export class SalesInvoiceCounter {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['real', 'test', 'proforma'] })
  series!: 'real' | 'test' | 'proforma';

  @Prop({ type: Number, required: true })
  year!: number;

  /** Dernier numéro attribué (ou réservé) ; 0 avant le premier. */
  @Prop({ type: Number, required: true, default: 0 })
  last!: number;

  @Prop({ type: Date, default: null })
  lastIssuedAt!: Date | null;

  /** Bail de normalisation : une seule facture à la fois entre réservation et issue DGI. */
  @Prop({ type: Object, default: null })
  inFlight!: { invoiceId: string; until: Date } | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesInvoiceCounterDocument = HydratedDocument<SalesInvoiceCounter>;
export const SalesInvoiceCounterSchema = SchemaFactory.createForClass(SalesInvoiceCounter);
SalesInvoiceCounterSchema.index({ organizationId: 1, series: 1, year: 1 }, { unique: true });
