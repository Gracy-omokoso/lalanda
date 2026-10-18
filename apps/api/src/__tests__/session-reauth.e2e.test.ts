// `GET` / `POST /me/reauth` contre la vraie application (ADR-0021 §8, §10, §13).
//
// Le chemin de better-auth est réel : inscription, connexion, vérification du mot
// de passe, lecture de la session. Seul le compte « Google » est simulé : on retire
// le compte `credential` d'un utilisateur inscrit par mot de passe et on lui donne
// un compte `google`, ce qui reproduit exactement l'état d'un compte créé par
// Google (aucun mot de passe en base) sans dépendre du jeton d'identité de Google.
// L'âge de la session est piloté en réécrivant `session.createdAt`.
//
// Base dédiée, supprimée à la fin.

import 'reflect-metadata';

import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REAUTH_WINDOW_MS, ReauthService } from '../integrations/reauth.service.js';
import { RecentReauthGuard, REQUIRES_RECENT_REAUTH_KEY } from '../integrations/reauth.guard.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = Math.random().toString(36).slice(2, 8);
process.env['MONGODB_DB'] = `lalanda_e2e_reauth_${tag}`;

const MOT_DE_PASSE = 'ANTIFUITE-Reauth-9f2c71ab';
const FAUX_MOT_DE_PASSE = 'ANTIFUITE-Mauvais-4e8d10c3';

const user = (n: string) => ({
  email: `reauth-${tag}-${n}@example.test`,
  password: MOT_DE_PASSE,
  name: `Reauth ${n}`,
});

const header = (cookies: string[]): string => cookies.join('; ');

/** Jeton better-auth d'un cookie de session (`<jeton>.<signature>`, encodé URL). */
function sessionTokenOf(cookies: string[]): string {
  const raw = cookies.find((c) => c.includes('better-auth.session_token='));
  if (!raw) throw new Error('cookie de session absent');
  return decodeURIComponent(raw.split('=').slice(1).join('=')).split('.')[0]!;
}

