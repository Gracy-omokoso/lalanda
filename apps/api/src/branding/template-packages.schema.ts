// Paquets de modèle de facture sur mesure installés — ADR-0029 § 6.
//
// Un document par VERSION installée, IMMUABLE et jamais supprimé : une facture
// gelée désigne le paquet par `packageId` + empreinte et doit pouvoir se
// réimprimer à l'identique. Index unique (organisation, identifiant, version) :
// une version installée ne change plus jamais de contenu.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

import type { TemplateManifest } from '../sales/documents/templates/custom/manifest.js';

@Schema({
  collection: 'invoice_template_packages',
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
})
export class InvoiceTemplatePackage {
  /** 128 bits tirés au hasard (`newObjectId`). */
  @Prop({ type: String, required: true, unique: true })
  packageId!: string;

  @Prop({ type: String, required: true, index: true })
  organizationId!: string;

  /** `manifest.id` (« editeur.nom »). */
  @Prop({ type: String, required: true })
  templateId!: string;

  @Prop({ type: String, required: true })
  version!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** Empreinte CANONIQUE du contenu (ADR-0029 § 1) ; figée au gel, vérifiée au rendu. */
  @Prop({ type: String, required: true })
  contentSha256!: string;

  /** SHA-256 des octets de l'archive stockée. */
  @Prop({ type: String, required: true })
  archiveSha256!: string;

  @Prop({ type: String, required: true })
  objectKey!: string;

  @Prop({ type: Number, required: true })
  byteSize!: number;

  /** Manifeste validé (schéma strict), recopié pour l'affichage et les options. */
  @Prop({ type: Object, required: true })
  manifest!: TemplateManifest;

  @Prop({ type: String, required: true })
  createdBy!: string;

  createdAt!: Date;

  @Prop({ type: Number, default: 1 })
  _schemaVersion!: number;
}
export type InvoiceTemplatePackageDocument = HydratedDocument<InvoiceTemplatePackage>;
export const InvoiceTemplatePackageSchema = SchemaFactory.createForClass(InvoiceTemplatePackage);
InvoiceTemplatePackageSchema.index(
  { organizationId: 1, templateId: 1, version: 1 },
  { unique: true },
);
