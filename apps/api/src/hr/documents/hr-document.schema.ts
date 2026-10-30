// Documents RH (ADR-0045 § 2.8). ADR-0045 — H4.
//
// Métadonnées seulement : le fichier vit dans le stockage objet, clé
// `hr-documents/<objectId>` tirée au hasard. Une pièce SENSIBLE (pièce d'identité,
// médical, justificatif — imposé ; libre pour les autres catégories) y est chiffrée
// côté application (`hr-document-crypto.ts`) : sa clé de données enveloppée sous
// `MASTER_KEYRING` est ici, dans `wrappedKey`. Suppression logique (`deletedAt`) puis
// effacement de l'objet ; la clé enveloppée est effacée en même temps.
//
// Sérialisation : `toJSON` et `toObject` remplacent la clé enveloppée par `[redacted]`.

import {
  HR_DOCUMENT_CATEGORIES,
  HR_DOCUMENT_CONTENT_TYPES,
  type HrDocumentCategory,
  type HrDocumentContentType,
} from '@lalanda/shared/hr';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { EncryptedValue } from '../../integrations/secrets-crypto.js';
import { REDACTED } from '../../integrations/secret-value.js';

export const HR_DOCUMENTS_COLLECTION = 'hr_documents';

export function hrDocumentObjectKey(objectId: string): string {
  return `hr-documents/${objectId}`;
}

@Schema({ collection: HR_DOCUMENTS_COLLECTION, timestamps: true, strict: true })
export class HrDocument {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  employeeId!: string;

  @Prop({ type: String, required: true, enum: HR_DOCUMENT_CATEGORIES })
  category!: HrDocumentCategory;

  @Prop({ type: String, required: true })
  label!: string;

  @Prop({ type: Boolean, required: true })
  sensitive!: boolean;

  @Prop({ type: Boolean, required: true })
  visibleToEmployee!: boolean;

  @Prop({ type: String, default: null })
  issuedOn!: string | null;

  @Prop({ type: String, default: null })
  expiresOn!: string | null;

  /** Identifiant d'objet au hasard (`hr-documents/<objectId>`). */
  @Prop({ type: String, required: true })
  objectId!: string;

  @Prop({ type: String, required: true })
  fileName!: string;

  /** Type déduit du CONTENU au dépôt (jamais de l'en-tête du client). */
  @Prop({ type: String, required: true, enum: HR_DOCUMENT_CONTENT_TYPES })
  contentType!: HrDocumentContentType;

  /** Taille du CLAIR (affichage) ; `storedSize` : octets au stockage (borne commune). */
  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: Number, required: true })
  storedSize!: number;

  /** Empreinte des octets STOCKÉS (chiffrés pour une pièce sensible). */
  @Prop({ type: String, required: true })
  storedSha256!: string;

  @Prop({ type: Boolean, required: true })
  encrypted!: boolean;

  /** Clé de données enveloppée sous `MASTER_KEYRING` (pièce sensible), sinon `null`. */
  @Prop({ type: Object, default: null })
  wrappedKey!: EncryptedValue | null;

  @Prop({ type: String, required: true })
  uploadedBy!: string;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: String, default: null })
  deletedBy!: string | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type HrDocumentDocument = HydratedDocument<HrDocument>;
export type HrDocumentLean = HrDocument & { _id: Types.ObjectId };
export const HrDocumentSchema = SchemaFactory.createForClass(HrDocument);

HrDocumentSchema.index(
  { organizationId: 1, employeeId: 1, category: 1 },
  { name: 'hr_document_employee_category' },
);
HrDocumentSchema.index(
  { organizationId: 1, expiresOn: 1 },
  {
    name: 'hr_document_expires_on',
    partialFilterExpression: { expiresOn: { $type: 'string' } },
  },
);

/** Remplace la clé enveloppée par `[redacted]`. Idempotente. */
function amputerLaCle(_doc: unknown, ret: unknown): unknown {
  const bag = ret as Record<string, unknown>;
  if (bag['wrappedKey'] !== null && typeof bag['wrappedKey'] === 'object') {
    bag['wrappedKey'] = REDACTED;
  }
  return bag;
}

HrDocumentSchema.set('toJSON', { transform: amputerLaCle });
HrDocumentSchema.set('toObject', { transform: amputerLaCle });