e2eSuite('ré-authentification des membres — /me/reauth (ADR-0021 §8)', () => {
  let app: INestApplication;
  let db: Db;

  const server = () => app.getHttpServer();

  /** Transforme un compte à mot de passe en compte « créé par Google ». */
  async function devenirCompteGoogle(email: string): Promise<void> {
    const u = await db.collection('user').findOne({ email });
    const userId = u!._id as ObjectId;
    const res = await db.collection('account').deleteMany({ userId, providerId: 'credential' });
    expect(res.deletedCount).toBe(1);
    await db.collection('account').insertOne({
      userId,
      providerId: 'google',
      accountId: `google-${tag}-${email}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function vieillirSession(cookies: string[], ms: number): Promise<void> {
    const res = await db
      .collection('session')
      .updateOne(
        { token: sessionTokenOf(cookies) },
        { $set: { createdAt: new Date(Date.now() - ms) } },
      );
    expect(res.matchedCount).toBe(1);
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
  }, 60_000);

  afterAll(async () => {
    try {
      if (db) await db.dropDatabase();
    } finally {
      await app?.close();
    }
  }, 30_000);

  describe('compte à mot de passe', () => {
    it('sans session : 401', async () => {
      await request(server()).get('/me/reauth').expect(401);
      await request(server()).post('/me/reauth').send({ password: MOT_DE_PASSE }).expect(401);
    });

    it('session neuve : fenêtre fermée, méthode « password »', async () => {
      const cookies = await registerAndLogin(app, user('etat'));
      const res = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, expiresAt: null, method: 'password' });
    });

    it('mauvais mot de passe → 401 INVALID_PASSWORD, sans recopier le mot de passe', async () => {
      const cookies = await registerAndLogin(app, user('faux'));
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({ password: FAUX_MOT_DE_PASSE });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_PASSWORD');
      expect(JSON.stringify(res.body)).not.toContain(FAUX_MOT_DE_PASSE);
      const etat = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(etat.body.valid).toBe(false);
    });

    it('sans mot de passe pour un compte qui en a un → 401 INVALID_PASSWORD', async () => {
      const cookies = await registerAndLogin(app, user('sans-mdp'));
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it('corps invalide → 400 INVALID_REQUEST, sans recopier la valeur', async () => {
      const cookies = await registerAndLogin(app, user('corps'));
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({ password: MOT_DE_PASSE, motDePasse: MOT_DE_PASSE });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
      expect(JSON.stringify(res.body)).not.toContain(MOT_DE_PASSE);
    });

    it('bon mot de passe → fenêtre de 10 min pour CETTE session seulement', async () => {
      const u = user('ok');
      const sessionA = await registerAndLogin(app, u);
      // Seconde session du même utilisateur (autre poste, ou cookie volé).
      const sessionB = await registerAndLogin(app, u);
      expect(sessionTokenOf(sessionA)).not.toBe(sessionTokenOf(sessionB));

      const avant = Date.now();
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(sessionA))
        .send({ password: MOT_DE_PASSE });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toEqual(['expiresAt']);
      const expiresAt = new Date(res.body.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(avant + REAUTH_WINDOW_MS - 1_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + REAUTH_WINDOW_MS + 1_000);
      expect(JSON.stringify(res.body)).not.toContain(MOT_DE_PASSE);

      const etatA = await request(server()).get('/me/reauth').set('Cookie', header(sessionA));
      expect(etatA.body).toEqual({
        valid: true,
        expiresAt: res.body.expiresAt,
        method: 'password',
      });

      const etatB = await request(server()).get('/me/reauth').set('Cookie', header(sessionB));
      expect(etatB.body.valid).toBe(false);

      // Le garde réutilisable du chantier B : il laisse passer A, refuse B.
      const reauth = app.get(ReauthService);
      const garde = new RecentReauthGuard(reauth);
      const userId = String((await db.collection('user').findOne({ email: u.email }))!._id);
      const contexte = (cookies: string[]) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: userId }, headers: { cookie: header(cookies) } }),
          }),
        }) as unknown as ExecutionContext;
      await expect(garde.canActivate(contexte(sessionA))).resolves.toBe(true);
      const refus = await garde.canActivate(contexte(sessionB)).catch((e: unknown) => e);
      expect((refus as { getResponse(): { code: string } }).getResponse().code).toBe(
        'REAUTH_REQUIRED',
      );
    });

    it('le garde refuse une requête sans utilisateur authentifié', async () => {
      const garde = new RecentReauthGuard(app.get(ReauthService));
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      } as unknown as ExecutionContext;
      await expect(garde.canActivate(ctx)).rejects.toThrow();
    });

    it('le décorateur RequireRecentReauth pose un marqueur lisible par introspection', async () => {
      const { RequireRecentReauth } = await import('../integrations/reauth.guard.js');
      class Exemple {
        @RequireRecentReauth()
        ecrire(): void {}
      }
      expect(Reflect.getMetadata(REQUIRES_RECENT_REAUTH_KEY, Exemple.prototype.ecrire)).toBe(true);
      expect(Reflect.getMetadata('__guards__', Exemple.prototype.ecrire)).toContain(
        RecentReauthGuard,
      );
    });
  });

  describe('compte sans mot de passe (créé par Google)', () => {
    it('connexion récente → POST sans mot de passe ouvre la fenêtre', async () => {
      const u = user('google-ok');
      const cookies = await registerAndLogin(app, u);
      await devenirCompteGoogle(u.email);

      const etat = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(etat.body).toEqual({ valid: false, expiresAt: null, method: 'google' });

      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({});
      expect(res.status).toBe(200);

      // La fenêtre court depuis la CONNEXION, pas depuis l'appel.
      const session = await db.collection('session').findOne({ token: sessionTokenOf(cookies) });
      expect(new Date(res.body.expiresAt).getTime()).toBe(
        new Date(session!['createdAt']).getTime() + REAUTH_WINDOW_MS,
      );

      const apres = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(apres.body).toMatchObject({ valid: true, method: 'google' });
    });

    it('le POST sans corps fonctionne aussi', async () => {
      const u = user('google-sans-corps');
      const cookies = await registerAndLogin(app, u);
      await devenirCompteGoogle(u.email);
      await request(server()).post('/me/reauth').set('Cookie', header(cookies)).expect(200);
    });

    it('session de plus de 10 minutes → 401 REAUTH_GOOGLE_REQUIRED, fenêtre fermée', async () => {
      const u = user('google-vieux');
      const cookies = await registerAndLogin(app, u);
      await devenirCompteGoogle(u.email);
      await vieillirSession(cookies, REAUTH_WINDOW_MS + 60_000);

      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('REAUTH_GOOGLE_REQUIRED');

      const etat = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(etat.body.valid).toBe(false);
    });

    it('un mot de passe soumis par un compte Google → 401 INVALID_PASSWORD', async () => {
      const u = user('google-mdp');
      const cookies = await registerAndLogin(app, u);
      await devenirCompteGoogle(u.email);
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({ password: MOT_DE_PASSE });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_PASSWORD');
    });

    it('une session récente NE suffit PAS à un compte qui a un mot de passe', async () => {
      // Le cas que la règle « aucun compte credential » ferme : une session volée de
      // moins de 10 minutes ne contourne pas la saisie du mot de passe.
      const cookies = await registerAndLogin(app, user('mdp-recent'));
      const res = await request(server())
        .post('/me/reauth')
        .set('Cookie', header(cookies))
        .send({});
      expect(res.status).toBe(401);
      const etat = await request(server()).get('/me/reauth').set('Cookie', header(cookies));
      expect(etat.body.valid).toBe(false);
    });
  });
});
