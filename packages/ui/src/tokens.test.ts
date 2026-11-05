import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CARD_COLORS,
  CARD_TOKENS,
  CHART_TOKENS,
  combinaison,
  COMBINAISONS,
  contraste,
  LABEL_TOKENS,
  modeAffiche,
  NAV_TOKENS,
  PAIRES,
  PAIRES_GRAPHIQUE,
  PAIRES_NAV,
  SELECTEURS_CSS,
  SEUIL_INTERFACE,
  SEUIL_TEXTE,
  TAG_COLORS,
  THEME_TOKENS,
  UI_THEMES,
  type Combinaison,
} from './tokens';

const CSS = readFileSync(fileURLToPath(new URL('./styles/tokens.css', import.meta.url)), 'utf8');

/**
 * Variables de couleur déclarées dans le bloc d'une combinaison. Le sélecteur
 * est cherché en début de ligne : `[data-theme='dark'] {` est aussi la fin de
 * `[data-ui-theme='lagune'][data-theme='dark'] {`.
 */
function blocCss(c: Combinaison): Record<string, string> {
  const entete = `\n${SELECTEURS_CSS[c]} {`;
  const debut = CSS.indexOf(entete);
  expect(debut, entete).toBeGreaterThanOrEqual(0);
  const corps = CSS.slice(debut + entete.length, CSS.indexOf('\n}', debut));
  const vars: Record<string, string> = {};
  for (const m of corps.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    vars[m[1]!] = m[2]!.toLowerCase();
  }
  return vars;
}

function attendus(c: Combinaison): Record<string, string> {
  const out: Record<string, string> = {
    ...THEME_TOKENS[c],
    ...NAV_TOKENS[c],
    ...CHART_TOKENS[c],
  };
  for (const cle of TAG_COLORS) {
    const t = LABEL_TOKENS[c][cle];
    out[`label-${cle}-bg`] = t.bg;
    out[`label-${cle}-fg`] = t.fg;
    out[`label-${cle}-dot`] = t.dot;
  }
  for (const cle of CARD_COLORS) {
    out[`card-${cle}-bg`] = CARD_TOKENS[c][cle].bg;
    out[`card-${cle}-dot`] = CARD_TOKENS[c][cle].dot;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toLowerCase()]));
}

describe('jetons — le CSS et le miroir typé disent la même chose', () => {
  for (const c of COMBINAISONS) {
    it(`${c} : le bloc déclare exactement les jetons attendus, aux mêmes valeurs`, () => {
      // Égalité stricte : un jeton oublié dans un bloc hériterait en silence de
      // la valeur d'un autre thème.
      expect(blocCss(c)).toEqual(attendus(c));
    });
  }

  it('les cinq combinaisons déclarent les mêmes noms de jetons', () => {
    const reference = Object.keys(attendus('lalanda-light')).sort();
    for (const c of COMBINAISONS) expect(Object.keys(attendus(c)).sort()).toEqual(reference);
  });

  it('Ébène vient en dernier : il l’emporte sur [data-theme] à spécificité égale', () => {
    const positions = COMBINAISONS.map((c) => CSS.indexOf(`\n${SELECTEURS_CSS[c]} {`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe('thèmes et modes', () => {
  it('trois thèmes, Lalanda par défaut en tête', () => {
    expect(UI_THEMES).toEqual(['lalanda', 'lagune', 'ebene']);
  });
  it('Ébène est toujours sombre, les autres suivent le mode choisi', () => {
    expect(modeAffiche('ebene', 'light')).toBe('dark');
    expect(modeAffiche('lagune', 'light')).toBe('light');
    expect(modeAffiche('lalanda', 'dark')).toBe('dark');
    expect(combinaison('ebene', 'light')).toBe('ebene');
    expect(combinaison('lagune', 'dark')).toBe('lagune-dark');
  });
});

describe('jetons — contrastes WCAG 2.2 AA, pour chaque thème × mode', () => {
  for (const c of COMBINAISONS) {
    for (const [avant, arriere, seuil] of PAIRES) {
      it(`${c} : ${avant} sur ${arriere} ≥ ${seuil}`, () => {
        const t = THEME_TOKENS[c];
        expect(contraste(t[avant], t[arriere])).toBeGreaterThanOrEqual(seuil);
      });
    }
    for (const [avant, arriere, seuil] of PAIRES_NAV) {
      it(`${c} (navigation) : ${avant} sur ${arriere} ≥ ${seuil}`, () => {
        const t = NAV_TOKENS[c];
        expect(contraste(t[avant], t[arriere])).toBeGreaterThanOrEqual(seuil);
      });
    }
    for (const [serie, seuil] of PAIRES_GRAPHIQUE) {
      it(`${c} (graphique) : ${serie} sur surface ≥ ${seuil}`, () => {
        expect(contraste(CHART_TOKENS[c][serie], THEME_TOKENS[c].surface)).toBeGreaterThanOrEqual(
          seuil,
        );
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

describe('étiquettes (ADR-0039 § 2.1) — palette fermée, chaque combinaison', () => {
  for (const c of COMBINAISONS) {
    for (const cle of TAG_COLORS) {
      it(`${c} : ${cle} — texte lisible, repère visible`, () => {
        const t = LABEL_TOKENS[c][cle];
        const surface = THEME_TOKENS[c].surface;
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

describe('cartes post-it (ADR-0061 § 4) — texte du thème lisible, liseré visible', () => {
  for (const c of COMBINAISONS) {
    for (const cle of CARD_COLORS) {
      it(`${c} : ${cle} — texte ≥ 4,5:1, texte secondaire ≥ 4,5:1, liseré ≥ 3:1`, () => {
        const t = CARD_TOKENS[c][cle];
        const theme = THEME_TOKENS[c];
        expect(contraste(theme.foreground, t.bg)).toBeGreaterThanOrEqual(SEUIL_TEXTE);
        expect(contraste(theme['foreground-muted'], t.bg)).toBeGreaterThanOrEqual(SEUIL_TEXTE);
        expect(contraste(t.dot, theme.surface)).toBeGreaterThanOrEqual(SEUIL_INTERFACE);
      });
    }
  }
  it('huit teintes, sans doublon ; claires en clair, sombres en sombre', () => {
    expect(new Set(CARD_COLORS).size).toBe(8);
    for (const cle of CARD_COLORS) {
      expect(contraste(CARD_TOKENS['lalanda-light'][cle].bg, '#000000')).toBeGreaterThan(15);
      expect(contraste(CARD_TOKENS.ebene[cle].bg, '#FFFFFF')).toBeGreaterThan(10);
    }
  });
});
