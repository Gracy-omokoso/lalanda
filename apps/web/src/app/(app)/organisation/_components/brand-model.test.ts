import { describe, expect, it } from 'vitest';

import { accepte, couleurSaisie, preControleFichier, tailleLisible } from './brand-model';

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
