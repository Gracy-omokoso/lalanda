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
 * Quota des appels qui SOLLICITENT LA DGI (ADR-0021 §10) : test de connexion d'un
 * point de vente e-MCF et lecture des listes de référence.
 *
 * 30 par heure et par utilisateur. Plus large que l'écriture d'intégration, parce
 * qu'un test se rejoue légitimement (jeton tout juste activé à la DGI, panne
 * passagère) sans rien écrire. Mais borné : chaque appel part vers un service de
 * l'État avec le jeton du contribuable, et un clic répété en boucle ne doit pas
 * faire de Lalanda la source d'un afflux sur l'e-DEF.
 */
export const EDEF_TEST_THROTTLE = { ttl: 3_600_000, limit: 30 } as const;

/**
 * Quota de la NORMALISATION des factures (ADR-0024 § 6) : `normalize`,
 * `normalization/retry` et `normalization/check`.
 *
 * 60 par heure et par utilisateur. Chaque appel peut solliciter la DGI (jusqu'à
 * quatre échanges) avec le jeton du contribuable ; une caisse active normalise
 * rarement plus d'une facture par minute et par personne. La décision de
 * réessayer reste humaine : ce plafond borne un clic répété, pas l'activité.
 */
export const INVOICE_NORMALIZE_THROTTLE = { ttl: 3_600_000, limit: 60 } as const;

/**
 * Plafond de la NORMALISATION par ORGANISATION (ADR-0024 § 6, amendement du
 * 21 oct. 2026) : 60 envois à la DGI par heure, `normalize` et
 * `normalization/retry` confondus, tous utilisateurs de l'organisation réunis.
 * Borne ce que Lalanda envoie à l'e-DEF pour un même contribuable, même si
 * plusieurs personnes cliquent en même temps. Voir `normalization-throttler.guard.ts`.
 */
export const INVOICE_NORMALIZE_ORG_THROTTLE = { ttl: 3_600_000, limit: 60 } as const;

/**
 * Envoi d'un document de vente par e-mail (ADR-0042 § 6) : 20 par heure et par
 * UTILISATEUR, seau commun aux factures et aux devis. Borne l'usage du domaine
 * d'envoi pour du pourriel sans gêner une facturation normale.
 */
export const DOCUMENT_EMAIL_USER_THROTTLE = { ttl: 3_600_000, limit: 20 } as const;

/** Même envoi, 100 par heure et par ORGANISATION, tous membres réunis. */
export const DOCUMENT_EMAIL_ORG_THROTTLE = { ttl: 3_600_000, limit: 100 } as const;
