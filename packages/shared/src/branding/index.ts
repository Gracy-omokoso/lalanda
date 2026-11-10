// Identité visuelle, deuxième version — ADR-0073.
//
// Partagé par l'API (rendu des documents) et le web (écran « Identité visuelle ») :
//   - le CHOIX DE LOGO unique de l'organisation (« carré » ou « horizontal ») et
//     sa correspondance avec les quatre déclinaisons d'ADR-0028 ;
//   - la BIBLIOTHÈQUE DE MOTIFS fournie par Lalanda : des tuiles SVG écrites ici,
//     constantes, paramétrées par une seule couleur `#rrggbb` vérifiée — jamais un
//     SVG venu de l'extérieur (le SVG téléversé reste refusé partout) ;
//   - les bornes des téléversements (favicon, motif) et de l'intensité.
//
// Fonctions PURES et déterministes : même entrée ⇒ même chaîne, donc même PDF.

// ── Choix du logo ───────────────────────────────────────────────────────────

export const LOGO_CHOICES = ['square', 'horizontal'] as const;
export type LogoChoice = (typeof LOGO_CHOICES)[number];

export const LOGO_CHOICE_LABELS: Readonly<Record<LogoChoice, string>> = {
  square: 'Logo carré',
  horizontal: 'Logo horizontal',
};

export function isLogoChoice(v: unknown): v is LogoChoice {
  return typeof v === 'string' && (LOGO_CHOICES as readonly string[]).includes(v);
}

/** Déclinaisons d'ADR-0028 utilisées sur fond clair (la version claire est à part). */
export type MarkVariant = 'primary' | 'horizontal' | 'symbol';

/**
 * Ordre des déclinaisons pour un choix : la première présente s'imprime.
 *   - carré : le logo principal, sinon le symbole, sinon (repli) l'horizontal ;
 *   - horizontal : l'horizontal, sinon (repli) le principal, sinon le symbole.
 */
export function logoOrderFor(choice: LogoChoice): readonly MarkVariant[] {
  return choice === 'horizontal'
    ? (['horizontal', 'primary', 'symbol'] as const)
    : (['primary', 'symbol', 'horizontal'] as const);
}

/**
 * Choix déduit de ce qui est téléversé, quand l'organisation n'a rien choisi
 * (identités enregistrées avant ADR-0073) : « horizontal » seulement si c'est la
 * seule forme présente, sinon « carré » — l'ordre qu'utilisaient la plupart des
 * modèles (principal d'abord).
 */
export function deducedLogoChoice(present: Readonly<Record<MarkVariant, boolean>>): LogoChoice {
  return present.horizontal && !present.primary && !present.symbol ? 'horizontal' : 'square';
}

/** Choix effectif : celui enregistré, sinon celui déduit. */
export function effectiveLogoChoice(
  stored: unknown,
  present: Readonly<Record<MarkVariant, boolean>>,
): LogoChoice {
  return isLogoChoice(stored) ? stored : deducedLogoChoice(present);
}

/** Déclinaison réellement imprimée pour un choix (`null` : aucun logo, initiales). */
export function markVariantFor(
  choice: LogoChoice,
  present: Readonly<Record<MarkVariant, boolean>>,
): MarkVariant | null {
  return logoOrderFor(choice).find((v) => present[v]) ?? null;
}

// ── Motifs de fond ──────────────────────────────────────────────────────────

/** Intensité = opacité du motif, en pour cent. Bornée pour que le texte reste lisible. */
export const PATTERN_INTENSITY = { min: 3, max: 20, default: 8 } as const;

export function clampIntensity(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : PATTERN_INTENSITY.default;
  return Math.min(PATTERN_INTENSITY.max, Math.max(PATTERN_INTENSITY.min, n));
}

export const PATTERN_SOURCES = ['none', 'library', 'upload'] as const;
export type PatternSource = (typeof PATTERN_SOURCES)[number];

interface PatternDef {
  id: string;
  label: string;
  /** Côté de la tuile en pixels CSS (largeur × hauteur). */
  w: number;
  h: number;
  /** Corps SVG ; `C` est remplacé par la couleur vérifiée. */
  body: string;
}

const STROKE = 'fill="none" stroke="C" stroke-width="1"';

