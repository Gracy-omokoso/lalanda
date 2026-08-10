// Validation des variables d'environnement. Brief §9-4 : refuser de démarrer si une variable manque.
// Utilisé par apps/api et apps/web (via un adapteur Next.js).

import { z } from 'zod';

const NodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

/** Schéma partagé — variables communes à tous les services. */
const CommonEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** Schéma API (NestJS) — voir apps/api. */
export const ApiEnvSchema = CommonEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),
  /** URL du front, utilisée pour whitelister CORS. */
  WEB_URL: z.string().url().default('http://localhost:3000'),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('lalanda'),

  // Requis à partir des exports asynchrones (files d'attente) — optionnel tant que
  // rien ne le consomme (S16a : aucun worker Redis en production).
  REDIS_URL: z.string().url().optional(),

  // Requis à partir des exports asynchrones (stockage des fichiers générés) —
  // optionnels tant que les rapports sont générés en streaming (S16a).
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET_EXPORTS: z.string().min(1).optional(),
  S3_BUCKET_SNAPSHOTS: z.string().min(1).optional(),
  S3_BUCKET_UPLOADS: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET doit faire au moins 32 caractères'),
  AUTH_URL: z.string().url(),
  /**
   * Vérification d'email bloquante à l'inscription (better-auth `requireEmailVerification`).
   * Défaut `false` en dev (aucun SMTP configuré) ; à passer à `true` en production
   * dès qu'un fournisseur d'envoi d'emails est branché (voir docs/17-SECURITE.md).
   * Parse strict : seul la chaîne littérale "true" active le flag (z.coerce.boolean
   * transformerait "false" en true — toute chaîne non vide est truthy).
   */
  AUTH_REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Domaine porté par le cookie de session (S22m). OPTIONNELLE.
   *
   * À renseigner UNIQUEMENT quand le front et l'API vivent sur deux hôtes
   * distincts d'un même domaine — en production, `lalanda.co` et
   * `api.lalanda.co`. La valeur est alors le domaine PARENT (`lalanda.co`),
   * pas l'hôte de l'API : c'est ce qui rend le cookie lisible par les deux.
   *
   * Absente, le cookie reste réservé à l'hôte qui l'émet. C'est le bon défaut
   * en développement, où front et API partagent `localhost`.
   *
   * Le renseigner à tort élargit la portée du cookie de session à tous les
   * sous-domaines : à ne poser que si l'architecture l'exige.
   */
  AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),

  /**
   * Connexion Google (ADR-0006, mise en œuvre S22a — ADR-0014).
   *
   * OPTIONNELLES, toutes les deux : sans elles l'API démarre normalement, le
   * bouton « Continuer avec Google » ne s'affiche pas, et la connexion par mot
   * de passe reste le seul chemin. Renseigner UNE SEULE des deux est en revanche
   * une configuration bancale — l'API le signale au démarrage et traite le cas
   * comme une absence (voir `resolveGoogleCredentials` dans apps/api).
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * Envoi d'emails transactionnels (S22a — ADR-0014).
   *
   * TOUTES OPTIONNELLES. Sans `SMTP_HOST`, aucun envoi n'a lieu : les messages
   * sont journalisés (destinataire et sujet, jamais le corps ni les jetons) et
   * les appels rapportent `delivered: false`. C'est un état NORMAL du produit en
   * développement — faire dépendre le démarrage d'un serveur de mail
   * transformerait une fonctionnalité optionnelle en point de panne global.
   *
   * `SMTP_USER` / `SMTP_PASSWORD` restent facultatifs même avec un hôte : un
   * relais interne ou un MailHog de développement n'authentifie personne.
   *
   * NOTE S21b — ces variables coexistent avec le fournisseur `smtp` du coffre
   * d'intégrations (ADR-0013). Elles configurent l'envoi transactionnel au
   * démarrage; le coffre vise la rotation sans redéploiement. Leur unification
   * relève du sprint de sortie de la migration, comme `OPENAI_API_KEY`.
   */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  /** Expéditeur affiché — `"Lalanda <no-reply@exemple.com>"` ou une simple adresse. */
  SMTP_FROM: z.string().min(1).optional(),

  /**
   * OPTIONNELLE depuis S21b (ADR-0013 § Conséquences).
   *
   * La clé OpenAI vit désormais dans la collection `integrations`, chiffrée. Cette
   * variable reste acceptée comme SECOURS pendant la migration (ADR-0013 option C,
   * « chemin de migration borné ») : `SecretsService` résout base d'abord,
   * environnement ensuite, et affiche la source effective dans `/admin`.
   *
   * À RETIRER au sprint de sortie de la migration. Tant qu'elle est là, elle peut
   * masquer une clé pourtant rotée en base — c'est exactement le risque que la
   * date de sortie existe pour borner.
   */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL_REASONING: z.string().default('gpt-4o'),
  OPENAI_MODEL_LITE: z.string().default('gpt-4o-mini'),

  // ─── Coffre des secrets d'intégration (S21b — ADR-0013 §2, §3, §8) ────────
  //
  // « Paradoxe d'amorçage : la clé qui protège le coffre ne peut pas être rangée
  // dans le coffre » (ADR-0013 §8). Ces quatre variables sont donc les seules du
  // dispositif à rester dans l'environnement, et elles doivent être sauvegardées
  // HORS LIGNE, séparément des sauvegardes de base — sans quoi la séparation
  // coffre/clé disparaît et le chiffrement ne protège plus de rien (§10).
  //
  // PERDRE `SECRETS_MASTER_KEY` rend les secrets définitivement irrécupérables.
  // Ce n'est pas une perte de données au sens propre : la copie faisant autorité
  // de chaque clé vit chez le fournisseur (console Stripe, OpenAI…) et la reprise
  // consiste à re-saisir les cinq secrets depuis `/admin`.

  /**
   * Clé maîtresse — 32 octets encodés en base64 (44 caractères).
   * Générer : `openssl rand -base64 32`.
   *
   * REQUISE : sans elle, aucun secret ne peut être ni lu ni écrit, et l'API
   * démarrerait dans un état où `/admin` accepte des saisies qu'elle ne peut pas
   * chiffrer. Le refus de démarrer est préférable à cette panne différée
   * (brief §9-4, ADR-0013 § Conséquences).
   */
  SECRETS_MASTER_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message:
      'SECRETS_MASTER_KEY doit décoder vers exactement 32 octets. ' +
      'Générer : openssl rand -base64 32',
  }),

  /** Identifiant court de la clé courante (`k1`, `k2`…) — pilote la rotation. */
  SECRETS_MASTER_KEY_ID: z.string().min(1).default('k1'),

  /**
   * Clé PRÉCÉDENTE, présente uniquement le temps d'une rotation (ADR-0013 §3).
   * Retirer après `secrets:rewrap` et vérification qu'aucun document ne porte
   * plus l'ancien `keyId`.
   */
  SECRETS_MASTER_KEY_PREVIOUS: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'SECRETS_MASTER_KEY_PREVIOUS doit décoder vers exactement 32 octets.',
    })
    .optional(),

  SECRETS_MASTER_KEY_PREVIOUS_ID: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

