// L'application démarre et fonctionne SANS aucune variable Google ni SMTP (S22a).
//
// C'est la promesse centrale du lot, et elle est facile à casser sans s'en
// apercevoir : il suffit qu'un jour quelqu'un lise `GOOGLE_CLIENT_ID` avec un
// `!` ou fasse dépendre un provider Nest d'une connexion SMTP pour qu'un
// développeur sans configuration ne puisse plus lancer l'API — et il ne le
// découvrira qu'en clonant le dépôt.
//
// Cette suite retire donc les sept variables et vérifie, de bout en bout :
//   • l'application démarre;
//   • Google est annoncé comme indisponible plutôt que d'être offert puis planter;
//   • les trois flux qui envoient un email fonctionnent quand même, en disant
//     honnêtement que rien n'a été délivré.
//
// AUCUN ENVOI RÉSEAU : le transport réel est utilisé tel quel, mais sans
// `SMTP_HOST` il ne tente aucune connexion — c'est précisément ce qu'on teste.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';

// Retiré AVANT la construction de l'application : `buildAuth` lit `process.env`
// au bootstrap et met son instance en cache pour tout le process.
const VARIABLES_OPTIONNELLES = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
] as const;
for (const v of VARIABLES_OPTIONNELLES) delete process.env[v];

const TAG = randomBytes(4).toString('hex');
const EMAIL = `s22a-sans-config-${TAG}@exemple-test.com`;
const EMAIL_INVITE = `s22a-sans-config-invite-${TAG}@exemple-test.com`;
const EMAIL_CIBLE = `s22a-sans-config-cible-${TAG}@exemple-test.com`;
const MOT_DE_PASSE = 'MotDePasseTest!2026';

e2eSuite('Démarrage sans configuration Google ni SMTP (S22a)', () => {
  let app: INestApplication;
  let cookies: string[];

  beforeAll(async () => {
    // Si cette ligne échoue, la promesse du lot est rompue : l'absence de
    // configuration optionnelle empêcherait le démarrage.
    app = await makeE2EApp();

    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up/email')
      .send({ email: EMAIL, password: MOT_DE_PASSE, name: 'Sans Config' });
    // L'inscription déclenche un email de vérification qui ne partira pas.
    // Elle doit réussir malgré tout.
    expect(res.status).toBeLessThan(400);
    const brutes = res.headers['set-cookie'];
    cookies = (Array.isArray(brutes) ? brutes : brutes ? [brutes] : []).map(
      (c: string) => c.split(';')[0]!,
    );
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [EMAIL, EMAIL_INVITE, EMAIL_CIBLE]);
  }, 30_000);

  it("n'annonce pas Google et ne propose donc pas le bouton", async () => {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer()).get('/auth-providers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ google: false });
  });

  it('refuse proprement une connexion Google au lieu de planter', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in/social')
      .send({ provider: 'google', callbackURL: 'http://localhost:3000/projects' });

    // 404 « fournisseur inconnu » : une erreur métier lisible, pas une exception
    // remontée depuis les entrailles d'OAuth.
    expect(res.status).toBe(404);
    // Et l'application répond toujours au reste.
    const sante = await request(app.getHttpServer()).get('/health');
    expect(sante.status).toBe(200);
  });

  it('accepte une demande de mot de passe oublié sans SMTP, sans erreur serveur', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email: EMAIL });

    // Le lien n'arrivera nulle part, mais la route ne doit ni tomber en 500 ni
    // répondre `RESET_PASSWORD_DISABLED` : le service d'envoi existe toujours,
    // c'est son transport qui se replie.
    expect(res.status).toBe(200);
  });

  it('annonce honnêtement qu’un changement d’adresse n’a PAS été notifié', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/account/email/change')
      .set('Cookie', cookies)
      .send({ newEmail: EMAIL_CIBLE, currentPassword: MOT_DE_PASSE });

    expect(res.status).toBe(202);
    // Le point qui compte : l'interface ne dira pas « consultez votre boîte » à
    // quelqu'un qui ne recevra jamais rien.
    expect(res.body.pending.verificationDelivered).toBe(false);
    expect(res.body.pending.reason).toContain('EMAIL_NON_DELIVRE');

    // Et la demande existe bel et bien : le flux reste terminable avec le lien.
    const db = await dbOf(app);
    const demandes = await db
      .collection('email_change_requests')
      .find({ newEmail: EMAIL_CIBLE })
      .toArray();
    expect(demandes).toHaveLength(1);
    expect(demandes[0]!['notifiedAt']).toBeNull();
  });

  it('crée une invitation même sans SMTP, en signalant que l’email n’est pas parti', async () => {
    const { default: request } = await import('supertest');
    const orgs = await request(app.getHttpServer()).get('/organizations').set('Cookie', cookies);
    expect(orgs.status).toBe(200);
    const orgId = orgs.body.organizations[0].id as string;

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookies)
      .send({ email: EMAIL_INVITE });

    expect(res.status).toBe(201);
    // L'invitation EXISTE — un envoi impossible ne doit pas annuler l'opération
    // métier — et son lien reste copiable depuis l'interface.
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.emailDelivered).toBe(false);
  });
});
