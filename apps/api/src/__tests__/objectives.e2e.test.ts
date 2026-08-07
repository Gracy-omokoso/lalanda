// S18d — objectifs financiers et taux d'atteinte (docs/01, ADR-0011 contrat 4).
//
// Exigences testées :
// 1. GET/PUT des cibles (remplacement complet : une cible absente est effacée).
// 2. zod refuse une clé inconnue et une cible négative.
// 3. 409 NO_APPROVED_PLAN tant qu'aucun plan n'est validé.
// 4. Cas chiffré : plan validé seedé, cible = 2 × valeur du snapshot → atteinte 50 %,
//    cible = valeur exacte → 100 % / « atteint ».
// 5. Ligne absente du snapshot (`ca_annuel_5`, horizon 3 ans) → atteinte null
//    + raison LIGNE_INDISPONIBLE — jamais 0 (ADR-0011, risque n°4).
// 6. Isolation org : un user d'une autre org reçoit 404 sur toutes les routes.
//
// Le taux est calculé contre des IDS DE LIGNES du snapshot, jamais contre des
// valeurs moteur en dur (ADR-0011 contrat 1) : les attentes chiffrées sont
// dérivées de la valeur lue dans le plan validé.

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

interface AttainmentItem {
  objectif: string;
  cible: number;
  lineId: string | null;
  valeur: number | null;
  atteinte: number | null;
  statut: string;
  raison: string | null;
}

const suite = hasMongo ? describe : describe.skip;

