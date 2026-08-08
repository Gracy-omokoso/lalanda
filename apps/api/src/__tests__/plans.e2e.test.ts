// S16c — FIN-003 : plan financier validé, figé et versionné.
//
// Exigences testées :
// 1. POST /projects/:id/plans fige v1 (status approved, empreinte, snapshot complet).
// 2. Re-valider sans changement → 409 { code: 'PLAN_UNCHANGED' } (aucune v2 créée).
// 3. Modifier un driver puis valider → v2 approved, v1 passe à superseded.
// 4. Le snapshot de v1 est IMMUABLE : après modification du driver, le détail v1
//    et l'export ?planVersion=1 (xlsx) reflètent toujours les valeurs d'origine.
// 5. Isolation org : un user d'une autre org reçoit 404 sur tous les endpoints plans.
//
// Même convention que isolation.e2e.test.ts : nécessite MONGODB_URI, sinon skip.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, teardown } from './e2e-utils.js';

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

e2eSuite('plans validés figés et versionnés (S16c — FIN-003)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `plana-${tag}@lalanda-test.local`,
    password: 'Passw0rd!plana',
    name: 'PlanAlice',
  };
  const userB = {
    email: `planb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!planb',
    name: 'PlanBob',
  };

  let cookiesA: string[] = [];
  let projectId = '';

  beforeAll(async () => {
    app = await makeApp();
    cookiesA = await registerAndLogin(userA);
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({
        name: `Plan figé ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10 },
      });
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

  it('valide v1 : snapshot figé, empreinte, statut approved', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
    expect(res.body.status).toBe('approved');
    expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.engineVersion).toBeTruthy();
    expect(res.body.templateSlug).toBe('hello-world');
    expect(res.body.driverValues.prix_unitaire).toBe(10);
    expect(res.body.result.lines.length).toBeGreaterThan(0);
    expect(res.body.approvedAt).toBeTruthy();
  }, 30_000);

  it('re-valider sans changement → 409 PLAN_UNCHANGED, pas de v2', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_UNCHANGED');

    const list = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA);
    expect(list.status).toBe(200);
    expect(list.body.plans).toHaveLength(1);
  }, 30_000);

  it('driver modifié → v2 approved et v1 superseded ; v1 reste figée', async () => {
    // Modifie un driver persisté.
    const upd = await request(app.getHttpServer())
      .post(`/projects/${projectId}/drivers`)
      .set('Cookie', cookiesA)
      .send({ driverValues: { prix_unitaire: 25 } });
    expect(upd.status).toBe(201);

    const v2 = await request(app.getHttpServer())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA)
      .send({});
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.status).toBe('approved');
    expect(v2.body.driverValues.prix_unitaire).toBe(25);

    const list = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA);
    expect(list.status).toBe(200);
    expect(list.body.plans).toHaveLength(2);
    const byVersion = Object.fromEntries(
      (list.body.plans as { version: number; status: string }[]).map((p) => [p.version, p.status]),
    );
    expect(byVersion[1]).toBe('superseded');
    expect(byVersion[2]).toBe('approved');

    // Détail v1 : le snapshot n'a pas bougé malgré le nouveau driver.
    const detail1 = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans/1`)
      .set('Cookie', cookiesA);
    expect(detail1.status).toBe(200);
    expect(detail1.body.driverValues.prix_unitaire).toBe(10);
    expect(detail1.body.status).toBe('superseded');
  }, 30_000);

  it('export xlsx ?planVersion=1 : repart du snapshot, pas des drivers courants', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/report/xlsx?planVersion=1`)
      .set('Cookie', cookiesA)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('-v1.xlsx');

    // La feuille Hypothèses doit contenir la valeur FIGÉE (10), pas la courante (25).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as Buffer);
    const hyp = wb.getWorksheet('Hypothèses');
    expect(hyp).toBeDefined();
    const values: number[] = [];
    hyp!.eachRow((row) => {
      const v = row.getCell(2).value;
      if (typeof v === 'number') values.push(v);
    });
    expect(values).toContain(10);
    expect(values).not.toContain(25);
  }, 30_000);

  it('planVersion inconnu → 404, planVersion invalide → 400', async () => {
    const notFound = await request(app.getHttpServer())
      .get(`/projects/${projectId}/report/xlsx?planVersion=99`)
      .set('Cookie', cookiesA);
    expect(notFound.status).toBe(404);

    const invalid = await request(app.getHttpServer())
      .get(`/projects/${projectId}/report/xlsx?planVersion=abc`)
      .set('Cookie', cookiesA);
    expect(invalid.status).toBe(400);
  }, 30_000);

  it('isolation org : un autre user reçoit 404 sur les endpoints plans', async () => {
    const cookiesB = await registerAndLogin(userB);

    const post = await request(app.getHttpServer())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesB)
      .send({});
    expect(post.status).toBe(404);
    expect(post.body.code).toBe('PROJECT_NOT_FOUND');

    const list = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesB);
    expect(list.status).toBe(404);

    const detail = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans/1`)
      .set('Cookie', cookiesB);
    expect(detail.status).toBe(404);

    const exportRes = await request(app.getHttpServer())
      .get(`/projects/${projectId}/report/xlsx?planVersion=1`)
      .set('Cookie', cookiesB);
    expect(exportRes.status).toBe(404);
  }, 30_000);
});
