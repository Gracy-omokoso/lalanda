import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MODAL_WIDTHS, Modal, modalCloseDecision, trapFocusIndex } from './components/modal';

function rendre(props: Partial<Parameters<typeof Modal>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(
      Modal,
      { open: true, onClose: () => undefined, title: 'Nouveau projet', ...props },
      createElement('input', { 'aria-label': 'Nom' }),
    ),
  );
}

describe('Modal — rendu', () => {
  it('ne rend rien quand elle est fermée', () => {
    expect(rendre({ open: false })).toBe('');
  });

  it('est un dialogue modal relié à son titre', () => {
    const html = rendre();
    expect(html).toMatch(/^<dialog/);
    expect(html).toContain('aria-modal="true"');
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('>Nouveau projet</h2>');
    expect(html).toContain('aria-label="Fermer"');
  });

  it('relie la description quand elle existe', () => {
    expect(rendre()).not.toContain('aria-describedby');
    const html = rendre({ description: 'Un projet client ou interne.' });
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
  });

  it('est plein écran sur téléphone et bornée au-delà, selon la largeur', () => {
    for (const taille of ['sm', 'md', 'lg'] as const) {
      const html = rendre({ size: taille });
      expect(html).toContain('h-dvh');
      expect(html).toContain('w-full');
      expect(html).toContain(MODAL_WIDTHS[taille]);
    }
    expect(new Set(Object.values(MODAL_WIDTHS)).size).toBe(3);
  });

  it('défile dans son contenu et s’appuie sur les jetons (clair et sombre)', () => {
    const html = rendre({ footer: createElement('button', null, 'Créer') });
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('bg-[var(--surface)]');
    expect(html).toContain('text-[var(--foreground)]');
    expect(html).toContain('<footer');
  });

  it('désactive la fermeture et s’annonce occupée pendant un envoi', () => {
    const html = rendre({ busy: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*aria-label="Fermer"|aria-label="Fermer"[^>]*disabled/,
    );
  });
});

describe('modalCloseDecision', () => {
  it('ferme quand rien n’a été saisi', () => {
    expect(modalCloseDecision({ busy: false, dirty: false, confirming: false })).toBe('close');
  });
  it('demande confirmation quand la saisie a commencé', () => {
    expect(modalCloseDecision({ busy: false, dirty: true, confirming: false })).toBe('confirm');
  });
  it('ne ferme jamais pendant un envoi', () => {
    expect(modalCloseDecision({ busy: true, dirty: false, confirming: false })).toBe('ignore');
    expect(modalCloseDecision({ busy: true, dirty: true, confirming: false })).toBe('ignore');
  });
  it('n’abandonne pas en silence pendant la confirmation', () => {
    expect(modalCloseDecision({ busy: false, dirty: true, confirming: true })).toBe('ignore');
  });
});

describe('trapFocusIndex', () => {
  it('boucle du dernier au premier avec Tab', () => {
    expect(trapFocusIndex(2, 3, false)).toBe(0);
  });
  it('boucle du premier au dernier avec Maj+Tab', () => {
    expect(trapFocusIndex(0, 3, true)).toBe(2);
  });
  it('laisse le navigateur avancer à l’intérieur', () => {
    expect(trapFocusIndex(0, 3, false)).toBeNull();
    expect(trapFocusIndex(2, 3, true)).toBeNull();
  });
  it('ramène dans la fenêtre un focus parti ailleurs', () => {
    expect(trapFocusIndex(-1, 3, false)).toBe(0);
    expect(trapFocusIndex(-1, 3, true)).toBe(2);
  });
  it('ne fait rien sans élément focalisable', () => {
    expect(trapFocusIndex(-1, 0, false)).toBeNull();
  });
});
