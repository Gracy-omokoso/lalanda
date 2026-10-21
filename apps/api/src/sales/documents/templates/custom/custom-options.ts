// Options d'un modèle sur mesure — ADR-0029 § 2.
//
// Mêmes options que les modèles intégrés (palette, accent, police intégrée),
// résolues par la même règle (`resolveOptions` : saisie, puis identité, puis
// défaut du manifeste) ; seule différence : un paquet peut restreindre les
// palettes proposées.

import { resolveOptions, type IdentityDefaults } from '../registry.js';
import type {
  Palette,
  TemplateFontChoice,
  TemplateOptions,
  TemplateOptionsInput,
} from '../template.contract.js';

export interface CustomOptionsSource {
  defaults: TemplateOptions;
  fontChoices: readonly TemplateFontChoice[];
  palettes: readonly Palette[];
}

export function resolveCustomOptions(
  template: CustomOptionsSource,
  input: TemplateOptionsInput | null,
  identity: IdentityDefaults,
): TemplateOptions {
  const resolved = resolveOptions(template, input, identity);
  return template.palettes.includes(resolved.palette)
    ? resolved
    : { ...resolved, palette: template.defaults.palette };
}
