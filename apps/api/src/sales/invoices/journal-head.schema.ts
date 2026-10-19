// Collection `sales_journal_heads` — tête du journal électronique par
// organisation (ADR-0023 § S25e.12) : dernier `seq` et dernier `hash`.
// SEUL ÉCRIVAIN : `InvoiceJournalService`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'sales_journal_heads', timestamps: true, strict: true })
export class SalesJournalHead {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq!: number;

  @Prop({ type: String, default: null })
  lastHash!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesJournalHeadDocument = HydratedDocument<SalesJournalHead>;
export const SalesJournalHeadSchema = SchemaFactory.createForClass(SalesJournalHead);
