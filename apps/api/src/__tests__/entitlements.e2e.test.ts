// Tests e2e des entitlements (S16b) — l'API impose les limites promises par /pricing.
//
// Exigences testées :
// 1. Org free (défaut, sans document Subscription) : 1er projet OK, 2e refusé
//    403 { code: 'PLAN_LIMIT_PROJECTS', limit: 1 }.
// 2. Org passée en pro (via BillingService, interne — pas d'endpoint public) :
//    création illimitée (on en crée plusieurs).
// 3. GET /organizations/current/subscription : { plan, entitlements, usage.projects }.
//
// Même convention que isolation.e2e.test.ts : nécessite Mongo (skip sans MONGODB_URI).

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
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

e2eSuite('entitlements par plan (S16b)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userFree = {
    email: `free-${tag}@lalanda-test.local`,
    password: 'Passw0rd!free',
    name: 'Freddy Free',
  };
  const userPro = {
    email: `pro-${tag}@lalanda-test.local`,
    password: 'Passw0rd!pro',
    name: 'Paula Pro',
  };

  beforeAll(async () => {
    app = await makeApp();
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [userFree.email, userPro.email]);
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
    expect(res.status, `auth échouée : ${res.status}`).toBeLessThan(400);
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  it('org free : 1er projet OK, 2e refusé 403 PLAN_LIMIT_PROJECTS', async () => {
    const cookies = await registerAndLogin(userFree);

    const p1 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookies)
      .send({ name: `Projet free 1 ${tag}`, templateSlug: 'hello-world' });
    expect(p1.status).toBe(201);

    const p2 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookies)
      .send({ name: `Projet free 2 ${tag}`, templateSlug: 'hello-world' });
    expect(p2.status).toBe(403);
    expect(p2.body.code).toBe('PLAN_LIMIT_PROJECTS');
    expect(p2.body.limit).toBe(1);
    expect(p2.body.plan).toBe('free');
  }, 30_000);

  it('GET /organizations/current/subscription — plan free + usage', async () => {
    const cookies = await registerAndLogin(userFree);
    const res = await request(app.getHttpServer())
      .get('/organizations/current/subscription')
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.entitlements).toEqual({ maxProjects: 1, pdfWatermark: true });
    expect(res.body.usage.projects).toBe(1);
  }, 30_000);

  it('org passée en pro (service interne) : création au-delà de 1 projet', async () => {
    const cookies = await registerAndLogin(userPro);

    // Récupère l'org primaire de Paula puis la passe en pro via le service interne.
    const orgs = await request(app.getHttpServer()).get('/organizations').set('Cookie', cookies);
    expect(orgs.status).toBe(200);
    const orgId: string = orgs.body.organizations[0].id;

    const { BillingService } = await import('../billing/billing.service.js');
    const billing = app.get(BillingService);
    await billing.setPlan(orgId, 'pro');
    // Idempotence de l'upsert (docs/13 : transitions idempotentes).
    await billing.setPlan(orgId, 'pro');

    for (let i = 1; i <= 3; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Cookie', cookies)
        .send({ name: `Projet pro ${i} ${tag}`, templateSlug: 'hello-world' });
      expect(res.status, `projet pro n°${i} refusé : ${JSON.stringify(res.body)}`).toBe(201);
    }

    const sub = await request(app.getHttpServer())
      .get('/organizations/current/subscription')
      .set('Cookie', cookies);
    expect(sub.status).toBe(200);
    expect(sub.body.plan).toBe('pro');
    expect(sub.body.entitlements).toEqual({ maxProjects: null, pdfWatermark: false });
    expect(sub.body.usage.projects).toBe(3);
  }, 30_000);

  it('endpoint subscription : 401 sans session', async () => {
    const res = await request(app.getHttpServer()).get('/organizations/current/subscription');
    expect(res.status).toBe(401);
  });
});
