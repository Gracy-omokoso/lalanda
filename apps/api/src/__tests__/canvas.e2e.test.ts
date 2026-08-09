// S18d — Business Model Canvas (docs/05, ADR-0011 contrat 4).
//
// Exigences testées :
// 1. GET sur un projet sans canvas → 9 blocs vides, version 0 (pas un 404).
// 2. PUT → CRUD complet des cartes, version incrémentée à chaque écriture.
// 3. zod refuse un bloc inconnu, un champ de carte inconnu, un texte > 500 car.
//    et plus de 20 cartes dans un bloc (400, aucune écriture).
// 3 bis. Un bloc OMIS est refusé : le PUT ne doit jamais effacer par omission.
// 4. GET /canvas/revisions est borné aux 20 dernières révisions, plus récentes
//    en premier, et la plus ancienne conservée suit bien la fenêtre glissante.
// 5. Isolation org : un user d'une autre org reçoit 404 sur toutes les routes.
//
// Même convention que plans.e2e.test.ts : nécessite MONGODB_URI, sinon skip.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, teardown } from './e2e-utils.js';

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

e2eSuite('Business Model Canvas (S18d — docs/05)', () => {
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
    await teardown(app, [userA.email, userB.email]);
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

    if (before.body?.version === undefined) {
      console.error(
        `DIAG-BEFORE status=${before.status} ct=${before.headers['content-type']} body=${JSON.stringify(before.body)} text=${String(before.text).slice(0, 400)}`,
      );
    }

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

  it('refuse un PUT partiel : un bloc omis n’efface jamais silencieusement', async () => {
    const server = app.getHttpServer();

    // État de départ : deux blocs peuplés.
    const seed = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          segments_clients: [{ id: 'seg1', texte: 'PME', ordre: 0 }],
          revenus: [{ id: 'rev1', texte: 'Abonnement', ordre: 0 }],
        }),
      );
    expect(seed.status).toBe(200);
    const versionAvant: number = seed.body.version;

    // Corps vide : autrefois accepté (defaults zod) — il remettait les 9 blocs
    // à vide en consommant une version ET une révision.
    const vide = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send({});
    expect(vide.status).toBe(400);
    expect(vide.body.code).toBe('INVALID_REQUEST');

    // Corps partiel : un seul bloc fourni, les huit autres omis.
    const partiel = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send({ segments_clients: [{ id: 'seg1', texte: 'PME', ordre: 0 }] });
    expect(partiel.status).toBe(400);

    // Rien n'a bougé : ni les données, ni la version (donc aucune révision).
    const apres = await request(server)
      .get(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA);
    expect(apres.body.version).toBe(versionAvant);
    expect(apres.body.blocs.segments_clients).toHaveLength(1);
    expect(apres.body.blocs.revenus).toHaveLength(1);

    // Vider un bloc reste possible — explicitement, avec un tableau vide.
    const videExplicite = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(body({ segments_clients: [{ id: 'seg1', texte: 'PME', ordre: 0 }] }));
    expect(videExplicite.status).toBe(200);
    expect(videExplicite.body.blocs.revenus).toEqual([]);
  }, 60_000);

  it('zod refuse un id de carte hors motif attendu', async () => {
    const res = await request(app.getHttpServer())
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(body({ canaux: [{ id: '__proto__', texte: 'Boutique', ordre: 0 }] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');

    // Un UUID (forme réellement produite par le client) reste accepté.
    const uuid = await request(app.getHttpServer())
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesA)
      .send(
        body({
          canaux: [{ id: '0f9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d', texte: 'Boutique', ordre: 0 }],
        }),
      );
    expect(uuid.status).toBe(200);
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

    // Corps malformé + projet hors scope : 404 (et pas 400, qui confirmerait
    // au passage l'existence du projet). Le scope est vérifié avant zod.
    const malforme = await request(server)
      .put(`/projects/${projectId}/canvas`)
      .set('Cookie', cookiesB)
      .send({ bloc_inconnu: 'nawak' });
    expect(malforme.status).toBe(404);

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
