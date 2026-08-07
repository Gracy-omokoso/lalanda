// Catalogue des entitlements par plan (S16b).
//
// Source de vérité de la promesse publique : la page tarifs
// `apps/web/src/app/(marketing)/pricing/page.tsx` (Free / Pro / Business).
// NB : docs/13-PRICING.md décrit encore 4 packs (Starter/Pro/Business/Enterprise) —
// divergence documentée dans la section « Implémenté (S16b) » de ce même doc.
//
// Règle CLAUDE.md/docs/13 : « L'interface peut expliquer une limite, mais l'API
// l'impose. » — ce catalogue est consommé côté API uniquement.

export type Plan = 'free' | 'pro' | 'business';

export const PLANS: readonly Plan[] = ['free', 'pro', 'business'] as const;

export interface Entitlements {
  /** Nombre maximal de projets par organisation. `null` = illimité. */
  maxProjects: number | null;
  /** Filigrane « offre gratuite » sur les exports PDF. */
  pdfWatermark: boolean;
  /** Sièges inclus (membres de l'organisation). Absent = non contractuel à ce stade. */
  seats?: number;
}

export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = {
  // Free — « 1 projet », « Export PDF avec filigrane » (page /pricing).
  free: { maxProjects: 1, pdfWatermark: true },
  // Pro — « Projets illimités », « Export PDF sans filigrane ».
  pro: { maxProjects: null, pdfWatermark: false },
  // Business — tout Pro + « 20 sièges inclus ».
  business: { maxProjects: null, pdfWatermark: false, seats: 20 },
};
