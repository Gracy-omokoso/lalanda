// Configuration IA — ADR-0008 (OpenAI).
// L'IA propose ; elle ne calcule jamais. Brief §11 S10 + §12.

export interface AiModels {
  /** Raisonnement : proposition de drivers, rédaction mémo. */
  reasoning: string;
  /** Tâches légères : reformulation, aide contextuelle courte. */
  lite: string;
}

/** Modèles par défaut, surchargeables par variables d'environnement. */
export const DEFAULT_MODELS: AiModels = {
  reasoning: 'gpt-4o',
  lite: 'gpt-4o-mini',
};

/**
 * Marqueur d'origine appliqué à toute valeur suggérée par l'IA.
 * Doit être stocké dans le driver et affiché dans l'UI (icône, tooltip).
 */
export const AI_ORIGIN_MARKER = 'ai' as const;

/**
 * Garde-fou : toute écriture d'un montant financier vérifiée par cette fonction
 * doit prouver que la valeur ne vient pas d'un LLM. Utilisée dans les tests
 * du moteur pour empêcher toute régression.
 */
export function assertNotFromAi<T>(value: T, origin: string | undefined): T {
  if (origin === AI_ORIGIN_MARKER) {
    throw new Error(
      "Interdit : une valeur d'origine IA ne peut jamais être consommée par le moteur financier (brief §12).",
    );
  }
  return value;
}
