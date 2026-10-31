// Collections de la bibliothèque de documents (ADR-0046 § 4). ADR-0046 — S6.
//
// `document_folders`, `library_documents`, `library_document_versions` : toutes portent
// `organizationId`. Le titre, les étiquettes et le nom du fichier sont des DONNÉES : ils
// ne quittent la base que dans un corps de réponse (jamais un journal, un audit, une
// URL ni un en-tête). La clé de données d'une version sensible est enveloppée sous
// `MASTER_KEYRING` (`library-document-crypto.ts`) et n'est jamais renvoyée.

import {
  DOCUMENT_FILE_TYPES,
  DOCUMENT_LINK_ENTITY_TYPES,
  DOCUMENT_NATURES,
  DOCUMENT_STATUSES,
  type DocumentFileType,
  type DocumentFolderAccessInput,
  type DocumentLinkEntityType,
  type DocumentNature,
  type DocumentStatus,
} from '@lalanda/shared/documents';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

import type { EncryptedValue } from '../integrations/secrets-crypto.js';

export const DOCUMENT_FOLDERS_COLLECTION = 'document_folders';
export const LIBRARY_DOCUMENTS_COLLECTION = 'library_documents';
export const LIBRARY_DOCUMENT_VERSIONS_COLLECTION = 'library_document_versions';

const list = <T extends readonly string[]>(v: T): string[] => [...v];

// ── Dossiers ────────────────────────────────────────────────────────────────

@Schema({ collection: DOCUMENT_FOLDERS_COLLECTION, timestamps: true, strict: true })
export class DocumentFolder {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  sortName!: string;

  @Prop({ type: String, default: null })
  parentId!: string | null;

  /** `{ read, write, inherit }` validé par `DocumentFolderAccessSchema`. */
  @Prop({ type: Object, required: true })
  access!: DocumentFolderAccessInput;

  @Prop({ type: String, required: true, enum: list(DOCUMENT_STATUSES), default: 'active' })
  status!: DocumentStatus;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type DocumentFolderDocument = HydratedDocument<DocumentFolder>;
export type DocumentFolderLean = DocumentFolder & { _id: Types.ObjectId };
export const DocumentFolderSchema = SchemaFactory.createForClass(DocumentFolder);
DocumentFolderSchema.index({ organizationId: 1, parentId: 1, sortName: 1 });

// ── Documents ───────────────────────────────────────────────────────────────

@Schema({ _id: false, strict: true })
export class LibraryDocumentLink {
  @Prop({ type: String, required: true, enum: list(DOCUMENT_LINK_ENTITY_TYPES) })
  entityType!: DocumentLinkEntityType;

  @Prop({ type: String, required: true })
  entityId!: string;
}
export const LibraryDocumentLinkSchema = SchemaFactory.createForClass(LibraryDocumentLink);

@Schema({ collection: LIBRARY_DOCUMENTS_COLLECTION, timestamps: true, strict: true })
export class LibraryDocument {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  title!: string;

  /** Titre normalisé (`normalizeDocumentSearchKey`) : tri et recherche. */
  @Prop({ type: String, required: true })
  searchKey!: string;

  @Prop({ type: String, required: true })
  sortTitle!: string;

  @Prop({ type: String, default: null })
  folderId!: string | null;

  @Prop({ type: String, required: true, enum: list(DOCUMENT_NATURES) })
  nature!: DocumentNature;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: [LibraryDocumentLinkSchema], default: [] })
  links!: LibraryDocumentLink[];

  @Prop({ type: String, default: null })
  issuedOn!: string | null;

  @Prop({ type: String, default: null })
  expiresOn!: string | null;

  @Prop({ type: Number, required: true, default: 30 })
  reminderDays!: number;

  @Prop({ type: Boolean, required: true, default: false })
  sensitive!: boolean;

  @Prop({ type: String, required: true })
  currentVersionId!: string;

  @Prop({ type: Number, required: true, default: 1 })
  versionCount!: number;

  @Prop({ type: String, required: true, enum: list(DOCUMENT_STATUSES), default: 'active' })
  status!: DocumentStatus;

  /** Suppression logique ; les objets sont effacés par `documents.purge` après 30 jours. */
  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: String, default: null })
  deletedBy!: string | null;

  @Prop({ type: Date, default: null })
  purgedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  revision!: number;

  @Prop({ type: String, required: true })
  createdBy!: string;

  @Prop({ type: String, required: true })
  updatedBy!: string;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}
