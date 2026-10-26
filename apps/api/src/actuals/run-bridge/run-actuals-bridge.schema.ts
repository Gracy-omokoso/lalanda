// Collection `run_actuals_bridges` — réglage, par organisation, du pont RUN → BUILD
// (ADR-0031 § 3). Absent ou `enabled: false` : aucun réalisé n'est écrit depuis
// les ventes, et la saisie manuelle fonctionne exactement comme avant.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export interface RunSyncSummary {
  at: Date;
  by: string;
  version: string;
  written: number;
  unchanged: number;
  removed: number;
  blocked: number;
  skipped: number;
}

@Schema({ collection: 'run_actuals_bridges', timestamps: true, strict: true })
export class RunActualsBridge {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: Boolean, required: true, default: false })
  enabled!: boolean;

  /** Projet qui reçoit le réalisé (même organisation). */
  @Prop({ type: String, default: null })
  projectId!: string | null;

  /** Ligne de chiffre d'affaires du compte d'exploitation du plan validé. */
  @Prop({ type: String, default: null })
  revenueLineId!: string | null;

  /** Mois civil qui ouvre l'exercice 1 (`AAAA-MM`). */
  @Prop({ type: String, default: null })
  exerciseStart!: string | null;

  @Prop({ type: Object, default: null })
  lastSync!: RunSyncSummary | null;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type RunActualsBridgeDocument = HydratedDocument<RunActualsBridge>;
export const RunActualsBridgeSchema = SchemaFactory.createForClass(RunActualsBridge);

RunActualsBridgeSchema.index({ organizationId: 1 }, { unique: true });
