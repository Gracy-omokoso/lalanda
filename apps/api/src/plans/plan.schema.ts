import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { EvaluationView } from '../evaluate/evaluation-view.js';

/**
 * Plan financier validé, figé et versionné (S16c — FIN-003, docs/07 § Version validée).
 *
 * INVARIANT D'IMMUABILITÉ : un document FinancialPlan n'est JAMAIS modifié après
 * création, à une seule exception près — `status` qui passe de 'approved' à
 * 'superseded' quand une version plus récente est validée (docs/22 § Plan).
 * Ni les entrées, ni le résultat, ni l'empreinte ne changent : un chiffre montré
 * à une banque reste retrouvable à l'identique via GET /projects/:id/plans/:version.
 *
 * Le snapshot embarque tout ce qu'il faut pour ré-exporter sans recalcul :
 * drivers résolus, identité template/pack/moteur et le résultat moteur complet.
 */
@Schema({ collection: 'financial_plans', timestamps: true, strict: true })
export class FinancialPlan {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true, index: true })
  projectId!: string;

  /** Numéro de version, incrémental par projet (v1, v2, …). */
  @Prop({ type: Number, required: true, min: 1 })
  version!: number;

  /** Machine d'état docs/22 : `approved → superseded`. Aucune autre transition. */
  @Prop({ type: String, required: true, enum: ['approved', 'superseded'], default: 'approved' })
  status!: 'approved' | 'superseded';

  // ─── Snapshot figé des entrées ────────────────────────────────
  /** Drivers RÉSOLUS au moment de la validation (user > pack > défaut template). */
  @Prop({ type: Object, required: true })
  driverValues!: Record<string, number>;

  @Prop({ type: String, required: true })
  templateSlug!: string;

  /** Version semver du template au moment de la validation. */
  @Prop({ type: String, required: true })
  templateVersion!: string;

  @Prop({ type: String })
  parameterPackSlug?: string;

  /** Version du pack — aujourd'hui son année de référence (les packs n'ont pas encore de semver). */
  @Prop({ type: String })
  packVersion?: string;

  /** ENGINE_VERSION du moteur qui a produit `result`. */
  @Prop({ type: String, required: true })
  engineVersion!: string;

  /** Résultat moteur complet (lignes + amortissements) — jamais recalculé. */
  @Prop({ type: Object, required: true })
  result!: EvaluationView;

  /**
   * SHA-256 hex du JSON canonique des entrées (voir fingerprint.ts).
   * Deux validations aux entrées identiques → même empreinte → 409 PLAN_UNCHANGED.
   */
  @Prop({ type: String, required: true })
  fingerprint!: string;

  @Prop({ type: Date, required: true })
  approvedAt!: Date;

  /** User id de l'auteur de la validation. */
  @Prop({ type: String, required: true })
  approvedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // timestamps: true
  createdAt!: Date;
  updatedAt!: Date;
}

export type FinancialPlanDocument = HydratedDocument<FinancialPlan>;
export const FinancialPlanSchema = SchemaFactory.createForClass(FinancialPlan);

// Unicité de la version par projet — protège contre une double validation concurrente.
FinancialPlanSchema.index({ projectId: 1, version: 1 }, { unique: true });
// Lecture « versions d'un projet » scopée tenant.
FinancialPlanSchema.index({ organizationId: 1, projectId: 1, version: -1 });