export type LibraryDocumentDocument = HydratedDocument<LibraryDocument>;
export type LibraryDocumentLean = LibraryDocument & { _id: Types.ObjectId };
export const LibraryDocumentSchema = SchemaFactory.createForClass(LibraryDocument);
LibraryDocumentSchema.index({ organizationId: 1, folderId: 1, sortTitle: 1 });
LibraryDocumentSchema.index({ organizationId: 1, 'links.entityType': 1, 'links.entityId': 1 });
LibraryDocumentSchema.index({ organizationId: 1, tags: 1 });
LibraryDocumentSchema.index(
  { organizationId: 1, expiresOn: 1 },
  { partialFilterExpression: { expiresOn: { $type: 'string' } } },
);
LibraryDocumentSchema.index({ organizationId: 1, searchKey: 1 });
LibraryDocumentSchema.index({ deletedAt: 1, purgedAt: 1 });

// ── Versions ────────────────────────────────────────────────────────────────

@Schema({ collection: LIBRARY_DOCUMENT_VERSIONS_COLLECTION, timestamps: false, strict: true })
export class LibraryDocumentVersion {
  @Prop({ type: String, required: true })
  organizationId!: string;

  @Prop({ type: String, required: true })
  documentId!: string;

  @Prop({ type: Number, required: true })
  number!: number;

  /** 32 hexadécimaux au hasard ; clé `documents/<objectId>`. */
  @Prop({ type: String, required: true })
  objectId!: string;

  @Prop({ type: String, required: true })
  fileName!: string;

  /** Déduit du CONTENU, jamais de l'annonce du client. */
  @Prop({ type: String, required: true, enum: list(DOCUMENT_FILE_TYPES) })
  contentType!: DocumentFileType;

  /** Taille du clair. */
  @Prop({ type: Number, required: true })
  size!: number;

  /** Taille de l'objet stocké (chiffré si sensible) : c'est elle qui compte dans la borne. */
  @Prop({ type: Number, required: true })
  storedSize!: number;

  /** Empreinte du clair. */
  @Prop({ type: String, required: true })
  sha256!: string;

  @Prop({ type: Boolean, required: true, default: false })
  encrypted!: boolean;

  /** Clé de données enveloppée (version sensible) ; `null` sinon ou après purge. */
  @Prop({ type: Object, default: null })
  wrappedKey!: EncryptedValue | null;

  @Prop({ type: String, required: true })
  uploadedBy!: string;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;

  @Prop({ type: String, default: null })
  note!: string | null;

  @Prop({ type: Date, default: null })
  purgedAt!: Date | null;

  @Prop({ type: Number, required: true, default: 1 })
  _schemaVersion!: number;
}
export type LibraryDocumentVersionDocument = HydratedDocument<LibraryDocumentVersion>;
export type LibraryDocumentVersionLean = LibraryDocumentVersion & { _id: Types.ObjectId };
export const LibraryDocumentVersionSchema = SchemaFactory.createForClass(LibraryDocumentVersion);
LibraryDocumentVersionSchema.index(
  { documentId: 1, number: 1 },
  { unique: true, name: 'library_document_version_unique' },
);
LibraryDocumentVersionSchema.index({ organizationId: 1, purgedAt: 1 });

export function libraryDocumentObjectKey(objectId: string): string {
  return `documents/${objectId}`;
}
