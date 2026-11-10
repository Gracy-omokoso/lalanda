// Identité visuelle v2 — ADR-0073.

import { describe, expect, it } from 'vitest';

import {
  BRAND_PATTERNS,
  PATTERN_INTENSITY,
  clampIntensity,
  deducedLogoChoice,
  effectiveLogoChoice,
  logoOrderFor,
  markVariantFor,
  patternDataUri,
  patternSvg,
} from './index.js';

const ALL = { primary: true, horizontal: true, symbol: true };

describe('choix de logo', () => {
  it('carré = principal puis symbole ; horizontal = horizontal ; repli sur l’autre forme', () => {
    expect(logoOrderFor('square')).toEqual(['primary', 'symbol', 'horizontal']);
    expect(logoOrderFor('horizontal')).toEqual(['horizontal', 'primary', 'symbol']);
    expect(markVariantFor('square', ALL)).toBe('primary');
    expect(markVariantFor('horizontal', ALL)).toBe('horizontal');
    expect(markVariantFor('square', { primary: false, horizontal: true, symbol: false })).toBe(
      'horizontal',
    );
    expect(markVariantFor('horizontal', { primary: false, horizontal: false, symbol: true })).toBe(
      'symbol',
    );
    expect(markVariantFor('square', { primary: false, horizontal: false, symbol: false })).toBe(
      null,
    );
  });

  it('migration douce : sans choix enregistré, déduit de ce qui est téléversé', () => {
    expect(deducedLogoChoice({ primary: false, horizontal: true, symbol: false })).toBe(
      'horizontal',
    );
    expect(deducedLogoChoice(ALL)).toBe('square');
    expect(deducedLogoChoice({ primary: false, horizontal: false, symbol: false })).toBe('square');
    expect(effectiveLogoChoice(null, { primary: false, horizontal: true, symbol: false })).toBe(
      'horizontal',
    );
    expect(effectiveLogoChoice('horizontal', ALL)).toBe('horizontal');
    expect(effectiveLogoChoice('rond', ALL)).toBe('square');
  });
});

describe('bibliothèque de motifs', () => {
  it('au moins huit motifs, identifiants uniques', () => {
    expect(BRAND_PATTERNS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BRAND_PATTERNS.map((p) => p.id)).size).toBe(BRAND_PATTERNS.length);
  });

  it.each(BRAND_PATTERNS.map((p) => p.id))('%s : SVG constant, sans script ni ressource', (id) => {
    const svg = patternSvg(id, '#0f5132');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).not.toMatch(/script|href|url\(|on[a-z]+=/i);
    expect(svg).toContain('#0f5132');
    const uri = patternDataUri(id, '#0f5132');
    expect(uri).toMatch(/^data:image\/svg\+xml,[A-Za-z0-9%._~!*-]+$/);
  });

  it('couleur vérifiée, identifiant fermé', () => {
    expect(() => patternSvg('points', 'red"/><script>')).toThrow();
    expect(() => patternSvg('inconnu', '#000000')).toThrow();
  });

  it('intensité bornée', () => {
    expect(clampIntensity(0)).toBe(PATTERN_INTENSITY.min);
    expect(clampIntensity(99)).toBe(PATTERN_INTENSITY.max);
    expect(clampIntensity('x')).toBe(PATTERN_INTENSITY.default);
    expect(clampIntensity(7.4)).toBe(7);
  });
});
