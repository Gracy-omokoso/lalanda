// Collection `purchase_receptions` — réceptions (ADR-0044 § 2.4). ADR-0044 — P4.
//
// Une réception n'est jamais effacée : elle s'annule (motif). Aucune quantité en stock
// n'est tenue (§ 6.6). `supplierId` est recopié de la commande (lecture, fusion).

import type { PurchaseReceptionStatus } from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import {
  PurchaseAttachmentDocSchema,
  type PurchaseAttachmentDoc,
} from '../attachments/purchase-attachments.js';

@Schema({ _id: false, strict: true })
export class PurchaseReceptionLine {
  @Prop({ type: String, required: true })
  orderLineId!: string;

  /** Chaîne décimale > 0, trois décimales au plus. */
  @Prop({ type: String, required: true })
  quantity!: string;
}
const PurchaseReceptionLineSchema = SchemaFactory.createForClass(PurchaseReceptionLine);

@Schema({ _id: false, strict: true })
export class PurchaseCancellation {
  @Prop({ type: Date, required: true })
  at!: Date;

  @Prop({ type: String, required: true })
  by!: string;

  @Prop({ type: String, required: true })
  reason!: string;
}
export const PurchaseCancellationSchema = SchemaFactory.createForClass(PurchaseCancellation);

@Schema({ collection: 'purchase_receptions', timestamps: true, strict: true })
export class PurchaseReception {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  orderId!: string;

  @Prop({ type: String, default: null })
  supplierId!: string | null;

  /** Date civile `AAAA-MM-JJ`, jamais future (jour de Kinshasa). */
  @Prop({ type: String, required: true })
  receivedOn!: string;

  @Prop({ type: [PurchaseReceptionLineSchema], required: true })
  lines!: PurchaseReceptionLine[];

  @Prop({ type: String, default: null })
  deliveryNoteRef!: string | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: PurchaseAttachmentDocSchema, default: null })
  attachment!: PurchaseAttachmentDoc | null;

  @Prop({ type: String, required: true, enum: ['recorded', 'cancelled'], default: 'recorded' })
  status!: PurchaseReceptionStatus;

  @Prop({ type: PurchaseCancellationSchema, default: null })
  cancellation!: PurchaseCancellation | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PurchaseReceptionDocument = HydratedDocument<PurchaseReception>;
export type PurchaseReceptionLean = PurchaseReception & { _id: Types.ObjectId };
export const PurchaseReceptionSchema = SchemaFactory.createForClass(PurchaseReception);

// § 2.4 : réceptions d'une commande, par date.
PurchaseReceptionSchema.index({ organizationId: 1, orderId: 1, receivedOn: 1 });
PurchaseReceptionSchema.index({ organizationId: 1, receivedOn: -1, _id: -1 });
