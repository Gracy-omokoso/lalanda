import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Objectifs financiers de l'utilisateur pour un projet (S18d — docs/01
 * § Objectifs financiers de l'utilisateur).
 *
 * Toutes les cibles sont optionnelles : un objectif absent n'est simplement
 * pas évalué. Les montants sont exprimés dans la devise d'affichage du projet.
 */
@Schema({ collection: 'financial_objectives', timestamps: true, strict: true })
export class FinancialObjectives {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  projectId!: string;

  /** Chiffre d'affaires cible à 1 an. */
  @Prop({ type: Number, min: 0 })
  ca_cible_an1?: number;

  /** Chiffre d'affaires cible à 5 ans. */
  @Prop({ type: Number, min: 0 })
  ca_cible_an5?: number;

  /** Résultat net cible à 1 an. */
  @Prop({ type: Number, min: 0 })
  resultat_net_cible_an1?: number;

  /** Résultat net cible à 5 ans. */
  @Prop({ type: Number, min: 0 })
  resultat_net_cible_an5?: number;

  /** Trésorerie cible (fin de première année). */
  @Prop({ type: Number, min: 0 })
  tresorerie_cible?: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type FinancialObjectivesDocument = HydratedDocument<FinancialObjectives>;
export const FinancialObjectivesSchema = SchemaFactory.createForClass(FinancialObjectives);

// Un seul document d'objectifs par projet — l'upsert du PUT s'appuie sur cet index.
FinancialObjectivesSchema.index({ projectId: 1 }, { unique: true });
FinancialObjectivesSchema.index({ organizationId: 1, projectId: 1 });
