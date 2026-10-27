// Catalogue des modèles de facture et résolution des options — ADR-0028 § 3, § 4.
//
// Chaque modèle garde TOUTES ses versions publiées : une facture gelée avec
// `bandeau@1.0.0` se réimprime avec `bandeau@1.0.0`, même quand `1.1.0` existe.
// Le choix d'une organisation pointe toujours la dernière version.

import { BANDEAU, BANDEAU_1_0_0 } from './bandeau.js';
import { CLASSIQUE, CLASSIQUE_1_0_0 } from './classique.js';
import { COMPACTE, COMPACTE_1_0_0 } from './compacte.js';
import { EDITORIALE, EDITORIALE_1_0_0 } from './editoriale.js';
import { FONTS, isBodyFont, type BodyFontId, type FontId } from './invoice-fonts.js';
import { LATERALE, LATERALE_1_0_0 } from './laterale.js';
import { MINIMAL, MINIMAL_1_0_0 } from './minimal.js';
import {
  INVOICE_TEMPLATE_IDS,
  PALETTES,
  type HexColor,
  type InvoiceTemplate,
  type InvoiceTemplateId,
  type Palette,
  type TemplateFontChoice,
  type TemplateOptions,
  type TemplateOptionsInput,
} from './template.contract.js';

/** Versions publiées, de la plus ancienne à la plus récente. Ne jamais en retirer. */
// 1.1.0 (21 oct. 2026) : ligne « Total HT » (ADR-0028, décision ouverte n° 1).
const VERSIONS: Readonly<Record<InvoiceTemplateId, readonly InvoiceTemplate[]>> = {
  classique: [CLASSIQUE_1_0_0, CLASSIQUE],
  bandeau: [BANDEAU_1_0_0, BANDEAU],
  laterale: [LATERALE_1_0_0, LATERALE],
  minimal: [MINIMAL_1_0_0, MINIMAL],
  compacte: [COMPACTE_1_0_0, COMPACTE],
  editoriale: [EDITORIALE_1_0_0, EDITORIALE],
};

export function latestTemplate(id: InvoiceTemplateId): InvoiceTemplate {
  const all = VERSIONS[id];
  return all[all.length - 1]!;
}

/** Version EXACTE d'un modèle, ou `null` si elle n'existe pas (document illisible). */
export function templateAt(id: string, version: string): InvoiceTemplate | null {
  if (!(INVOICE_TEMPLATE_IDS as readonly string[]).includes(id)) return null;
  return VERSIONS[id as InvoiceTemplateId].find((t) => t.version === version) ?? null;
}

export function allTemplates(): InvoiceTemplate[] {
  return INVOICE_TEMPLATE_IDS.map(latestTemplate);
}

/** Identité utile à la résolution des options (couleur et police de la marque). */
export interface IdentityDefaults {
  primaryColor: HexColor | null;
  font: BodyFontId | null;
}

/**
 * Options RÉSOLUES : la saisie de l'organisation, sinon son identité, sinon le
 * défaut du modèle. Ce résultat est ce qui se fige (aucune valeur « suivre »
 * n'entre dans une facture gelée).
 */
export function resolveOptions(
  template: Pick<InvoiceTemplate, 'defaults' | 'fontChoices'>,
  input: TemplateOptionsInput | null,
  identity: IdentityDefaults,
): TemplateOptions {
  const palette: Palette = input?.palette ?? template.defaults.palette;
  const accent: HexColor = input?.accent ?? identity.primaryColor ?? template.defaults.accent;
  const choices = template.fontChoices as readonly string[];
  const font: TemplateFontChoice =
    input?.font && choices.includes(input.font)
      ? input.font
      : identity.font && choices.includes(identity.font)
        ? identity.font
        : template.defaults.font;
  return { palette, accent, font };
}

/** La police demandée est-elle proposée par ce modèle ? */
export function fontAllowed(template: Pick<InvoiceTemplate, 'fontChoices'>, font: string): boolean {
  return (template.fontChoices as readonly string[]).includes(font);
}

function fontChoiceLabel(choice: TemplateFontChoice): string {
  if (isBodyFont(choice)) return FONTS[choice].label;
  return choice
    .split('+')
    .map((id) => FONTS[id as FontId].label)
    .join(' + ');
}

export interface InvoiceTemplateCatalogEntry {
  id: InvoiceTemplateId;
  version: string;
  label: string;
  description: string;
  defaults: TemplateOptions;
  palettes: readonly Palette[];
  fonts: { id: TemplateFontChoice; label: string }[];
  /** Couleurs d'accent suggérées par la maquette. */
  accentSuggestions: HexColor[];
}

const ACCENT_SUGGESTIONS: Record<InvoiceTemplateId, HexColor[]> = {
  classique: ['#0f5132', '#1d4ed8', '#9a3412', '#6d28d9'],
  bandeau: ['#1d4ed8', '#0f5132', '#9a3412', '#6d28d9'],
  laterale: ['#7c2d12', '#0f5132', '#1d4ed8', '#6d28d9'],
  minimal: ['#0f5132', '#1d4ed8', '#9a3412', '#6d28d9'],
  compacte: ['#334155', '#0f5132', '#1d4ed8', '#9a3412'],
  editoriale: ['#7f1d1d', '#14532d', '#1e3a8a', '#78350f'],
};

export function templateCatalog(): InvoiceTemplateCatalogEntry[] {
  return allTemplates().map((t) => ({
    id: t.id,
    version: t.version,
    label: t.label,
    description: t.description,
    defaults: t.defaults,
    palettes: PALETTES,
    fonts: t.fontChoices.map((id) => ({ id, label: fontChoiceLabel(id) })),
    accentSuggestions: ACCENT_SUGGESTIONS[t.id],
  }));
}
