// Dérogation de fonctionnalité par organisation (ADR-0053 § 4 et § 6.3 — lot P4).
//
// Portée PLATEFORME : `targetOrganizationId` nomme l'organisation CIBLE, ce n'est pas
// une clé de locataire. Motif et échéance obligatoires (90 jours au plus, décision
// ouverte n° 10). Rien n'est supprimé : une levée pose `revokedAt`, l'historique reste.
//
// `value` vaut toujours `true` en v1 : une dérogation OUVRE une fonctionnalité que la
// grille ne donne pas à l'offre. Fermer une fonctionnalité appartient à la grille
// (docs/13), jamais à un geste de console sur une organisation.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'platform_feature_overrides', timestamps: true, strict: true })
export class PlatformFeatureOverride {
  @Prop({ type: String, required: true })
  targetOrganizationId!: string;

  /** Clé du catalogue `FEATURES` (`@lalanda/shared/pricing`). */
  @Prop({ type: String, required: true })
  feature!: string;

  @Prop({ type: Boolean, required: true, default: true })
  value!: boolean;

  @Prop({ type: String, required: true })
  reasonCategory!: string;

  /** Note interne — JAMAIS servie au client. */
  @Prop({ type: String, required: true })
  internalNote!: string;

  @Prop({ type: Date, required: true })
  endsAt!: Date;

  @Prop({ type: String, required: true })
  grantedBy!: string;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  revokedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type PlatformFeatureOverrideDocument = HydratedDocument<PlatformFeatureOverride>;
export const PlatformFeatureOverrideSchema = SchemaFactory.createForClass(PlatformFeatureOverride);

// Lecture de la garde : dérogations actives d'une organisation pour une fonctionnalité.
PlatformFeatureOverrideSchema.index({
  targetOrganizationId: 1,
  feature: 1,
  revokedAt: 1,
  endsAt: -1,
});
