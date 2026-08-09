// Constantes de rate limiting (S16a, docs/17-SECURITE.md + ADR-0008).
// Centralisées ici pour être consommées par le module ET testées sans démarrer Nest.

/** Limite globale par IP — protège toute l'API contre les abus basiques. */
export const GLOBAL_THROTTLE = { ttl: 60_000, limit: 100 } as const;

/**
 * Quota strict sur POST /ai/corrective-actions — endpoint facturé (OpenAI, ADR-0008).
 * Appliqué deux fois : par IP (guard global) ET par utilisateur (UserThrottlerGuard).
 */
export const AI_THROTTLE = { ttl: 60_000, limit: 10 } as const;

/**
 * Quota d'ÉCRITURE sur `/admin/integrations/*` (S21b — ADR-0013 §5).
 *
 * 10 écritures par heure et par utilisateur, « plus strict que le global
 * 100 req/min ». La fenêtre est volontairement longue : un quota par minute ne
 * gênerait pas un attaquant patient détenant une session de super-administrateur,
 * alors qu'il n'existe aucun usage légitime qui remplace plus de dix secrets dans
 * l'heure. La lecture n'est pas comptée — consulter `/admin` ne consomme rien.
 */
export const INTEGRATION_WRITE_THROTTLE = { ttl: 3_600_000, limit: 10 } as const;
