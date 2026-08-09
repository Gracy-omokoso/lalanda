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

import { INestApplication } from '@nestjs/common';
import { LEGAL_VERSION } from '@lalanda/shared/legal';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

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
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [user.email, autre.email]);
  }, 30_000);

  it('refuse un appel sans session', async () => {
    await request(app.getHttpServer()).get('/legal/terms/acceptance').expect(401);
    await request(app.getHttpServer())
      .post('/legal/terms/acceptance')
      .send({ version: LEGAL_VERSION })
      .expect(401);
  });

  it('rend un compte fraîchement inscrit comme n’ayant pas accepté', async () => {
    const res = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', cookies)
      .expect(200);

    expect(res.body).toMatchObject({
      currentVersion: LEGAL_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      isCurrent: false,
    });
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
    const res = await request(app.getHttpServer())
      .get('/legal/terms/acceptance')
      .set('Cookie', autreCookies)
      .expect(200);

    // Le premier utilisateur a accepté ; le second ne doit rien en voir.
    expect(res.body.acceptedVersion).toBeNull();
    expect(res.body.isCurrent).toBe(false);
  });
});
