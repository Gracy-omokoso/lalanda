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
  /**
   * Scénarios maximum par projet. `null` = illimité.
   *
   * Valeurs reprises TELLES QUELLES de la page tarifs
   * (`pricing-model.ts` — « 1 scénario » en Free, « Jusqu'à 3 scénarios par
   * projet » en Pro et Business) et d'AUCUNE autre source. `docs/13-PRICING.md`
   * décrit encore quatre packs avec des mentions qualitatives
   * (« limité / plusieurs / avancé ») : la page publique fait foi parce qu'elle
   * est publiée, divergence déjà documentée (ADR-0015 § Contradictions 4).
   *
   * Que Business ne promette pas plus que Pro est une anomalie COMMERCIALE, pas
   * technique — remontée telle quelle au décideur (ADR-0015 § Décisions
   * ouvertes n°1). L'API applique la promesse en ligne ; elle ne la corrige pas.
   */
  maxScenariosPerProject: number | null;
  /** Sièges inclus (membres de l'organisation). Absent = non contractuel à ce stade. */
  seats?: number;
}

export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, Entitlements>> = {
  // Free — « 1 projet », « 1 scénario », « Export PDF avec filigrane » (page /pricing).
  free: { maxProjects: 1, maxScenariosPerProject: 1, pdfWatermark: true },
  // Pro — « Projets illimités », « Jusqu'à 3 scénarios par projet », « PDF sans filigrane ».
  pro: { maxProjects: null, maxScenariosPerProject: 3, pdfWatermark: false },
  // Business — tout Pro + « 20 sièges inclus ». Même plafond de scénarios que Pro :
  // c'est ce que la page annonce, et l'API n'invente pas une promesse plus large.
  business: { maxProjects: null, maxScenariosPerProject: 3, pdfWatermark: false, seats: 20 },
};
