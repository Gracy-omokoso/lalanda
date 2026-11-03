// Le script anti-FOUC est exécuté ici contre un document et un stockage
// simulés : c'est lui qui décide de la PREMIÈRE image peinte (ADR-0055).

import { describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY, UI_THEME_STORAGE_KEY } from './theme';
import { THEME_BOOT_SCRIPT } from './theme-boot';

function demarrer(
  stockage: Record<string, string>,
  systemeSombre = false,
): Record<string, string | undefined> {
  const dataset: Record<string, string | undefined> = {};
  const document = { documentElement: { dataset } };
  const localStorage = { getItem: (k: string) => stockage[k] ?? null };
  const window = { matchMedia: () => ({ matches: systemeSombre }) };
  new Function('document', 'localStorage', 'window', THEME_BOOT_SCRIPT)(
    document,
    localStorage,
    window,
  );
  return dataset;
}

describe('script anti-FOUC (ADR-0055)', () => {
  it('sans rien en mémoire : Lalanda, mode du système', () => {
    expect(demarrer({})).toEqual({ uiTheme: 'lalanda', theme: 'light' });
    expect(demarrer({}, true)).toEqual({ uiTheme: 'lalanda', theme: 'dark' });
  });

  it('reprend le thème et le mode mémorisés', () => {
    expect(demarrer({ [UI_THEME_STORAGE_KEY]: 'lagune', [THEME_STORAGE_KEY]: 'dark' })).toEqual({
      uiTheme: 'lagune',
      theme: 'dark',
    });
  });

  it('Ébène est sombre même si le mode mémorisé est clair', () => {
    expect(demarrer({ [UI_THEME_STORAGE_KEY]: 'ebene', [THEME_STORAGE_KEY]: 'light' })).toEqual({
      uiTheme: 'ebene',
      theme: 'dark',
    });
  });

  it('une valeur inconnue retombe sur Lalanda, jamais sur un thème inexistant', () => {
    expect(demarrer({ [UI_THEME_STORAGE_KEY]: 'solarized' }).uiTheme).toBe('lalanda');
    expect(demarrer({ [THEME_STORAGE_KEY]: 'system' }).theme).toBe('light');
  });
});
