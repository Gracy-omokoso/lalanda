// Collection `sales_deposit_resolutions` — geste « traité » d'ADR-0050 § 5.2. ADR-0050 — V4.
//
// Geste DÉCLARATIF : l'utilisateur dit qu'il a tenu compte d'une facture d'acompte émise
// dans la facture finale (comme son expert-comptable le lui a indiqué). Lalanda n'impute
// rien, ne calcule rien et ne vérifie pas comment : la marque lève seulement
// `DEPOSIT_NOT_RESOLVED` (moteur `depositSummary`). Ajout seul, une marque par facture
// d'acompte (index unique), motif libre, journalisée.
//
// Comme `sales_document_links`, cette collection n'est lue ni par la comptabilité, ni
// par le pont vers le réalisé, ni par la trésorerie : aucun effet fiscal ni comptable.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'sales_deposit_resolutions', timestamps: true, strict: true })
export class SalesDepositResolution {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Facture d'acompte (`FT`/`ET`) liée à l'engagement par `sales_document_links`. */
  @Prop({ type: String, required: true })
  invoiceId!: string;

  @Prop({ type: String, default: null })
  orderId!: string | null;

  @Prop({ type: String, default: null })
  contractId!: string | null;

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: String, required: true })
  resolvedBy!: string;

  @Prop({ type: Date, required: true })
  resolvedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SalesDepositResolutionDocument = HydratedDocument<SalesDepositResolution>;
export type SalesDepositResolutionLean = SalesDepositResolution & { _id: Types.ObjectId };
export const SalesDepositResolutionSchema = SchemaFactory.createForClass(SalesDepositResolution);
SalesDepositResolutionSchema.index({ organizationId: 1, invoiceId: 1 }, { unique: true });
SalesDepositResolutionSchema.index({ organizationId: 1, orderId: 1 });
SalesDepositResolutionSchema.index({ organizationId: 1, contractId: 1 });
