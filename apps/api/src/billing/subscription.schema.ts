import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PLANS, type Plan } from './entitlements.js';

/**
 * Abonnement d'une organisation (S16b).
 * Une organisation SANS document Subscription est en plan `free` — on ne crée
 * pas de document à l'inscription, seulement lors d'un changement de plan.
 *
 * Pas d'intégration paiement à ce stade : `status` ne connaît que `active`.
 * Les états docs/13 (`trialing`, `past_due`, `grace`, …) viendront avec le
 * fournisseur de paiement.
 */
@Schema({ collection: 'subscriptions', timestamps: true, strict: true })
export class Subscription {
  /** Une seule subscription par organisation. */
  @Prop({ type: String, required: true, unique: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: PLANS, default: 'free' })
  plan!: Plan;

  @Prop({ type: String, required: true, enum: ['active'], default: 'active' })
  status!: 'active';

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // Champs auto-ajoutés par `timestamps: true` (Mongoose). Déclarés pour le typage.
  createdAt!: Date;
  updatedAt!: Date;
}

export type SubscriptionDocument = HydratedDocument<Subscription>;
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
