// Chiffrement côté application des documents SENSIBLES de la bibliothèque (ADR-0046
// § 4.3). ADR-0046 — S6.
//
// Motif exact des documents RH (`hr/documents/hr-document-crypto.ts`), même code
// (`integrations/envelope-blob-crypto.ts`) : clé de données par fichier, AES-256-GCM,
// AAD = organisation + document + version, clé enveloppée sous `MASTER_KEYRING` à
// l'emplacement `org:library_documents` ; format `LLD1`. Un objet recopié vers un autre
// document, une autre version ou une autre organisation ne se déchiffre pas ;
// `secrets:rewrap` re-chiffre la seule clé enveloppée (`integrations/rewrap.ts`).

import {
  openEnvelopeBlob,
  rewrapEnvelopeKey,
  sealEnvelopeBlob,
  type EnvelopeIdentity,
} from '../integrations/envelope-blob-crypto.js';
import type {
  EncryptedValue,
  MasterKeyring,
  SecretLocation,
} from '../integrations/secrets-crypto.js';

const MAGIC = Buffer.from('LLD1', 'latin1');

export interface LibraryDocumentIdentity {
  organizationId: string;
  documentId: string;
  versionId: string;
}

/** Emplacement cryptographique de la clé enveloppée — UNE seule définition. */
export function libraryDocumentKeyLocation(id: LibraryDocumentIdentity): SecretLocation {
  const triple = `${id.organizationId}:${id.documentId}:${id.versionId}`;
  return { documentId: triple, provider: 'org:library_documents', secretName: triple };
}

function envelopeOf(id: LibraryDocumentIdentity): EnvelopeIdentity {
  return {
    magic: MAGIC,
    aad: Buffer.from(`library_documents:${id.organizationId}:${id.documentId}:${id.versionId}`),
    location: libraryDocumentKeyLocation(id),
  };
}

export function sealLibraryDocument(
  id: LibraryDocumentIdentity,
  bytes: Buffer,
  keyring: MasterKeyring,
  updatedBy: string,
): { blob: Buffer; wrappedKey: EncryptedValue } {
  return sealEnvelopeBlob(envelopeOf(id), bytes, keyring, updatedBy);
}

export function openLibraryDocument(
  id: LibraryDocumentIdentity,
  blob: Buffer,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): Buffer {
  return openEnvelopeBlob(envelopeOf(id), blob, wrappedKey, keyring);
}

export function rewrapLibraryDocumentKey(
  id: LibraryDocumentIdentity,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): { changed: boolean; record: EncryptedValue } {
  return rewrapEnvelopeKey(libraryDocumentKeyLocation(id), wrappedKey, keyring);
}
