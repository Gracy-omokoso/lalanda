// Mot de passe oublié — bout en bout (S22a).
//
// ── AUCUN ENVOI RÉSEAU ────────────────────────────────────────────────────────
// Le transport est espionné APRÈS l'initialisation de l'application : le service
// et le transport sont des singletons Nest, remplacer la méthode `send` de
// l'instance suffit à intercepter tout ce qui partirait. On récupère ainsi le
// lien réellement produit — donc le jeton réellement émis — sans jamais ouvrir
// de connexion SMTP.
//
// Ce que cette suite protège, et qui ne se voit pas en lisant la configuration :
//   1. AUCUNE ÉNUMÉRATION — la réponse est identique pour une adresse inconnue;
//   2. USAGE UNIQUE — un jeton consommé ne resert pas;
//   3. EXPIRATION — un jeton périmé est refusé;
//   4. les sessions ouvertes ailleurs tombent quand le mot de passe change.

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { dbOf, e2eSuite, makeE2EApp, teardown } from './e2e-utils.js';

// Ce fichier doit tester le comportement NU : ni Google, ni SMTP. Les variables
// sont retirées avant la construction de l'application (`buildAuth` lit
// `process.env` au bootstrap, puis met son instance en cache pour le process).
for (const v of [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
]) {
  delete process.env[v];
}

const EMAIL = 's22a-reset@exemple-test.com';
const EMAIL_INCONNU = 's22a-reset-inexistant@exemple-test.com';
const ANCIEN = 'AncienMotDePasse!2026';
const NOUVEAU = 'NouveauMotDePasse!2026';

