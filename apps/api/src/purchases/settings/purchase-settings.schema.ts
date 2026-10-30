// Collection `purchase_settings` — réglages des achats, un document par
// organisation (ADR-0044 § 2.2). ADR-0044 — P3.
//
// Absent ⇒ `PURCHASE_SETTINGS_DEFAULTS` (décisions ouvertes n° 3, 6 et 9). Les
// montants (seuils, tolérances absolues) sont des chaînes décimales ; aucun n'est
// fixé par Lalanda.

import type { PurchaseApprovalCount } from '@lalanda/shared/purchases';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false, strict: true })
export class PurchaseApprovalTier {
  @Prop({ type: String, required: true })
  from!: string;

  @Prop({ type: Number, required: true, enum: [0, 1, 2] })
  approvals!: PurchaseApprovalCount;
}
const PurchaseApprovalTierSchema = SchemaFactory.createForClass(PurchaseApprovalTier);

@Schema({ _id: false, strict: true })
export class PurchaseTiersByCurrency {
  @Prop({ type: [PurchaseApprovalTierSchema], required: true })
  CDF!: PurchaseApprovalTier[];

  @Prop({ type: [PurchaseApprovalTierSchema], required: true })
  USD!: PurchaseApprovalTier[];
}
const PurchaseTiersByCurrencySchema = SchemaFactory.createForClass(PurchaseTiersByCurrency);

@Schema({ _id: false, strict: true })
export class PurchaseAmountsByCurrency {
  @Prop({ type: String, required: true })
  CDF!: string;

  @Prop({ type: String, required: true })
  USD!: string;
}
const PurchaseAmountsByCurrencySchema = SchemaFactory.createForClass(PurchaseAmountsByCurrency);

@Schema({ _id: false, strict: true })
export class PurchaseMatchingTolerances {
  @Prop({ type: String, required: true })
  pricePercent!: string;

  @Prop({ type: PurchaseAmountsByCurrencySchema, required: true })
  amountAbsolute!: PurchaseAmountsByCurrency;
}
const PurchaseMatchingTolerancesSchema = SchemaFactory.createForClass(PurchaseMatchingTolerances);

@Schema({ collection: 'purchase_settings', timestamps: true, strict: true })
export class PurchaseSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: PurchaseTiersByCurrencySchema, required: true })
  approvalTiers!: PurchaseTiersByCurrency;

  @Prop({ type: Boolean, required: true })
  allowSoleApprover!: boolean;

  @Prop({ type: PurchaseMatchingTolerancesSchema, required: true })
  matchingTolerances!: PurchaseMatchingTolerances;

  @Prop({ type: Number, required: true })
  dueSoonDays!: number;

  @Prop({ type: Boolean, required: true })
  requireOrderForInvoice!: boolean;

  @Prop({ type: Number, required: true })
  paymentDetailsAlertDays!: number;

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

export type PurchaseSettingsDocument = HydratedDocument<PurchaseSettings>;
export type PurchaseSettingsLean = PurchaseSettings & { _id: Types.ObjectId };
export const PurchaseSettingsSchema = SchemaFactory.createForClass(PurchaseSettings);
PurchaseSettingsSchema.index({ organizationId: 1 }, { unique: true });
