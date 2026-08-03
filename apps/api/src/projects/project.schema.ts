import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Projet — instance d'un template pour une organisation (brief §6).
 * S4a : forme réduite. Scénarios, versions, snapshots viendront à S3-full et S9.
 */
@Schema({ collection: 'projects', timestamps: true, strict: true })
export class Project {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  name!: string;

  /** Slug du template de référence (voir @lalanda/engine). */
  @Prop({ type: String, required: true })
  templateSlug!: string;

  /** Valeurs des drivers saisies par l'utilisateur — surcharges du défaut du template. */
  @Prop({ type: Object, default: {} })
  driverValues!: Record<string, number>;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  // Champs auto-ajoutés par `timestamps: true` (Mongoose). Déclarés pour le typage.
  createdAt!: Date;
  updatedAt!: Date;
}

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectSchema = SchemaFactory.createForClass(Project);

// Index composé — lecture rapide "mes projets" scopée par tenant.
ProjectSchema.index({ organizationId: 1, updatedAt: -1 });
