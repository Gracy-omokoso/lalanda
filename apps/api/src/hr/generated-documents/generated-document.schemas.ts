// Registre des pièces générées et réglages — ADR-0072 § 3.
//
// Le registre ne copie AUCUNE donnée nominative (ni nom, ni adresse, ni numéro CNSS) :
// le contenu ne vit que dans le PDF, rangé dans `hr_documents` (chiffré s'il est
// sensible). Un document par pièce ; numéro unique par organisation.

import {
  GENERATED_DOCUMENT_KINDS,
  GENERATED_DOCUMENT_TEMPLATES,
  type GeneratedDocumentKind,
  type GeneratedDocumentTemplateId,
} from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

export const HR_GENERATED_DOCUMENTS_COLLECTION = 'hr_generated_documents';
export const HR_GENERATED_DOCUMENT_SETTINGS_COLLECTION = 'hr_generated_document_settings';

@Schema({ _id: false, strict: true })
export class GeneratedSignatory {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  title!: string;
}
const GeneratedSignatorySchema = SchemaFactory.createForClass(GeneratedSignatory);

@Schema({ collection: HR_GENERATED_DOCUMENTS_COLLECTION, timestamps: true, strict: true })
export class HrGeneratedDocument {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true, enum: GENERATED_DOCUMENT_KINDS })
  kind!: GeneratedDocumentKind;

  @Prop({ type: String, required: true })
  number!: string;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true })
  seq!: number;

  /** `classique@1`. */
  @Prop({ type: String, required: true })
  templateId!: string;

  /** Le `hr_documents` qui porte le PDF. */
  @Prop({ type: String, required: true })
  documentId!: string;

  @Prop({ type: String, required: true })
  issuedOn!: string;

  @Prop({ type: String, required: true })
  place!: string;

  @Prop({ type: GeneratedSignatorySchema, required: true })
  signatory!: GeneratedSignatory;

  /** Options cochées (booléens seulement). */
  @Prop({ type: Object, required: true })
  options!: Record<string, boolean>;

  @Prop({ type: Boolean, required: true })
  sensitive!: boolean;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HrGeneratedDocumentDocument = HydratedDocument<HrGeneratedDocument>;
export type HrGeneratedDocumentLean = HrGeneratedDocument & { _id: Types.ObjectId };
export const HrGeneratedDocumentSchema = SchemaFactory.createForClass(HrGeneratedDocument);
HrGeneratedDocumentSchema.index(
  { organizationId: 1, number: 1 },
  { unique: true, name: 'hr_generated_document_number' },
);
HrGeneratedDocumentSchema.index(
  { organizationId: 1, employeeId: 1, createdAt: -1 },
  { name: 'hr_generated_document_employee' },
);

@Schema({ collection: HR_GENERATED_DOCUMENT_SETTINGS_COLLECTION, timestamps: true, strict: true })
export class HrGeneratedDocumentSettings {
  @Prop({ type: String, required: true, unique: true })
  organizationId!: string;

  @Prop({ type: String, required: true, enum: GENERATED_DOCUMENT_TEMPLATES })
  templateId!: GeneratedDocumentTemplateId;

  @Prop({ type: String, default: null })
  place!: string | null;

  @Prop({ type: GeneratedSignatorySchema, default: null })
  signatory!: GeneratedSignatory | null;

  @Prop({ type: String, default: null })
  attestationIntro!: string | null;

  @Prop({ type: String, default: null })
  attestationClosing!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}

export type HrGeneratedDocumentSettingsDocument = HydratedDocument<HrGeneratedDocumentSettings>;
export type HrGeneratedDocumentSettingsLean = HrGeneratedDocumentSettings & {
  _id: Types.ObjectId;
};
export const HrGeneratedDocumentSettingsSchema = SchemaFactory.createForClass(
  HrGeneratedDocumentSettings,
);