suite('objectifs financiers et taux d’atteinte (S18d — docs/01)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `obja-${tag}@lalanda-test.local`,
    password: 'Passw0rd!obja',
    name: 'ObjAlice',
  };
  const userB = {
    email: `objb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!objb',
    name: 'ObjBob',
  };

  let cookiesA: string[] = [];
  let projectId = '';
  /** Valeur de `ca_annuel_1` figée dans le plan validé v1 — base des cas chiffrés. */
  let caAnnuel1 = 0;

  beforeAll(async () => {
    app = await makeApp();
    cookiesA = await registerAndLogin(userA);
    // Template sectoriel : il expose la feuille `projection` (ca_annuel_1..3),
    // contrairement au template de démo `hello-world`.
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: `Objectifs ${tag}`, templateSlug: 'prestation-services' });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  }, 60_000);

  afterAll(async () => {
    try {
      const db = mongoose.connection.db;
      if (db) {
        await Promise.all([
          db.collection('user').deleteMany({ email: { $in: [userA.email, userB.email] } }),
          db.collection('financial_objectives').deleteMany({ projectId }),
          db.collection('financial_plans').deleteMany({ projectId }),
          db
            .collection('projects')
            .deleteMany({ name: { $regex: `${tag}$` } })
            .catch(() => {}),
          db
            .collection('organizations')
            .deleteMany({ slug: { $regex: /^obja|^objb/ } })
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

  it('projet sans objectifs : toutes les cibles absentes (pas un 404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.ca_cible_an1).toBeUndefined();
    expect(res.body.updatedAt).toBeNull();
  }, 30_000);

  it('PUT = remplacement complet : une cible absente est effacée', async () => {
    const server = app.getHttpServer();

    const put1 = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 500_000, resultat_net_cible_an1: 80_000 });
    expect(put1.status).toBe(200);
    expect(put1.body.ca_cible_an1).toBe(500_000);
    expect(put1.body.resultat_net_cible_an1).toBe(80_000);

    const put2 = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 600_000 });
    expect(put2.status).toBe(200);
    expect(put2.body.ca_cible_an1).toBe(600_000);
    expect(put2.body.resultat_net_cible_an1).toBeUndefined();

    const read = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(read.body.ca_cible_an1).toBe(600_000);
    expect(read.body.resultat_net_cible_an1).toBeUndefined();
  }, 30_000);

  it('zod refuse une clé inconnue et une cible négative', async () => {
    const server = app.getHttpServer();

    const inconnue = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 1000, objectif_fantaisie: 42 });
    expect(inconnue.status).toBe(400);
    expect(inconnue.body.code).toBe('INVALID_REQUEST');

    const negative = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: -1 });
    expect(negative.status).toBe(400);
  }, 30_000);

  it('sans plan validé : 409 NO_APPROVED_PLAN', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_APPROVED_PLAN');
  }, 30_000);

  it('cas chiffré : plan validé seedé → atteinte 50 % puis 100 %', async () => {
    const server = app.getHttpServer();

    // Seed : fige la version courante en plan validé v1.
    const approve = await request(server)
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA)
      .send({});
    expect(approve.status).toBe(201);
    expect(approve.body.version).toBe(1);

    // Valeur observée de référence, lue dans le SNAPSHOT (pas recalculée).
    const lines = approve.body.result.lines as { lineId: string; value: number }[];
    const ligne = lines.find((l) => l.lineId === 'ca_annuel_1');
    expect(ligne).toBeDefined();
    caAnnuel1 = ligne!.value;
    expect(caAnnuel1).toBeGreaterThan(0);

    // Cible = 2 × valeur observée → 50 %, statut « non atteint » (< 80 %).
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1 * 2 });

    const moitie = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(moitie.status).toBe(200);
    expect(moitie.body.source).toBe('plan_valide');
    expect(moitie.body.planVersion).toBe(1);
    expect(moitie.body.planApprovedAt).toBeTruthy();

    const ca = (moitie.body.objectifs as AttainmentItem[]).find(
      (o) => o.objectif === 'ca_cible_an1',
    );
    expect(ca).toMatchObject({
      lineId: 'ca_annuel_1',
      valeur: caAnnuel1,
      atteinte: 50,
      statut: 'non_atteint',
      raison: null,
    });

    // Cible = valeur observée exacte → 100 %, statut « atteint ».
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1 });

    const pile = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    const caPile = (pile.body.objectifs as AttainmentItem[]).find(
      (o) => o.objectif === 'ca_cible_an1',
    );
    expect(caPile?.atteinte).toBe(100);
    expect(caPile?.statut).toBe('atteint');
  }, 60_000);

  it('ligne absente du snapshot → atteinte null + LIGNE_INDISPONIBLE (jamais 0)', async () => {
    const server = app.getHttpServer();

    // Les templates S6–S14 projettent 3 exercices : `ca_annuel_5` n'existe pas
    // encore (il arrivera avec FIN-001). L'objectif à 5 ans doit dégrader
    // proprement, sans faire échouer l'objectif à 1 an du même appel.
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1, ca_cible_an5: 9_000_000 });

    const res = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);

    const objectifs = res.body.objectifs as AttainmentItem[];
    const an5 = objectifs.find((o) => o.objectif === 'ca_cible_an5');
    expect(an5).toMatchObject({
      cible: 9_000_000,
      lineId: null,
      valeur: null,
      atteinte: null,
      statut: 'indisponible',
      raison: 'LIGNE_INDISPONIBLE',
    });
    expect(an5?.atteinte).not.toBe(0);

    // L'objectif mesurable reste évalué normalement.
    expect(objectifs.find((o) => o.objectif === 'ca_cible_an1')?.atteinte).toBe(100);
  }, 60_000);

  it('isolation org : un autre user reçoit 404 sur toutes les routes objectifs', async () => {
    const cookiesB = await registerAndLogin(userB);
    const server = app.getHttpServer();

    const get = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesB);
    expect(get.status).toBe(404);
    expect(get.body.code).toBe('PROJECT_NOT_FOUND');

    const put = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesB)
      .send({ ca_cible_an1: 1 });
    expect(put.status).toBe(404);

    // 404 (projet hors scope) prime sur le 409 métier : aucune fuite d'information.
    const attainment = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesB);
    expect(attainment.status).toBe(404);

    // La cible de A n'a pas été écrasée par la tentative de B.
    const check = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(check.body.ca_cible_an1).toBe(caAnnuel1);
  }, 60_000);

  it('sans session : 401 sur toutes les routes objectifs', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get(`/projects/${projectId}/objectives`)).status).toBe(401);
    expect((await request(server).put(`/projects/${projectId}/objectives`).send({})).status).toBe(
      401,
    );
    expect((await request(server).get(`/projects/${projectId}/objectives/attainment`)).status).toBe(
      401,
    );
  }, 30_000);
});
