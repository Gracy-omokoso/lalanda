// Chiffrement PAR ENVELOPPE d'un fichier (ADR-0045 § 2.8, repris par ADR-0046 § 4.3).
//
// Factorisé du lot H4 (`hr/documents/hr-document-crypto.ts`) pour la bibliothèque de
// documents (R5, lot S6) : un seul code pour les deux formats (`LHD1`, `LLD1`).
//
// Une clé de données AES-256 tirée au hasard PAR FICHIER chiffre les octets
// (AES-256-GCM, AAD propre à l'identité du fichier) ; cette clé est elle-même chiffrée
// sous le trousseau `MASTER_KEYRING` par `secrets-crypto.ts` (ADR-0013), à un
// emplacement qui porte la même identité. Conséquences :
//   - l'objet stocké ne contient jamais le clair (ni `%PDF-`, ni en-tête d'image) ;
//   - un objet ou une clé recopiés vers une autre identité ne se déchiffrent pas ;
//   - effacer la clé enveloppée rend l'objet illisible à jamais ;
//   - une rotation ne re-chiffre que la clé enveloppée, jamais l'objet.
// La clé de données n'est jamais journalisée ni renvoyée.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from './secrets-crypto.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Identité cryptographique d'un fichier : signature du format, AAD, emplacement de la clé. */
export interface EnvelopeIdentity {
  /** Signature de 4 octets (version du format), en tête de l'objet. */
  magic: Buffer;
  aad: Buffer;
  location: SecretLocation;
}

/** Chiffre un fichier : objet à stocker et clé de données enveloppée. */
export function sealEnvelopeBlob(
  id: EnvelopeIdentity,
  bytes: Buffer,
  keyring: MasterKeyring,
  updatedBy: string,
): { blob: Buffer; wrappedKey: EncryptedValue } {
  const dek = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(id.aad);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = encryptSecret({
      location: id.location,
      value: dek.toString('base64'),
      keyring,
      updatedBy,
    });
    return {
      blob: Buffer.concat([id.magic, iv, tag, ciphertext]),
      // `last4` d'une clé n'aurait aucun sens et en livrerait un fragment.
      wrappedKey: { ...wrapped, last4: null },
    };
  } finally {
    dek.fill(0);
  }
}

/** Déchiffre un objet ; lève si la clé, l'identité ou les octets ne concordent pas. */
export function openEnvelopeBlob(
  id: EnvelopeIdentity,
  blob: Buffer,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): Buffer {
  const head = id.magic.length;
  if (blob.length < head + IV_BYTES + TAG_BYTES || !blob.subarray(0, head).equals(id.magic)) {
    throw new Error('Objet chiffré illisible.');
  }
  const plain = decryptSecret({ location: id.location, record: wrappedKey, keyring });
  const dek = Buffer.from(plain.expose(), 'base64');
  try {
    const iv = blob.subarray(head, head + IV_BYTES);
    const tag = blob.subarray(head + IV_BYTES, head + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(id.aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(blob.subarray(head + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } finally {
    dek.fill(0);
  }
}

/**
 * Rotation (ADR-0013 § 3, `secrets:rewrap`) : seule la clé de données enveloppée
 * dépend du trousseau ; elle est re-chiffrée sous la clé courante. `changed: false` si
 * elle l'est déjà.
 */
export function rewrapEnvelopeKey(
  location: SecretLocation,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): { changed: boolean; record: EncryptedValue } {
  const out = rewrapSecret({ location, record: wrappedKey, keyring });
  return out.changed ? { changed: true, record: { ...out.record, last4: null } } : out;
}
