import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { PLATFORM_ROLES, type PlatformRole } from './permissions.js';

/**
 * Attribution d'un rôle PLATEFORME à un utilisateur (S20a, docs/12 § Rôles plateforme).
 *
 * ── Pourquoi une collection dédiée plutôt qu'un champ sur l'utilisateur ─────────
 *
 * 1. **Indépendance assumée.** Un rôle plateforme ne dépend d'aucune organisation
 *    (docs/12) : le porter sur `memberships` serait un contresens, et le porter sur
 *    l'organisation aussi.
 * 2. **Le document `user` appartient à better-auth.** Y ajouter un champ impose un
 *    `additionalFields` dans `auth.ts` — fichier partagé avec le lot « /compte ».
 *    Une collection séparée n'y touche pas.
 * 3. **Plusieurs rôles, et des rôles temporaires.** Un opérateur peut être
 *    `support` ET `finance`; l'accès support doit être « limité, visible et audité »
 *    (docs/12 § Règles critiques) — d'où `expiresAt`, `grantedBy`, `reason`, qui
 *    n'auraient aucun sens en champ scalaire sur `user`.
 *
 * Aucune route ne crée d'attribution en S20a : les rôles plateforme sont posés à la
 * main (ou par migration) tant que la console `/admin` n'existe pas. La lecture,
 * elle, est déjà branchée sur `@RequirePlatformRole`.
 */
@Schema({ collection: 'platform_roles', timestamps: true, strict: true })
export class PlatformRoleAssignment {
  /** Id better-auth de l'utilisateur, en string (cohérent avec `memberships.userId`). */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, enum: PLATFORM_ROLES as unknown as string[] })
  role!: PlatformRole;

  /** Qui a accordé le rôle (audit). `null` = amorçage manuel / migration. */
  @Prop({ type: String, default: null })
  grantedBy!: string | null;

  /** Motif — obligatoire côté processus pour `support`, libre en base. */
  @Prop({ type: String, default: null })
  reason!: string | null;

  /**
   * Expiration facultative. `null` = permanent. Une attribution expirée n'est
   * JAMAIS retenue par la lecture (filtre serveur, pas seulement index TTL).
   */
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PlatformRoleAssignmentDocument = HydratedDocument<PlatformRoleAssignment>;
export const PlatformRoleAssignmentSchema = SchemaFactory.createForClass(PlatformRoleAssignment);

// Un utilisateur ne détient chaque rôle qu'une fois.
PlatformRoleAssignmentSchema.index({ userId: 1, role: 1 }, { unique: true });
