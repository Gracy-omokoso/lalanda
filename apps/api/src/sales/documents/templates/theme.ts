// Couleurs et polices dérivées des options d'un modèle — ADR-0028 § 3.
//
// Fonction PURE et déterministe : mêmes options figées ⇒ mêmes couleurs, donc
// même PDF. Les modèles ne calculent aucune couleur eux-mêmes.

import {
  EDITORIAL_FONT_PAIRS,
  fontStack,
  isBodyFont,
  type BodyFontId,
  type EditorialFontPair,
  type FontId,
} from './invoice-fonts.js';
import type {
  FrozenIdentity,
  HexColor,
  TemplateOptions,
  TemplateTheme,
} from './template.contract.js';

const WHITE = '#ffffff';
const INK = '#111111';

function rgb(hex: HexColor): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function toHex(ch: number[]): HexColor {
  return `#${ch.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mélange vers le blanc : `t = 0` → la couleur, `t = 1` → blanc. */
export function tint(hex: HexColor, t: number): HexColor {
  return toHex(rgb(hex).map((v) => v + (255 - v) * t));
}

/** Luminance relative WCAG 2.x. */
function luminance(hex: HexColor): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: HexColor, b: HexColor): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Texte lisible sur un fond de couleur : blanc si le contraste atteint 4,5:1
 * (WCAG AA), sinon encre. Une couleur de marque très claire (jaune) ne rend
 * donc jamais un bandeau illisible.
 */
export function readableOn(background: HexColor): HexColor {
  return contrastRatio(background, WHITE) >= 4.5 ? WHITE : INK;
}

/** Couleur d'accent utilisable comme TEXTE sur fond blanc (assombrie si trop claire). */
export function inkSafe(hex: HexColor): HexColor {
  let c = hex;
  for (let i = 0; i < 10 && contrastRatio(c, WHITE) < 4.5; i += 1) {
    c = toHex(rgb(c).map((v) => v * 0.8));
  }
  return c;
}

function fontsOf(choice: TemplateOptions['font']): {
  body: BodyFontId;
  display: FontId;
} {
  if (isBodyFont(choice)) return { body: choice, display: choice };
  if ((EDITORIAL_FONT_PAIRS as readonly string[]).includes(choice)) {
    const [display, body] = (choice as EditorialFontPair).split('+') as [FontId, BodyFontId];
    return { body, display };
  }
  return { body: 'inter', display: 'inter' };
}

export function themeOf(options: TemplateOptions, identity: FrozenIdentity): TemplateTheme {
  const mono = options.palette === 'mono';
  const { body, display } = fontsOf(options.font);
  const fonts: FontId[] = [body, display, 'jetbrains-mono'];
  const stacks = {
    body: fontStack(body),
    display: fontStack(display),
    code: fontStack('jetbrains-mono'),
  };
  if (mono) {
    return {
      mono: true,
      accent: INK,
      onAccent: WHITE,
      soft: '#f3f4f6',
      line: '#9ca3af',
      side: '#f3f4f6',
      onSide: INK,
      ...stacks,
      fonts,
      logoFilter: 'grayscale(1)',
    };
  }
  const accent = options.accent;
  const second = identity.secondaryColor ?? accent;
  return {
    mono: false,
    accent: inkSafe(accent),
    onAccent: readableOn(inkSafe(accent)),
    soft: tint(second, 0.9),
    line: tint(accent, 0.5),
    side: accent,
    onSide: readableOn(accent),
    ...stacks,
    fonts,
    logoFilter: 'none',
  };
}
