// Registre des vingt modèles Lalanda — ADR-0069 § 5.

import type { CardKind, CardTemplateSummary } from '@lalanda/shared/hr';

import { BADGE_TEMPLATES } from './badges.js';
import { BUSINESS_TEMPLATES } from './business.js';
import type { CardTemplateDef } from './parts.js';

export const BUILTIN_CARD_TEMPLATES: readonly CardTemplateDef[] = [
  ...BADGE_TEMPLATES,
  ...BUSINESS_TEMPLATES,
];

export const DEFAULT_CARD_TEMPLATE: Readonly<Record<CardKind, string>> = {
  badge: 'badge-h-bandeau',
  business: 'visite-h-classique',
};

export function builtinCardTemplate(id: string): CardTemplateDef | null {
  return BUILTIN_CARD_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function summaryOf(t: CardTemplateDef): CardTemplateSummary {
  return {
    id: t.id,
    kind: t.kind,
    orientation: t.orientation,
    name: t.name,
    description: t.description,
    version: t.version,
    source: 'lalanda',
  };
}
