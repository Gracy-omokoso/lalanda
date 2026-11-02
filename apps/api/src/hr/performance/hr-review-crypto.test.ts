// Évaluations : chiffrement lié à l'organisation, à l'évaluation et à la section ;
// rotation (ADR-0051 § 2.6, § 4). ADR-0051 — H15. Sans base.

import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MasterKeyring } from '../../integrations/secrets-crypto.js';
import {
  decryptReviewSection,
  encryptReviewSection,
  hrReviewLocation,
  rewrapReviewSection,
  type ReviewSectionContent,
} from './hr-review-crypto.js';

const K1 = { keyId: 'k1', key: randomBytes(32) };
const K2 = { keyId: 'k2', key: randomBytes(32) };
const k1 = MasterKeyring.of([K1], 'k1');
const APPRECIATION = 'Appréciation confidentielle 7731';
const contenu: ReviewSectionContent = {
  answers: { bilan: APPRECIATION },
  ratings: { savoir_etre: 3 },
  overall: null,
};
const id = {
  organizationId: 'org-a',
  reviewId: 'a'.repeat(24),
  section: 'managerAssessment',
} as const;

describe('chiffrement des évaluations', () => {
  it('aller-retour exact ; jamais le clair dans le chiffré ; last4 nul', () => {
    const record = encryptReviewSection(id, contenu, k1, 'u');
    expect(JSON.stringify(record)).not.toContain(APPRECIATION);
    expect(record.last4).toBeNull();
    expect(decryptReviewSection(id, record, k1)).toEqual(contenu);
  });

  it('emplacement `org:hr_reviews` : organisation, évaluation et section', () => {
    expect(hrReviewLocation(id)).toEqual({
      documentId: `org-a:${'a'.repeat(24)}`,
      provider: 'org:hr_reviews',
      secretName: `org-a:${'a'.repeat(24)}:managerAssessment`,
    });
  });

  it('un chiffré recopié ailleurs ne se déchiffre pas (AAD)', () => {
    const record = encryptReviewSection(id, contenu, k1, 'u');
    expect(() => decryptReviewSection({ ...id, section: 'selfAssessment' }, record, k1)).toThrow();
    expect(() => decryptReviewSection({ ...id, reviewId: 'b'.repeat(24) }, record, k1)).toThrow();
    expect(() => decryptReviewSection({ ...id, organizationId: 'org-b' }, record, k1)).toThrow();
  });

  it('rotation k1 → k2 : relu avec la seule k2 ; idempotente', () => {
    const record = encryptReviewSection(id, contenu, k1, 'u');
    const both = MasterKeyring.of([K2, K1], 'k2');
    const out = rewrapReviewSection(id, record, both);
    expect(out.changed).toBe(true);
    expect(out.record.keyId).toBe('k2');
    expect(out.record.last4).toBeNull();
    expect(decryptReviewSection(id, out.record, MasterKeyring.of([K2], 'k2'))).toEqual(contenu);
    expect(rewrapReviewSection(id, out.record, both).changed).toBe(false);
  });
});
