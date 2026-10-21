// Couleurs et polices dérivées des options d'un modèle — ADR-0028 § 3.
//
// Fonction PURE et déterministe : mêmes options figées ⇒ mêmes couleurs, donc
// même PDF. Les modèles ne calculent aucune couleur eux-mêmes. L'arithmétique
// des couleurs vit dans `branding/colors.ts` : `sales/documents` n'en fait
// aucune (règle « mise en forme seule », ADR-0025).

import { inkSafe, readableOn, tint } from '../../../branding/colors.js';
import {
  EDITORIAL_FONT_PAIRS,
  fontStack,
  isBodyFont,
  type BodyFontId,
  type EditorialFontPair,
  type FontId,
} from './invoice-fonts.js';
import type { FrozenIdentity, TemplateOptions, TemplateTheme } from './template.contract.js';

const WHITE = '#ffffff';
const INK = '#111111';

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
