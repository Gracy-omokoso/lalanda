import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { ORG_ROLES, type OrgRole } from '../authz/permissions.js';

/** Version courante du schéma — alignée sur la migration S20a. */
export const MEMBERSHIP_SCHEMA_VERSION = 2;

/**
 * Lien utilisateur ↔ organisation avec rôle (brief §6).
 *
 * S20a : les rôles réduits `owner` / `member` laissent place aux 8 rôles de
 * docs/12. La migration `apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs`
 * réécrit l'existant (`owner` → `proprietaire`, `member` → `chef_projet`) et passe
 * `_schemaVersion` à 2. L'enum n'accepte plus les anciennes valeurs : les entrées
 * d'API les traduisent (`normalizeOrgRole`) au lieu de les stocker.
 */
@Schema({ collection: 'memberships', timestamps: true, strict: true })
export class Membership {
  /** Id de l'utilisateur (better-auth `user._id` en string). */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ORG_ROLES as unknown as string[],
    default: 'lecteur',
  })
  role!: OrgRole;

  @Prop({ type: Date, default: () => new Date() })
  acceptedAt!: Date;

  @Prop({ type: Number, required: true, default: MEMBERSHIP_SCHEMA_VERSION })
  _schemaVersion!: number;
}

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);

// Index composé unique — un user n'est membre qu'une seule fois par organisation (brief §6).
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
