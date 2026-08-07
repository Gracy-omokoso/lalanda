// S18d — Business Model Canvas (docs/05, ADR-0011 contrat 4).
//
// Exigences testées :
// 1. GET sur un projet sans canvas → 9 blocs vides, version 0 (pas un 404).
// 2. PUT → CRUD complet des cartes, version incrémentée à chaque écriture.
// 3. zod refuse un bloc inconnu, un champ de carte inconnu, un texte > 500 car.
//    et plus de 20 cartes dans un bloc (400, aucune écriture).
// 4. GET /canvas/revisions est borné aux 20 dernières révisions, plus récentes
//    en premier, et la plus ancienne conservée suit bien la fenêtre glissante.
// 5. Isolation org : un user d'une autre org reçoit 404 sur toutes les routes.
//
// Même convention que plans.e2e.test.ts : nécessite MONGODB_URI, sinon skip.

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

async function makeApp(): Promise<INestApplication> {
  const { AppModule } = await import('../app.module.js');
  const { getAuth } = await import('../auth/auth.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({
    origin: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
    credentials: true,
  });
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

const BLOCKS = [
  'segments_clients',
  'proposition_valeur',
  'canaux',
  'relations_clients',
  'revenus',
  'ressources_cles',
  'activites_cles',
  'partenaires_cles',
  'couts',
] as const;

/** Corps PUT complet : 9 blocs, seul `overrides` porte des cartes. */
function body(
  overrides: Partial<Record<(typeof BLOCKS)[number], unknown[]>> = {},
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const b of BLOCKS) out[b] = overrides[b] ?? [];
  return out;
}

const suite = hasMongo ? describe : describe.skip;

