// Équipes (ADR-0060 § 2). Membres = UTILISATEURS de l'organisation (appartenances),
// pas des dossiers du personnel : une équipe peut traverser plusieurs services.
//
// Collection `hr_teams`, lue en LECTURE SEULE par le module « work » (portée des
// projets privés, membres d'un projet) : ses membres sont résolus à chaque lecture.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hr_teams', timestamps: true, strict: true })
export class Team {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** Nom normalisé : unicité dans l'organisation et tri. */
  @Prop({ type: String, required: true })
  nameKey!: string;

  @Prop({ type: String, default: null })
  description!: string | null;

  /** Responsable, toujours compté parmi les membres. */
  @Prop({ type: String, default: null })
  leadUserId!: string | null;

  @Prop({ type: [String], default: [] })
  memberUserIds!: string[];

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type TeamDocument = HydratedDocument<Team>;
export type TeamLean = Team & { _id: Types.ObjectId };
export const TeamSchema = SchemaFactory.createForClass(Team);

TeamSchema.index({ organizationId: 1, nameKey: 1 }, { unique: true, name: 'hr_team_name_unique' });
TeamSchema.index({ organizationId: 1, memberUserIds: 1 });
TeamSchema.index({ organizationId: 1, leadUserId: 1 });
