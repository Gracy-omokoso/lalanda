import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PLANS, type Plan } from '../billing/entitlements.js';
import { BILLING_INTERVALS, type BillingInterval } from '../billing/pricing-catalog.js';

/**
 * Demande de paiement manuel — mobile money ou virement (S22b).
 *
 * Une ligne par tentative de souscription hors Stripe/PayPal. Elle porte tout ce
 * qu'un administrateur doit voir pour décider : qui, quel plan, combien, quelle
 * référence à retrouver sur le relevé.
 *
 * ── Pourquoi une collection dédiée plutôt qu'un champ sur `subscriptions` ────
 *
 * Parce qu'une demande n'est pas un abonnement. Un client peut en ouvrir
 * plusieurs (changer d'avis, se tromper de plan, laisser expirer), et
 * l'historique des demandes doit survivre à leur refus. Écraser un champ unique
 * sur l'abonnement effacerait la trace de la demande précédente au moment
 * précis où l'on en a besoin : quand un dépôt arrive avec une vieille référence.
 *
 * ── Ce qui n'est PAS ici ─────────────────────────────────────────────────────
 *
 * Aucune coordonnée du payeur (numéro de téléphone, numéro de compte). Le
 * rapprochement se fait par la RÉFÉRENCE, portée par le motif du dépôt. Stocker
 * un numéro mobile money reviendrait à constituer un fichier de données
 * financières personnelles pour un gain de confort — docs/17 § Minimisation.
 */
@Schema({ collection: 'manual_payment_requests', timestamps: true })
export class ManualPaymentRequest {
  /** Référence communiquée au client — unique, c'est la clé de rapprochement. */
  @Prop({ type: String, required: true, unique: true, index: true })
  reference!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /** Utilisateur à l'origine de la demande (support, audit). */
  @Prop({ type: String, required: true })
  requestedBy!: string;

  @Prop({ type: String, required: true, enum: PLANS as unknown as string[] })
  plan!: Plan;

  @Prop({ type: String, required: true, enum: BILLING_INTERVALS as unknown as string[] })
  interval!: BillingInterval;

  /** Montant attendu, en centimes. Figé à la demande : le tarif peut changer. */
  @Prop({ type: Number, required: true })
  amountDueCents!: number;

  @Prop({ type: String, required: true, default: 'USD' })
  currency!: string;

  @Prop({ type: String, required: true, enum: ['mobile_money', 'bank_transfer'] })
  method!: 'mobile_money' | 'bank_transfer';

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'rejected', 'expired'],
    default: 'pending',
    index: true,
  })
  status!: 'pending' | 'confirmed' | 'rejected' | 'expired';

  /** Administrateur plateforme ayant tranché. `null` tant que la demande est ouverte. */
  @Prop({ type: String, default: null })
  decidedBy!: string | null;

  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;

  /** Note de décision : « dépôt M-Pesa 12/08, 9 USD ». Sans donnée personnelle. */
  @Prop({ type: String, default: null })
  decisionNote!: string | null;

  /**
   * Au-delà de cette date, la demande n'est plus confirmable.
   *
   * Sans expiration, une référence émise il y a huit mois resterait
   * indéfiniment activable : un administrateur distrait confirmerait un dépôt
   * ancien au tarif de l'époque. Le client rouvre simplement une demande.
   */
  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ManualPaymentRequestDocument = HydratedDocument<ManualPaymentRequest>;
export const ManualPaymentRequestSchema = SchemaFactory.createForClass(ManualPaymentRequest);

/** Durée de validité d'une demande de paiement manuel, en jours. */
export const MANUAL_REQUEST_TTL_DAYS = 14;

// File de travail de l'administration : « les demandes en attente, les plus
// anciennes d'abord ».
ManualPaymentRequestSchema.index({ status: 1, createdAt: 1 });
