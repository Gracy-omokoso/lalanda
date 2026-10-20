// Empreinte du contenu figé et champs figés optionnels (ADR-0026 § 6.2).

import { describe, expect, it } from 'vitest';

import { normalizedTest } from '../documents/testing/invoice-fixtures.js';
import { contentSha256Of } from './canonical.js';

describe('contentSha256 — champ figé optionnel softwareVersion', () => {
  it('document gelé avant le champ : empreinte identique, absent ou null', () => {
    const ancien = normalizedTest() as unknown as Record<string, unknown>;
    const avant = contentSha256Of(ancien);
    expect(contentSha256Of({ ...ancien, softwareVersion: null })).toBe(avant);
    expect(contentSha256Of({ ...ancien, softwareVersion: undefined })).toBe(avant);
  });

  it('version figée : couverte par l’empreinte', () => {
    const doc = normalizedTest() as unknown as Record<string, unknown>;
    const a = contentSha256Of({ ...doc, softwareVersion: '0.9.3' });
    expect(a).not.toBe(contentSha256Of(doc));
    expect(a).not.toBe(contentSha256Of({ ...doc, softwareVersion: '0.9.4' }));
    expect(a).toBe(contentSha256Of({ ...doc, softwareVersion: '0.9.3' }));
  });
});
