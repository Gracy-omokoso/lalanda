// Collections du business plan narratif (ADR-0037).
//
//   business_plans          un document de travail par projet (brouillon)
//   business_plan_versions  instantanés validés, IMMUABLES (v1, v2…)
//   business_plan_settings  un document par organisation : l'IA du business plan est-elle permise ?
//   business_plan_ai_logs   une ligne par tentative de brouillon IA, expirée par index TTL
//
// Aucune collection ne stocke un chiffre du moteur : les tableaux sont RELUS dans
// le plan figé (ou évalués en direct pour un brouillon non rattaché) à chaque
// affichage et à chaque export.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { BusinessPlanSectionId } from './business-plan.sections.js';

/** Origine du texte publié d'une section. */
export type SectionOrigin = 'user' | 'ai_accepted';

/** Brouillon proposé par l'IA, en attente d'une décision de l'utilisateur. */
export interface SectionProposal {
  text: string;
  sources: string[];
  generatedAt: Date;
  inputSha256: string;
  model: string;
  promptVersion: string;
}

export interface SectionState {
  text: string;
  origin: SectionOrigin | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  /** Renseignés quand le texte vient d'une proposition IA acceptée. */
  acceptedBy: string | null;
  acceptedAt: Date | null;
  proposal: SectionProposal | null;
}

export type BusinessPlanSections = Partial<Record<BusinessPlanSectionId, SectionState>>;

@Schema({ collection: 'business_plans', timestamps: true, strict: true })
export class BusinessPlan {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  /** Version figée du plan financier rattachée, ou `null` (tableaux en direct, brouillon). */
  @Prop({ type: Number, default: null })
  planVersion!: number | null;

  /** Objet libre côté Mongoose — la forme est garantie par le service (zod au PUT). */
  @Prop({ type: Object, required: true, default: () => ({}) })
  sections!: BusinessPlanSections;

  /** Dernier auteur d'une modification (texte, acceptation, rattachement) — séparation des tâches. */
  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type BusinessPlanDocument = HydratedDocument<BusinessPlan>;
export const BusinessPlanSchema = SchemaFactory.createForClass(BusinessPlan);
BusinessPlanSchema.index({ organizationId: 1, projectId: 1 }, { unique: true });

/** Section figée dans une version validée. */
export interface FrozenSection {
  text: string;
  origin: SectionOrigin | null;
}

/**
 * Version validée d'un business plan — INVARIANT D'IMMUABILITÉ : jamais modifiée
 * après création (comme `financial_plans`, docs/07 § S16c).
 */
@Schema({ collection: 'business_plan_versions', timestamps: true, strict: true })
export class BusinessPlanVersion {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: Number, required: true, min: 1 })
  version!: number;

  @Prop({ type: Object, required: true })
  sections!: Partial<Record<BusinessPlanSectionId, FrozenSection>>;

  /** Plan financier figé rattaché : version, empreinte SHA-256 et date de validation. */
  @Prop({ type: Object, required: true })
  plan!: { version: number; fingerprint: string; approvedAt: Date };

  /** SHA-256 du contenu (sections + plan rattaché) — détecte une validation sans changement. */
  @Prop({ type: String, required: true })
  contentSha256!: string;

  @Prop({ type: Date, required: true })
  approvedAt!: Date;

  @Prop({ type: String, required: true })
  approvedBy!: string;

  /** Séparation des tâches au moment de la validation (ADR-0012 § 6, R2). */
  @Prop({ type: Object, required: true })
  approval!: { soleApprover: boolean; lastEditor: string | null };

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type BusinessPlanVersionDocument = HydratedDocument<BusinessPlanVersion>;
export const BusinessPlanVersionSchema = SchemaFactory.createForClass(BusinessPlanVersion);
BusinessPlanVersionSchema.index({ projectId: 1, version: 1 }, { unique: true });
BusinessPlanVersionSchema.index({ organizationId: 1, projectId: 1, version: -1 });

@Schema({ collection: 'business_plan_settings', timestamps: true, strict: true })
export class BusinessPlanSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** IA du business plan permise. Absence de document = permise (ADR-0037 § 4). */
  @Prop({ type: Boolean, required: true, default: true })
  aiEnabled!: boolean;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type BusinessPlanSettingsDocument = HydratedDocument<BusinessPlanSettings>;
export const BusinessPlanSettingsSchema = SchemaFactory.createForClass(BusinessPlanSettings);
BusinessPlanSettingsSchema.index({ organizationId: 1 }, { unique: true });

export type BusinessPlanAiOutcome = 'accepted' | 'rejected' | 'error' | 'disabled';

/**
 * Journal des brouillons IA (ADR-0037 § 5). NI le prompt NI la réponse : ils
 * portent le texte libre de l'entrepreneur. Seulement des empreintes, des
 * longueurs, l'issue et son motif.
 */
@Schema({ collection: 'business_plan_ai_logs', timestamps: true, strict: true })
export class BusinessPlanAiLog {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  @Prop({ type: String, required: true })
  sectionId!: string;

  @Prop({ type: String, required: true })
  model!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  @Prop({ type: String, required: true })
  inputSha256!: string;

  @Prop({ type: String, default: null })
  responseSha256!: string | null;

  @Prop({ type: Number, default: null })
  responseLength!: number | null;

  @Prop({ type: String, required: true, enum: ['accepted', 'rejected', 'error', 'disabled'] })
  outcome!: BusinessPlanAiOutcome;

  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type BusinessPlanAiLogDocument = HydratedDocument<BusinessPlanAiLog>;
export const BusinessPlanAiLogSchema = SchemaFactory.createForClass(BusinessPlanAiLog);
BusinessPlanAiLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
BusinessPlanAiLogSchema.index({ organizationId: 1, projectId: 1, createdAt: -1 });
