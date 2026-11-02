// Collection `subscription_billing_profiles` — informations de facturation de
// l'organisation ABONNÉE (ADR-0047, décision n° 6).
//
// Raison sociale obligatoire ; NIF et adresse facultatifs. Sans fiche saisie ici,
// la facture reprend la fiche fiscale de l'organisation abonnée quand elle existe
// (dénomination, NIF, siège), sinon son nom. Seuls ces trois champs passent dans
// l'organisation vendeuse (pont à sens unique, borné, ADR-0047 § 2 option A).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'subscription_billing_profiles', timestamps: true, strict: true })
export class SubscriptionBillingProfile {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  legalName!: string;

  @Prop({ type: String, default: null })
  nif!: string | null;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionBillingProfileDocument = HydratedDocument<SubscriptionBillingProfile>;
export const SubscriptionBillingProfileSchema = SchemaFactory.createForClass(
  SubscriptionBillingProfile,
);
SubscriptionBillingProfileSchema.index({ organizationId: 1 }, { unique: true });

/**
 * Collection `subscription_invoice_customers` — fiche client de l'abonné DANS
 * l'organisation vendeuse. `organizationId` est l'abonné ; la fiche vit chez le
 * vendeur (`sellerOrganizationId`, `customerId`).
 */
@Schema({ collection: 'subscription_invoice_customers', timestamps: true, strict: true })
export class SubscriptionInvoiceCustomer {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  sellerOrganizationId!: string;

  @Prop({ type: String, required: true })
  customerId!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type SubscriptionInvoiceCustomerDocument = HydratedDocument<SubscriptionInvoiceCustomer>;
export const SubscriptionInvoiceCustomerSchema = SchemaFactory.createForClass(
  SubscriptionInvoiceCustomer,
);
SubscriptionInvoiceCustomerSchema.index(
  { organizationId: 1, sellerOrganizationId: 1 },
  { unique: true },
);