suite('Business Model Canvas (S18d — docs/05)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `canvasa-${tag}@lalanda-test.local`,
    password: 'Passw0rd!cana',
    name: 'CanvasAlice',
  };
  const userB = {
    email: `canvasb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!canb',
    name: 'CanvasBob',
  };

  let cookiesA: string[] = [];
  let projectId = '';

  beforeAll(async () => {
    app = await makeApp();
    cookiesA = await registerAndLogin(userA);
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: `Canvas ${tag}`, templateSlug: 'hello-world' });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  }, 60_000);

  afterAll(async () => {
    try {
      const db = mongoose.connection.db;
      if (db) {
        await Promise.all([
          db.collection('user').deleteMany({ email: { $in: [userA.email, userB.email] } }),
          db.collection('canvases').deleteMany({ projectId }),
          db.collection('canvas_revisions').deleteMany({ projectId }),
          db
            .collection('projects')
            .deleteMany({ name: { $regex: `${tag}$` } })
            .catch(() => {}),
          db
            .collection('organizations')
            .deleteMany({ slug: { $regex: /^canvasa|^canvasb/ } })
            .catch(() => {}),
        ]);
      }
    } catch {
      // Best-effort.
    }
    await app?.close();
  }, 30_000);

  async function registerAndLogin(user: {
    email: string;
    password: string;
    name: string;
  }): Promise<string[]> {
    const server = app.getHttpServer();
    let res = await request(server)
      .post('/auth/sign-up/email')
      .send({ email: user.email, password: user.password, name: user.name });
    if (res.status >= 400) {
      res = await request(server)
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password });
    }
    expect(res.status).toBeLessThan(400);
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  it('projet sans canvas : 9 blocs vides, version 0 (jamais 404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(0);
    expect(res.body.updatedAt).toBeNull();
    expect(Object.keys(res.body.blocs).sort()).toEqual([...BLOCKS].sort());
    for (const b of BLOCKS) expect(res.body.blocs[b]).toEqual([]);
  }, 30_000);

  it('CRUD des cartes : création, modification, suppression, version incrémentée', async () => {
    // Create.
    const create = await request(app.getHttpServer())
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          segments_clients: [
            { id: 'c1', texte: 'PME de Kinshasa', ordre: 0 },
            { id: 'c2', texte: 'ONG locales', ordre: 1 },
          ],
          revenus: [{ id: 'r1', texte: 'Abonnement mensuel', ordre: 0 }],
        }),
      );
    expect(create.status).toBe(200);
    expect(create.body.version).toBe(1);
    expect(create.body.blocs.segments_clients).toHaveLength(2);
    expect(create.body.updatedBy).toBeTruthy();

    // Read.
    const read = await request(app.getHttpServer())
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    expect(read.status).toBe(200);
    expect(read.body.version).toBe(1);
    expect(read.body.blocs.revenus[0].texte).toBe('Abonnement mensuel');

    // Update (texte) + delete (carte c2 retirée) — PUT = remplacement complet.
    const update = await request(app.getHttpServer())
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          segments_clients: [{ id: 'c1', texte: 'PME de Kinshasa et Lubumbashi', ordre: 0 }],
          revenus: [{ id: 'r1', texte: 'Abonnement mensuel', ordre: 0 }],
        }),
      );
    expect(update.status).toBe(200);
    expect(update.body.version).toBe(2);
    expect(update.body.blocs.segments_clients).toHaveLength(1);
    expect(update.body.blocs.segments_clients[0].texte).toBe('PME de Kinshasa et Lubumbashi');
  }, 30_000);

  it('zod refuse un bloc inconnu (400) et n’écrit rien', async () => {
    const before = await request(app.getHttpServer())
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);

    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send({ ...body(), bloc_inconnu: [{ id: 'x', texte: 'hop', ordre: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');

    const after = await request(app.getHttpServer())
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    expect(after.body.version).toBe(before.body.version);
  }, 30_000);

  it('zod refuse un champ de carte inconnu, un texte > 500 car. et > 20 cartes', async () => {
    const server = app.getHttpServer();

    const champInconnu = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(body({ canaux: [{ id: 'k1', texte: 'Boutique', ordre: 0, priorite: 'haute' }] }));
    expect(champInconnu.status).toBe(400);

    const tropLong = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(body({ canaux: [{ id: 'k1', texte: 'x'.repeat(501), ordre: 0 }] }));
    expect(tropLong.status).toBe(400);

    // 500 caractères pile passent — la borne est inclusive.
    const limite = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(body({ canaux: [{ id: 'k1', texte: 'x'.repeat(500), ordre: 0 }] }));
    expect(limite.status).toBe(200);

    const tropDeCartes = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          couts: Array.from({ length: 21 }, (_, i) => ({
            id: `co${i}`,
            texte: `Coût ${i}`,
            ordre: i,
          })),
        }),
      );
    expect(tropDeCartes.status).toBe(400);

    const idsDupliques = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          couts: [
            { id: 'same', texte: 'Loyer', ordre: 0 },
            { id: 'same', texte: 'Salaires', ordre: 1 },
          ],
        }),
      );
    expect(idsDupliques.status).toBe(400);
  }, 60_000);

  it('révisions bornées à 20, plus récentes en premier', async () => {
    const server = app.getHttpServer();

    // Amène le compteur bien au-delà de 20 révisions.
    for (let i = 0; i < 22; i += 1) {
      const res = await request(server)
        .put(`/projects/${projectId}/canvas`)
        .set('Cookie', cookiesA)
        .send(body({ activites_cles: [{ id: 'a1', texte: `Itération ${i}`, ordre: 0 }] }));
      expect(res.status).toBe(200);
    }

    const current = await request(server)
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    const latestVersion: number = current.body.version;

    const res = await request(server)
      .get(`/projects/${projectId}/canvas/revisions`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);

    const versions = (res.body.revisions as { version: number }[]).map((r) => r.version);
    expect(versions).toHaveLength(20);
    // Fenêtre glissante : exactement les 20 dernières versions, décroissantes.
    expect(versions).toEqual(
      Array.from({ length: 20 }, (_, i) => latestVersion - i).filter((v) => v > 0),
    );

    const first = res.body.revisions[0];
    expect(first.savedBy).toBeTruthy();
    expect(first.savedAt).toBeTruthy();
    expect(first.blocs.activites_cles[0].texte).toBe('Itération 21');
  }, 120_000);

  it('isolation org : un autre user reçoit 404 sur toutes les routes canvas', async () => {
    const cookiesB = await registerAndLogin(userB);
    const server = app.getHttpServer();

    const get = await request(server).get(`/projects/${projectId}/canvas`).set('Cookie', cookiesB);
    expect(get.status).toBe(404);
    expect(get.body.code).toBe('PROJECT_NOT_FOUND');

    const put = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesB)
      .send(body({ couts: [{ id: 'hack', texte: 'Injection', ordre: 0 }] }));
    expect(put.status).toBe(404);

    const revisions = await request(server)
      .get(`/projects/${projectId}/canvas/revisions`)
      .set('Cookie', cookiesB);
    expect(revisions.status).toBe(404);

    // Le canvas de A n'a pas été altéré par la tentative de B.
    const check = await request(server)
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    expect(check.body.blocs.couts).toEqual([]);
  }, 60_000);

  it('sans session : 401 sur toutes les routes canvas', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get(`/projects/${projectId}/canvas`)).status).toBe(401);
    expect((await request(server).put(`/projects/${projectId}/canvas`).send(body())).status).toBe(
      401,
    );
    expect((await request(server).get(`/projects/${projectId}/canvas/revisions`)).status).toBe(401);
  }, 30_000);
});