const DEFS: readonly PatternDef[] = [
  { id: 'points', label: 'Points', w: 14, h: 14, body: '<circle cx="7" cy="7" r="1.4" fill="C"/>' },
  {
    id: 'diagonales',
    label: 'Diagonales',
    w: 14,
    h: 14,
    body: `<path d="M-1 15L15 -1M-1 1L1 -1M13 15L15 13" ${STROKE}/>`,
  },
  {
    id: 'quadrillage',
    label: 'Quadrillage',
    w: 22,
    h: 22,
    body: `<path d="M0 0.5H22M0.5 0V22" ${STROKE}/>`,
  },
  {
    id: 'losanges',
    label: 'Losanges',
    w: 24,
    h: 24,
    body: `<path d="M12 2L22 12L12 22L2 12Z" ${STROKE}/>`,
  },
  {
    id: 'vagues',
    label: 'Vagues',
    w: 40,
    h: 16,
    body: `<path d="M0 8C5 2 15 2 20 8S35 14 40 8" ${STROKE}/>`,
  },
  {
    id: 'hexagones',
    label: 'Nid d’abeille',
    w: 28,
    h: 48,
    body: `<path d="M14 0V8L0 16V32L14 40L28 32V16L14 8M14 40V48" ${STROKE}/>`,
  },
  {
    id: 'chevrons',
    label: 'Chevrons',
    w: 24,
    h: 14,
    body: `<path d="M0 10L6 4L12 10L18 4L24 10" ${STROKE}/>`,
  },
  {
    id: 'anneaux',
    label: 'Anneaux',
    w: 32,
    h: 32,
    body: `<circle cx="16" cy="16" r="9" ${STROKE}/><circle cx="0" cy="0" r="9" ${STROKE}/><circle cx="32" cy="0" r="9" ${STROKE}/><circle cx="0" cy="32" r="9" ${STROKE}/><circle cx="32" cy="32" r="9" ${STROKE}/>`,
  },
  {
    id: 'croix',
    label: 'Croix',
    w: 20,
    h: 20,
    body: `<path d="M10 6V14M6 10H14" ${STROKE}/>`,
  },
  {
    id: 'triangles',
    label: 'Triangles',
    w: 24,
    h: 21,
    body: `<path d="M0 21L12 0L24 21" ${STROKE}/>`,
  },
  {
    id: 'tissage',
    label: 'Tissage',
    w: 24,
    h: 24,
    body: `<path d="M2 3H10M2 6H10M2 9H10M15 2V10M18 2V10M21 2V10M3 14V22M6 14V22M9 14V22M14 15H22M14 18H22M14 21H22" ${STROKE}/>`,
  },
];

export interface BrandPatternInfo {
  id: string;
  label: string;
}

/** Bibliothèque de motifs fournie par Lalanda (ordre d'affichage). */
export const BRAND_PATTERNS: readonly BrandPatternInfo[] = DEFS.map((d) => ({
  id: d.id,
  label: d.label,
}));

export function isPatternId(v: unknown): v is string {
  return typeof v === 'string' && DEFS.some((d) => d.id === v);
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * SVG d'une tuile de la bibliothèque, dans la couleur demandée. Lève si
 * l'identifiant est inconnu ou la couleur hors du format `#rrggbb` : rien
 * d'autre qu'une constante du dépôt et une couleur vérifiée n'entre dans le SVG.
 */
export function patternSvg(id: string, color: string): string {
  const d = DEFS.find((x) => x.id === id);
  if (!d) throw new Error(`Motif inconnu : ${id}`);
  if (!HEX.test(color)) throw new Error('Couleur de motif attendue au format #rrggbb.');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">${d.body.replaceAll('"C"', `"${color}"`)}</svg>`;
}

/** Taille de la tuile (pixels CSS). */
export function patternTileSize(id: string): { w: number; h: number } {
  const d = DEFS.find((x) => x.id === id);
  if (!d) throw new Error(`Motif inconnu : ${id}`);
  return { w: d.w, h: d.h };
}

/**
 * URI `data:` d'une tuile (SVG encodé en pourcentage : ni guillemet, ni
 * parenthèse, utilisable tel quel dans `url("…")`).
 */
export function patternDataUri(id: string, color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(patternSvg(id, color)).replace(/[()']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

// ── Bornes des téléversements ──────────────────────────────────────────────

/** Favicon : PNG CARRÉ ; 512 × 512 conseillé (onglets, écrans d'accueil). */
export const FAVICON_LIMITS = {
  maxBytes: 512 * 1024,
  minDimension: 32,
  maxDimension: 1024,
  recommended: 512,
} as const;

/** Motif téléversé : PNG TRANSPARENT (RVBA ou niveaux de gris + alpha, 8 bits). */
export const PATTERN_IMAGE_LIMITS = {
  maxBytes: 1024 * 1024,
  minDimension: 64,
  maxDimension: 2048,
  recommended: 512,
  /** Part minimale de pixels non opaques : un fond plein n'est pas un motif. */
  minTransparentShare: 0.1,
} as const;

// ── Vue de l'écran ─────────────────────────────────────────────────────────

export interface BrandPatternSetting {
  source: PatternSource;
  /** Motif de la bibliothèque (`source: 'library'`). */
  libraryId: string | null;
  /** Opacité en %, `PATTERN_INTENSITY`. */
  intensity: number;
}

export const NO_PATTERN: BrandPatternSetting = {
  source: 'none',
  libraryId: null,
  intensity: PATTERN_INTENSITY.default,
};
