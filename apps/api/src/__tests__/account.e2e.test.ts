// S20b — espace compte : profil, sécurité, sessions, préférences.
//
// Exigences testées :
//  1. Profil : lecture et écriture scopées à la SESSION de l'appelant.
//  2. Aucune route ne permet d'écrire le profil d'un autre utilisateur — un
//     `userId` glissé dans le corps est refusé (400), pas ignoré en silence.
//  3. Préférences réellement persistées entre deux requêtes, défauts servis
//     avant toute écriture.
//  4. Sessions : liste (session courante marquée, token JAMAIS exposé),
//     révocation unitaire, révocation de toutes les autres.
//  5. Suppression refusée pour un DERNIER PROPRIÉTAIRE d'organisation ayant
//     d'autres membres (docs/12 § Règles critiques, ADR-0012).
//  6. Suppression effective d'un compte solo, avec cascade des données.
//  7. ADR-0012/0013 risque n°2 : un utilisateur SANS AUCUNE ORGANISATION accède
//     à tout l'espace compte. C'est le cas que la refonte RBAC peut casser
//     silencieusement — d'où un test dédié et explicite.
//  8. Changement d'email : la nouvelle adresse n'est PAS appliquée sans
//     vérification, et l'API annonce que l'email n'a pas pu être envoyé.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, teardown } from './e2e-utils.js';

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

