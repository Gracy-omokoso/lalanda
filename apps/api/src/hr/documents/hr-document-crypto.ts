// Chiffrement côté application des documents RH SENSIBLES (ADR-0045 § 2.8, décision
// ouverte n° 17). ADR-0045 — H4.
//
// Enveloppe : une clé de données AES-256 tirée au hasard PAR FICHIER chiffre les
// octets (AES-256-GCM, AAD = organisation + collaborateur + document) ; cette clé est
// elle-même chiffrée sous le trousseau `MASTER_KEYRING` par `secrets-crypto.ts`
// (ADR-0013), réutilisé tel quel, à l'emplacement `org:hr_documents` qui porte la même
// triple identité. Conséquences :
//   - l'objet stocké ne contient jamais le clair (ni `%PDF-`, ni en-tête d'image) ;
//   - un objet ou une clé recopiés vers un autre document, un autre collaborateur ou
//     une autre organisation ne se déchiffrent pas ;
//   - effacer la clé enveloppée (anonymisation, purge) rend l'objet illisible à jamais,
//     même si l'effacement de l'objet au stockage échoue.
// La clé de données n'est jamais journalisée ni renvoyée.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  decryptSecret,
  encryptSecret,
  type EncryptedValue,
  type MasterKeyring,
  type SecretLocation,
} from '../../integrations/secrets-crypto.js';

/** Signature de l'objet chiffré (version du format). */
const MAGIC = Buffer.from('LHD1', 'latin1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

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

function aadOf(id: HrDocumentIdentity): Buffer {
  return Buffer.from(`hr_documents:${id.organizationId}:${id.employeeId}:${id.documentId}`);
}

/** Chiffre un fichier : objet à stocker et clé de données enveloppée. */
export function sealHrDocument(
  id: HrDocumentIdentity,
  bytes: Buffer,
  keyring: MasterKeyring,
  updatedBy: string,
): { blob: Buffer; wrappedKey: EncryptedValue } {
  const dek = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(aadOf(id));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = encryptSecret({
      location: hrDocumentKeyLocation(id),
      value: dek.toString('base64'),
      keyring,
      updatedBy,
    });
    return {
      blob: Buffer.concat([MAGIC, iv, tag, ciphertext]),
      // `last4` d'une clé n'aurait aucun sens et en livrerait un fragment.
      wrappedKey: { ...wrapped, last4: null },
    };
  } finally {
    dek.fill(0);
  }
}

/** Déchiffre un objet ; lève si la clé, l'identité ou les octets ne concordent pas. */
export function openHrDocument(
  id: HrDocumentIdentity,
  blob: Buffer,
  wrappedKey: EncryptedValue,
  keyring: MasterKeyring,
): Buffer {
  if (blob.length < MAGIC.length + IV_BYTES + TAG_BYTES || !blob.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Objet chiffré illisible.');
  }
  const plain = decryptSecret({ location: hrDocumentKeyLocation(id), record: wrappedKey, keyring });
  const dek = Buffer.from(plain.expose(), 'base64');
  try {
    const iv = blob.subarray(4, 4 + IV_BYTES);
    const tag = blob.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAAD(aadOf(id));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(blob.subarray(4 + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } finally {
    dek.fill(0);
  }
}
