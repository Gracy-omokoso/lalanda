// Factory de l'instance better-auth. ADR-0006, ADR-0014.
// Une seule instance partagée par tout le process (utilisée par le middleware express
// et par les guards pour extraire la session).

import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { MongoClient, type Db } from 'mongodb';

import { passwordResetUrl, signupVerificationUrl } from '../mail/mail.links.js';
import type { MailService } from '../mail/mail.service.js';
import type { OrganizationsService } from '../organizations/organizations.service.js';

let cachedAuth: ReturnType<typeof betterAuth> | null = null;

/**
 * Validité d'un lien de réinitialisation de mot de passe (S22a).
 *
 * 30 minutes, et non les 60 par défaut de better-auth : ce lien vaut une prise
 * de contrôle complète du compte pour qui l'intercepte, et une boîte email
 * consultée sur un poste partagé garde ses messages bien plus longtemps que le
 * temps nécessaire pour cliquer. 30 minutes reste confortable pour quelqu'un qui
 * relève son courrier dans la foulée ; au-delà, redemander un lien coûte un clic.
 */
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

/**
 * Validité d'un lien de vérification d'adresse. 24 h : contrairement au lien de
 * réinitialisation, il ne donne accès à rien — il atteste seulement qu'une boîte
 * est relevée par son propriétaire. Un email lu le lendemain doit encore marcher.
 */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/** Identifiants d'une application OAuth Google. Voir ADR-0014 pour l'obtention. */
export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Google configuré, ou `null`.
 *
 * FONCTION PURE, EXPORTÉE POUR ÊTRE TESTÉE. La règle « les deux variables ou
 * rien » n'est pas cosmétique : un `clientId` seul produit, au premier clic sur
 * le bouton, une exception `CLIENT_ID_AND_SECRET_REQUIRED` levée au fond de
 * better-auth — une panne à l'usage là où l'absence des deux ne fait
 * qu'escamoter un bouton. On refuse donc la demi-configuration en la traitant
 * comme une absence, et l'appelant la signale (voir `buildAuth`).
 */
