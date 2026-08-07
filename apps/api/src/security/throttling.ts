// Constantes de rate limiting (S16a, docs/17-SECURITE.md + ADR-0008).
// Centralisées ici pour être consommées par le module ET testées sans démarrer Nest.

/** Limite globale par IP — protège toute l'API contre les abus basiques. */
export const GLOBAL_THROTTLE = { ttl: 60_000, limit: 100 } as const;

/**
 * Quota strict sur POST /ai/corrective-actions — endpoint facturé (OpenAI, ADR-0008).
 * Appliqué deux fois : par IP (guard global) ET par utilisateur (UserThrottlerGuard).
 */
export const AI_THROTTLE = { ttl: 60_000, limit: 10 } as const;
