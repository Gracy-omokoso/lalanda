// Factory de l'instance better-auth. ADR-0006.
// Une seule instance partagée par tout le process (utilisée par le middleware express
// et par les guards pour extraire la session).

import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient, type Db } from 'mongodb';

import type { OrganizationsService } from '../organizations/organizations.service.js';

let cachedAuth: ReturnType<typeof betterAuth> | null = null;

interface BuildAuthOptions {
  mongodbUri: string;
  mongodbDb: string;
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
  /**
   * S16a : vérification d'email bloquante à la connexion (better-auth).
   * Piloté par AUTH_REQUIRE_EMAIL_VERIFICATION (défaut false en dev — aucun SMTP
   * branché ; à activer en production dès qu'un fournisseur d'envoi existe).
   */
  requireEmailVerification?: boolean;
  /**
   * Callback invoqué APRÈS la création d'un user (better-auth `databaseHooks.user.create.after`).
   * Utilisé pour auto-provisionner l'organisation personnelle + membership owner.
   */
  onUserCreated?: (user: { id: string; email: string; name?: string | null }) => Promise<void>;
}

export async function buildAuth(opts: BuildAuthOptions): Promise<ReturnType<typeof betterAuth>> {
  if (cachedAuth) return cachedAuth;

  const client = new MongoClient(opts.mongodbUri);
  await client.connect();
  const db: Db = client.db(opts.mongodbDb);

  // Cast : better-auth expose des types stricts sur `database` qui conflictent avec
  // ses adapters officiels selon la version (peer zod v3 vs v4 dans better-call).
  // On garde l'API typée en runtime via la factory `betterAuth`.
  const instance = betterAuth({
    database: mongodbAdapter(db),
    baseURL: opts.baseUrl,
    basePath: '/auth', // aligne avec le mount Express dans main.ts (`.all('/auth/*', …)`)
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      // S16a : bloquant seulement si AUTH_REQUIRE_EMAIL_VERIFICATION=true (prod avec SMTP).
      // Défaut false : aucun fournisseur d'envoi d'email n'est branché (ADR SMTP à venir).
      requireEmailVerification: opts.requireEmailVerification ?? false,
      autoSignIn: true,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; name?: string | null }) => {
            if (opts.onUserCreated) {
              await opts.onUserCreated({
                id: String(user.id),
                email: user.email,
                name: user.name ?? null,
              });
            }
          },
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  cachedAuth = instance;
  return instance;
}

/**
 * Utilitaire : à appeler UNIQUEMENT depuis un contexte où buildAuth a déjà tourné.
 * Sinon lève. Utilisé dans les guards pour éviter de re-connecter à Mongo à chaque requête.
 */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (!cachedAuth) {
    throw new Error(
      'Auth non initialisée. buildAuth() doit être appelé au démarrage (voir AuthModule).',
    );
  }
  return cachedAuth;
}

/**
 * Bridge : signature attendue par la factory pour brancher les hooks post-signup.
 * L'implémentation concrète vit dans AuthModule.
 */
export type UserCreatedHook = NonNullable<BuildAuthOptions['onUserCreated']>;
export type { OrganizationsService };
