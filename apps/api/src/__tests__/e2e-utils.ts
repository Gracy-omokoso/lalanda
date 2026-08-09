// Outils partagés des suites e2e (S19a).
//
// Deux problèmes réglés ici, tous deux découverts en fin de batch S18 :
//
// 1. GARDE ANTI-SKIP. Les suites e2e se mettaient en `describe.skip` dès que
//    `MONGODB_URI` était absent. La CI ne fournissait pas Mongo : les suites ne
//    s'exécutaient JAMAIS et les jobs passaient au vert avec zéro couverture
//    d'intégration. `e2eSuite` conserve le skip confortable en local (un dev sans
//    docker compose peut lancer les unitaires) mais le REND IMPOSSIBLE dès que
//    `LALANDA_REQUIRE_E2E=1` : le module lève à la collecte, le fichier échoue,
//    le job rougit. Un job vert prouve donc que les e2e ont tourné.
//
// 2. NETTOYAGE INEFFECTIF. Les `afterAll` utilisaient `mongoose.connection`, la
//    connexion GLOBALE du driver — que personne n'ouvre ici. Nest ouvre la sienne
//    via `MongooseModule.forRootAsync`. `mongoose.connection.db` était donc
//    `undefined`, le `if (db)` sautait tout le bloc en silence et chaque exécution
//    laissait users, orgs, projets et snapshots derrière elle. `dbOf(app)` va
//    chercher la connexion réellement utilisée par l'application.