e2eSuite('Réinitialisation de mot de passe (S22a)', () => {
  let app: INestApplication;
  let envoyes: MailMessage[];

  beforeAll(async () => {
    app = await makeE2EApp();
    const db = await dbOf(app);
    const { purgeTestUsers } = await import('./e2e-utils.js');
    await purgeTestUsers(db, [EMAIL, EMAIL_INCONNU]);

    envoyes = [];
    const transport = app.get(MailTransport);
    vi.spyOn(transport, 'send').mockImplementation(async (message: MailMessage) => {
      envoyes.push(message);
      return { delivered: true };
    });

    const { default: request } = await import('supertest');
    const inscription = await request(app.getHttpServer())
      .post('/auth/sign-up/email')
      .send({ email: EMAIL, password: ANCIEN, name: 'Reset Test' });
    expect(inscription.status).toBeLessThan(400);
  }, 60_000);

  afterAll(async () => {
    try {
      const db = await dbOf(app);
      // `verification` porte les jetons de better-auth : hors du périmètre de
      // `purgeTestUsers`, qui ne connaît que les collections applicatives.
      await db.collection('verification').deleteMany({ identifier: /^reset-password:/ });
    } finally {
      await teardown(app, [EMAIL, EMAIL_INCONNU]);
    }
  });

  /** Dernier lien de réinitialisation émis, extrait du corps texte de l'email. */
  function dernierJeton(): string {
    const dernier = envoyes.at(-1);
    expect(dernier, 'aucun email de réinitialisation intercepté').toBeDefined();
    const match = /nouveau-mot-de-passe\?token=([^\s]+)/.exec(dernier!.text);
    expect(match, `lien de réinitialisation absent du message : ${dernier!.text}`).not.toBeNull();
    return decodeURIComponent(match![1]!);
  }

  async function demanderReinitialisation(email: string): Promise<{ status: number; body: string }> {
    const { default: request } = await import('supertest');
    const res = await request(app.getHttpServer())
      .post('/auth/request-password-reset')
      .send({ email });
    return { status: res.status, body: JSON.stringify(res.body) };
  }

  it("répond À L'IDENTIQUE pour une adresse inconnue — aucune énumération possible", async () => {
    const connue = await demanderReinitialisation(EMAIL);
    const nombreApresConnue = envoyes.length;
    const inconnue = await demanderReinitialisation(EMAIL_INCONNU);

    // Même code, même corps : rien dans la réponse ne distingue les deux cas.
    // C'est ce qui empêche de transformer ce formulaire en annuaire des comptes.
    expect(inconnue.status).toBe(connue.status);
    expect(inconnue.body).toBe(connue.body);

    // Et surtout : aucun email n'est parti pour l'adresse inconnue.
    expect(envoyes).toHaveLength(nombreApresConnue);
    expect(envoyes.at(-1)!.to).toBe(EMAIL);
  });

  it("envoie un email de réinitialisation en français, avec un lien vers l'interface", async () => {
    await demanderReinitialisation(EMAIL);
    const mail = envoyes.at(-1)!;

    expect(mail.to).toBe(EMAIL);
    expect(mail.subject).toContain('réinitialisation');
    expect(mail.text).toContain('/nouveau-mot-de-passe?token=');
    // Durée annoncée = durée réellement appliquée (30 min, cf. auth.ts).
    expect(mail.text).toContain('valable 30 minutes');
    expect(mail.html).not.toMatch(/<img\b/i);
  });

  it('refuse un jeton EXPIRÉ', async () => {
    const { default: request } = await import('supertest');
    await demanderReinitialisation(EMAIL);
    const jeton = dernierJeton();

    // On vieillit le jeton en base plutôt que d'attendre 30 minutes : le test
    // vérifie que l'expiration est appliquée, pas que l'horloge avance.
    const db = await dbOf(app);
    const res = await db
      .collection('verification')
      .updateOne(
        { identifier: `reset-password:${jeton}` },
        { $set: { expiresAt: new Date(Date.now() - 60_000) } },
      );
    expect(res.matchedCount).toBe(1);

    const refus = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ newPassword: NOUVEAU, token: jeton });
    expect(refus.status).toBeGreaterThanOrEqual(400);

    // Et l'ancien mot de passe reste le bon : un jeton expiré ne change rien.
    const connexion = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: ANCIEN });
    expect(connexion.status).toBe(200);
  });

  it('applique le nouveau mot de passe, révoque les sessions, et refuse un SECOND usage du jeton', async () => {
    const { default: request } = await import('supertest');

    // Session ouverte AVANT la réinitialisation — elle ne doit pas y survivre.
    const avant = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: ANCIEN });
    const brutes = avant.headers['set-cookie'];
    const cookies = (Array.isArray(brutes) ? brutes : brutes ? [brutes] : []).map(
      (c: string) => c.split(';')[0]!,
    );
    expect(cookies.length).toBeGreaterThan(0);

    await demanderReinitialisation(EMAIL);
    const jeton = dernierJeton();

    const premier = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ newPassword: NOUVEAU, token: jeton });
    expect(premier.status).toBe(200);

    // ── USAGE UNIQUE ────────────────────────────────────────────────────────
    // Rejouer le même lien doit échouer. Sans cette garantie, un lien qui traîne
    // dans une boîte email reste une porte d'entrée permanente.
    const second = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ newPassword: 'EncoreUnAutre!2026', token: jeton });
    expect(second.status).toBeGreaterThanOrEqual(400);

    // Le nouveau mot de passe fonctionne, l'ancien non.
    const avecNouveau = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: NOUVEAU });
    expect(avecNouveau.status).toBe(200);

    const avecAncien = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: EMAIL, password: ANCIEN });
    expect(avecAncien.status).toBeGreaterThanOrEqual(400);

    // ── RÉVOCATION DES SESSIONS ─────────────────────────────────────────────
    // Une réinitialisation signifie souvent « quelqu'un d'autre avait accès » :
    // laisser vivre ses sessions laisserait cet accès intact.
    const ancienneSession = await request(app.getHttpServer())
      .get('/account/profile')
      .set('Cookie', cookies);
    expect(ancienneSession.status).toBe(401);
  });
});
