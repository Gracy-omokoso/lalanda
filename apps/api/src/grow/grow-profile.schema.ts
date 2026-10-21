import { JOURNEY_STAGES, type JourneyStage } from '@lalanda/engine';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Solde de trésorerie DÉCLARÉ (hypothèse de l'utilisateur, ADR-0032 § 1). */
export interface StoredDeclaredCash {
  /** Chaîne décimale ≥ 0, deux décimales au plus (docs/26). */
  amount: string;
  currency: string;
  /** Date du solde, `AAAA-MM-JJ` (Kinshasa). */
  asOf: string;
  declaredBy: string;
  declaredAt: Date;
}

/**
 * Fiche GROW d'une organisation (ADR-0032 § 1) — la SEULE collection où GROW écrit.
 *
 * Elle ne porte que des DÉCLARATIONS de l'utilisateur : projet de référence, étape
 * du parcours, articles récurrents, cases de checklist, solde de trésorerie. Aucun
 * indicateur n'y est stocké : tout est recalculé par le moteur à la lecture, depuis
 * le réalisé BUILD et les ventes RUN, qui ne sont jamais modifiés.
 */
@Schema({ collection: 'grow_profiles', timestamps: true, strict: true, minimize: false })
export class GrowProfile {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Projet dont le réalisé représente l'entreprise ; `null` = non choisi. */
  @Prop({ type: String, default: null })
  referenceProjectId!: string | null;

  /** Étape déclarée ; `null` = l'étape suggérée s'applique. */
  @Prop({ type: String, default: null, enum: [...JOURNEY_STAGES, null] })
  declaredStage!: JourneyStage | null;

  /** Articles du catalogue déclarés « revenu récurrent » (ADR-0032 O3). */
  @Prop({ type: [String], default: [] })
  recurringCatalogItemIds!: string[];

  /** Points de checklist cochés à la main. */
  @Prop({ type: [String], default: [] })
  checklistDone!: string[];

  @Prop({ type: Object, default: null })
  declaredCash!: StoredDeclaredCash | null;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type GrowProfileDocument = HydratedDocument<GrowProfile>;
export const GrowProfileSchema = SchemaFactory.createForClass(GrowProfile);

GrowProfileSchema.index({ organizationId: 1 }, { unique: true });
