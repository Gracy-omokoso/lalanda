// Collection `platform_subscription_invoice_settings` — organisation vendeuse des
// abonnements Lalanda (ADR-0047, décision n° 1, option A).
//
// Réglage de PLATEFORME, sans `organizationId` de locataire : il désigne quelle
// organisation existante (celle de Go freelance SARLU) émet les factures des
// abonnements. Aucune organisation n'est créée par le code : la désignation se
// fait depuis la console (`PUT /admin/billing/subscription-invoices/seller`), avec
// motif et ré-authentification. Une seule ligne (`key: 'seller'`).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'platform_subscription_invoice_settings', timestamps: true, strict: true })
export class SubscriptionInvoicingSettings {
  @Prop({ type: String, required: true, enum: ['seller'] })
  key!: 'seller';

  @Prop({ type: String, required: true })
  sellerOrganizationId!: string;

  @Prop({ type: String, required: true })
  designatedBy!: string;

  @Prop({ type: Date, required: true })
  designatedAt!: Date;

  @Prop({ type: String, required: true })
  reason!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionInvoicingSettingsDocument = HydratedDocument<SubscriptionInvoicingSettings>;
export const SubscriptionInvoicingSettingsSchema = SchemaFactory.createForClass(
  SubscriptionInvoicingSettings,
);
SubscriptionInvoicingSettingsSchema.index({ key: 1 }, { unique: true });