export function resolveGoogleCredentials(
  env: Record<string, string | undefined>,
): GoogleCredentials | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Vrai si UNE SEULE des deux variables Google est renseignée (configuration bancale). */
export function isPartialGoogleConfig(env: Record<string, string | undefined>): boolean {
  const hasId = Boolean(env['GOOGLE_CLIENT_ID']?.trim());
  const hasSecret = Boolean(env['GOOGLE_CLIENT_SECRET']?.trim());
  return hasId !== hasSecret;
}

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
  /**
   * Envoi des emails d'authentification (S22a). OBLIGATOIRE : sans lui,
   * better-auth refuserait la route de réinitialisation avec
   * `RESET_PASSWORD_DISABLED`. L'implémentation par défaut se replie sur un log
   * serveur quand aucun SMTP n'est configuré — l'absence de SMTP n'empêche donc
   * pas le démarrage, mais l'absence de service d'envoi, elle, serait un bug.
   */
  mail: MailService;
  /** Identifiants Google, ou `null` : le fournisseur social n'est alors pas déclaré. */
  google?: GoogleCredentials | null;
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
      requireEmailVerification: opts.requireEmailVerification ?? false,
      autoSignIn: true,

      // ── Mot de passe oublié (S22a) ──────────────────────────────────────────
      // Le flux repose sur better-auth et NON sur une implémentation maison :
      // c'est lui qui possède l'algorithme de hachage de la collection `account`.
      // Réécrire la pose du nouveau mot de passe reviendrait à dupliquer — puis à
      // désynchroniser — la politique de hachage, exactement le genre de
      // divergence qui ne se voit qu'au moment où plus personne ne peut se
      // connecter. Ce qu'il garantit et que nous n'aurions pas à réécrire :
      //   • jeton à USAGE UNIQUE (`consumeVerificationValue` le supprime en le lisant);
      //   • expiration côté serveur, réglée ci-dessous;
      //   • AUCUNE ÉNUMÉRATION : `/request-password-reset` répond la même chose
      //     pour une adresse inconnue, et simule même la génération de jeton et la
      //     lecture en base pour ne pas se trahir par le temps de réponse.
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_SECONDS,
      // Un mot de passe réinitialisé signifie souvent « quelqu'un d'autre avait
      // accès ». Laisser vivre les sessions ouvertes ailleurs laisserait cet
      // accès intact : le changement de mot de passe ne servirait à rien.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async (data: {
        user: { email: string; name?: string };
        token: string;
      }) => {
        await opts.mail.sendPasswordReset({
          to: data.user.email,
          // On ignore l'URL fournie par better-auth (elle pointe vers un endpoint
          // API qui redirige) : le destinataire doit atterrir directement sur la
          // page web de saisie du nouveau mot de passe.
          url: passwordResetUrl(data.token),
          name: data.user.name ?? null,
          expiresInMinutes: PASSWORD_RESET_TTL_SECONDS / 60,
        });
      },
    },

    // ── Vérification d'adresse (S22a) ─────────────────────────────────────────
    // Envoyée à l'inscription. Non bloquante par défaut : c'est
    // AUTH_REQUIRE_EMAIL_VERIFICATION qui décide si une adresse non vérifiée
    // interdit la connexion. Séparer les deux permet d'activer l'envoi bien avant
    // de durcir la connexion, sans enfermer dehors les comptes déjà créés.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: EMAIL_VERIFICATION_TTL_SECONDS,
      sendVerificationEmail: async (data: {
        user: { email: string; name?: string };
        token: string;
      }) => {
        await opts.mail.sendEmailVerification({
          to: data.user.email,
          url: signupVerificationUrl(data.token),
          name: data.user.name ?? null,
          isEmailChange: false,
          expiresInHours: EMAIL_VERIFICATION_TTL_SECONDS / 3600,
        });
      },
    },

    // ── Connexion Google (ADR-0006, mise en œuvre S22a) ───────────────────────
    // Déclaré seulement si les deux identifiants existent : `socialProviders: {}`
    // laisse l'API démarrer normalement et `/sign-in/social` répondre 404
    // PROVIDER_NOT_FOUND — aucun crash au bootstrap.
    socialProviders: opts.google
      ? {
          google: {
            clientId: opts.google.clientId,
            clientSecret: opts.google.clientSecret,
            // Force le sélecteur de compte Google. Sans ça, un poste partagé
            // reconnecte silencieusement la dernière session Google du navigateur :
            // l'utilisateur croit se connecter, il entre dans le compte du collègue.
            prompt: 'select_account',
          },
        }
      : {},

    account: {
      // ── LIAISON DE COMPTES ────────────────────────────────────────────────
      // Cas visé : quelqu'un s'inscrit par mot de passe, revient plus tard par
      // « Continuer avec Google » avec LA MÊME adresse. Sans liaison, better-auth
      // refuse la connexion (`account not linked`) — la personne se retrouve
      // dehors avec une adresse qui « existe déjà », sans comprendre pourquoi.
      //
      // La configuration ci-dessous est écrite pour être lue avec le code de
      // better-auth (`oauth2/link-account.ts`), qui refuse la liaison si :
      //     (!fournisseurDeConfiance && !emailVérifiéParLeFournisseur)
      //  || (requireLocalEmailVerified && !emailVérifiéLocalement)
      //  || accountLinking désactivé
      //
      //  • `trustedProviders: []` — VOLONTAIREMENT VIDE, ce n'est pas un oubli.
      //    Inscrire "google" ici court-circuiterait la première condition et
      //    lierait le compte même si Google annonçait `email_verified: false`.
      //    En le laissant vide, on exige que Google atteste lui-même que
      //    l'adresse lui appartient. C'est la preuve de propriété sur laquelle
      //    repose toute la liaison.
      //
      //  • `requireLocalEmailVerified: false` — c'est le point qui mérite d'être
      //    discuté, pas subi. Avec la valeur par défaut (`true`), la liaison
      //    exigerait que le compte local soit DÉJÀ vérifié. Or ce produit
      //    fonctionne sans SMTP configuré (mode documenté, docs/17) : dans cette
      //    situation, aucun compte n'est jamais vérifié et la liaison ne
      //    fonctionnerait pour personne — l'utilisateur légitime serait
      //    définitivement enfermé dehors sur sa propre adresse.
      //    Le risque encouru est connu : un attaquant qui pré-enregistre un
      //    compte mot de passe à l'adresse d'une victime avant elle capte la
      //    liaison Google et partage l'accès. La parade n'est pas de refuser la
      //    liaison — elle est d'empêcher un compte non vérifié d'exister utilement :
      //    AUTH_REQUIRE_EMAIL_VERIFICATION=true en production, ce que S22a rend
      //    enfin possible en branchant l'envoi. Voir ADR-0014 § Risque accepté.
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: false,
      },
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
