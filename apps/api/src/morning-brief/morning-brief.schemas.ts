// Collections du brief du matin (ADR-0033).
//
//   morning_brief_settings       un document par organisation : l'IA du brief est-elle permise ?
//   morning_brief_subscriptions  un document par (organisation, utilisateur) : e-mail quotidien
//   morning_brief_ai_logs        une ligne par tentative d'explication, expirée par index TTL
//
// Aucune de ces collections ne contient de montant recopié d'une facture en
// dehors du prompt journalisé, qui ne porte QUE des agrégats (ADR-0033 § 4).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'morning_brief_settings', timestamps: true, strict: true })
export class MorningBriefSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** IA du brief permise pour l'organisation. Absence de document = permise (ADR-0033 § 7). */
  @Prop({ type: Boolean, required: true, default: true })
  aiEnabled!: boolean;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type MorningBriefSettingsDocument = HydratedDocument<MorningBriefSettings>;
export const MorningBriefSettingsSchema = SchemaFactory.createForClass(MorningBriefSettings);
MorningBriefSettingsSchema.index({ organizationId: 1 }, { unique: true });

@Schema({ collection: 'morning_brief_subscriptions', timestamps: true, strict: true })
export class MorningBriefSubscription {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  /** E-mail quotidien. Désactivé par défaut (ADR-0033 § 8). */
  @Prop({ type: Boolean, required: true, default: false })
  emailDaily!: boolean;

  /**
   * Dernier jour servi (`AAAA-MM-JJ`, Kinshasa). Posé AVANT l'envoi par une
   * réclamation atomique : au plus un e-mail par jour, même avec deux instances.
   */
  @Prop({ type: String, default: null })
  lastSentOn!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type MorningBriefSubscriptionDocument = HydratedDocument<MorningBriefSubscription>;
export const MorningBriefSubscriptionSchema =
  SchemaFactory.createForClass(MorningBriefSubscription);
MorningBriefSubscriptionSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
/** Sert la réclamation de l'envoi quotidien. */
MorningBriefSubscriptionSchema.index({ emailDaily: 1, lastSentOn: 1 });

export const BRIEF_AI_OUTCOMES = ['accepted', 'rejected', 'error', 'disabled'] as const;
export type BriefAiOutcome = (typeof BRIEF_AI_OUTCOMES)[number];

@Schema({ collection: 'morning_brief_ai_logs', timestamps: true, strict: true, minimize: false })
export class MorningBriefAiLog {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  intent!: string;

  @Prop({ type: String, required: true })
  model!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  /** Empreinte SHA-256 des faits envoyés : clé du cache (ADR-0033 § 5). */
  @Prop({ type: String, required: true })
  factsSha256!: string;

  /** Jour de Kinshasa `AAAA-MM-JJ`. */
  @Prop({ type: String, required: true })
  day!: string;

  /** Prompt envoyé — agrégats seulement, par construction. `null` si aucun appel. */
  @Prop({ type: Object, default: null })
  prompt!: { system: string; user: string } | null;

  /** Réponse brute du modèle, bornée. */
  @Prop({ type: String, default: null })
  response!: string | null;

  /** Réponse acceptée, servie de nouveau telle quelle par le cache. */
  @Prop({ type: Object, default: null })
  answer!: { items: { texte: string; sources: string[] }[] } | null;

  @Prop({ type: String, required: true, enum: BRIEF_AI_OUTCOMES as unknown as string[] })
  outcome!: BriefAiOutcome;

  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  /** Expiration : l'index TTL supprime la ligne passé cet instant. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type MorningBriefAiLogDocument = HydratedDocument<MorningBriefAiLog>;
export const MorningBriefAiLogSchema = SchemaFactory.createForClass(MorningBriefAiLog);
MorningBriefAiLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/** Sert la recherche du cache. */
MorningBriefAiLogSchema.index({ organizationId: 1, intent: 1, day: 1, factsSha256: 1, outcome: 1 });
