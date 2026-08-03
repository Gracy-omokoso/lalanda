import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Organisation — tenant racine (brief §6).
 * S4a : forme minimale. Les champs `branding`, `plan`, `creditsBalance` etc. viendront à S6/S12.
 */
@Schema({ collection: 'organizations', timestamps: true, strict: true })
export class Organization {
  @Prop({ type: String, required: true })
  name!: string;

  /** Slug URL-safe unique. Auto-généré à la création. */
  @Prop({ type: String, required: true, unique: true, index: true })
  slug!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['solo', 'agence', 'incubateur', 'banque', 'ecole'],
    default: 'solo',
  })
  type!: 'solo' | 'agence' | 'incubateur' | 'banque' | 'ecole';

  /** Code pays ISO-2 (RDC = CD par défaut, brief §11 S7). */
  @Prop({ type: String, required: true, default: 'CD' })
  pays!: string;

  /** Id de l'utilisateur propriétaire (better-auth `user._id` en string). */
  @Prop({ type: String, required: true, index: true })
  ownerId!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);
