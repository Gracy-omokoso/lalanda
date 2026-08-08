// Tests de la mécanique de thème (S20b). Logique pure : aucun DOM requis
// (vitest en environnement node, cf. apps/web/vitest.config.ts).

import { describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY, resolveTheme, themeStorageValue } from './theme';

describe('resolveTheme (S20b)', () => {
  it('applique tel quel un thème explicite, quel que soit le système', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('suit le système quand la préférence est « system »', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('themeStorageValue (S20b)', () => {
  it('n’écrit JAMAIS « system » dans le stockage local', () => {
    // Le script anti-FOUC de app/layout.tsx n'attend que 'light' | 'dark'. Y
    // écrire 'system' forcerait le mode clair au chargement suivant : le thème
    // changerait tout seul entre deux visites.
    expect(themeStorageValue('system')).toBeNull();
  });

  it('mémorise un thème explicite pour que le rechargement le reproduise', () => {
    expect(themeStorageValue('light')).toBe('light');
    expect(themeStorageValue('dark')).toBe('dark');
  });

  it('utilise la clé attendue par le script de démarrage', () => {
    // Constante partagée avec `theme-toggle.tsx` et le script inline de
    // layout.tsx : la désynchroniser casserait silencieusement l'anti-FOUC.
    expect(THEME_STORAGE_KEY).toBe('theme');
  });
});
