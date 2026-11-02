// Déclarations de la mise en route, une par organisation (ADR-0052 § 4). ADR-0052 — O2/O3.
//
// Écrivain unique : le module `organization-setup`. AUCUN document = rien de déclaré :
// rien n'est créé à la création d'une organisation (critère 9), seulement à la première
// déclaration. Ce document ne dit jamais qu'une étape est « faite » : la progression se
// déduit des données des modules propriétaires ; il ne porte que ce qu'on ne peut lire
// nulle part ailleurs.
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ORGANIZATION_SETUP_MODULE_IDS,
  type OrganizationSetupDeferrableStep,
  type OrganizationSetupModuleId,
} from '@lalanda/shared/organization-setup';
import type { HydratedDocument } from 'mongoose';

export interface SetupDeclarationMark {
  at: Date;
  by: string;
}

@Schema({ collection: 'organization_setup', timestamps: true, strict: true })
export class OrganizationSetup {
  @Prop({ type: String, required: true, unique: true, index: true })
  organizationId!: string;

  /** Étape 1 validée par un détenteur d'`organization.manage`. */
  @Prop({ type: Date, default: null })
  countryConfirmedAt!: Date | null;

  @Prop({ type: String, default: null })
  countryConfirmedBy!: string | null;

  /** `{ normalisation?, tresorerie?, comptabilite?, equipe? }` → `{ at, by }`. */
  @Prop({ type: Object, default: () => ({}) })
  deferred!: Partial<Record<OrganizationSetupDeferrableStep, SetupDeclarationMark>>;

  /** Choix de modules ; `null` = tous. N'a de sens que si `modulesChosenAt` est posé. */
  @Prop({ type: [String], enum: ORGANIZATION_SETUP_MODULE_IDS, default: null })
  modules!: OrganizationSetupModuleId[] | null;

  @Prop({ type: Date, default: null })
  modulesChosenAt!: Date | null;

  /** Réservé à la reprise explicite (§ 5, décision ouverte n° 4) — toujours `null` en v1. */
  @Prop({ type: String, default: null })
  createdFrom!: string | null;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrganizationSetupDocument = HydratedDocument<OrganizationSetup>;
export type OrganizationSetupLean = Pick<
  OrganizationSetup,
  'organizationId' | 'countryConfirmedAt' | 'deferred' | 'modules' | 'modulesChosenAt'
>;
export const OrganizationSetupSchema = SchemaFactory.createForClass(OrganizationSetup);
