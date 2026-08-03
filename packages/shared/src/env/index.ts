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

  REDIS_URL: z.string().url(),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_EXPORTS: z.string().min(1),
  S3_BUCKET_SNAPSHOTS: z.string().min(1),
  S3_BUCKET_UPLOADS: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET doit faire au moins 32 caractères'),
  AUTH_URL: z.string().url(),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_REASONING: z.string().default('gpt-4o'),
  OPENAI_MODEL_LITE: z.string().default('gpt-4o-mini'),
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
 * Parse et valide un schéma d'env. Sort du process avec un message explicite si invalide.
 * À appeler au démarrage de chaque service (brief §9-4).
 */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, raw: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(raw);
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
