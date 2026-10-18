// Identité fiscale d'une organisation — ADR-0021 §2.
//
// Une fiche par organisation. Les champs couvrent les mentions vendeur qu'une
// facture normalisée doit porter (dénomination, NIF, adresse, téléphone,
// adresse e-mail), plus ce que la facture d'une société porte d'usage (RCCM,
// forme juridique, identification nationale) — ces derniers FACULTATIFS : aucune
// source disponible ne les rend obligatoires sur la facture normalisée.
//
// L'écriture est toujours COMPLÈTE (`PUT`, schéma `.strict()`) : une fiche
// enregistrée est donc toujours une fiche complète.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const LEGAL_FORMS = [
  'entreprise_individuelle',
  'sarl',
  'sarlu',
  'sa',
  'sas',
  'sasu',
  'snc',
  'scs',
  'gie',
  'cooperative',
  'asbl',
  'etablissement_public',
  'autre',
] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

@Schema({ _id: false, strict: true })
export class FiscalHeadOffice {
  @Prop({ type: String, required: true })
  line1!: string;

  @Prop({ type: String, default: null })
  line2!: string | null;

  @Prop({ type: String, default: null })
  commune!: string | null;

  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String, default: null })
  province!: string | null;

  /** ISO-2. */
  @Prop({ type: String, required: true })
  country!: string;
}
const FiscalHeadOfficeSchema = SchemaFactory.createForClass(FiscalHeadOffice);

@Schema({ collection: 'organization_fiscal_profiles', timestamps: true, strict: true })
export class OrganizationFiscalProfile {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  legalName!: string;

  @Prop({ type: String, default: null })
  tradeName!: string | null;

  @Prop({ type: String, default: null, enum: [...LEGAL_FORMS, null] })
  legalForm!: LegalForm | null;

  @Prop({ type: String, default: null })
  legalFormOther!: string | null;

  /** Normalisé : majuscules, sans espaces ni tirets. */
  @Prop({ type: String, required: true, index: true })
  nif!: string;

  @Prop({ type: String, default: null })
  rccm!: string | null;

  @Prop({ type: String, default: null })
  nationalId!: string | null;

  @Prop({ type: Boolean, required: true })
  vatRegistered!: boolean;

  @Prop({ type: FiscalHeadOfficeSchema, required: true })
  headOffice!: FiscalHeadOffice;

  @Prop({ type: String, required: true })
  phone!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export type OrganizationFiscalProfileDocument = HydratedDocument<OrganizationFiscalProfile>;
export const OrganizationFiscalProfileSchema =
  SchemaFactory.createForClass(OrganizationFiscalProfile);
