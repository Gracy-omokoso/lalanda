// Briques des tableaux de bord de l'espace Ventes (ADR-0067). Elles vivent désormais
// dans `@/components/tableau-de-bord/briques` (ADR-0071), communes à Ventes, Achats
// et Trésorerie ; ce fichier les réexporte pour que l'espace Ventes ne change pas.

export * from '@/components/tableau-de-bord/briques';
