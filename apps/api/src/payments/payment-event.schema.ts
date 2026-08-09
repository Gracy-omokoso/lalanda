import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PAYMENT_PROVIDERS, type PaymentProviderId } from './payment-provider.js';

/**
 * Journal des rappels de paiement REÇUS — support de l'idempotence (S22b).
 *
 * ── Le problème que cette collection résout ──────────────────────────────────
 *
 * Tous les fournisseurs réémettent. Stripe retente pendant trois jours tant
 * qu'il n'a pas reçu un 2xx ; PayPal fait de même. Un rappel « paiement reçu »
 * traité deux fois prolongerait la période de facturation deux fois, ou
 * créditerait deux fois un prorata. Ce n'est pas un cas théorique : une réponse
 * lente suffit à déclencher une réémission alors que le premier traitement a
 * abouti.
 *
 * ── Le mécanisme ─────────────────────────────────────────────────────────────
 *
 * L'index unique `{ provider, eventId }` fait foi, et l'insertion a lieu AVANT
 * le traitement. Une seconde réception échoue en `E11000` : le service en
 * déduit un doublon et répond 200 sans rien faire. Ce n'est pas un `findOne`
 * suivi d'un `create` — cette forme-là laisse une fenêtre entre la lecture et
 * l'écriture pendant laquelle deux réceptions simultanées passent toutes les
 * deux. L'unicité est déléguée à la base, seule à pouvoir l'arbitrer.
 *
 * ── Le statut, et pourquoi il existe ─────────────────────────────────────────
 *
 * Insérer avant de traiter crée un risque symétrique : si le traitement échoue
 * ensuite (base indisponible, transition interdite), la trace existe déjà et la
 * réémission serait rejetée comme doublon — le paiement serait perdu. D'où
 * `status` : un événement `received` dont le traitement a échoué est REPRIS lors
 * de la réémission ; seul un `processed` est un vrai doublon.
 */
@Schema({ collection: 'payment_events', timestamps: { createdAt: true, updatedAt: true } })
export class PaymentEvent {
  @Prop({ type: String, required: true, enum: PAYMENT_PROVIDERS as unknown as string[] })
  provider!: PaymentProviderId;

  /** Identifiant CHEZ LE FOURNISSEUR. Jamais généré localement. */
  @Prop({ type: String, required: true })
  eventId!: string;

  /** Type brut (`invoice.paid`, `BILLING.SUBSCRIPTION.ACTIVATED`…). */
  @Prop({ type: String, required: true })
  rawType!: string;

  /** Événement métier appliqué, ou `null` si le rappel est sans effet. */
  @Prop({ type: String, default: null })
  mappedEvent!: string | null;

  /** Organisation résolue, `null` si le rappel n'était rattachable à aucune. */
  @Prop({ type: String, default: null, index: true })
  organizationId!: string | null;

  @Prop({
    type: String,
    required: true,
    enum: ['received', 'processed', 'ignored', 'failed'],
    default: 'received',
  })
  status!: 'received' | 'processed' | 'ignored' | 'failed';

  /** Motif d'échec ou d'ignorance — assaini, jamais un message fournisseur brut. */
  @Prop({ type: String, default: null })
  detail!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PaymentEventDocument = HydratedDocument<PaymentEvent>;
export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);

/**
 * L'unicité qui porte toute l'idempotence.
 *
 * Sur le couple et non sur `eventId` seul : rien ne garantit que deux
 * fournisseurs n'émettent pas un jour le même identifiant, et un doublon
 * inter-fournisseurs ferait silencieusement disparaître un paiement.
 */
PaymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

// Lecture d'exploitation : « les derniers rappels de cette organisation ».
PaymentEventSchema.index({ organizationId: 1, createdAt: -1 });
