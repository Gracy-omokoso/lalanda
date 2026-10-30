// Tests e2e de l'acceptation des conditions (S22c).
//
// Ce que ces tests protègent, et qu'aucun test unitaire ne peut voir :
//
// 1. LE GUARD. Le module utilise `AccountAuthGuard` (session seule) et non
//    `AuthGuard` (session + organisation). Un test unitaire vérifierait la
//    métadonnée ; seul un test e2e vérifie qu'un appel réel n'est pas refusé.
// 2. L'IDEMPOTENCE RÉELLE. `$setOnInsert` combiné à un index unique ne se
//    comporte comme prévu que face à une vraie base. Un double envoi du
//    formulaire d'inscription ne doit pas réécrire la date de preuve.
// 3. L'ISOLATION. L'acceptation d'un utilisateur ne doit être ni lisible ni
//    modifiable par un autre — et aucune route ne prend d'identifiant permettant
//    de le tenter.

import type { INestApplication } from '@nestjs/common';
import { KNOWN_LEGAL_VERSIONS, LEGAL_VERSION } from '@lalanda/shared/legal';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

e2eSuite('acceptation des conditions (S22c)', () => {
  let app: INestApplication;
  let cookies: string[];
  let autreCookies: string[];

  const tag = Math.random().toString(36).slice(2, 8);
  const user = {
    email: `legal-${tag}@lalanda-test.local`,
    password: 'Passw0rd!legal',
    name: 'Lea Legal',
  };
  const autre = {
    email: `legal-autre-${tag}@lalanda-test.local`,
    password: 'Passw0rd!autre',
    name: 'Alex Autre',
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    cookies = await registerAndLogin(app, user);
    autreCookies = await registerAndLogin(app, autre);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await teardown(app, [user.email, autre.email]);
  }, E2E_HOOK_TIMEOUT_MS);

  it('refuse un appel sans session', async () => {
    await request(app.getHttpServer()).get('/legal/terms/acceptance').expect(401);
    await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .send({ version: LEGAL_VERSION })
      .expect(401);
  });

  it('enregistre l’accord dès l’inscription, sans appel séparé (v0.4.3)', async () => {
    // `registerAndLogin` inscrit avec `termsVersion` : l'accord naît avec le
    // compte. Avant la v0.4.3, il fallait ce POST après coup — et il tombait en
    // 401 dès que la vérification d'adresse était exigée.
    const res = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .expect(200);

    expect(res.body).toMatchObject({
      currentVersion: LEGAL_VERSION,
      acceptedVersion: LEGAL_VERSION,
      isCurrent: true,
    });
    expect(res.body.acceptedAt).not.toBeNull();
  });

  it('enregistre l’accord et le rend courant', async () => {
    const res = await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .send({ version: LEGAL_VERSION })
      .expect(201);

    expect(res.body).toMatchObject({ acceptedVersion: LEGAL_VERSION, isCurrent: true });
    expect(typeof res.body.acceptedAt).toBe('string');
  });

  it('ne déplace pas la date d’acceptation lors d’un second envoi', async () => {
    // Double clic, rejeu réseau, retour arrière du navigateur : la date qui fait
    // la preuve doit rester celle du PREMIER accord.
    const premier = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .expect(200);

    await new Promise((r) => setTimeout(r, 15));

    const second = await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .send({ version: LEGAL_VERSION })
      .expect(201);

    expect(second.body.acceptedAt).toBe(premier.body.acceptedAt);
  });

  it('refuse une version jamais publiée', async () => {
    // Sans ce refus, un client enregistrerait une version future et ne serait
    // plus jamais resollicité.
    const res = await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .send({ version: '2099-01-01' })
      .expect(400);

    expect(res.body.code).toBe('INVALID_TERMS_VERSION');
  });

  it('refuse un userId glissé dans le corps plutôt que de l’ignorer', async () => {
    await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .send({ version: LEGAL_VERSION, userId: 'quelquun-dautre' })
      .expect(400);
  });

  it('n’expose l’accord d’un utilisateur à aucun autre', async () => {
    // Depuis la v0.4.3, les deux comptes acceptent en s'inscrivant. Pour que
    // l'isolation reste OBSERVABLE, l'accord du second est retiré en base : s'il
    // voyait celui du premier, il le lirait encore.
    const db = await dbOf(app);
    const autreUser = await db.collection('user').findOne({ email: autre.email });
    await db.collection('terms_acceptances').deleteMany({ userId: String(autreUser!._id) });

    const res = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', autreCookies)
      .expect(200);

    // Le premier utilisateur a accepté ; le second ne doit rien en voir.
    expect(res.body.acceptedVersion).toBeNull();
    expect(res.body.isCurrent).toBe(false);

    const premier = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .expect(200);
    expect(premier.body.acceptedVersion).toBe(LEGAL_VERSION);
  });

  it('tient pour périmé un accord sur le corpus précédent, puis le rend courant après acceptation (ADR-0043)', async () => {
    // Cas réel du changement d'éditeur : un compte qui n'a accepté que le corpus
    // `2026-08-09` doit être resollicité, puis redevenir à jour sans que la
    // trace de son premier accord ne soit effacée.
    const ancienne = KNOWN_LEGAL_VERSIONS[KNOWN_LEGAL_VERSIONS.length - 2]!;
    expect(ancienne).not.toBe(LEGAL_VERSION);

    const db = await dbOf(app);
    const autreUser = await db.collection('user').findOne({ email: autre.email });
    const userId = String(autreUser!._id);
    await db.collection('terms_acceptances').deleteMany({ userId });
    await db.collection('terms_acceptances').insertOne({
      userId,
      termsVersion: ancienne,
      acceptedAt: new Date('2026-09-01T10:00:00Z'),
      _schemaVersion: 1,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    });

    const avant = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', autreCookies)
      .expect(200);
    expect(avant.body).toMatchObject({
      currentVersion: LEGAL_VERSION,
      acceptedVersion: ancienne,
      isCurrent: false,
    });

    const apres = await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .set('Cookie', autreCookies)
      .send({ version: LEGAL_VERSION })
      .expect(201);
    expect(apres.body).toMatchObject({ acceptedVersion: LEGAL_VERSION, isCurrent: true });

    const historique = await db
      .collection('terms_acceptances')
      .find({ userId })
      .sort({ acceptedAt: 1 })
      .toArray();
    expect(historique.map((a) => a['termsVersion'])).toEqual([ancienne, LEGAL_VERSION]);
  });
});