/** Schéma Web (Next.js) — uniquement les variables client (`NEXT_PUBLIC_*`) et runtime SSR. */
export const WebEnvSchema = CommonEnvSchema.extend({
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

/**
 * Retire les variables dont la valeur est une chaîne VIDE, pour qu'elles soient
 * traitées comme absentes.
 *
 * Pourquoi c'est nécessaire : dans un fichier `.env`, `SMTP_HOST=` est la façon
 * habituelle d'écrire « non configuré », et c'est exactement ce que fait
 * `.env.production.example`. Mais pour Zod, une chaîne vide est PRÉSENTE : un
 * `z.string().min(1).optional()` la refuse, et l'API sortait en `exit 1` au
 * démarrage. Autrement dit, suivre la procédure de déploiement documentée
 * empêchait le service de démarrer — sur SIX variables toutes facultatives
 * (Google, SMTP, OpenAI).
 *
 * La distinction absente / vide n'a aucun sens pour une variable d'environnement
 * facultative : les deux veulent dire la même chose. On la supprime ici, une
 * fois, plutôt que d'ajouter un `.or(z.literal(''))` sur chaque champ — qui
 * serait à réécrire à chaque nouvelle variable, donc oublié.
 *
 * Une variable OBLIGATOIRE laissée vide reste refusée : elle disparaît de
 * l'objet, et son absence est signalée comme telle.
 */
function withoutEmptyValues(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nettoye: NodeJS.ProcessEnv = {};
  for (const [cle, valeur] of Object.entries(raw)) {
    if (valeur !== '') nettoye[cle] = valeur;
  }
  return nettoye;
}

/**
 * Parse et valide un schéma d'env. Sort du process avec un message explicite si invalide.
 * À appeler au démarrage de chaque service (brief §9-4).
 */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, raw: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(withoutEmptyValues(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // On préfère un log direct + exit 1 plutôt que de lever une erreur silencieuse.
    // eslint-disable-next-line no-console
    console.error(`\n❌ Variables d'environnement invalides :\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}
