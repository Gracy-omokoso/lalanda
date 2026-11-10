import { describe, expect, it } from 'vitest';

import {
  accepte,
  couleurSaisie,
  preControleFichier,
  preControlePng,
  tailleLisible,
  varianteImprimee,
  vignetteMotif,
} from './brand-model';

const LIMITES = {
  maxBytes: 2 * 1024 * 1024,
  acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'],
};

describe('identité visuelle — saisie', () => {
  it('couleur : #RRGGBB en minuscules, vide = aucune, sinon invalide', () => {
    expect(couleurSaisie('#0F5132')).toBe('#0f5132');
    expect(couleurSaisie('  ')).toBeNull();
    expect(couleurSaisie('vert')).toBeUndefined();
    expect(couleurSaisie('#fff')).toBeUndefined();
  });

  it('fichier : SVG refusé d’emblée, taille et type contrôlés', () => {
    expect(
      preControleFichier({ size: 10, type: 'image/svg+xml', name: 'logo.svg' }, LIMITES),
    ).toMatch(/SVG/);
    expect(preControleFichier({ size: 10, type: '', name: 'LOGO.SVG' }, LIMITES)).toMatch(/SVG/);
    expect(
      preControleFichier({ size: 3 * 1024 * 1024, type: 'image/png', name: 'a.png' }, LIMITES),
    ).toMatch(/trop lourd/);
    expect(preControleFichier({ size: 10, type: 'image/gif', name: 'a.gif' }, LIMITES)).toMatch(
      /PNG, JPEG ou WebP/,
    );
    expect(preControleFichier({ size: 10, type: 'image/png', name: 'a.png' }, LIMITES)).toBeNull();
  });

  it('attribut accept sans SVG, tailles lisibles', () => {
    expect(accepte(['image/png', 'image/svg+xml'])).toBe('image/png');
    expect(tailleLisible(512)).toBe('512 o');
    expect(tailleLisible(2048)).toBe('2 Kio');
    expect(tailleLisible(2 * 1024 * 1024)).toBe('2,0 Mio');
  });
});

describe('identité visuelle v2 (ADR-0073)', () => {
  const tous = { primary: 1, horizontal: 1, symbol: 1, light: 1 };
  it('le choix carré ou horizontal désigne la déclinaison imprimée, avec repli', () => {
    expect(varianteImprimee('square', tous)).toBe('primary');
    expect(varianteImprimee('horizontal', tous)).toBe('horizontal');
    expect(
      varianteImprimee('square', { primary: null, horizontal: 1, symbol: null, light: null }),
    ).toBe('horizontal');
    expect(
      varianteImprimee('horizontal', { primary: null, horizontal: null, symbol: null, light: 1 }),
    ).toBeNull();
  });

  it('favicon et motif : PNG seulement, SVG refusé, taille bornée', () => {
    expect(preControlePng({ size: 10, type: 'image/svg+xml', name: 'a.svg' }, 100)).toMatch(/SVG/);
    expect(preControlePng({ size: 10, type: 'image/jpeg', name: 'a.jpg' }, 100)).toMatch(/PNG/);
    expect(preControlePng({ size: 1000, type: 'image/png', name: 'a.png' }, 100)).toMatch(/lourd/);
    expect(preControlePng({ size: 10, type: 'image/png', name: 'a.png' }, 100)).toBeNull();
  });

  it('vignette : SVG de la bibliothèque en data:, couleur invalide remplacée', () => {
    expect(vignetteMotif('points', '#0f5132')).toMatch(/^data:image\/svg\+xml,/);
    expect(vignetteMotif('points', 'rouge')).toContain(encodeURIComponent('#1f4e79'));
  });
});
