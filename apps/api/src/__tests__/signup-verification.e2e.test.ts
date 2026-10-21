// Inscription et connexion quand la vérification d'adresse est EXIGÉE (v0.4.3).
//
// Le parcours que la production a cassé le 18 oct. 2026 : avec
// AUTH_REQUIRE_EMAIL_VERIFICATION=true, l'inscription n'ouvre plus de session,
// et l'acceptation des conditions — envoyée après coup par un appel authentifié
// — tombait en 401. Le compte existait sans preuve d'accord. Aucun autre fichier
// e2e ne tourne avec le drapeau actif : c'est lui qui garde ce parcours.
//
// Ce qui est vérifié ici, et nulle part ailleurs :
//   1. l'accord est enregistré PAR l'inscription elle-même, sans session ;
//   2. un compte mot de passe ne peut pas naître sans version publiée ;
//   3. une connexion non vérifiée, mot de passe correct, renvoie un lien
//      (`sendOnSignIn`) — et un mauvais mot de passe n'en renvoie aucun.

import { LEGAL_VERSION } from '@lalanda/shared/legal';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import 'reflect-metadata';

import { LegalService } from '../legal/legal.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { dbOf, e2eSuite, makeE2EApp, purgeTestUsers, teardown } from './e2e-utils.js';

// Lu par `auth.module.ts` au bootstrap : à poser AVANT `makeE2EApp`.
process.env['AUTH_REQUIRE_EMAIL_VERIFICATION'] = 'true';

const tag = Math.random().toString(36).slice(2, 8);
const EMAIL = `verif-${tag}@lalanda-test.local`;
const EMAIL_SANS_ACCORD = `verif-sans-accord-${tag}@lalanda-test.local`;
const EMAIL_VERSION_INCONNUE = `verif-version-${tag}@lalanda-test.local`;
const MOT_DE_PASSE = 'Passw0rd!verif';

e2eSuite('inscription avec vérification d’adresse exigée (v0.4.3)', () => {
  let app: INestApplication;
  let envoyes: MailMessage[];

  beforeAll(async () => {
    app = await makeE2EApp();
    await purgeTestUsers(await dbOf(app), [EMAIL, EMAIL_SANS_ACCORD, EMAIL_VERSION_INCONNUE]);
    envoyes = [];
    vi.spyOn(app.get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      envoyes.push(m);
      return { delivered: true };
    });
  }, 60_000);

  beforeEach(() => {
    envoyes.length = 0;
  });

  afterAll(async () => {
    await teardown(app, [EMAIL, EMAIL_SANS_ACCORD, EMAIL_VERSION_INCONNUE]);
  }, 30_000);

  async function userIdOf(email: string): Promise<string | null> {
    const user = await (await dbOf(app)).collection('user').findOne({ email });
    return user ? String(user._id) : null;
  }

  it('refuse de créer un compte sans accord, et ne crée rien', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-up/email')
      .send({ email: EMAIL_SANS_ACCORD, password: MOT_DE_PASSE, name: 'Sans Accord' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TERMS_NOT_ACCEPTED');
    expect(await userIdOf(EMAIL_SANS_ACCORD)).toBeNull();
    expect(envoyes).toHaveLength(0);
  });

  it('refuse une version des conditions jamais publiée', async () => {
    const res = await request(app.getHttpServer()).post('/auth/sign-up/email').send({
      email: EMAIL_VERSION_INCONNUE,
      password: MOT_DE_PASSE,
      name: 'Version Inconnue',
      termsVersion: '2099-01-01',
    });

    expect(res.status).toBe(400);
    expect(await userIdOf(EMAIL_VERSION_INCONNUE)).toBeNull();
  });

  it('crée le compte SANS session, enregistre l’accord et envoie le lien', async () => {
    const res = await request(app.getHttpServer()).post('/auth/sign-up/email').send({
      email: EMAIL,
      password: MOT_DE_PASSE,
      name: 'Vera Verif',
      termsVersion: LEGAL_VERSION,
    });

    expect(res.status).toBe(200);
    // Pas de session : c'est ce que la page d'inscription lit pour afficher
    // « Confirmez votre adresse » au lieu de partir vers l'application.
    expect(res.body.token).toBeNull();
    expect(res.headers['set-cookie'] ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('session_token=')]),
    );

    const userId = await userIdOf(EMAIL);
    expect(userId).not.toBeNull();
    const accord = await app.get(LegalService).getAcceptance(userId!);
    expect(accord).toMatchObject({ acceptedVersion: LEGAL_VERSION, isCurrent: true });

    expect(envoyes.map((m) => m.to)).toEqual([EMAIL]);
  });

  it('renvoie un lien à une connexion non vérifiée, mot de passe correct', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: MOT_DE_PASSE });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(envoyes.map((m) => m.to)).toEqual([EMAIL]);
  });

  it('n’envoie RIEN sur un mauvais mot de passe — pas de canon à emails', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: 'MauvaisMotDePasse!1' });

    expect(res.status).toBe(401);
    expect(envoyes).toHaveLength(0);
  });
});
