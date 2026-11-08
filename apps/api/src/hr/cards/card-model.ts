// Contenu imprimé d'une carte et couleurs dérivées — ADR-0069 § 4 et § 5.
//
// Fonctions PURES : la fiche, l'identité visuelle et les réglages entrent, une
// `CardData` (textes déjà mis en forme, images en `data:`) et un `CardTheme`
// (couleurs contrastées, polices) sortent. Les modèles ne calculent rien.

import type { CardVariant, CardKind } from '@lalanda/shared/hr';

import { inkSafe, readableOn, tint } from '../../branding/colors.js';
import {
  fontStack,
  isBodyFont,
  type BodyFontId,
  type FontId,
} from '../../sales/documents/templates/invoice-fonts.js';

/** Logo prêt au rendu (octets vérifiés, `data:`). */
export interface CardImage {
  dataUri: string;
  width: number;
  height: number;
}

export interface CardOrganization {
  name: string;
  initials: string;
  /** Logo principal (fond clair) et version claire (fond sombre), si fournis. */
  logo: CardImage | null;
  logoLight: CardImage | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  slogan: string | null;
}

export interface CardData {
  kind: CardKind;
  firstName: string;
  lastName: string;
  /** Nom d'usage + nom. */
  displayName: string;
  initials: string;
  jobTitle: string;
  department: string | null;
  employeeNumber: string | null;
  workEmail: string | null;
  workPhone: string | null;
  photo: CardImage | null;
  org: CardOrganization;
  /** SVG du QR de vérification (badge), sinon `null`. */
  verifyQrSvg: string | null;
  /** « lalanda.co/v ». */
  verifyLabel: string;
  /** Numéro d'émission (badge), sinon `null`. */
  serial: number | null;
  /** SVG du QR vCard (carte de visite), sinon `null`. */
  vcardQrSvg: string | null;
  /** Aperçu fictif : bandeau « EXEMPLE » posé par le moteur. */
  sample: boolean;
}

export interface CardIdentity {
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
}

export interface CardTheme {
  variant: CardVariant;
  /** Couleur de marque (fonds). */
  accent: string;
  onAccent: string;
  /** Accent lisible en texte sur blanc. */
  accentInk: string;
  /** Seconde couleur (filets, motifs). */
  second: string;
  onSecond: string;
  soft: string;
  line: string;
  /** Fond sombre et texte dessus (variante `inverse`, blocs pleins). */
  dark: string;
  onDark: string;
  ink: string;
  muted: string;
  paper: string;
  body: string;
  display: string;
  fonts: readonly FontId[];
  logoFilter: string;
}

const DEFAULT_ACCENT = '#1f4e79';
const HEX = /^#[0-9a-f]{6}$/;

function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Thème d'une carte. `displayFont` : police de titre propre au modèle (Fraunces
 * pour les compositions éditoriales), sinon la police de l'identité.
 */
export function cardThemeOf(
  identity: CardIdentity,
  variant: CardVariant,
  accentOverride: string | null,
  displayFont: FontId | null = null,
): CardTheme {
  const bodyFont: BodyFontId = isBodyFont(identity.font) ? identity.font : 'inter';
  const display: FontId = displayFont ?? bodyFont;
  const fonts: FontId[] = [bodyFont, display];
  const stacks = { body: fontStack(bodyFont), display: fontStack(display) };
  if (variant === 'mono') {
    return {
      variant,
      accent: '#111111',
      onAccent: '#ffffff',
      accentInk: '#111111',
      second: '#4b5563',
      onSecond: '#ffffff',
      soft: '#f3f4f6',
      line: '#d1d5db',
      dark: '#111111',
      onDark: '#ffffff',
      ink: '#111111',
      muted: '#4b5563',
      paper: '#ffffff',
      ...stacks,
      fonts,
      logoFilter: 'grayscale(1)',
    };
  }
  const base =
    accentOverride && HEX.test(accentOverride)
      ? accentOverride
      : identity.primaryColor && HEX.test(identity.primaryColor)
        ? identity.primaryColor
        : DEFAULT_ACCENT;
  const second =
    identity.secondaryColor && HEX.test(identity.secondaryColor) ? identity.secondaryColor : base;
  const dark = inkSafe(shade(base, 0.55));
  const t: CardTheme = {
    variant,
    accent: base,
    onAccent: readableOn(base),
    accentInk: inkSafe(base),
    second,
    onSecond: readableOn(second),
    soft: tint(second, 0.9),
    line: tint(base, 0.6),
    dark,
    onDark: readableOn(dark),
    ink: '#111827',
    muted: '#4b5563',
    paper: '#ffffff',
    ...stacks,
    fonts,
    logoFilter: 'none',
  };
  if (variant === 'inverse') {
    // Fond sombre de marque ; le blanc devient la couleur d'appui.
    return {
      ...t,
      paper: dark,
      ink: readableOn(dark),
      muted: readableOn(dark) === '#ffffff' ? '#e5e7eb' : '#374151',
      soft: shade(base, 0.45),
      line: tint(base, 0.35),
      accentInk: readableOn(dark),
    };
  }
  return t;
}

/** Initiales (deux lettres) d'un nom. */
export function initialsOf(name: string): string {
  const words = name
    .normalize('NFKC')
    .split(/[\s’'-]+/)
    .filter((w) => /\p{L}/u.test(w));
  const letters = words.slice(0, 2).map((w) => [...w.replace(/[^\p{L}]/gu, '')][0] ?? '');
  return letters.join('').toLocaleUpperCase('fr') || '·';
}

/** Taille de police d'un nom selon sa longueur (évite le débordement). */
export function fitSize(text: string, base: number, min: number, perChar: number, from: number) {
  const over = Math.max(0, [...text].length - from);
  return Math.max(min, Number((base - over * perChar).toFixed(2)));
}
