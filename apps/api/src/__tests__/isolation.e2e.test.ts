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
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, teardown } from './e2e-utils.js';

import { e2eSuite, teardown } from './e2e-utils.js';

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

e2eSuite('isolation multi-tenant (brief §11 S4)', () => {
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
    await teardown(app, [userA.email, userB.email]);
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

  /**
   * (S16b) Ce test crée plusieurs projets dans l'org d'Alice ; le plan free est
   * limité à 1 projet depuis les entitlements. On passe l'org en `pro` (illimité)
   * via le service interne — l'isolation multi-tenant testée ici est indépendante
   * du plan. Les limites de plan ont leur propre suite : entitlements.e2e.test.ts.
   */
  async function upgradeActiveOrgToPro(cookies: string[]): Promise<void> {
    const orgs = await request(app.getHttpServer()).get('/organizations').set('Cookie', cookies);
    expect(orgs.status).toBe(200);
    const orgId: string = orgs.body.organizations[0].id;
    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'pro');
  }

  it("Alice s'inscrit, crée un projet, le voit dans /projects", async () => {
    const cookiesA = await registerAndLogin(userA);
    await upgradeActiveOrgToPro(cookiesA);

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

  // ─── S5c : multi-org ─────────────────────────────────────────────
  it('Alice crée une 2e org, ses projets restent scopés par org active (cookie)', async () => {
    const cookiesA = await registerAndLogin(userA);

    // Projet dans l'org auto-provisionnée
    const p1 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: 'Projet org 1', templateSlug: 'hello-world' });
    expect(p1.status).toBe(201);

    // Crée une 2e org
    const org2Res = await request(app.getHttpServer())
      .post('/organizations')
      .set('Cookie', cookiesA)
      .send({ name: `Second Workspace ${tag}` });
    expect(org2Res.status).toBe(201);
    const org2Id: string = org2Res.body.id;

    // Passe l'org active à org2 via cookie
    const cookiesWithActiveOrg = [...cookiesA, `active_org_id=${org2Id}`];

    // Liste des projets dans org2 → vide (P1 est dans org1)
    const listInOrg2 = await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', cookiesWithActiveOrg);
    expect(listInOrg2.status).toBe(200);
    expect(listInOrg2.body.projects.map((p: { id: string }) => p.id)).not.toContain(p1.body.id);

    // Crée un projet dans org2
    const p2 = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesWithActiveOrg)
      .send({ name: 'Projet org 2', templateSlug: 'hello-world' });
    expect(p2.status).toBe(201);
    expect(p2.body.organizationId).toBe(org2Id);

    // Retour à org1 (sans cookie active_org_id → fallback primary) → ne voit que P1
    const listInOrg1 = await request(app.getHttpServer()).get('/projects').set('Cookie', cookiesA);
    expect(listInOrg1.status).toBe(200);
    const ids1 = listInOrg1.body.projects.map((p: { id: string }) => p.id);
    expect(ids1).toContain(p1.body.id);
    expect(ids1).not.toContain(p2.body.id);
  }, 30_000);

  it("cookie active_org_id vers une org dont on n'est pas membre → fallback silencieux primary", async () => {
    const cookiesA = await registerAndLogin(userA);
    const cookiesB = await registerAndLogin(userB);

    // Récupère l'id de l'org primaire de Bob
    const bobOrgs = await request(app.getHttpServer())
      .get('/organizations')
      .set('Cookie', cookiesB);
    expect(bobOrgs.status).toBe(200);
    const bobOrgId: string = bobOrgs.body.organizations[0].id;

    // Alice tente de forcer l'org de Bob via cookie
    const cookiesAliceSpoof = [...cookiesA, `active_org_id=${bobOrgId}`];
    const list = await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', cookiesAliceSpoof);
    expect(list.status).toBe(200);
    // La liste ne contient que les projets de l'org d'Alice, jamais ceux de Bob.
    // (le guard ignore le cookie et retombe sur la primary org d'Alice)
    for (const p of list.body.projects as Array<{ organizationId: string }>) {
      expect(p.organizationId).not.toBe(bobOrgId);
    }
  }, 30_000);
});
