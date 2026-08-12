// Tests e2e des entitlements (S16b) — l'API impose les limites promises par /pricing.
//
// Exigences testées :
// 1. Org free (défaut, sans document Subscription) : la création est autorisée
//    jusqu'à la limite de l'offre, refusée au-delà avec
//    403 { code: 'PLAN_LIMIT_PROJECTS', limit, plan }.
// 2. Org passée en pro (via BillingService, interne — pas d'endpoint public) :
//    la limite gratuite est levée, remplacée par celle de Pro.
// 3. GET /organizations/current/subscription : { plan, entitlements, usage.projects }.
//
// AUCUN MONTANT NI AUCUNE LIMITE N'EST ÉCRIT ICI. Toutes les valeurs attendues
// sont lues dans `PLAN_ENTITLEMENTS` (`@lalanda/shared/pricing`), la source de
// vérité unique. Un test qui recopierait la grille ne vérifierait plus que
// l'API sert la grille : il vérifierait que deux copies coïncident, et c'est
// exactement la duplication que le catalogue partagé a supprimée.
//
// Même convention que isolation.e2e.test.ts : nécessite Mongo (skip sans MONGODB_URI).

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { PLAN_ENTITLEMENTS } from '@lalanda/shared/pricing';

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

  /**
   * Limite de projets de l'offre gratuite, lue dans le catalogue.
   *
   * `null` signifierait « illimité » : la suite n'aurait alors plus rien à
   * mesurer et passerait au vert sans rien prouver. L'assertion ci-dessous rend
   * ce cas visible au lieu de le laisser vider le test en silence.
   */
  const limiteFree = PLAN_ENTITLEMENTS.free.maxProjects;

  it("org free : la création est refusée au-delà de la limite de l'offre", async () => {
    expect(
      limiteFree,
      "l'offre gratuite doit rester bornée pour que ce test mesure quelque chose",
    ).not.toBeNull();
    const cookies = await registerAndLogin(userFree);

    for (let i = 1; i <= limiteFree!; i += 1) {
      const ok = await request(app.getHttpServer())
        .post('/projects')
        .set('Cookie', cookies)
        .send({ name: `Projet free ${i} ${tag}`, templateSlug: 'hello-world' });
      expect(ok.status, `projet free n°${i} refusé : ${JSON.stringify(ok.body)}`).toBe(201);
    }

    const refuse = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookies)
      .send({ name: `Projet free ${limiteFree! + 1} ${tag}`, templateSlug: 'hello-world' });
    expect(refuse.status).toBe(403);
    expect(refuse.body.code).toBe('PLAN_LIMIT_PROJECTS');
    expect(refuse.body.limit).toBe(limiteFree);
    expect(refuse.body.plan).toBe('free');
  }, 30_000);

  it('GET /organizations/current/subscription — plan free + usage', async () => {
    const cookies = await registerAndLogin(userFree);
    const res = await request(app.getHttpServer())
      .get('/organizations/current/subscription')
      .set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    // TOUS les entitlements de l'offre, pas un extrait : un `toEqual` partiel
    // laisserait passer un champ oublié par l'API (quota IA, sièges, filigrane).
    expect(res.body.entitlements).toEqual(PLAN_ENTITLEMENTS.free);
    expect(res.body.usage.projects).toBe(limiteFree);
  }, 30_000);

  it('org passée en pro (service interne) : création au-delà de la limite gratuite', async () => {
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

    // Autant de projets que Pro en autorise — donc STRICTEMENT plus que l'offre
    // gratuite, ce qui est l'exigence mesurée ici. Si Pro devenait illimité, on
    // se contente de dépasser la limite gratuite : c'est la propriété testée.
    const projetsPro = PLAN_ENTITLEMENTS.pro.maxProjects ?? limiteFree! + 2;
    expect(projetsPro, 'Pro doit autoriser plus de projets que Free').toBeGreaterThan(limiteFree!);

    for (let i = 1; i <= projetsPro; i += 1) {
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
    expect(sub.body.entitlements).toEqual(PLAN_ENTITLEMENTS.pro);
    expect(sub.body.usage.projects).toBe(projetsPro);
  }, 30_000);

  it('endpoint subscription : 401 sans session', async () => {
    const res = await request(app.getHttpServer()).get('/organizations/current/subscription');
    expect(res.status).toBe(401);
  });
});