interface SessionItem {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

e2eSuite('espace compte (S20b — docs/04, docs/12, docs/17)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `acca-${tag}@lalanda-test.local`,
    password: 'Passw0rd!acca',
    name: 'Alice Compte',
  };
  const userB = {
    email: `accb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!accb',
    name: 'Bob Compte',
  };
  /** Compte volontairement privé d'organisation (exigence 7). */
  const userOrphan = {
    email: `acco-${tag}@lalanda-test.local`,
    password: 'Passw0rd!acco',
    name: 'Olga Sans Org',
  };
  /** Compte solo dédié à la suppression effective (exigence 6). */
  const userSolo = {
    email: `accs-${tag}@lalanda-test.local`,
    password: 'Passw0rd!accs',
    name: 'Sam Solo',
  };

  let cookiesA: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    cookiesA = await registerAndLogin(userA);
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [userA.email, userB.email, userOrphan.email, userSolo.email]);
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
    expect(res.status).toBeLessThan(400);
    return cookiesOf(res);
  }

  /** Ouvre une session SUPPLÉMENTAIRE pour un compte déjà inscrit. */
  async function login(user: { email: string; password: string }): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBeLessThan(400);
    return cookiesOf(res);
  }

  function cookiesOf(res: { headers: Record<string, unknown> }): string[] {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
    return list.map((c: string) => c.split(';')[0]!);
  }

  // ─── Profil ────────────────────────────────────────────────────────────────

  it('profil : lecture servie depuis la session, avec les défauts avant toute écriture', async () => {
    const res = await request(app.getHttpServer()).get('/account/profile').set('Cookie', cookiesA);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(userA.email);
    expect(res.body.name).toBe(userA.name);
    // Initiales calculées côté serveur — « Alice Compte » → « AC ».
    expect(res.body.initials).toBe('AC');
    expect(res.body.locale).toBe('fr');
    expect(res.body.timezone).toBe('Africa/Kinshasa');
    expect(res.body.pendingEmailChange).toBeNull();
    // Aucun SMTP : personne ne peut être vérifié (docs/17 § Restant).
    expect(res.body.emailVerified).toBe(false);
  }, 30_000);

  it('profil : écriture persistée et relue à l’identique', async () => {
    const server = app.getHttpServer();

    const put = await request(server)
      .put('/account/profile')
      .set('Cookie', cookiesA)
      .send({ name: 'Alice Modifiée', locale: 'fr', timezone: 'Europe/Paris' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Alice Modifiée');
    expect(put.body.timezone).toBe('Europe/Paris');
    expect(put.body.initials).toBe('AM');

    const read = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(read.body.name).toBe('Alice Modifiée');
    expect(read.body.timezone).toBe('Europe/Paris');
  }, 30_000);

  it('profil : zod refuse un fuseau inconnu, une langue non servie et un nom vide', async () => {
    const server = app.getHttpServer();
    const base = { name: 'Alice', locale: 'fr', timezone: 'Europe/Paris' };

    for (const body of [
      { ...base, timezone: 'Mars/Olympus_Mons' },
      { ...base, locale: 'en' },
      { ...base, name: '   ' },
    ]) {
      const res = await request(server).put('/account/profile').set('Cookie', cookiesA).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    }
  }, 30_000);

  it('aucune route ne permet d’écrire le profil d’autrui : un userId dans le corps est REFUSÉ', async () => {
    const server = app.getHttpServer();
    const cookiesB = await registerAndLogin(userB);

    const profileB = await request(server).get('/account/profile').set('Cookie', cookiesB);
    expect(profileB.status).toBe(200);
    const idB = profileB.body.id as string;
    expect(idB).toBeTruthy();

    // A tente de se faire passer pour B en injectant son identifiant. Les schémas
    // sont `.strict()` : la clé inconnue fait échouer la validation. Elle n'est
    // NI appliquée NI silencieusement ignorée — la différence compte, car un
    // champ ignoré donnerait un 200 trompeur.
    const usurpation = await request(server)
      .put('/account/profile')
      .set('Cookie', cookiesA)
      .send({ name: 'Pirate', locale: 'fr', timezone: 'Europe/Paris', userId: idB });
    expect(usurpation.status).toBe(400);
    expect(usurpation.body.code).toBe('INVALID_REQUEST');

    const prefsUsurpation = await request(server)
      .put('/account/preferences')
      .set('Cookie', cookiesA)
      .send({
        theme: 'dark',
        displayCurrency: 'EUR',
        notifications: {
          securite: true,
          produit: true,
          projet: true,
          resumeHebdomadaire: false,
        },
        userId: idB,
      });
    expect(prefsUsurpation.status).toBe(400);

    // Le profil de B est resté strictement intact.
    const apresB = await request(server).get('/account/profile').set('Cookie', cookiesB);
    expect(apresB.body.name).toBe(userB.name);
    expect(apresB.body.email).toBe(userB.email);

    // Et chacun ne lit que le sien.
    const apresA = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(apresA.body.email).toBe(userA.email);
    expect(apresA.body.id).not.toBe(idB);
  }, 60_000);

  it('sans session : 401 sur toutes les routes de l’espace compte', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/account/profile')).status).toBe(401);
    expect((await request(server).get('/account/preferences')).status).toBe(401);
    expect((await request(server).get('/account/sessions')).status).toBe(401);
    expect((await request(server).get('/account/deletion')).status).toBe(401);
    expect((await request(server).put('/account/profile').send({})).status).toBe(401);
    expect((await request(server).post('/account/delete').send({})).status).toBe(401);
  }, 30_000);

  // ─── Préférences ───────────────────────────────────────────────────────────

  it('préférences : défauts servis, puis écriture réellement persistée', async () => {
    const server = app.getHttpServer();

    const avant = await request(server).get('/account/preferences').set('Cookie', cookiesA);
    expect(avant.status).toBe(200);
    expect(avant.body.theme).toBe('system');
    expect(avant.body.displayCurrency).toBe('USD');
    expect(avant.body.notifications.securite).toBe(true);
    expect(avant.body.notifications.resumeHebdomadaire).toBe(false);
    // Les valeurs acceptées sont servies par l'API : l'UI ne les code pas en dur.
    expect(avant.body.options.themes).toContain('dark');
    expect(avant.body.options.currencies).toContain('CDF');

    const put = await request(server)
      .put('/account/preferences')
      .set('Cookie', cookiesA)
      .send({
        theme: 'dark',
        displayCurrency: 'CDF',
        notifications: {
          securite: true,
          produit: false,
          projet: true,
          resumeHebdomadaire: true,
        },
      });
    expect(put.status).toBe(200);
    expect(put.body.theme).toBe('dark');
    expect(put.body.updatedAt).toBeTruthy();

    // Relecture dans une requête DISTINCTE : c'est la persistance qui est testée,
    // pas l'écho de la réponse d'écriture.
    const apres = await request(server).get('/account/preferences').set('Cookie', cookiesA);
    expect(apres.body.theme).toBe('dark');
    expect(apres.body.displayCurrency).toBe('CDF');
    expect(apres.body.notifications.produit).toBe(false);
    expect(apres.body.notifications.resumeHebdomadaire).toBe(true);

    // Le profil n'a pas été écrasé au passage : les deux volets écrivent le même
    // document sans se marcher dessus.
    const profil = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(profil.body.timezone).toBe('Europe/Paris');
  }, 60_000);

  it('préférences : les préférences d’un utilisateur sont invisibles à un autre', async () => {
    const server = app.getHttpServer();
    const cookiesB = await login(userB);

    const prefsB = await request(server).get('/account/preferences').set('Cookie', cookiesB);
    expect(prefsB.status).toBe(200);
    // A vient de passer en dark/CDF ; B garde ses propres défauts.
    expect(prefsB.body.theme).toBe('system');
    expect(prefsB.body.displayCurrency).toBe('USD');
  }, 30_000);

  it('préférences : zod refuse une valeur hors énumération', async () => {
    const server = app.getHttpServer();
    const valid = {
      theme: 'dark',
      displayCurrency: 'CDF',
      notifications: { securite: true, produit: true, projet: true, resumeHebdomadaire: false },
    };
    for (const body of [
      { ...valid, theme: 'solarized' },
      { ...valid, displayCurrency: 'BTC' },
      { ...valid, notifications: { securite: 'oui' } },
    ]) {
      const res = await request(server)
        .put('/account/preferences')
        .set('Cookie', cookiesA)
        .send(body);
      expect(res.status).toBe(400);
    }
  }, 30_000);

  // ─── Sessions ──────────────────────────────────────────────────────────────

  it('sessions : liste avec session courante marquée, et AUCUN token exposé', async () => {
    const server = app.getHttpServer();
    // Deuxième session pour le même compte, avec un User-Agent reconnaissable.
    await request(server)
      .post('/auth/sign-in/email')
      .set(
        'User-Agent',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      )
      .send({ email: userA.email, password: userA.password });

    const res = await request(server).get('/account/sessions').set('Cookie', cookiesA);
    expect(res.status).toBe(200);

    const sessions = res.body.sessions as SessionItem[];
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    // Exactement une session courante, et elle est en tête de liste.
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions[0]!.current).toBe(true);

    // Le libellé d'appareil est rempli pour la session ouverte avec un vrai UA.
    expect(sessions.some((s) => s.device === 'Chrome sur macOS')).toBe(true);
    for (const s of sessions) {
      expect(s.device.length).toBeGreaterThan(0);
      expect(s.id).toBeTruthy();
      expect(Number.isNaN(Date.parse(s.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(s.lastActiveAt))).toBe(false);
      expect(Number.isNaN(Date.parse(s.expiresAt))).toBe(false);
    }

    // RÈGLE DE SÉCURITÉ : un token de session vaut le cookie de connexion. La
    // liste ne doit en contenir aucun, sous aucune clé — sinon l'écran « sessions
    // actives » distribuerait des sessions détournables.
    const serialise = JSON.stringify(res.body);
    expect(serialise).not.toContain('token');
    const cookieValeur = cookiesA[0]!.split('=')[1]!;
    expect(serialise).not.toContain(cookieValeur);
  }, 60_000);

  it('sessions : révocation unitaire d’une AUTRE session, la courante survit', async () => {
    const server = app.getHttpServer();
    const cookiesAutre = await login(userA);

    const avant = await request(server).get('/account/sessions').set('Cookie', cookiesA);
    const cible = (avant.body.sessions as SessionItem[]).find((s) => !s.current);
    expect(cible).toBeDefined();

    const del = await request(server)
      .delete(`/account/sessions/${cible!.id}`)
      .set('Cookie', cookiesA);
    expect(del.status).toBe(200);
    expect(del.body.revoked).toBe(1);
    expect(del.body.wasCurrent).toBe(false);

    const apres = await request(server).get('/account/sessions').set('Cookie', cookiesA);
    expect(apres.status).toBe(200);
    const ids = (apres.body.sessions as SessionItem[]).map((s) => s.id);
    expect(ids).not.toContain(cible!.id);

    void cookiesAutre;
  }, 60_000);

  it('sessions : un id inconnu ou appartenant à autrui renvoie 404, jamais une révocation', async () => {
    const server = app.getHttpServer();
    const cookiesB = await login(userB);

    // Session bien réelle, mais celle de B : introuvable dans la liste de A.
    const sessionsB = await request(server).get('/account/sessions').set('Cookie', cookiesB);
    const idDeB = (sessionsB.body.sessions as SessionItem[])[0]!.id;

    const tentative = await request(server)
      .delete(`/account/sessions/${idDeB}`)
      .set('Cookie', cookiesA);
    expect(tentative.status).toBe(404);
    expect(tentative.body.code).toBe('SESSION_NOT_FOUND');

    // La session de B est toujours valide : rien n'a été révoqué.
    const toujoursLa = await request(server).get('/account/profile').set('Cookie', cookiesB);
    expect(toujoursLa.status).toBe(200);

    const inconnu = await request(server)
      .delete('/account/sessions/000000000000000000000000')
      .set('Cookie', cookiesA);
    expect(inconnu.status).toBe(404);
  }, 60_000);

  it('sessions : « révoquer toutes les autres » déconnecte les autres et garde la courante', async () => {
    const server = app.getHttpServer();
    const cookiesAutre = await login(userA);

    // Les deux sessions fonctionnent avant l'opération.
    expect((await request(server).get('/account/profile').set('Cookie', cookiesAutre)).status).toBe(
      200,
    );

    const res = await request(server)
      .post('/account/sessions/revoke-others')
      .set('Cookie', cookiesAutre);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(1);

    // La session qui a demandé la révocation est toujours valide…
    expect((await request(server).get('/account/profile').set('Cookie', cookiesAutre)).status).toBe(
      200,
    );
    // …et il n'en reste qu'une.
    const restantes = await request(server).get('/account/sessions').set('Cookie', cookiesAutre);
    expect((restantes.body.sessions as SessionItem[]).length).toBe(1);
    expect((restantes.body.sessions as SessionItem[])[0]!.current).toBe(true);

    // L'ancienne session de A est bien morte.
    expect((await request(server).get('/account/profile').set('Cookie', cookiesA)).status).toBe(
      401,
    );

    // A repart d'une session neuve pour la suite de la suite.
    cookiesA = cookiesAutre;
  }, 60_000);

  // ─── Changement d'email ────────────────────────────────────────────────────

  it('changement d’email : demande acceptée mais NON appliquée, et vérification non délivrée', async () => {
    const server = app.getHttpServer();
    const nouvelle = `acca-new-${tag}@lalanda-test.local`;

    const mauvaisMdp = await request(server)
      .post('/account/email/change')
      .set('Cookie', cookiesA)
      .send({ newEmail: nouvelle, currentPassword: 'PasLeBon!123' });
    expect(mauvaisMdp.status).toBe(400);
    expect(mauvaisMdp.body.code).toBe('INVALID_PASSWORD');

    const res = await request(server)
      .post('/account/email/change')
      .set('Cookie', cookiesA)
      .send({ newEmail: nouvelle, currentPassword: userA.password });
    // 202 : la demande est ACCEPTÉE, le changement n'est pas appliqué.
    expect(res.status).toBe(202);
    expect(res.body.pending.newEmail).toBe(nouvelle);
    // Le produit annonce honnêtement que l'email n'est pas parti (aucun SMTP).
    expect(res.body.pending.verificationDelivered).toBe(false);
    expect(res.body.pending.reason).toContain('SMTP');

    // L'adresse du compte n'a PAS bougé — c'est tout l'enjeu du flux.
    const profil = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(profil.body.email).toBe(userA.email);
    expect(profil.body.pendingEmailChange.newEmail).toBe(nouvelle);

    // La connexion continue de se faire avec l'ANCIENNE adresse.
    const connexion = await request(server)
      .post('/auth/sign-in/email')
      .send({ email: userA.email, password: userA.password });
    expect(connexion.status).toBeLessThan(400);

    // Un token invalide ne change rien et ne révèle rien.
    const faux = await request(server)
      .post('/account-email/verify')
      .send({ token: 'f'.repeat(64) });
    expect(faux.status).toBe(400);
    expect(faux.body.code).toBe('INVALID_TOKEN');

    // Annulation : la demande disparaît, l'adresse reste inchangée.
    const annule = await request(server).delete('/account/email/change').set('Cookie', cookiesA);
    expect(annule.status).toBe(200);
    expect(annule.body.canceled).toBe(true);

    const apres = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(apres.body.email).toBe(userA.email);
    expect(apres.body.pendingEmailChange).toBeNull();
  }, 60_000);

  it('changement d’email : une adresse déjà prise est refusée (409)', async () => {
    const res = await request(app.getHttpServer())
      .post('/account/email/change')
      .set('Cookie', cookiesA)
      .send({ newEmail: userB.email, currentPassword: userA.password });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  }, 30_000);

  // ─── Utilisateur sans organisation (ADR-0012/0013, risque n°2) ──────────────

  it('un utilisateur SANS AUCUNE ORGANISATION accède à tout son espace compte', async () => {
    const server = app.getHttpServer();
    const cookiesOrphan = await registerAndLogin(userOrphan);

    // On retire toute appartenance : c'est l'état d'un compte dont la dernière
    // organisation vient d'être supprimée, ou dont l'auto-provisionnement a
    // échoué. `AuthGuard` répondrait 403 NO_ORGANIZATION sur les routes métier —
    // l'espace compte, lui, DOIT rester joignable, sinon l'utilisateur ne peut
    // plus ni consulter ses sessions ni supprimer son compte.
    const db = await dbOf(app);
    const orphan = await db.collection('user').findOne({ email: userOrphan.email });
    expect(orphan).not.toBeNull();
    await db.collection('memberships').deleteMany({ userId: String(orphan!._id) });

    // Précondition vérifiée, et non supposée : une route métier échoue bien.
    const routeMetier = await request(server).get('/projects').set('Cookie', cookiesOrphan);
    expect(routeMetier.status).toBe(403);
    expect(routeMetier.body.code).toBe('NO_ORGANIZATION');

    // Les trois pages de l'espace compte répondent normalement.
    const profil = await request(server).get('/account/profile').set('Cookie', cookiesOrphan);
    expect(profil.status).toBe(200);
    expect(profil.body.email).toBe(userOrphan.email);

    const securite = await request(server).get('/account/sessions').set('Cookie', cookiesOrphan);
    expect(securite.status).toBe(200);
    expect((securite.body.sessions as SessionItem[]).length).toBeGreaterThanOrEqual(1);

    const prefs = await request(server).get('/account/preferences').set('Cookie', cookiesOrphan);
    expect(prefs.status).toBe(200);

    // L'écriture fonctionne aussi — pas seulement la lecture.
    const ecriture = await request(server)
      .put('/account/profile')
      .set('Cookie', cookiesOrphan)
      .send({ name: 'Olga Sans Org', locale: 'fr', timezone: 'Africa/Kinshasa' });
    expect(ecriture.status).toBe(200);

    // Et il peut consulter son éligibilité à la suppression : sans organisation,
    // rien ne bloque.
    const eligibilite = await request(server).get('/account/deletion').set('Cookie', cookiesOrphan);
    expect(eligibilite.status).toBe(200);
    expect(eligibilite.body.canDelete).toBe(true);
    expect(eligibilite.body.blockingOrganizations).toEqual([]);
  }, 60_000);

  // ─── Suppression du compte ─────────────────────────────────────────────────

  it('suppression REFUSÉE pour le dernier propriétaire d’une organisation peuplée (docs/12)', async () => {
    const server = app.getHttpServer();

    // A invite B dans SON organisation, B accepte : l'org compte alors deux
    // membres, et A en est le seul propriétaire.
    const orgs = await request(server).get('/organizations').set('Cookie', cookiesA);
    expect(orgs.status).toBe(200);
    const orgA = (orgs.body.organizations as Array<{ id: string; role: string }>).find(
      (o) => o.role === 'owner',
    );
    expect(orgA).toBeDefined();

    const invitation = await request(server)
      .post(`/organizations/${orgA!.id}/invitations`)
      .set('Cookie', cookiesA)
      .send({ email: userB.email });
    expect(invitation.status).toBe(201);

    const cookiesB = await login(userB);
    const accept = await request(server)
      .post('/invitations/accept')
      .set('Cookie', cookiesB)
      .send({ token: invitation.body.token });
    expect(accept.status).toBe(201);

    // L'éligibilité annonce le blocage AVANT toute saisie : l'utilisateur doit
    // l'apprendre en arrivant sur l'écran, pas après avoir tapé son mot de passe.
    const eligibilite = await request(server).get('/account/deletion').set('Cookie', cookiesA);
    expect(eligibilite.status).toBe(200);
    expect(eligibilite.body.canDelete).toBe(false);
    expect(eligibilite.body.blockingOrganizations).toHaveLength(1);
    expect(eligibilite.body.blockingOrganizations[0].id).toBe(orgA!.id);
    expect(eligibilite.body.blockingOrganizations[0].otherMemberCount).toBe(1);

    // La suppression elle-même est refusée, avec des identifiants VALIDES : c'est
    // bien la règle métier qui bloque, pas une confirmation ratée.
    const suppression = await request(server)
      .post('/account/delete')
      .set('Cookie', cookiesA)
      .send({ confirmEmail: userA.email, currentPassword: userA.password });
    expect(suppression.status).toBe(409);
    expect(suppression.body.code).toBe('LAST_OWNER');
    expect(suppression.body.organizations[0].name).toBeTruthy();

    // Le compte et l'organisation sont intacts — aucune suppression partielle.
    const profil = await request(server).get('/account/profile').set('Cookie', cookiesA);
    expect(profil.status).toBe(200);
    const db = await dbOf(app);
    expect(await db.collection('memberships').countDocuments({ organizationId: orgA!.id })).toBe(2);

    // B, lui, n'est que MEMBRE de l'org de A : rien ne bloque sa suppression.
    const eligibiliteB = await request(server).get('/account/deletion').set('Cookie', cookiesB);
    expect(eligibiliteB.body.canDelete).toBe(true);
  }, 90_000);

  it('suppression : confirmations exigées — email exact et mot de passe courant', async () => {
    const server = app.getHttpServer();
    const cookiesSolo = await registerAndLogin(userSolo);

    const mauvaisEmail = await request(server)
      .post('/account/delete')
      .set('Cookie', cookiesSolo)
      .send({
        confirmEmail: `autre-${tag}@lalanda-test.local`,
        currentPassword: userSolo.password,
      });
    expect(mauvaisEmail.status).toBe(400);
    expect(mauvaisEmail.body.code).toBe('EMAIL_MISMATCH');

    const mauvaisMdp = await request(server)
      .post('/account/delete')
      .set('Cookie', cookiesSolo)
      .send({ confirmEmail: userSolo.email, currentPassword: 'PasLeBon!123' });
    expect(mauvaisMdp.status).toBe(400);
    expect(mauvaisMdp.body.code).toBe('INVALID_PASSWORD');

    // Le compte est toujours là après deux tentatives ratées.
    expect((await request(server).get('/account/profile').set('Cookie', cookiesSolo)).status).toBe(
      200,
    );
  }, 60_000);

  it('suppression effective d’un compte solo : cascade complète, plus rien ne subsiste', async () => {
    const server = app.getHttpServer();
    const cookiesSolo = await login(userSolo);
    const db = await dbOf(app);

    const soloUser = await db.collection('user').findOne({ email: userSolo.email });
    expect(soloUser).not.toBeNull();
    const soloId = String(soloUser!._id);

    // On seede de la donnée applicative pour prouver que la cascade l'emporte.
    const projet = await request(server)
      .post('/projects')
      .set('Cookie', cookiesSolo)
      .send({ name: `Projet solo ${tag}`, templateSlug: 'prestation-services' });
    expect(projet.status).toBe(201);

    await request(server)
      .put('/account/preferences')
      .set('Cookie', cookiesSolo)
      .send({
        theme: 'dark',
        displayCurrency: 'EUR',
        notifications: { securite: true, produit: true, projet: true, resumeHebdomadaire: false },
      });

    const orgs = await request(server).get('/organizations').set('Cookie', cookiesSolo);
    const orgIds = (orgs.body.organizations as Array<{ id: string }>).map((o) => o.id);
    expect(orgIds.length).toBe(1);

    const res = await request(server)
      .post('/account/delete')
      .set('Cookie', cookiesSolo)
      .send({ confirmEmail: userSolo.email, currentPassword: userSolo.password });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.deletedOrganizations).toBe(1);

    // Plus aucune trace, dans AUCUNE des collections concernées.
    expect(await db.collection('user').countDocuments({ email: userSolo.email })).toBe(0);
    expect(await db.collection('memberships').countDocuments({ userId: soloId })).toBe(0);
    expect(await db.collection('user_preferences').countDocuments({ userId: soloId })).toBe(0);
    expect(await db.collection('organizations').countDocuments({ ownerId: soloId })).toBe(0);
    expect(
      await db.collection('projects').countDocuments({ organizationId: { $in: orgIds } }),
    ).toBe(0);

    // La session est morte avec le compte.
    expect((await request(server).get('/account/profile').set('Cookie', cookiesSolo)).status).toBe(
      401,
    );

    // Et l'ancienne adresse ne permet plus de se connecter.
    const reconnexion = await request(server)
      .post('/auth/sign-in/email')
      .send({ email: userSolo.email, password: userSolo.password });
    expect(reconnexion.status).toBeGreaterThanOrEqual(400);
  }, 90_000);
});
