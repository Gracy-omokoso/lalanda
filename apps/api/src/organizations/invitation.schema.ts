import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * Invitation d'un email à rejoindre une organisation (brief §6, docs/12-ROLES-PERMISSIONS.md).
 *
 * Cycle de vie :
 * - `createdAt` — création par un owner
 * - `expiresAt` — TTL 7 jours par défaut ; passée cette date l'invitation est refusée
 * - `revokedAt` — révocation manuelle par un owner (l'invitation ne peut plus être acceptée)
 * - `acceptedAt` — acceptation par le user connecté dont l'email matche
 *
 * Une seule invitation `pending` par (org, email) — l'index partiel unique le garantit.
 * Livraison email = log serveur en S5d ; SMTP réel en S12 (monétisation + notifications).
 */
@Schema({ collection: 'invitations', timestamps: true, strict: true })
export class Invitation {
  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /** Email normalisé lowercase — matché contre `session.user.email` à l'acceptation. */
  @Prop({ type: String, required: true, lowercase: true, trim: true, index: true })
  email!: string;

  /** Id de l'owner qui a émis l'invitation (audit). */
  @Prop({ type: String, required: true })
  invitedBy!: string;

  /** Rôle attribué à l'acceptation. S5d : owner|member. */
  @Prop({ type: String, required: true, enum: ['owner', 'member'], default: 'member' })
  role!: 'owner' | 'member';

  /**
   * Token opaque partagé dans l'URL d'acceptation. 64 chars hex — non devinable.
   * Indexé unique pour la lookup à l'acceptation.
   */
  @Prop({ type: String, required: true, unique: true, index: true })
  token!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);

// Une seule invitation pending par (org, email) — l'index partiel n'indexe que les non-acceptées
// et non-révoquées, ce qui permet de recréer une invitation après révocation ou expiration acceptée.
InvitationSchema.index(
  { organizationId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { acceptedAt: null, revokedAt: null },
    name: 'uniq_pending_by_org_email',
  },
);
