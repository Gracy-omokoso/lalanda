// Collections de l'Idea Lab (ADR-0036).
//
//   idea_lab_ideas     une fiche par idée, isolée par organisation (notes, expériences incluses)
//   idea_lab_settings  un document par organisation : l'IA de l'Idea Lab est-elle permise ?
//   idea_lab_ai_logs   une ligne par tentative d'assistance IA, expirée par index TTL
//
// Tout ce qui est stocké ici est SAISI par l'utilisateur. Aucun score n'est
// stocké : le moteur le recalcule à chaque lecture depuis les notes et les preuves.

import type {
  IdeaExperimentConclusion,
  IdeaExperimentStatus,
  IdeaExperimentType,
} from '@lalanda/engine';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const IDEA_HYPOTHESIS_STATUSES = ['a_tester', 'confirmee', 'infirmee'] as const;
export type IdeaHypothesisStatus = (typeof IDEA_HYPOTHESIS_STATUSES)[number];

export const MARKET_SIZE_UNITS = ['personnes', 'menages', 'entreprises', 'montant'] as const;
export type MarketSizeUnit = (typeof MARKET_SIZE_UNITS)[number];

export interface StoredAlternative {
  name: string;
  description: string;
  source: string | null;
}

export interface StoredHypothesis {
  id: string;
  text: string;
  status: IdeaHypothesisStatus;
}

/** Taille de marché DÉCLARÉE, toujours avec sa source (ADR-0036 § 2.3). */
export interface StoredMarketSize {
  /** Chaîne décimale positive (docs/26) — jamais dérivée ni convertie. */
  value: string;
  unit: MarketSizeUnit;
  currency: string | null;
  scope: string;
  source: string;
  sourceDate: string | null;
  sourceUrl: string | null;
}

export interface StoredRating {
  criterionId: string;
  note: number;
  proof: string;
  experimentIds: string[];
  ratedBy: string;
  ratedAt: Date;
}

export interface StoredExperimentResults {
  realises: number | null;
  confirmant: number | null;
  visiteurs: number | null;
  inscrits: number | null;
  sollicites: number | null;
  precommandes: number | null;
  /** Montant DÉCLARÉ des pré-commandes : affiché tel quel, jamais totalisé ni converti. */
  montant: string | null;
  devise: string | null;
}

export interface StoredExperiment {
  id: string;
  type: IdeaExperimentType;
  title: string;
  hypothesis: string;
  targetPct: number | null;
  status: IdeaExperimentStatus;
  results: StoredExperimentResults;
  conclusion: IdeaExperimentConclusion | null;
  notes: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredPromotion {
  projectId: string;
  at: Date;
  by: string;
  /** Cartes ajoutées au Canvas lors de ce passage. */
  cards: number;
}

@Schema({ collection: 'idea_lab_ideas', timestamps: true, strict: true, minimize: false })
export class IdeaLabIdea {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  title!: string;

  @Prop({ type: String, default: '' })
  problem!: string;

  @Prop({ type: String, default: '' })
  target!: string;

  @Prop({ type: String, default: '' })
  solution!: string;

  @Prop({ type: [Object], default: [] })
  alternatives!: StoredAlternative[];

  @Prop({ type: String, default: '' })
  revenueModel!: string;

  /** Pays ISO-2, ou `null`. */
  @Prop({ type: String, default: null })
  country!: string | null;

  @Prop({ type: String, default: '' })
  market!: string;

  @Prop({ type: [Object], default: [] })
  hypotheses!: StoredHypothesis[];

  @Prop({ type: Object, default: null })
  marketSize!: StoredMarketSize | null;

  /** Version de grille qui note cette idée (ADR-0036 § 2.1). */
  @Prop({ type: String, required: true })
  gridVersion!: string;

  @Prop({ type: [Object], default: [] })
  ratings!: StoredRating[];

  @Prop({ type: [Object], default: [] })
  experiments!: StoredExperiment[];

  @Prop({ type: Boolean, default: false })
  archived!: boolean;

  @Prop({ type: [Object], default: [] })
  promotions!: StoredPromotion[];

  @Prop({ type: Number, required: true, default: 1 })
  version!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type IdeaLabIdeaDocument = HydratedDocument<IdeaLabIdea>;
export const IdeaLabIdeaSchema = SchemaFactory.createForClass(IdeaLabIdea);
IdeaLabIdeaSchema.index({ organizationId: 1, archived: 1, updatedAt: -1 });

@Schema({ collection: 'idea_lab_settings', timestamps: true, strict: true })
export class IdeaLabSettings {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Boolean, required: true, default: true })
  aiEnabled!: boolean;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type IdeaLabSettingsDocument = HydratedDocument<IdeaLabSettings>;
export const IdeaLabSettingsSchema = SchemaFactory.createForClass(IdeaLabSettings);
IdeaLabSettingsSchema.index({ organizationId: 1 }, { unique: true });

export const IDEA_AI_OUTCOMES = ['accepted', 'rejected', 'error', 'disabled'] as const;
export type IdeaAiOutcome = (typeof IDEA_AI_OUTCOMES)[number];

@Schema({ collection: 'idea_lab_ai_logs', timestamps: true, strict: true })
export class IdeaLabAiLog {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  ideaId!: string;

  @Prop({ type: String, required: true })
  intent!: string;

  @Prop({ type: String, required: true })
  model!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  /** Empreinte SHA-256 de l'entrée envoyée — le prompt lui-même n'est pas conservé. */
  @Prop({ type: String, required: true })
  inputSha256!: string;

  /** Réponse brute du modèle, bornée. */
  @Prop({ type: String, default: null })
  response!: string | null;

  @Prop({ type: String, required: true, enum: IDEA_AI_OUTCOMES as unknown as string[] })
  outcome!: IdeaAiOutcome;

  @Prop({ type: String, default: null })
  reason!: string | null;

  @Prop({ type: Number, default: null })
  durationMs!: number | null;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type IdeaLabAiLogDocument = HydratedDocument<IdeaLabAiLog>;
export const IdeaLabAiLogSchema = SchemaFactory.createForClass(IdeaLabAiLog);
IdeaLabAiLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
