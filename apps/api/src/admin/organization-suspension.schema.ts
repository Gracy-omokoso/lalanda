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
// Elle enregistre la décision, révoque immédiatement les sessions des membres et
// l'affiche dans `/admin`. Elle NE BLOQUE PAS une reconnexion : le refus d'accès
// se déciderait dans `AuthGuard` (`apps/api/src/auth/`), hors du périmètre de ce
// lot. La limite est documentée dans docs/17 § Implémenté (S21b) et dans la PR :
// une suspension aujourd'hui déconnecte, elle ne verrouille pas.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'organization_suspensions', timestamps: true, strict: true })
export class OrganizationSuspension {
  @Prop({ type: String, required: true })
  organizationId!: string;

  /** Motif obligatoire — une suspension sans raison écrite ne se relit pas. */
  @Prop({ type: String, required: true })
  reason!: string;

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
export const OrganizationSuspensionSchema =
  SchemaFactory.createForClass(OrganizationSuspension);

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
