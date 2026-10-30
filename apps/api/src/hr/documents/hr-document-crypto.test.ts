// Chiffrement des documents RH sensibles : enveloppe liée à l'organisation, au
// collaborateur et au document (ADR-0045 § 2.8). ADR-0045 — H4. Sans base.

import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MasterKeyring } from '../../integrations/secrets-crypto.js';
import { HrDocumentSchema } from './hr-document.schema.js';
import { openHrDocument, sealHrDocument } from './hr-document-crypto.js';
import { addMonthsToDay, retentionEnabled } from '../retention/hr-retention.job.js';

const k1 = MasterKeyring.of([{ keyId: 'k1', key: randomBytes(32) }], 'k1');
const k2 = MasterKeyring.of([{ keyId: 'k2', key: randomBytes(32) }], 'k2');
const id = { organizationId: 'org-a', employeeId: 'emp-1', documentId: 'doc-1' };
const CLAIR = Buffer.from('%PDF-1.4 passeport OP998877', 'latin1');

describe('sealHrDocument / openHrDocument', () => {
  it('aller-retour ; l’objet ne contient ni la signature ni le contenu', () => {
    const { blob, wrappedKey } = sealHrDocument(id, CLAIR, k1, 'u1');
    expect(blob.includes(Buffer.from('%PDF-'))).toBe(false);
    expect(blob.includes(Buffer.from('OP998877'))).toBe(false);
    expect(wrappedKey).toMatchObject({ alg: 'aes-256-gcm', keyId: 'k1', last4: null });
    expect(openHrDocument(id, blob, wrappedKey, k1).equals(CLAIR)).toBe(true);
  });

  it('deux dépôts du même fichier ne donnent jamais le même objet', () => {
    const a = sealHrDocument(id, CLAIR, k1, 'u1');
    const b = sealHrDocument(id, CLAIR, k1, 'u1');
    expect(a.blob.equals(b.blob)).toBe(false);
  });

  it('lié à l’organisation, au collaborateur, au document et au trousseau', () => {
    const { blob, wrappedKey } = sealHrDocument(id, CLAIR, k1, 'u1');
    for (const other of [
      { ...id, organizationId: 'org-b' },
      { ...id, employeeId: 'emp-2' },
      { ...id, documentId: 'doc-2' },
    ]) {
      expect(() => openHrDocument(other, blob, wrappedKey, k1)).toThrow();
    }
    expect(() => openHrDocument(id, blob, wrappedKey, k2)).toThrow();
    const altered = Buffer.from(blob);
    altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
    expect(() => openHrDocument(id, altered, wrappedKey, k1)).toThrow();
    expect(() => openHrDocument(id, Buffer.from('court'), wrappedKey, k1)).toThrow();
  });

  it('la clé enveloppée ne sort jamais en JSON', () => {
    const { wrappedKey } = sealHrDocument(id, CLAIR, k1, 'u1');
    const json = JSON.stringify(
      (
        HrDocumentSchema.get('toJSON') as { transform: (d: unknown, r: unknown) => unknown }
      ).transform(null, { wrappedKey }),
    );
    expect(json).not.toContain(wrappedKey.ciphertext);
  });
});

describe('conservation (hr.retention)', () => {
  it('éteinte par défaut ; mois ajoutés au jour civil', () => {
    expect(
      retentionEnabled({ privateDataMonthsAfterExit: null, anonymizeYearsAfterExit: null }),
    ).toBe(false);
    expect(retentionEnabled({ privateDataMonthsAfterExit: 6, anonymizeYearsAfterExit: null })).toBe(
      true,
    );
    expect(addMonthsToDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDay('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsToDay('2024-02-29', 12)).toBe('2025-02-28');
  });
});
