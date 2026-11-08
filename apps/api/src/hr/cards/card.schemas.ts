// Cartes de service et de visite — collections — ADR-0069 § 2.
//
//   - `hr_card_profiles`  : photo consentie, consentement daté, jeton de vérification ;
//   - `hr_card_settings`  : modèles par défaut et coordonnées imprimées, par organisation ;
//   - `hr_card_template_packages` : paquets sur mesure installés (immuables).
//
// La photo est une EXCEPTION documentée à la minimisation d'ADR-0045 § 2.1 :
// facultative, conditionnée au consentement, effacée au retrait et à l'anonymisation.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'hr_card_profiles', timestamps: true, strict: true })
export class HrCardProfile {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  /** Octets ASSAINIS (porte de la photo de profil), objet `hr-card-photos/<objectId>`. */
  @Prop({ type: Object, default: null })
  photo!: {
    objectId: string;
    contentType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    byteSize: number;
    sha256: string;
  } | null;

  /** Consentement à la photo sur la carte, recueilli et enregistré par les RH. */
  @Prop({ type: Object, default: null })
  photoConsent!: { at: Date; by: string } | null;

  /** Second accord : photo montrée sur la page publique de vérification. */
  @Prop({ type: Boolean, default: false })
  photoPublic!: boolean;

  /** Jeton de la carte en cours (`null` : aucune carte valide). */
  @Prop({ type: Object, default: null })
  verification!: { token: string; serial: number; issuedAt: Date; issuedBy: string } | null;

  /** Nombre d'émissions (le prochain `serial` vaut `issueCount + 1`). */
  @Prop({ type: Number, default: 0 })
  issueCount!: number;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  revokedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type HrCardProfileDocument = HydratedDocument<HrCardProfile>;
export type HrCardProfileLean = HrCardProfile & { _id: Types.ObjectId };
export const HrCardProfileSchema = SchemaFactory.createForClass(HrCardProfile);
HrCardProfileSchema.index(
  { organizationId: 1, employeeId: 1 },
  { unique: true, name: 'hr_card_profile_unique' },
);
HrCardProfileSchema.index(
  { 'verification.token': 1 },
  {
    unique: true,
    partialFilterExpression: { 'verification.token': { $type: 'string' } },
    name: 'hr_card_token_unique',
  },
);

interface KindSettings {
  templateId: string | null;
  variant: 'brand' | 'mono' | 'inverse';
  accent: string | null;
}

@Schema({ collection: 'hr_card_settings', timestamps: true, strict: true })
export class HrCardSettings {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: Object, default: () => ({ templateId: null, variant: 'brand', accent: null }) })
  badge!: KindSettings;

  @Prop({ type: Object, default: () => ({ templateId: null, variant: 'brand', accent: null }) })
  business!: KindSettings;

  @Prop({ type: Boolean, default: true })
  showEmployeeNumber!: boolean;

  @Prop({ type: Boolean, default: true })
  badgeVerso!: boolean;

  @Prop({ type: Boolean, default: true })
  vcardQr!: boolean;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  slogan!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, default: null })
  updatedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type HrCardSettingsDocument = HydratedDocument<HrCardSettings>;
export type HrCardSettingsLean = HrCardSettings & { _id: Types.ObjectId };
export const HrCardSettingsSchema = SchemaFactory.createForClass(HrCardSettings);

@Schema({
  collection: 'hr_card_template_packages',
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class HrCardTemplatePackage {
  /** 128 bits tirés au hasard. */
  @Prop({ type: String, required: true, unique: true })
  packageId!: string;

  @Prop({ type: String, required: true })
  organizationId!: string;

  /** `code` (HTML/CSS à variables) ou `designer` (fonds + zones). */
  @Prop({ type: String, required: true, enum: ['code', 'designer'] })
  format!: 'code' | 'designer';

  @Prop({ type: String, required: true, enum: ['badge', 'business'] })
  kind!: 'badge' | 'business';

  @Prop({ type: String, required: true, enum: ['vertical', 'horizontal'] })
  orientation!: 'vertical' | 'horizontal';

  @Prop({ type: String, required: true })
  templateId!: string;

  @Prop({ type: String, required: true })
  version!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  contentSha256!: string;

  @Prop({ type: String, required: true })
  objectKey!: string;

  @Prop({ type: Number, required: true })
  byteSize!: number;

  @Prop({ type: Object, required: true })
  manifest!: Record<string, unknown>;

  @Prop({ type: String, required: true })
  createdBy!: string;

  createdAt!: Date;

  @Prop({ type: Number, default: 1 })
  _schemaVersion!: number;
}
export type HrCardTemplatePackageDocument = HydratedDocument<HrCardTemplatePackage>;
export type HrCardTemplatePackageLean = HrCardTemplatePackage & { _id: Types.ObjectId };
export const HrCardTemplatePackageSchema = SchemaFactory.createForClass(HrCardTemplatePackage);
HrCardTemplatePackageSchema.index(
  { organizationId: 1, templateId: 1, version: 1 },
  { unique: true, name: 'hr_card_package_version_unique' },
);
