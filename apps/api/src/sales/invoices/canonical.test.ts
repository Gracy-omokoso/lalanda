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

describe('contentSha256 — champ figé optionnel presentation (ADR-0028 § 6)', () => {
  const presentation = {
    template: { id: 'bandeau', version: '1.0.0' },
    options: { palette: 'brand', accent: '#1d4ed8', font: 'manrope' },
    identity: {
      primaryColor: '#0f5132',
      secondaryColor: null,
      font: 'manrope',
      logos: {
        primary: {
          assetId: 'a'.repeat(32),
          sha256: 'b'.repeat(64),
          contentType: 'image/png',
          width: 96,
          height: 96,
        },
        horizontal: null,
        symbol: null,
        light: null,
      },
    },
  };

  it('document sans modèle choisi : empreinte inchangée', () => {
    const doc = normalizedTest() as unknown as Record<string, unknown>;
    expect(contentSha256Of({ ...doc, presentation: null })).toBe(contentSha256Of(doc));
  });

  it('présentation figée : couverte par l’empreinte (modèle, options, logo)', () => {
    const doc = normalizedTest() as unknown as Record<string, unknown>;
    const a = contentSha256Of({ ...doc, presentation });
    expect(a).not.toBe(contentSha256Of(doc));
    expect(
      contentSha256Of({
        ...doc,
        presentation: { ...presentation, template: { id: 'minimal', version: '1.0.0' } },
      }),
    ).not.toBe(a);
    const autreLogo = structuredClone(presentation);
    autreLogo.identity.logos.primary.sha256 = 'c'.repeat(64);
    expect(contentSha256Of({ ...doc, presentation: autreLogo })).not.toBe(a);
    expect(contentSha256Of({ ...doc, presentation: structuredClone(presentation) })).toBe(a);
  });
});
