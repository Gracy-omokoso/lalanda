// S16a — /evaluate n'est plus public : 401 sans session, 200 avec session.
// Couvre GET /evaluate/templates, GET /evaluate/templates/:slug et POST /evaluate.
//
// Comme isolation.e2e.test.ts : nécessite une vraie connexion Mongo (better-auth).
// Skippé si MONGODB_URI n'est pas défini — protège la CI sans Atlas.

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
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

const suite = hasMongo ? describe : describe.skip;

suite('auth sur /evaluate (S16a)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const user = {
    email: `eve-${tag}@lalanda-test.local`,
    password: 'Passw0rd!eve',
    name: 'Eve',
  };

  beforeAll(async () => {
    app = await makeApp();
  }, 60_000);

  afterAll(async () => {
    try {
      const db = mongoose.connection.db;
      if (db) {
        await Promise.all([
          db.collection('user').deleteMany({ email: user.email }),
          db.collection('session').deleteMany({}),
          db
            .collection('organizations')
            .deleteMany({ slug: { $regex: /^eve/ } })
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

  async function registerAndLogin(): Promise<string[]> {
    const server = app.getHttpServer();
    let res = await request(server)
      .post('/auth/sign-up/email')
      .send({ email: user.email, password: user.password, name: user.name });
    if (res.status >= 400) {
      res = await request(server)
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password });
    }
    expect(res.status, `sign-up + sign-in échoué : ${res.status}`).toBeLessThan(400);
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.length, 'aucun cookie de session émis').toBeGreaterThan(0);
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  it('sans session → 401 sur les trois routes', async () => {
    const server = app.getHttpServer();

    const list = await request(server).get('/evaluate/templates');
    expect(list.status).toBe(401);

    const one = await request(server).get('/evaluate/templates/hello-world');
    expect(one.status).toBe(401);

    const evalRes = await request(server)
      .post('/evaluate')
      .send({ templateSlug: 'hello-world', drivers: {} });
    expect(evalRes.status).toBe(401);
  }, 30_000);

  it('avec session → 200 (templates + évaluation)', async () => {
    const cookies = await registerAndLogin();
    const server = app.getHttpServer();

    const list = await request(server).get('/evaluate/templates').set('Cookie', cookies);
    expect(list.status).toBe(200);
    expect(list.body.slugs).toContain('hello-world');

    const one = await request(server)
      .get('/evaluate/templates/hello-world')
      .set('Cookie', cookies);
    expect(one.status).toBe(200);
    expect(one.body.template.slug).toBe('hello-world');

    const evalRes = await request(server)
      .post('/evaluate')
      .set('Cookie', cookies)
      .send({ templateSlug: 'hello-world', drivers: {} });
    expect([200, 201]).toContain(evalRes.status);
    expect(evalRes.body.templateSlug).toBe('hello-world');
  }, 30_000);
});
