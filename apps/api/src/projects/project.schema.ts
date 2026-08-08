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

  /**
   * Pays ISO-2 du projet — définit le contexte fiscal/comptable.
   * Redondant avec l'org.pays au moment de la création mais nécessaire au projet
   * car un même utilisateur peut avoir des projets dans plusieurs pays (ex. holding).
   */
  @Prop({ type: String, required: true, default: 'CD', maxlength: 2 })
  pays!: string;

  /** Slug du ParameterPack chargé pour ce projet (ex. `cd-2026`). */
  @Prop({ type: String, required: true, default: 'cd-2026' })
  parameterPackSlug!: string;

  /** Système comptable — dérivé du pack mais persisté pour cohérence historique. */
  @Prop({ type: String, required: true, default: 'syscohada-revise-2017' })
  systemeComptable!: string;

  /** Devise principale d'affichage — copiée depuis le pack, surchargée par le user. */
  @Prop({ type: String, required: true, default: 'USD' })
  deviseAffichage!: string;

  /** Valeurs des drivers saisies par l'utilisateur — surcharges du défaut du template. */
  /**
   * Dernier auteur d'une écriture d'hypothèses — socle de la séparation des
   * tâches dynamique (R2, ADR-0012 §6) : l'approbateur d'une version de plan ne
   * peut pas être le dernier à en avoir saisi les entrées.
   *
   * `null` sur les projets créés avant S20a : un plan approuvé sur des hypothèses
   * dont on ignore l'auteur est traité comme « séparé », faute de preuve du
   * contraire. Refuser rétroactivement bloquerait des projets existants sur une
   * information qu'on n'a jamais collectée.
   */
  @Prop({ type: String, default: null })
  driversUpdatedBy!: string | null;

  @Prop({ type: Object, default: {} })
  driverValues!: Record<string, number>;

  @Prop({ type: Number, required: true, default: 2 })
  _schemaVersion!: number;

  // Champs auto-ajoutés par `timestamps: true` (Mongoose). Déclarés pour le typage.
  createdAt!: Date;
  updatedAt!: Date;
}

export type ProjectDocument = HydratedDocument<Project>;
export const ProjectSchema = SchemaFactory.createForClass(Project);

// Index composé — lecture rapide "mes projets" scopée par tenant.
ProjectSchema.index({ organizationId: 1, updatedAt: -1 });
