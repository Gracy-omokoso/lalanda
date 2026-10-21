// Polices des modèles de facture — ADR-0028 § 5.
//
// Les fichiers `woff2` (OFL-1.1, voir `apps/api/assets/fonts/NOTICE.md`) sont
// lus sur disque et INTÉGRÉS au HTML en `data:` : Chromium n'a aucune requête
// à faire (CSP `font-src data:`, interception réseau S22e). Jamais de police
// chargée en ligne au rendu.
//
// Liste FERMÉE : un identifiant inconnu ne compile pas, et l'API refuse toute
// valeur hors liste (validation zod). Un fichier n'est jamais remplacé en place
// (réimpression à l'identique) : `invoice-fonts.test.ts` en fige les empreintes.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_IDS = [
  'inter',
  'ibm-plex-sans',
  'manrope',
  'source-serif-4',
  'fraunces',
  'jetbrains-mono',
] as const;
export type FontId = (typeof FONT_IDS)[number];

/** Polices de texte proposées aux organisations (identité et modèles). */
export const BODY_FONT_IDS = ['inter', 'ibm-plex-sans', 'manrope', 'source-serif-4'] as const;
export type BodyFontId = (typeof BODY_FONT_IDS)[number];

/** Paires titre + texte du modèle Éditoriale. */
export const EDITORIAL_FONT_PAIRS = [
  'fraunces+inter',
  'source-serif-4+ibm-plex-sans',
  'source-serif-4+manrope',
] as const;
export type EditorialFontPair = (typeof EDITORIAL_FONT_PAIRS)[number];

export function isBodyFont(v: unknown): v is BodyFontId {
  return typeof v === 'string' && (BODY_FONT_IDS as readonly string[]).includes(v);
}

interface FontFile {
  weight: number;
  style: 'normal' | 'italic';
  file: string;
}

interface FontFamily {
  /** Nom CSS (`font-family`). */
  family: string;
  /** Libellé affiché dans l'interface. */
  label: string;
  /** Repli quand un glyphe manque (sous-ensemble latin). */
  fallback: string;
  dir: string;
  files: readonly FontFile[];
}

const normal = (prefix: string, weights: number[]): FontFile[] =>
  weights.map((weight) => ({
    weight,
    style: 'normal',
    file: `${prefix}-latin-${weight}-normal.woff2`,
  }));
const italic = (prefix: string): FontFile => ({
  weight: 400,
  style: 'italic',
  file: `${prefix}-latin-400-italic.woff2`,
});

export const FONTS: Readonly<Record<FontId, FontFamily>> = {
  inter: {
    family: 'Lalanda Inter',
    label: 'Inter',
    fallback: 'Arial, sans-serif',
    dir: 'inter',
    files: [...normal('inter', [300, 400, 500, 600, 700, 800]), italic('inter')],
  },
  'ibm-plex-sans': {
    family: 'Lalanda IBM Plex Sans',
    label: 'IBM Plex Sans',
    fallback: 'Arial, sans-serif',
    dir: 'ibm-plex-sans',
    files: [...normal('ibm-plex-sans', [300, 400, 500, 600, 700]), italic('ibm-plex-sans')],
  },
  manrope: {
    family: 'Lalanda Manrope',
    label: 'Manrope',
    fallback: 'Arial, sans-serif',
    dir: 'manrope',
    files: normal('manrope', [300, 400, 500, 600, 700, 800]),
  },
  'source-serif-4': {
    family: 'Lalanda Source Serif 4',
    label: 'Source Serif 4',
    fallback: 'Georgia, serif',
    dir: 'source-serif-4',
    files: [...normal('source-serif-4', [300, 400, 600, 700, 800]), italic('source-serif-4')],
  },
  fraunces: {
    family: 'Lalanda Fraunces',
    label: 'Fraunces',
    fallback: 'Georgia, serif',
    dir: 'fraunces',
    files: [...normal('fraunces', [300, 400, 600, 700]), italic('fraunces')],
  },
  'jetbrains-mono': {
    family: 'Lalanda JetBrains Mono',
    label: 'JetBrains Mono',
    fallback: "'Courier New', monospace",
    dir: 'jetbrains-mono',
    files: normal('jetbrains-mono', [500, 700]),
  },
};

/**
 * Dossier des polices : `apps/api/assets/fonts` dans le dépôt, `/app/assets/fonts`
 * dans l'image (`pnpm deploy` recopie le paquet). Même profondeur depuis `src/`
 * et depuis `dist/` : `<racine>/{src,dist}/sales/documents/templates/`.
 */
export const FONTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../assets/fonts',
);

export function fontFilePath(id: FontId, file: string): string {
  return resolve(FONTS_DIR, FONTS[id].dir, file);
}

/** `font-family` CSS complet d'une police, repli compris. */
export function fontStack(id: FontId): string {
  return `'${FONTS[id].family}', ${FONTS[id].fallback}`;
}

export function fontLabel(id: FontId): string {
  return FONTS[id].label;
}

const cache = new Map<FontId, string>();

/**
 * `@font-face` d'une famille, fichiers intégrés en base64. Lus une fois par
 * processus (≈ 20 à 30 Kio par graisse) ; un fichier absent est une erreur de
 * déploiement : on lève, plutôt que d'imprimer silencieusement en Arial.
 */
export function fontFaceCss(id: FontId): string {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const f = FONTS[id];
  const css = f.files
    .map((file) => {
      const data = readFileSync(fontFilePath(id, file.file)).toString('base64');
      return `@font-face{font-family:'${f.family}';font-style:${file.style};font-weight:${file.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    })
    .join('\n');
  cache.set(id, css);
  return css;
}

/** `@font-face` de plusieurs familles, sans doublon, dans un ordre stable. */
export function fontFacesCss(ids: readonly FontId[]): string {
  return FONT_IDS.filter((id) => ids.includes(id))
    .map(fontFaceCss)
    .join('\n');
}
