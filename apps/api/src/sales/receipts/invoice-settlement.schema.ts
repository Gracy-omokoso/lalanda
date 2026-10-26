// Collection `sales_invoice_settlements` — un document par facture lettrée ou
// portant une échéance (ADR-0031 § 1 et § 2).
//
// Hors du document figé : l'échéance ne change ni `contentSha256`, ni le PDF, ni
// ce qui part à la DGI. `revision` est incrémentée dans la transaction de chaque
// encaissement qui touche la facture : deux encaissements simultanés écrivent le
// même document, MongoDB en rejoue un, qui voit alors l'autre (pas de dépassement
// du reste à encaisser).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'sales_invoice_settlements', timestamps: true, strict: true })
export class SalesInvoiceSettlement {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  invoiceId!: string;

  /** Échéance `AAAA-MM-JJ` ou `null` : jamais « en retard » sans elle. */
  @Prop({ type: String, default: null })
  dueDate!: string | null;

  @Prop({ type: Number, required: true, default: 0 })
  revision!: number;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SalesInvoiceSettlementDocument = HydratedDocument<SalesInvoiceSettlement>;
export const SalesInvoiceSettlementSchema = SchemaFactory.createForClass(SalesInvoiceSettlement);

SalesInvoiceSettlementSchema.index({ organizationId: 1, invoiceId: 1 }, { unique: true });
