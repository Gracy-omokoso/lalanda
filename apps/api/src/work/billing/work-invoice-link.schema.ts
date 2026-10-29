// Collection `work_invoice_links` — ADR-0039 § 2.9 (lot L4a).
//
// Le lien facture ↔ projet vit CÔTÉ PROJET : la facture, figée par
// `contentSha256` et versée au journal électronique, ignore le projet comme elle
// ignore le devis (O3). Une facture appartient à un projet au plus (index unique).
// Une facture brouillon supprimée laisse un lien orphelin, ignoré à la lecture et
// nettoyé au passage.

import { WORK_INVOICE_LINK_ORIGINS, type WorkInvoiceLinkOrigin } from '@lalanda/shared/work';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'work_invoice_links', timestamps: false, strict: true })
export class WorkInvoiceLink {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  /** `sales_invoices` de l'organisation, type `FV` ou `EV` (jamais un avoir). */
  @Prop({ type: String, required: true })
  invoiceId!: string;

  /** Jalon dont la facture a été préparée (`origin: 'milestone'`), sinon `null`. */
  @Prop({ type: String, default: null })
  milestoneTaskId!: string | null;

  @Prop({ type: String, required: true, enum: [...WORK_INVOICE_LINK_ORIGINS] })
  origin!: WorkInvoiceLinkOrigin;

  @Prop({ type: Date, required: true })
  linkedAt!: Date;

  @Prop({ type: String, required: true })
  linkedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type WorkInvoiceLinkDocument = HydratedDocument<WorkInvoiceLink>;
export type WorkInvoiceLinkLean = WorkInvoiceLink & { _id: Types.ObjectId };
export const WorkInvoiceLinkSchema = SchemaFactory.createForClass(WorkInvoiceLink);
WorkInvoiceLinkSchema.index({ organizationId: 1, invoiceId: 1 }, { unique: true });
WorkInvoiceLinkSchema.index({ organizationId: 1, projectId: 1, linkedAt: -1 });
