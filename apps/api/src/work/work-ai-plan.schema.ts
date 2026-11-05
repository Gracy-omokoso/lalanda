// Journal des propositions de plan par l'IA — ADR-0063 § 6.
//
// Une ligne par tentative (acceptée, rejetée, erreur, désactivée) : empreinte de
// l'entrée, réponse brute bornée, issue, durée. Le prompt n'est pas conservé (il
// contient le texte saisi). Expire par index TTL (90 jours). L'identifiant de la
// ligne sert de `draftId` : la création du projet y inscrit `projectId`.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const WORK_AI_PLAN_OUTCOMES = ['accepted', 'rejected', 'error', 'disabled'] as const;
export type WorkAiPlanOutcome = (typeof WORK_AI_PLAN_OUTCOMES)[number];

@Schema({ collection: 'work_ai_plan_logs', timestamps: true, strict: true })
export class WorkAiPlanLog {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  model!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  /** Empreinte SHA-256 de la charge utile envoyée — le prompt lui-même n'est pas conservé. */
  @Prop({ type: String, required: true })
  inputSha256!: string;

  /** Réponse brute du modèle, bornée. */
  @Prop({ type: String, default: null })
  response!: string | null;

  @Prop({ type: String, required: true, enum: WORK_AI_PLAN_OUTCOMES as unknown as string[] })
  outcome!: WorkAiPlanOutcome;

  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  /** Corrections apportées par le serveur à une proposition acceptée. */
  @Prop({ type: Number, default: 0 })
  corrections!: number;

  /** Projet créé depuis cette proposition (après relecture), ou `null`. */
  @Prop({ type: String, default: null })
  projectId!: string | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type WorkAiPlanLogDocument = HydratedDocument<WorkAiPlanLog>;
export const WorkAiPlanLogSchema = SchemaFactory.createForClass(WorkAiPlanLog);
WorkAiPlanLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
WorkAiPlanLogSchema.index({ organizationId: 1, createdAt: -1 });
