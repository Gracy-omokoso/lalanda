// Réclamations des rappels d'échéance des factures fournisseurs — ADR-0044 § 6.5.
// ADR-0044 — P6.
//
// Une ligne par (organisation, facture, type, échéance) : l'index UNIQUE fait office
// de verrou, comme `reminders.<type>For` des relances du CRM, sans écrire dans les
// factures (lot P4). Deux passages concurrents ne notifient jamais deux fois ;
// une échéance déplacée rouvre le rappel.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'purchase_due_reminders', timestamps: false, strict: true })
export class PurchaseDueReminder {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  invoiceId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['purchases.invoice_due_soon', 'purchases.invoice_overdue'],
  })
  kind!: 'purchases.invoice_due_soon' | 'purchases.invoice_overdue';

  /** Échéance `AAAA-MM-JJ` rappelée. */
  @Prop({ type: String, required: true })
  dueDate!: string;

  @Prop({ type: Date, required: true })
  claimedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PurchaseDueReminderDocument = HydratedDocument<PurchaseDueReminder>;
export const PurchaseDueReminderSchema = SchemaFactory.createForClass(PurchaseDueReminder);
PurchaseDueReminderSchema.index(
  { organizationId: 1, invoiceId: 1, kind: 1, dueDate: 1 },
  { unique: true },
);