import type { INestApplication } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import type { Db, ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'vitest';

/** `.env` à la racine du monorepo — en CI les variables viennent du process. */
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
loadDotenv({ path: envPath });

export const hasMongo = Boolean(process.env['MONGODB_URI']);

/** Positionné par la CI : une suite e2e skippée devient une erreur. */
const requireE2E = process.env['LALANDA_REQUIRE_E2E'] === '1';

/**
 * `describe` d'une suite e2e nécessitant MongoDB.
 *
 * - `MONGODB_URI` présent → la suite tourne;
 * - absent et `LALANDA_REQUIRE_E2E=1` → throw (le fichier échoue, la CI rougit);
 * - absent sinon → skip (confort local documenté dans docs/18-TESTS.md).
 */
export function e2eSuite(name: string, fn: () => void): void {
  if (hasMongo) {
    describe(name, fn);
    return;
  }
  if (requireE2E) {
    throw new Error(
      `Suite e2e « ${name} » sur le point d'être skippée alors que LALANDA_REQUIRE_E2E=1.\n` +
        "MONGODB_URI est absent de l'environnement du process de test.\n" +
        "Cause fréquente : la variable n'est pas déclarée dans `globalEnv` de turbo.json — " +
        'Turborepo 2 tourne en envMode strict et ne transmet que les variables listées.',
    );
  }
  describe.skip(name, fn);
}

/**
 * Application Nest de test, montée comme `main.ts` (better-auth en middleware
 * Express, CORS identique).
 *
 * Chaque suite appelle cette fonction et obtient SA PROPRE instance — ce n'est
 * pas seulement de l'isolation de confort : le `ThrottlerGuard` global (100
 * req/min) garde son compteur en mémoire dans l'instance. Deux suites qui
 * partageraient une application partageraient aussi son quota, et la seconde
 * échouerait en 429 sans rapport avec ce qu'elle teste.
 */
export async function makeE2EApp(): Promise<INestApplication> {
  const { NestFactory } = await import('@nestjs/core');
  const { toNodeHandler } = await import('better-auth/node');
  const { AppModule } = await import('../app.module.js');
  const { getAuth } = await import('../auth/auth.js');

  // `rawBody` : voir main.ts — les rappels de paiement en dépendent (S22b).
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  app.enableCors({
    origin: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
    credentials: true,
  });
  // Doit correspondre au mount de main.ts (préserve req.url pour le basePath).
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

/**
 * Inscrit (ou reconnecte) un utilisateur de test et renvoie ses cookies de session.
 * Le repli sur `sign-in` sert aux suites qui rejouent un même utilisateur.
 */
export async function registerAndLogin(
  app: INestApplication,
  user: { email: string; password: string; name: string },
): Promise<string[]> {
  const { default: request } = await import('supertest');
  const server = app.getHttpServer();
  let res = await request(server)
    .post('/auth/sign-up/email')
    .send({ email: user.email, password: user.password, name: user.name });
  if (res.status >= 400) {
    res = await request(server)
      .post('/auth/sign-in/email')
      .send({ email: user.email, password: user.password });
  }
  if (res.status >= 400) {
    throw new Error(`Authentification impossible pour ${user.email} (${res.status})`);
  }
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.map((c: string) => c.split(';')[0]!);
}

/**
 * Base de données de la connexion Mongoose OUVERTE PAR NEST.
 *
 * Ne jamais lui substituer `mongoose.connection` : c'est la connexion globale du
 * driver, jamais ouverte par l'application, et tout nettoyage écrit dessus est
 * silencieusement perdu.
 */
export async function dbOf(app: INestApplication): Promise<Db> {
  const { getConnectionToken } = await import('@nestjs/mongoose');
  const connection = app.get<Connection>(getConnectionToken());
  const db = connection.db;
  if (!db) {
    throw new Error(
      "La connexion Mongoose de l'application n'expose pas de `db` — nettoyage e2e impossible.",
    );
  }
  return db;
}

/**
 * Collections applicatives portant toutes un `organizationId` : la purge d'une
 * organisation de test les vide intégralement pour cette org.
 */
const ORG_SCOPED_COLLECTIONS = [
  'projects',
  'financial_plans',
  'financial_objectives',
  'actual_periods',
  'canvases',
  'canvas_revisions',
  'subscriptions',
  'invitations',
  // S20a — le journal d'audit porte lui aussi un `organizationId`. Sans cette
  // ligne, chaque exécution laisserait derrière elle les traces d'export des
  // suites RBAC.
  'audit_events',
] as const;

/**
 * Supprime en cascade tout ce qu'une suite e2e a créé, à partir des SEULS emails
 * de ses utilisateurs de test : users → organisations → données applicatives.
 *
 * Pourquoi passer par une cascade plutôt que par des `deleteMany({})` :
 * vitest exécute les fichiers de test EN PARALLÈLE sur la même base. Les
 * anciens nettoyages vidaient `session`, `account`, `memberships`,
 * `subscriptions` et `invitations` sans filtre — inoffensif tant qu'ils
 * s'exécutaient sur une connexion morte (bug corrigé en S19a), mais destructeur
 * dès qu'ils écrivent vraiment : l'`afterAll` d'une suite terminée déconnecterait
 * les suites encore en cours. Tout est donc scopé par utilisateur et par
 * organisation.
 *
 * Attention aux types d'identifiants : better-auth stocke `session.userId` et
 * `account.userId` en ObjectId, tandis que `organizations.ownerId` et
 * `memberships.userId` sont des chaînes.
 */
export async function purgeTestUsers(db: Db, emails: string[]): Promise<void> {
  if (emails.length === 0) return;

  const users = await db
    .collection('user')
    .find({ email: { $in: emails } }, { projection: { _id: 1 } })
    .toArray();
  if (users.length === 0) return;

  const userObjectIds = users.map((u) => u._id as ObjectId);
  const userIds = userObjectIds.map(String);

  const ownedOrgs = await db
    .collection('organizations')
    .find({ ownerId: { $in: userIds } }, { projection: { _id: 1 } })
    .toArray();
  const memberships = await db
    .collection('memberships')
    .find({ userId: { $in: userIds } }, { projection: { organizationId: 1 } })
    .toArray();

  const orgObjectIds = ownedOrgs.map((o) => o._id as ObjectId);
  const orgIds = [
    ...new Set([
      ...orgObjectIds.map(String),
      ...memberships.map((m) => String(m['organizationId'])),
    ]),
  ];

  await Promise.all([
    ...ORG_SCOPED_COLLECTIONS.map((name) =>
      db.collection(name).deleteMany({ organizationId: { $in: orgIds } }),
    ),
    // Les invitations sont aussi indexées par email du destinataire : un invité
    // qui ne s'est jamais inscrit n'a ni user ni membership à remonter.
    db.collection('invitations').deleteMany({ email: { $in: emails } }),
    db.collection('session').deleteMany({ userId: { $in: userObjectIds } }),
    db.collection('account').deleteMany({ userId: { $in: userObjectIds } }),
    db.collection('memberships').deleteMany({ userId: { $in: userIds } }),
    // Collections de l'espace compte (S20b) : scopées par UTILISATEUR et non par
    // organisation, elles ne sont donc pas couvertes par ORG_SCOPED_COLLECTIONS.
    db.collection('user_preferences').deleteMany({ userId: { $in: userIds } }),
    db.collection('email_change_requests').deleteMany({ userId: { $in: userIds } }),
    // S22c — preuve d'acceptation des conditions, scopée par utilisateur elle aussi.
    db.collection('terms_acceptances').deleteMany({ userId: { $in: userIds } }),
  ]);

  await db.collection('organizations').deleteMany({ _id: { $in: orgObjectIds } });
  await db.collection('user').deleteMany({ _id: { $in: userObjectIds } });
}

/**
 * `afterAll` standard d'une suite e2e : purge les données de test puis ferme
 * l'application. La fermeture est dans un `finally` — un nettoyage qui échoue
 * doit être visible (il n'est plus avalé en « best-effort »), mais il ne doit
 * jamais laisser une connexion Mongo ouverte derrière lui.
 */
export async function teardown(app: INestApplication | undefined, emails: string[]): Promise<void> {
  try {
    if (app) await purgeTestUsers(await dbOf(app), emails);
  } finally {
    await app?.close();
  }
}
