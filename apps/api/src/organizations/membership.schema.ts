import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import { ACTIONS, ORG_ROLES, type Action, type OrgRole } from '../authz/permissions.js';

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

  /**
   * ADR-0041 § 1 — ajouts : actions que la ligne du rôle refuse et que ce membre
   * détient. Sans doublon, dans l'ordre d'`ACTIONS`. Vide par défaut, AUCUNE
   * migration : un document sans ce champ vaut exactement son titre — toute lecture
   * passe par `overridesOf()` (`authz/authz.service.ts`), qui traite l'absence comme `[]`.
   */
  @Prop({ type: [String], enum: ACTIONS as unknown as string[], default: [] })
  grants!: Action[];

  /** ADR-0041 § 1 — retraits : actions que la ligne du rôle accorde et que ce membre n'a pas. */
  @Prop({ type: [String], enum: ACTIONS as unknown as string[], default: [] })
  revokes!: Action[];

  /**
   * ADR-0041 G8 — incrémentée à chaque écriture de rôle, d'écart ou de droit de
   * clôture (lot A4). Tout cache futur de permissions la porte dans sa clé.
   */
  @Prop({ type: Number, default: 0 })
  permissionsRevision!: number;

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

// ADR-0041 § 9.1 — recherche des détenteurs effectifs par ajout (`holdersOf`).
MembershipSchema.index({ organizationId: 1, grants: 1 });
