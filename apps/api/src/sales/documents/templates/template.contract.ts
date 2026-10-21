// Contrat d'un modèle de facture — ADR-0028 § 3.
//
// Un MODÈLE change la présentation, JAMAIS le contenu. Il reçoit :
//   - `document` : le contenu imprimé, déjà décidé par `invoice-document.model.ts`
//     (intitulé, mentions DGI, montants figés, éléments de sécurité…), en
//     LECTURE SEULE ;
//   - `dgi` : les fragments IMPOSÉS par le moteur (bandeau de test, QR code tel
//     quel), à placer tels quels ;
//   - `brand` et `theme` : logos (déjà intégrés en `data:`), couleurs dérivées,
//     polices.
// Il rend du HTML (corps + CSS). Le moteur ajoute lui-même le filigrane, la CSP,
// les polices, l'en-tête et le pied répétés sur chaque page, puis VÉRIFIE que
// toutes les mentions du document figurent dans le HTML (`dgi-content.ts`) :
// un modèle qui en omettrait une ne s'imprime pas.
//
// C'est cette interface — entrée typée, sortie HTML, zone DGI imposée,
// vérification à chaque rendu — qui permettra plus tard des modèles écrits
// hors du dépôt (gabarit à variables, place de marché : docs/19, ADR-0028 § 9).
// Aujourd'hui, seuls les six modèles du dépôt existent.

import type { InvoiceDocumentModel } from '../invoice-document.model.js';
import type { BodyFontId, EditorialFontPair, FontId } from './invoice-fonts.js';

export const INVOICE_TEMPLATE_IDS = [
  'classique',
  'bandeau',
  'laterale',
  'minimal',
  'compacte',
  'editoriale',
] as const;
export type InvoiceTemplateId = (typeof INVOICE_TEMPLATE_IDS)[number];

export function isInvoiceTemplateId(v: unknown): v is InvoiceTemplateId {
  return typeof v === 'string' && (INVOICE_TEMPLATE_IDS as readonly string[]).includes(v);
}

/** `brand` : couleurs de la marque ; `mono` : noir et blanc (logo en niveaux de gris). */
export const PALETTES = ['brand', 'mono'] as const;
export type Palette = (typeof PALETTES)[number];

export type TemplateFontChoice = BodyFontId | EditorialFontPair;

/** `#rrggbb`, minuscules. */
export type HexColor = string;
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

export const LOGO_VARIANTS = ['primary', 'horizontal', 'symbol', 'light'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

export const LOGO_VARIANT_LABELS: Record<LogoVariant, string> = {
  primary: 'Logo principal',
  horizontal: 'Version horizontale',
  symbol: 'Symbole seul',
  light: 'Version claire (fond sombre)',
};

/** Options RÉSOLUES d'un modèle : ce qui est figé au gel. */
export interface TemplateOptions {
  palette: Palette;
  accent: HexColor;
  font: TemplateFontChoice;
}

/** Options saisies : `null` = suivre l'identité de l'organisation, puis le défaut du modèle. */
export interface TemplateOptionsInput {
  palette: Palette | null;
  accent: HexColor | null;
  font: TemplateFontChoice | null;
}

// ── Contenu figé au gel (ADR-0028 § 6) ───────────────────────────────────────

/** Logo désigné par un identifiant IMMUABLE et l'empreinte de ses octets. */
export interface FrozenLogoRef {
  assetId: string;
  sha256: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

/** Empreinte de l'identité visuelle au moment du gel. */
export interface FrozenIdentity {
  primaryColor: HexColor | null;
  secondaryColor: HexColor | null;
  font: BodyFontId | null;
  logos: Record<LogoVariant, FrozenLogoRef | null>;
}

/** Champ figé `presentation` d'une facture ; absent = présentation d'origine. */
export interface FrozenPresentation {
  template: { id: InvoiceTemplateId; version: string };
  options: TemplateOptions;
  identity: FrozenIdentity;
}

// ── Entrée d'un rendu ────────────────────────────────────────────────────────

export interface RenderLogo {
  /** `data:image/…;base64,…` — octets vérifiés contre l'empreinte figée. */
  dataUri: string;
  width: number;
  height: number;
}

export interface TemplateBrand {
  logos: Record<LogoVariant, RenderLogo | null>;
  /** Initiales du vendeur, à défaut de logo. */
  initials: string;
}

/** Couleurs et polices dérivées des options (`theme.ts`) : le modèle n'en calcule aucune. */
export interface TemplateTheme {
  mono: boolean;
  accent: HexColor;
  /** Texte lisible sur fond `accent` (contraste vérifié). */
  onAccent: HexColor;
  /** Teinte douce (fonds de tableau). */
  soft: HexColor;
  /** Teinte intermédiaire (filets). */
  line: HexColor;
  /** Fond de colonne de couleur (Latérale) et texte dessus. */
  side: HexColor;
  onSide: HexColor;
  /** `font-family` du texte, des titres, des codes DGI. */
  body: string;
  display: string;
  code: string;
  /** Familles à intégrer (`@font-face`). */
  fonts: readonly FontId[];
  /** Filtre CSS appliqué aux logos (noir et blanc). */
  logoFilter: string;
}

/** Fragments IMPOSÉS par le moteur : un modèle les place, il ne les réécrit pas. */
export interface DgiZone {
  /** Bandeau « Environnement de test DGI — sans valeur fiscale » (vide hors test). */
  testBand: string;
  /** Bandeau « exemple fictif » d'un aperçu (vide hors aperçu). */
  sampleBand: string;
  /** SVG du QR code, encodé tel que reçu de l'e-MCF (vide sans éléments de sécurité). */
  qrSvg: string;
}

export interface TemplateRenderInput {
  readonly document: Readonly<InvoiceDocumentModel>;
  readonly dgi: DgiZone;
  readonly brand: TemplateBrand;
  readonly theme: TemplateTheme;
  readonly options: TemplateOptions;
}

export interface TemplateRenderOutput {
  css: string;
  body: string;
}

export interface PageMargins {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

export interface InvoiceTemplate {
  readonly id: InvoiceTemplateId;
  /**
   * Version du rendu. Une version publiée ne change plus JAMAIS de rendu : une
   * facture gelée avec elle doit se réimprimer à l'identique. Modifier un
   * modèle, c'est en publier une nouvelle version (ADR-0028 § 4).
   */
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly defaults: TemplateOptions;
  readonly fontChoices: readonly TemplateFontChoice[];
  readonly page: PageMargins;
  render(input: TemplateRenderInput): TemplateRenderOutput;
}
