// Identité visuelle d'une organisation et modèle de facture choisi — ADR-0028 § 7.
//
// Deux collections :
//   - `organization_brand_assets` : un document par logo TÉLÉVERSÉ, IMMUABLE et
//     jamais supprimé — une facture gelée le désigne par `assetId` + `sha256` et
//     doit pouvoir se réimprimer à l'identique des années plus tard ;
//   - `organization_brands` : un document par organisation, l'état COURANT
//     (logos reliés, couleurs, police, modèle de facture et ses options).

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({
  collection: 'organization_brand_assets',
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class OrganizationBrandAsset {
  /** 128 bits tirés au hasard (`newObjectId`) : ni devinable ni dérivé de l'organisation. */
  @Prop({ type: String, required: true, unique: true })
  assetId!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  objectKey!: string;

  /** Type DÉDUIT DU CONTENU par `validateAndSanitizeImage`. */
  @Prop({ type: String, required: true })
  contentType!: 'image/png' | 'image/jpeg' | 'image/webp';

  @Prop({ type: Number, required: true })
  width!: number;

  @Prop({ type: Number, required: true })
  height!: number;

  @Prop({ type: Number, required: true })
  byteSize!: number;

  /** Empreinte des octets ASSAINIS stockés ; vérifiée à chaque rendu PDF. */
  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: String, required: true })
  createdBy!: string;

  createdAt!: Date;

  @Prop({ type: Number, default: 1 })
  _schemaVersion!: number;
}
export type OrganizationBrandAssetDocument = HydratedDocument<OrganizationBrandAsset>;
export const OrganizationBrandAssetSchema = SchemaFactory.createForClass(OrganizationBrandAsset);

@Schema({ collection: 'organization_brands', timestamps: true, strict: true })
export class OrganizationBrand {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  /** `assetId` relié à chaque déclinaison, ou `null`. */
  @Prop({
    type: Object,
    default: () => ({ primary: null, horizontal: null, symbol: null, light: null }),
  })
  logos!: {
    primary: string | null;
    horizontal: string | null;
    symbol: string | null;
    light: string | null;
  };

  @Prop({ type: String, default: null })
  primaryColor!: string | null;

  @Prop({ type: String, default: null })
  secondaryColor!: string | null;

  @Prop({ type: String, default: null })
  font!: string | null;

  /**
   * Modèle de facture choisi et ses options SAISIES (`null` = suivre l'identité).
   * `null` : aucun choix — les factures gardent la présentation d'origine.
   */
  @Prop({ type: Object, default: null })
  invoiceTemplate!: {
    id: string;
    options: { palette: string | null; accent: string | null; font: string | null };
  } | null;

  @Prop({ type: Number, default: 0 })
  revision!: number;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  updatedAt!: Date;

  @Prop({ type: Number, default: 1 })
  _schemaVersion!: number;
}
export type OrganizationBrandDocument = HydratedDocument<OrganizationBrand>;
export const OrganizationBrandSchema = SchemaFactory.createForClass(OrganizationBrand);
