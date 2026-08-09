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

/**
 * Quota des routes `/account/mfa/*` (S22h — docs/17 § Identité).
 *
 * 20 requêtes par 15 minutes et PAR UTILISATEUR. Le seau par IP cliente
 * (`ClientIpThrottlerGuard`, 100 req/min) protège l'API ; il ne protège pas un
 * compte précis, puisqu'un attaquant qui change d'IP obtient un seau neuf — c'est
 * la limite explicitement notée au finding F-03. Un seau par utilisateur, lui,
 * suit le compte visé quelle que soit l'origine des requêtes.
 *
 * L'ordre de grandeur vient de l'usage légitime : saisir un code, se tromper,
 * recommencer, éventuellement rentrer un code de secours — quelques essais, pas
 * vingt. À 20 essais par quart d'heure, deviner un code à six chiffres demande en
 * moyenne 500 000 essais, soit ~7 ans de tentatives ininterrompues, et le
 * verrouillage par compte après cinq échecs consécutifs
 * (`MFA_MAX_FAILED_ATTEMPTS`) intervient bien avant.
 *
 * Les deux mécanismes sont complémentaires et aucun ne remplace l'autre : ce
 * quota compte les REQUÊTES et est remis à zéro par le temps qui passe ; le
 * verrouillage compte les ÉCHECS CONSÉCUTIFS et est remis à zéro par un succès.
 */
export const MFA_VERIFY_THROTTLE = { ttl: 900_000, limit: 20 } as const;
