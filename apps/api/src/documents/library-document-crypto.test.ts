// Chiffrement des documents sensibles de la bibliothèque (ADR-0046 § 4.3). ADR-0046 — S6.

import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MasterKeyring } from '../integrations/secrets-crypto.js';
import {
  openLibraryDocument,
  rewrapLibraryDocumentKey,
  sealLibraryDocument,
} from './library-document-crypto.js';

const k1 = { keyId: 'k1', key: randomBytes(32) };
const k2 = { keyId: 'k2', key: randomBytes(32) };
const ring1 = MasterKeyring.of([k1], 'k1');
const id = { organizationId: 'org-a', documentId: 'doc-1', versionId: 'v-1' };
const CLAIR = Buffer.from('%PDF-1.4 attestation NIF-778899', 'latin1');

describe('sealLibraryDocument / openLibraryDocument', () => {
  it('aller-retour, format LLD1, sans clair dans l’objet', () => {
    const { blob, wrappedKey } = sealLibraryDocument(id, CLAIR, ring1, 'u1');
    expect(blob.subarray(0, 4).toString('latin1')).toBe('LLD1');
    expect(blob.includes(Buffer.from('%PDF-'))).toBe(false);
    expect(blob.includes(Buffer.from('NIF-778899'))).toBe(false);
    expect(wrappedKey).toMatchObject({ keyId: 'k1', last4: null });
    expect(openLibraryDocument(id, blob, wrappedKey, ring1).equals(CLAIR)).toBe(true);
  });

  it('lié à l’organisation, au document et à la version', () => {
    const { blob, wrappedKey } = sealLibraryDocument(id, CLAIR, ring1, 'u1');
    for (const other of [
      { ...id, organizationId: 'org-b' },
      { ...id, documentId: 'doc-2' },
      { ...id, versionId: 'v-2' },
    ]) {
      expect(() => openLibraryDocument(other, blob, wrappedKey, ring1)).toThrow();
    }
  });

  it('rotation : la clé enveloppée seule change, l’objet se relit avec la nouvelle clé', () => {
    const { blob, wrappedKey } = sealLibraryDocument(id, CLAIR, ring1, 'u1');
    const both = MasterKeyring.of([k2, k1], 'k2');
    const out = rewrapLibraryDocumentKey(id, wrappedKey, both);
    expect(out.changed).toBe(true);
    expect(out.record).toMatchObject({ keyId: 'k2', last4: null });
    expect(rewrapLibraryDocumentKey(id, out.record, both).changed).toBe(false);
    const only2 = MasterKeyring.of([k2], 'k2');
    expect(openLibraryDocument(id, blob, out.record, only2).equals(CLAIR)).toBe(true);
    expect(() => openLibraryDocument(id, blob, wrappedKey, only2)).toThrow();
  });
});
