// Collections de l'intégration WhatsApp — ADR-0065 § 2, § 4 et § 6.
//
// Le numéro d'une personne est une donnée PERSONNELLE : il ne vit que dans
// `whatsapp_recipients`, scopé par (organisation, personne), et n'est renvoyé qu'à son
// titulaire. Les journaux de messages ne portent PAS le numéro (seulement la personne),
// et expirent au bout de 90 jours. Le code de vérification n'est jamais stocké : seule
// son empreinte l'est, effacée dès la vérification, l'expiration ou le 5e essai.

import { WHATSAPP_NUMBER_STATUSES, type WhatsAppNumberStatus } from '@lalanda/shared/work';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** Durée de conservation d'un journal de message (minimisation). */
export const WHATSAPP_MESSAGE_RETENTION_MS = 90 * 24 * 3_600_000;

/** Numéro WhatsApp d'UNE personne dans UNE organisation (un document au plus). */
@Schema({ collection: 'whatsapp_recipients', timestamps: true, strict: true, minimize: false })
export class WhatsAppRecipient {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** E.164 (`+243…`) ; `null` tant que rien n'a été saisi (document ouvert par un envoi). */
  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null, enum: WHATSAPP_NUMBER_STATUSES as unknown as string[] })
  status!: WhatsAppNumberStatus | null;

  /** Code Meta ou motif qui a fait passer le numéro « à vérifier » — jamais de contenu. */
  @Prop({ type: String, default: null })
  statusReason!: string | null;

  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;

  @Prop({ type: Date, default: null })
  optedOutAt!: Date | null;

  /** Empreinte HMAC du code en attente (jamais le code). */
  @Prop({ type: String, default: null })
  codeHash!: string | null;

  @Prop({ type: Date, default: null })
  codeSentAt!: Date | null;

  @Prop({ type: Date, default: null })
  codeExpiresAt!: Date | null;

  @Prop({ type: Number, default: 0 })
  codeAttempts!: number;

  /** Instants des demandes de code de l'heure glissante (limitation d'envoi). */
  @Prop({ type: [Date], default: [] })
  codeRequests!: Date[];

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type WhatsAppRecipientDocument = HydratedDocument<WhatsAppRecipient>;
export type WhatsAppRecipientLean = WhatsAppRecipient & { _id: Types.ObjectId };
export const WhatsAppRecipientSchema = SchemaFactory.createForClass(WhatsAppRecipient);
WhatsAppRecipientSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
// Opt-out « STOP » reçu par le webhook : retrouvé par numéro, toutes organisations.
WhatsAppRecipientSchema.index({ phone: 1 });

/**
 * Journal d'un message envoyé (statuts de livraison remontés par le webhook). Ni
 * numéro, ni contenu : l'identifiant Meta, le modèle, la personne, l'état.
 */
@Schema({ collection: 'whatsapp_messages', timestamps: true, strict: true })
export class WhatsAppMessage {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** Identifiant Meta (`wamid…`). */
  @Prop({ type: String, required: true })
  wamid!: string;

  @Prop({ type: String, required: true })
  template!: string;

  /** `accepted` (pris par Meta) → `sent` → `delivered` → `read`, ou `failed`. */
  @Prop({
    type: String,
    required: true,
    enum: ['accepted', 'sent', 'delivered', 'read', 'failed'],
  })
  status!: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

  @Prop({ type: String, default: null })
  errorCode!: string | null;

  @Prop({ type: Date, default: null })
  statusAt!: Date | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type WhatsAppMessageDocument = HydratedDocument<WhatsAppMessage>;
export type WhatsAppMessageLean = WhatsAppMessage & { _id: Types.ObjectId };
export const WhatsAppMessageSchema = SchemaFactory.createForClass(WhatsAppMessage);
WhatsAppMessageSchema.index({ wamid: 1 }, { unique: true });
WhatsAppMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Compteur mensuel d'envois d'une organisation (heure de Kinshasa). */
@Schema({ collection: 'whatsapp_usage', timestamps: true, strict: true })
export class WhatsAppUsage {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `AAAA-MM`. */
  @Prop({ type: String, required: true })
  month!: string;

  /** Messages acceptés par Meta (codes compris : ils sont facturés aussi). */
  @Prop({ type: Number, required: true, default: 0 })
  sent!: number;

  /** Envois refusés par le plafond. */
  @Prop({ type: Number, required: true, default: 0 })
  blocked!: number;
}

export type WhatsAppUsageDocument = HydratedDocument<WhatsAppUsage>;
export type WhatsAppUsageLean = WhatsAppUsage & { _id: Types.ObjectId };
export const WhatsAppUsageSchema = SchemaFactory.createForClass(WhatsAppUsage);
WhatsAppUsageSchema.index({ organizationId: 1, month: 1 }, { unique: true });
