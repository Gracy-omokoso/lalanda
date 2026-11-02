// Suspension d'une organisation (S21b).
//
// ── Pourquoi une collection dédiée et non un champ sur `organizations` ────────
//
// Trois raisons, dans l'ordre d'importance :
//
// 1. La suspension est un acte de PLATEFORME sur une organisation cliente. Elle
//    porte un motif, un auteur et une date de levée — trois informations qui
//    n'ont aucun sens en champ booléen, et qu'un `suspended: true` sur
//    `organizations` perdrait à la première levée.
// 2. L'historique doit survivre à la levée : « cette organisation a-t-elle déjà
//    été suspendue, quand, et pourquoi ? » est la question qu'on pose au moment
//    d'en décider une seconde. Un champ écrasé ne répond jamais à ça.
// 3. `organizations` appartient au lot organisation, développé en parallèle.
//
// ── Ce que la suspension fait, et ce qu'elle NE FAIT PAS ─────────────────────
//
// ADR-0053 — P2 : la suspension est EFFECTIVE. `PermissionsGuard` lit la suspension
// active de l'organisation visée par chaque route d'organisation : en `read_only`
// (défaut, décision ouverte n° 4) toute écriture répond `423 ORGANIZATION_SUSPENDED`
// et la lecture reste ouverte ; en `full`, toute route d'organisation répond 423. Les
// sessions des membres ne sont plus révoquées : un membre garde l'accès à ses AUTRES
// organisations, que la suspension ne touche pas (§ 6.1).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'organization_suspensions', timestamps: true, strict: true })
export class OrganizationSuspension {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /**
   * Motif obligatoire — une suspension sans raison écrite ne se relit pas. Depuis
   * ADR-0053 (P2), recopie de `internalNote` pour les lecteurs historiques.
   */
  @Prop({ type: String, required: true })
  reason!: string;

  // ── ADR-0053 — P2 (§ 4) ─────────────────────────────────────────────────────

  /** `unpaid`, `abuse`, `fraud`, `legal`, `request`, `other` ; `null` avant P2. */
  @Prop({ type: String, default: null })
  reasonCategory!: string | null;

  /** Texte destiné au client (miroir de son journal). */
  @Prop({ type: String, default: null })
  clientMessage!: string | null;

  /** Note interne — JAMAIS servie au client. */
  @Prop({ type: String, default: null })
  internalNote!: string | null;

  /** `read_only` (défaut) ou `full`. Absent sur une suspension antérieure : `read_only`. */
  @Prop({ type: String, default: 'read_only' })
  mode!: string;

  @Prop({ type: String, default: null })
  liftReason!: string | null;

  @Prop({ type: String, default: null })
  liftedClientMessage!: string | null;

  @Prop({ type: String, required: true })
  suspendedBy!: string;

  @Prop({ type: Date, required: true })
  suspendedAt!: Date;

  /** `null` tant que la suspension est active. */
  @Prop({ type: Date, default: null })
  liftedAt!: Date | null;

  @Prop({ type: String, default: null })
  liftedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type OrganizationSuspensionDocument = HydratedDocument<OrganizationSuspension>;
export const OrganizationSuspensionSchema = SchemaFactory.createForClass(OrganizationSuspension);

// Une seule suspension ACTIVE par organisation; l'historique reste illimité.
// L'index est PARTIEL : sans `partialFilterExpression`, la contrainte d'unicité
// porterait aussi sur les suspensions levées et interdirait de suspendre deux
// fois la même organisation — ce qui arrivera.
OrganizationSuspensionSchema.index(
  { organizationId: 1 },
  { unique: true, partialFilterExpression: { liftedAt: null } },
);

// Lecture de l'historique : « toutes les suspensions de cette organisation ».
// L'index partiel ci-dessus ne la sert pas, il ne contient que les actives.
OrganizationSuspensionSchema.index({ organizationId: 1, suspendedAt: -1 });
