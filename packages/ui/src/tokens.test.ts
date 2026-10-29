import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  contraste,
  LABEL_TOKENS,
  NAV_TOKENS,
  PAIRES,
  PAIRES_NAV,
  SEUIL_INTERFACE,
  SEUIL_TEXTE,
  TAG_COLORS,
  THEME_TOKENS,
  type Theme,
} from './tokens';

const CSS = readFileSync(fileURLToPath(new URL('./styles/tokens.css', import.meta.url)), 'utf8');

/** Variables déclarées dans le bloc du thème (`:root, [data-theme='light']` ou `[data-theme='dark']`). */
function blocCss(theme: Theme): Record<string, string> {
  const entete = theme === 'light' ? ":root,\n[data-theme='light'] {" : "[data-theme='dark'] {";
  const debut = CSS.indexOf(entete);
  expect(debut).toBeGreaterThanOrEqual(0);
  const corps = CSS.slice(debut + entete.length, CSS.indexOf('}', debut));
  const vars: Record<string, string> = {};
  for (const m of corps.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    vars[m[1]!] = m[2]!.toLowerCase();
  }
  return vars;
}

describe('jetons — le CSS et le miroir typé disent la même chose', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`thème ${theme}`, () => {
      const css = blocCss(theme);
      const attendus = { ...THEME_TOKENS[theme], ...NAV_TOKENS[theme] };
      for (const [nom, valeur] of Object.entries(attendus)) {
        expect(css[nom], `--${nom}`).toBe(valeur.toLowerCase());
      }
    });
  }
});

describe('jetons — contrastes WCAG 2.2 AA', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [avant, arriere, seuil] of PAIRES) {
      it(`${theme} : ${avant} sur ${arriere} ≥ ${seuil}`, () => {
        const t = THEME_TOKENS[theme];
        expect(contraste(t[avant], t[arriere])).toBeGreaterThanOrEqual(seuil);
      });
    }
    for (const [avant, arriere, seuil] of PAIRES_NAV) {
      it(`${theme} (barre latérale) : ${avant} sur ${arriere} ≥ ${seuil}`, () => {
        const t = NAV_TOKENS[theme];
        expect(contraste(t[avant], t[arriere])).toBeGreaterThanOrEqual(seuil);
      });
    }
  }
});

describe('contraste()', () => {
  it('noir sur blanc vaut 21, une couleur sur elle-même vaut 1', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contraste('#005263', '#005263')).toBe(1);
  });
  it('est symétrique', () => {
    expect(contraste('#575449', '#F4F2ED')).toBe(contraste('#F4F2ED', '#575449'));
  });
  it("l'ancien texte secondaire sur crème était à la limite (audit A7)", () => {
    expect(contraste('#6c685a', '#eee7d7')).toBeLessThan(SEUIL_TEXTE + 0.2);
  });
});

describe('étiquettes (ADR-0039 § 2.1) — palette fermée, deux thèmes', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`thème ${theme} : le CSS déclare chaque couleur de la palette`, () => {
      const css = blocCss(theme);
      for (const cle of TAG_COLORS) {
        const t = LABEL_TOKENS[theme][cle];
        expect(css[`label-${cle}-bg`], `--label-${cle}-bg`).toBe(t.bg.toLowerCase());
        expect(css[`label-${cle}-fg`], `--label-${cle}-fg`).toBe(t.fg.toLowerCase());
        expect(css[`label-${cle}-dot`], `--label-${cle}-dot`).toBe(t.dot.toLowerCase());
      }
    });
    for (const cle of TAG_COLORS) {
      it(`${theme} : ${cle} — texte lisible, repère visible`, () => {
        const t = LABEL_TOKENS[theme][cle];
        const surface = THEME_TOKENS[theme].surface;
        expect(contraste(t.fg, t.bg)).toBeGreaterThanOrEqual(SEUIL_TEXTE);
        expect(contraste(t.dot, surface)).toBeGreaterThanOrEqual(SEUIL_INTERFACE);
        expect(contraste(t.dot, t.bg)).toBeGreaterThanOrEqual(SEUIL_INTERFACE);
      });
    }
  }
  it('neuf couleurs, sans doublon', () => {
    expect(new Set(TAG_COLORS).size).toBe(9);
  });
});
