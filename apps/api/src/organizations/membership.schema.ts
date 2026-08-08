import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { ORG_ROLES, type OrgRole } from '../authz/permissions.js';

/** Version courante du schéma — alignée sur la migration S20a (ADR-0012 §7). */
export const MEMBERSHIP_SCHEMA_VERSION = 2;

/**
 * Lien utilisateur ↔ organisation avec rôle (brief §6, ADR-0012).
 *
 * S20a : les rôles réduits `owner | member` laissent place aux 8 rôles de docs/12.
 * La migration `apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs`
 * réécrit l'existant (`member` → `finance_director`; `owner` garde sa valeur) et
 * passe `_schemaVersion` à 2. L'enum n'accepte plus `member` : les entrées d'API
 * le traduisent (`normalizeOrgRole`) au lieu de le stocker.
 */
@Schema({ collection: 'memberships', timestamps: true, strict: true })
export class Membership {
  /** Id de l'utilisateur (better-auth `user._id` en string). */
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /**
   * Défaut `viewer` — moindre privilège (ADR-0012 §7). Créer un membership sans
   * rôle explicite ne doit jamais accorder de droit d'écriture. Ne concerne que
   * les NOUVEAUX documents : la migration traite l'existant.
   */
  @Prop({
    type: String,
    required: true,
    enum: ORG_ROLES as unknown as string[],
    default: 'viewer',
  })
  role!: OrgRole;

  /**
   * Droit conditionnel `period.close` du Comptable — la case ⚙ de la matrice
   * (docs/12 « clôture selon permission », ADR-0012 §3).
   *
   * `false` par défaut, accordable par un `owner` ou un `admin`. Sans effet pour
   * les autres rôles : la matrice décide d'abord, ce drapeau ne fait que lever une
   * case `conditional`. Il ne peut donc JAMAIS élargir un rôle au-delà de sa ligne.
   */
  @Prop({ type: Boolean, required: true, default: false })
  canClosePeriods!: boolean;

  @Prop({ type: Date, default: () => new Date() })
  acceptedAt!: Date;

  @Prop({ type: Number, required: true, default: MEMBERSHIP_SCHEMA_VERSION })
  _schemaVersion!: number;
}

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);

// Index composé unique — un user n'est membre qu'une seule fois par organisation (brief §6).
MembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

// Recomptage des propriétaires (règle R1) et listing des membres d'une org.
MembershipSchema.index({ organizationId: 1, role: 1 });
