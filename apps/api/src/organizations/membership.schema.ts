import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Lien utilisateur ↔ organisation avec rôle (brief §6).
 * S4a : rôles réduits à `owner` et `member`. Les rôles fine-grained (admin, fondateur,
 * comptable, mentor, viewer) arrivent avec les workflows métier (S5-S7).
 */
@Schema({ collection: 'memberships', timestamps: true, strict: true })
export class Membership {
  /** Id de l'utilisateur (better-auth `user._id` en string). */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: ['owner', 'member'], default: 'member' })
  role!: 'owner' | 'member';

  @Prop({ type: Date, default: () => new Date() })
  acceptedAt!: Date;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);

// Index composé unique — un user n'est membre qu'une seule fois par organisation (brief §6).
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
