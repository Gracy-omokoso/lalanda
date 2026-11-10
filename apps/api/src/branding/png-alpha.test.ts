// Transparence réelle d'un motif téléversé — ADR-0073 § 4.

import { describe, expect, it } from 'vitest';

import { validateAndSanitizeImage } from '../account/image-validation.js';
import { rgbaPng, solidPng } from '../sales/documents/testing/template-fixtures.js';
import { pngAlpha } from './png-alpha.js';

function sanitized(b: Buffer): Buffer {
  const v = validateAndSanitizeImage(b);
  if (!v.ok) throw new Error(v.message);
  return v.bytes;
}

describe('pngAlpha', () => {
  it('compte les pixels non opaques après défiltrage (cinq filtres)', () => {
    const png = sanitized(rgbaPng(64, 64, (x, y) => ((x + y) % 4 === 0 ? 255 : 0)));
    const v = pngAlpha(png);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.transparentShare).toBeCloseTo(0.75, 2);
  });

  it('un RVBA entièrement opaque est vu comme opaque', () => {
    const v = pngAlpha(sanitized(rgbaPng(64, 64, () => 255)));
    expect(v).toEqual({ ok: true, transparentShare: 0 });
  });

  it('un PNG sans canal alpha est refusé avec un message qui dit quoi exporter', () => {
    const v = pngAlpha(sanitized(solidPng(64, 64, [10, 20, 30])));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe('PATTERN_NOT_TRANSPARENT');
      expect(v.message).toMatch(/PNG transparent/);
    }
  });

  it('autre chose qu’un PNG est refusé', () => {
    expect(pngAlpha(Buffer.from('GIF89a……………………………………………………………')).ok).toBe(false);
  });
});
