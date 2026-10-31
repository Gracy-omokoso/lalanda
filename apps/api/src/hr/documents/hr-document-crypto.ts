// Chiffrement côté application des documents RH SENSIBLES (ADR-0045 § 2.8, décision
// ouverte n° 17). ADR-0045 — H4.
//
// Enveloppe (`integrations/envelope-blob-crypto.ts`, factorisée au lot S6 d'ADR-0046) :
// une clé de données AES-256 tirée au hasard PAR FICHIER chiffre les octets
// (AES-256-GCM, AAD = organisation + collaborateur + document) ; cette clé est
// elle-même chiffrée sous le trousseau `MASTER_KEYRING` (ADR-0013) à l'emplacement
// `org:hr_documents` qui porte la même triple identité. Conséquences :
//   - l'objet stocké ne contient jamais le clair (ni `%PDF-`, ni en-tête d'image) ;
//   - un objet ou une clé recopiés vers un autre document, un autre collaborateur ou
//     une autre organisation ne se déchiffrent pas ;
//   - effacer la clé enveloppée (anonymisation, purge) rend l'objet illisible à jamais,
//     même si l'effacement de l'objet au stockage échoue.
// La clé de données n'est jamais journalisée ni renvoyée.

import {
  openEnvelopeBlob,
  rewrapEnvelopeKey,
  sealEnvelopeBlob,
  type EnvelopeIdentity,
} from '../../integrations/envelope-blob-crypto.js';
import type {
  EncryptedValue,
  MasterKeyring,
  SecretLocation,
} from '../../integrations/secrets-crypto.js';

/** Signature de l'objet chiffré (version du format). */
const MAGIC = Buffer.from('LHD1', 'latin1');

export interface HrDocumentIdentity {
  organizationId: string;
  employeeId: string;
  documentId: string;
}

/** Emplacement cryptographique de la clé enveloppée — UNE seule définition. */
export function hrDocumentKeyLocation(id: HrDocumentIdentity): SecretLocation {
  const triple = `${id.organizationId}:${id.employeeId}:${id.documentId}`;
  return { documentId: triple, provider: 'org:hr_documents', secretName: triple };
}

function envelopeOf(id: HrDocumentIdentity): EnvelopeIdentity {
  return {
    magic: MAGIC,
    aad: Buffer.from(`hr_documents:${id.organizationId}:${id.employeeId}:${id.documentId}`),
    location: hrDocumentKeyLocation(id),
  };
}

/** Chiffre un fichier : objet à stocker et clé de données enveloppée. */
export function sealHrDocument(
  id: HrDocumentIdentity,
  bytes: Buffer,
  keyring: MasterKeyring,
  updatedBy: string,
): { blob: Buffer; wrappedKey: EncryptedValue } {
  return sealEnvelopeBlob(envelopeOf(id), bytes, keyring, updatedBy);
}

/** Déchiffre un objet ; lève si la clé, l'identité ou les octets ne concordent pas. */
export function openHrDocument(
  id: HrDocumentIdentity,
  blob: Buffer,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): Buffer {
  return openEnvelopeBlob(envelopeOf(id), blob, wrappedKey, keyring);
}

/**
 * Rotation (ADR-0013 § 3, `secrets:rewrap`) : seule la clé de données enveloppée
 * dépend du trousseau ; elle est re-chiffrée sous la clé courante. L'objet stocké,
 * chiffré par la clé de données (inchangée), reste valide : rien n'est relu ni réécrit
 * au stockage. `changed: false` si la clé est déjà à la clé courante.
 */
export function rewrapHrDocumentKey(
  id: HrDocumentIdentity,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): { changed: boolean; record: EncryptedValue } {
  return rewrapEnvelopeKey(hrDocumentKeyLocation(id), wrappedKey, keyring);
}
