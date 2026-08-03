// Test critique du brief §11 S4 : « deux utilisateurs de deux organisations
// ne voient jamais les données de l'autre ». Sans ce test vert, le sprint échoue.
//
// Exigences testées :
// 1. Un user peut s'inscrire et se voit auto-provisionner une organisation.
// 2. Un user peut créer un projet dans sa propre org.
// 3. Un autre user (autre org) ne voit AUCUN projet de la première org (GET /projects).
// 4. Un autre user ne peut PAS lire un projet précis d'une autre org (GET /projects/:id → 404).
// 5. Un autre user ne peut PAS évaluer un projet d'une autre org (POST /projects/:id/evaluate → 404).
//
// Ce test nécessite une vraie connexion Mongo (Atlas ou local). Il est skippé si
// MONGODB_URI n'est pas défini — protège la CI qui n'aurait pas encore Atlas configuré.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import 'reflect-metadata';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
loadDotenv({ path: envPath });

const hasMongo = Boolean(process.env['MONGODB_URI']);

// Import différé — évite de charger better-auth (qui essaie de se connecter) si on skip.
async function makeApp(): Promise<INestApplication> {
  const { AppModule } = await import('../app.module.js');
  const { getAuth } = await import('../auth/auth.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({
    origin: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
    credentials: true,
  });
  // Doit correspondre au mount de main.ts (préserve req.url pour better-auth basePath).
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

const suite = hasMongo ? describe : describe.skip;

suite('isolation multi-tenant (brief §11 S4)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `alice-${tag}@lalanda-test.local`,
    password: 'Passw0rd!alice',
    name: 'Alice',
  };
  const userB = {
    email: `bob-${tag}@lalanda-test.local`,
    password: 'Passw0rd!bob',
    name: 'Bob',
  };

  beforeAll(async () => {
    app = await makeApp();
  }, 60_000);

  afterAll(async () => {
    // Nettoyage : supprime les documents de test créés (garde la DB Atlas propre).
    try {
      const db = mongoose.connection.db;
      if (db) {
        await Promise.all([
          db.collection('user').deleteMany({ email: { $in: [userA.email, userB.email] } }),
          db.collection('session').deleteMany({}),
          db.collection('account').deleteMany({}),
          db
            .collection('projects')
            .deleteMany({ createdBy: { $exists: true } })
            .catch(() => {}),
          db
            .collection('organizations')
            .deleteMany({
              ownerId: { $exists: true },
              slug: { $regex: /^alice|^bob/ },
            })
            .catch(() => {}),
          db
            .collection('memberships')
            .deleteMany({})
            .catch(() => {}),
        ]);
      }
    } catch {
      // Best-effort — pas critique.
    }
    await app?.close();
  }, 30_000);

  async function registerAndLogin(user: {
    email: string;
    password: string;
    name: string;
  }): Promise<string[]> {
    const server = app.getHttpServer();
    // Tente d'abord sign-up ; si le user existe déjà (deuxième `it` dans le même run),
    // on tombe en fallback sur sign-in pour récupérer une session fraîche.
    let res = await request(server)
      .post('/auth/sign-up/email')
      .send({ email: user.email, password: user.password, name: user.name });
    if (res.status >= 400) {
      res = await request(server)
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password });
    }
    expect(
      res.status,
      `sign-up + sign-in échoué : ${res.status} ${JSON.stringify(res.body)}`,
    ).toBeLessThan(400);

    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.length, 'aucun cookie de session émis').toBeGreaterThan(0);
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  it("Alice s'inscrit, crée un projet, le voit dans /projects", async () => {
    const cookiesA = await registerAndLogin(userA);

    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: 'Plan resto Alice', templateSlug: 'hello-world' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Plan resto Alice');
    expect(created.body.organizationId).toBeDefined();

    const list = await request(app.getHttpServer()).get('/projects').set('Cookie', cookiesA);
    expect(list.status).toBe(200);
    expect(list.body.projects).toHaveLength(1);
    expect(list.body.projects[0].id).toBe(created.body.id);
  }, 30_000);

  it("Bob s'inscrit et ne voit AUCUN projet d'Alice", async () => {
    const cookiesB = await registerAndLogin(userB);

    const list = await request(app.getHttpServer()).get('/projects').set('Cookie', cookiesB);
    expect(list.status).toBe(200);
    expect(list.body.projects).toEqual([]);
  }, 30_000);

  it("Bob ne peut ni lire ni évaluer un projet d'Alice (404, pas 403)", async () => {
    const cookiesA = await registerAndLogin(userA);
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: 'Projet secret Alice', templateSlug: 'hello-world' });
    const projectId: string = created.body.id;
    expect(projectId).toBeDefined();

    const cookiesB = await registerAndLogin(userB);

    const read = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Cookie', cookiesB);
    expect(read.status).toBe(404);
    expect(read.body.code).toBe('PROJECT_NOT_FOUND');

    const evalRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/evaluate`)
      .set('Cookie', cookiesB)
      .send({});
    expect(evalRes.status).toBe(404);
    expect(evalRes.body.code).toBe('PROJECT_NOT_FOUND');
  }, 30_000);

  it('un utilisateur non authentifié reçoit 401', async () => {
    const list = await request(app.getHttpServer()).get('/projects');
    expect(list.status).toBe(401);
  });
});
