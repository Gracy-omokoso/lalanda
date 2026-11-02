// ADR-0053 — P8 : DOUBLE AUTHENTIFICATION DE LA CONSOLE (décision n° 2 retenue le 3 nov. 2026).
//
// 1. Mise en ligne : un opérateur EXISTANT, non enrôlé, n'est jamais enfermé dehors —
//    toute route de console répond 403 PLATFORM_2FA_REQUIRED, mais l'enrôlement (QR code,
//    puis code) lui reste ouvert ; enrôlé, il entre. Dix codes de secours, montrés une fois,
//    stockés hachés ; secret chiffré au repos.
// 2. Nouvelle session : 401 PLATFORM_2FA_VERIFICATION_REQUIRED ; la ré-authentification
//    de console exige mot de passe + code (ou un code de secours, à usage unique).
// 3. Une fenêtre `/me/reauth` (mot de passe seul) ne vaut pas pour une écriture de console.
// 4. Limitation des essais : verrouillage après 5 échecs, journalisé.
// 5. Réinitialisation par un AUTRE super-administrateur, motif obligatoire ; la cible se
//    ré-enrôle à sa prochaine entrée.
// 6. Comptes d'organisation non concernés.
// 7. Rotation `secrets:rewrap` du secret TOTP.

import { ThrottlerStorage } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PLATFORM_TWO_FACTOR } from '@lalanda/shared/platform';

import type { PlatformRole } from '../authz/permissions.js';
import { RewrapService } from '../integrations/rewrap.js';
import { keyringFromEnv } from '../integrations/secrets-crypto.js';
import { PlatformTwoFactorService } from '../platform-two-factor/platform-two-factor.service.js';
import { totpCodeAt } from '../platform-two-factor/totp.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
import { codeCourant, enrolerDeuxFacteurs, secretDe } from './platform-2fa-e2e.js';

e2eSuite('ADR-0053 — P8 : double authentification de la console', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p8-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P8 ${cle}` };
  };
  const viderLimiteur = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const t of store.timeoutIds.values()) t.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const idDeSession = async (c: string[]): Promise<string> => {
    const s = await request(serveur()).get('/auth/get-session').set('Cookie', c);
    return String(s.body?.user?.id ?? '');
  };
  const poserRole = (userId: string, role: PlatformRole) =>
    db.collection('platform_roles').insertOne({
      userId,
      role,
      grantedBy: null,
      reason: `suite e2e P8 ${tag}`,
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const seConnecter = async (cle: string): Promise<string[]> => {
    const res = await request(serveur())
      .post('/auth/sign-in/email')
      .send({ email: compte(cle).email, password: compte(cle).password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw : [raw]).map((c: string) => c.split(';')[0]!);
  };
  const reauth = (c: string[], corps: Record<string, string>) => {
    viderLimiteur();
    return request(serveur()).post('/admin/reauth').set('Cookie', c).send(corps);
  };
  const journal = async (action: string) =>
    db
      .collection('audit_events')
      .find({ organizationId: 'platform', action })
      .sort({ createdAt: 1 })
      .toArray();

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await db.collection('platform_roles').deleteMany({});
    // `sa` : super-administrateur enrôlé ; `sa2` : second super-administrateur ;
    // `op` : opérateur EXISTANT, rôle posé avant P8, jamais enrôlé ; `pa` : admin plateforme ;
    // `client` : compte d'organisation sans rôle plateforme.
    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['sa2', 'platform_super_admin'],
      ['op', 'platform_support'],
      ['pa', 'platform_admin'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      await poserRole(ids[cle]!, role);
    }
    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    for (const cle of ['sa', 'sa2', 'pa']) {
      viderLimiteur();
      await enrolerDeuxFacteurs(app, cookies[cle]!, compte(cle).password);
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await db.collection('platform_roles').deleteMany({ reason: `suite e2e P8 ${tag}` });
      const userIds = Object.values(ids);
      await db.collection('platform_two_factor').deleteMany({ userId: { $in: userIds } });
      await db.collection('platform_two_factor_sessions').deleteMany({ userId: { $in: userIds } });
    } finally {
      await teardown(app, emails);
    }
  }, E2E_HOOK_TIMEOUT_MS);

  it('mise en ligne : un opérateur existant non enrôlé est envoyé vers l’enrôlement, jamais enfermé', async () => {
    const c = cookies['op']!;
    // Toute route de console : 403 PLATFORM_2FA_REQUIRED.
    for (const route of ['/admin/overview', '/admin/reauth']) {
      const res = await request(serveur()).get(route).set('Cookie', c);
      expect(res.status, route).toBe(403);
      expect(res.body.code, route).toBe('PLATFORM_2FA_REQUIRED');
    }
    // L'interface sait quoi faire.
    const acces = await request(serveur()).get('/me/platform-access').set('Cookie', c);
    expect(acces.status).toBe(200);
    expect(acces.body.twoFactor).toEqual({
      required: true,
      enrolled: false,
      sessionVerified: false,
      backupCodesRemaining: 0,
    });
    // Chemin d'enrôlement ouvert : QR code + clé manuelle.
    viderLimiteur();
    const debut = await request(serveur()).post('/admin/two-factor/enrollment').set('Cookie', c);
    expect(debut.status, JSON.stringify(debut.body)).toBe(200);
    expect(debut.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(debut.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Lalanda:/);
    const secret = String(debut.body.manualKey).replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    // Secret chiffré au repos : jamais en clair dans la base.
    const enAttente = await db.collection('platform_two_factor').findOne({ userId: ids['op'] });
    expect(enAttente?.['status']).toBe('pending');
    expect(JSON.stringify(enAttente)).not.toContain(secret);
    expect(enAttente?.['secret']?.['keyId']).toBe(process.env['SECRETS_MASTER_KEY_ID']);

    // Mauvais mot de passe, puis mauvais code : refus.
    viderLimiteur();
    const sansMdp = await request(serveur())
      .post('/admin/two-factor/enrollment/confirm')
      .set('Cookie', c)
      .send({ password: 'mauvais', code: totpCodeAt(secret, Date.now()) });
    expect(sansMdp.status).toBe(401);
    expect(sansMdp.body.code).toBe('INVALID_PASSWORD');
    const fauxCode = await request(serveur())
      .post('/admin/two-factor/enrollment/confirm')
      .set('Cookie', c)
      .send({ password: compte('op').password, code: '000000' });
    expect(fauxCode.status).toBe(401);
    expect(fauxCode.body.code).toBe('INVALID_TWO_FACTOR_CODE');

    // Bon code : dix codes de secours, montrés une fois.
    const fin = await request(serveur())
      .post('/admin/two-factor/enrollment/confirm')
      .set('Cookie', c)
      .send({ password: compte('op').password, code: totpCodeAt(secret, Date.now()) });
    expect(fin.status, JSON.stringify(fin.body)).toBe(200);
    const codes = fin.body.backupCodes as string[];
    expect(codes).toHaveLength(PLATFORM_TWO_FACTOR.backupCodeCount);
    expect(new Set(codes).size).toBe(10);
    expect(fin.body.status).toMatchObject({ enrolled: true, sessionVerified: true });

    // Stockés hachés : aucun code en clair en base, et l'état ne les ressert jamais.
    const actif = await db.collection('platform_two_factor').findOne({ userId: ids['op'] });
    const brut = JSON.stringify(actif);
    for (const code of codes) expect(brut).not.toContain(code);
    expect((actif?.['backupCodes'] as unknown[]).length).toBe(10);
    const etat = await request(serveur()).get('/admin/two-factor').set('Cookie', c);
    expect(etat.status).toBe(200);
    expect(JSON.stringify(etat.body)).not.toContain(codes[0]!);
    expect(etat.body).toMatchObject({
      enrolled: true,
      sessionVerified: true,
      backupCodesRemaining: 10,
    });

    // Il entre dans la console.
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
    // Un enrôlement actif ne se remplace pas soi-même.
    viderLimiteur();
    const encore = await request(serveur()).post('/admin/two-factor/enrollment').set('Cookie', c);
    expect(encore.status).toBe(409);
    expect(encore.body.code).toBe('TWO_FACTOR_ALREADY_ENROLLED');
    // Journal : enrôlement et échecs, sans secret ni code.
    const enroles = await journal('platform.two_factor.enrolled');
    expect(enroles.some((e) => e['targetId'] === ids['op'])).toBe(true);
    const echecs = await journal('platform.two_factor.failed');
    expect(echecs.some((e) => e['targetId'] === ids['op'])).toBe(true);
    expect(JSON.stringify([...enroles, ...echecs])).not.toContain(secret);
    // Retenu pour les tests suivants.
    cookies['opCodes'] = codes;
    ids['opSecret'] = secret;
  });

  it('nouvelle session : vérification exigée ; ré-authentification = mot de passe + code', async () => {
    const c = await seConnecter('sa');
    cookies['saNouvelle'] = c;
    const avant = await request(serveur()).get('/admin/overview').set('Cookie', c);
    expect(avant.status).toBe(401);
    expect(avant.body.code).toBe('PLATFORM_2FA_VERIFICATION_REQUIRED');

    const sansCode = await reauth(c, { password: compte('sa').password });
    expect(sansCode.status).toBe(401);
    expect(sansCode.body.code).toBe('TWO_FACTOR_CODE_REQUIRED');
    const mauvaisMdp = await reauth(c, { password: 'mauvais', code: '123456' });
    expect(mauvaisMdp.body.code).toBe('INVALID_PASSWORD');

    const ok = await reauth(c, {
      password: compte('sa').password,
      code: await codeCourant(db, ids['sa']!),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
    const fenetre = await request(serveur()).get('/admin/reauth').set('Cookie', c);
    expect(fenetre.body.active).toBe(true);

    // Anti-rejeu : le même code ne sert pas deux fois.
    const secret = secretDe(ids['sa']!)!;
    const code = totpCodeAt(secret, Date.now());
    await db
      .collection('platform_two_factor')
      .updateOne({ userId: ids['sa'] }, { $set: { lastUsedStep: null } });
    expect((await reauth(c, { password: compte('sa').password, code })).status).toBe(201);
    const rejeu = await reauth(c, { password: compte('sa').password, code });
    expect(rejeu.status).toBe(401);
    expect(rejeu.body.code).toBe('INVALID_TWO_FACTOR_CODE');
  });

  it('code de secours : ouvre la ré-authentification une seule fois, journalisé', async () => {
    const c = await seConnecter('op');
    const codes = cookies['opCodes'] as unknown as string[];
    const premier = await reauth(c, { password: compte('op').password, backupCode: codes[0]! });
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
    // Saisi dans le champ « code » aussi, en minuscules avec tirets : reconnu.
    const tape = codes[1]!.toLowerCase().replace(/(.{4})(?=.)/g, '$1-');
    expect((await reauth(c, { password: compte('op').password, code: tape })).status).toBe(201);
    const reutilise = await reauth(c, { password: compte('op').password, backupCode: codes[0]! });
    expect(reutilise.status).toBe(401);
    expect(reutilise.body.code).toBe('INVALID_TWO_FACTOR_CODE');
    const utilises = await journal('platform.two_factor.backup_code_used');
    expect(
      utilises.filter((e) => e['targetId'] === ids['op']).map((e) => e['metadata']['remaining']),
    ).toEqual([9, 8]);
    const etat = await request(serveur()).get('/admin/two-factor').set('Cookie', c);
    expect(etat.body.backupCodesRemaining).toBe(8);
  });

  it('une fenêtre ouverte par `/me/reauth` (mot de passe seul) ne vaut pas pour la console', async () => {
    const c = cookies['saNouvelle']!;
    // Fenêtre d'organisation fraîche, SANS code, pour la même session.
    viderLimiteur();
    const org = await request(serveur())
      .post('/me/reauth')
      .set('Cookie', c)
      .send({ password: compte('sa').password });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    const ecriture = await request(serveur())
      .post(`/admin/users/${ids['pa']}/two-factor/reset`)
      .set('Cookie', c)
      .send({ reasonCategory: 'request', internalNote: 'Téléphone perdu, demande écrite.' });
    expect(ecriture.status).toBe(401);
    expect(ecriture.body.code).toBe('REAUTH_REQUIRED');
    const statut = await request(serveur()).get('/admin/reauth').set('Cookie', c);
    expect(statut.body.active).toBe(false);
  });

  it('limitation des essais : verrouillage après 5 échecs, même avec le bon code ensuite', async () => {
    const c = cookies['sa2']!;
    for (let i = 1; i <= PLATFORM_TWO_FACTOR.maxFailedAttempts; i += 1) {
      const res = await reauth(c, { password: compte('sa2').password, code: '000000' });
      expect(res.status, `essai ${i}`).toBe(401);
    }
    const bloque = await reauth(c, {
      password: compte('sa2').password,
      code: await codeCourant(db, ids['sa2']!),
    });
    expect(bloque.status).toBe(429);
    expect(bloque.body.code).toBe('TWO_FACTOR_LOCKED');
    expect(
      (await journal('platform.two_factor.locked')).some((e) => e['targetId'] === ids['sa2']),
    ).toBe(true);
    expect(
      (await journal('platform.two_factor.failed')).filter((e) => e['targetId'] === ids['sa2'])
        .length,
    ).toBe(PLATFORM_TWO_FACTOR.maxFailedAttempts);
    // Fin du verrouillage (horloge avancée en base) : le bon code passe.
    await db
      .collection('platform_two_factor')
      .updateOne({ userId: ids['sa2'] }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
    const apres = await reauth(c, {
      password: compte('sa2').password,
      code: await codeCourant(db, ids['sa2']!),
    });
    expect(apres.status, JSON.stringify(apres.body)).toBe(201);
  });

  it('réinitialisation : un AUTRE super-administrateur, motif obligatoire ; la cible se ré-enrôle', async () => {
    const sa = cookies['sa']!;
    const ouvrir = async (c: string[], cle: string) =>
      expect(
        (
          await reauth(c, {
            password: compte(cle).password,
            code: await codeCourant(db, ids[cle]!),
          })
        ).status,
      ).toBe(201);
    await ouvrir(sa, 'sa');
    const route = (id: string) => `/admin/users/${id}/two-factor/reset`;
    const motif = { reasonCategory: 'request', internalNote: 'Téléphone perdu, demande écrite.' };

    // Soi-même : jamais (deux personnes).
    const soi = await request(serveur()).post(route(ids['sa']!)).set('Cookie', sa).send(motif);
    expect(soi.status).toBe(409);
    expect(soi.body.code).toBe('SELF_RESET_FORBIDDEN');
    // Sans motif : 400.
    const sansMotif = await request(serveur()).post(route(ids['op']!)).set('Cookie', sa).send({});
    expect(sansMotif.status).toBe(400);
    // Administrateur plateforme : 403 (super-administrateur seul).
    await ouvrir(cookies['pa']!, 'pa');
    const pa = await request(serveur())
      .post(route(ids['op']!))
      .set('Cookie', cookies['pa']!)
      .send(motif);
    expect(pa.status).toBe(403);

    const ok = await request(serveur()).post(route(ids['op']!)).set('Cookie', sa).send(motif);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.reset).toBe(true);
    const trace = (await journal('platform.two_factor.reset')).find(
      (e) => e['targetId'] === ids['op'],
    );
    expect(trace?.['actorUserId']).toBe(ids['sa']);
    expect(trace?.['metadata']).toMatchObject({ reasonCategory: 'request' });
    // Deuxième réinitialisation : rien à réinitialiser.
    const encore = await request(serveur()).post(route(ids['op']!)).set('Cookie', sa).send(motif);
    expect(encore.body.code).toBe('TWO_FACTOR_NOT_ENROLLED');

    // Sessions révoquées ; reconnecté, il est renvoyé vers l'enrôlement — et y arrive.
    expect(
      (await request(serveur()).get('/admin/overview').set('Cookie', cookies['op']!)).status,
    ).toBe(401);
    const c = await seConnecter('op');
    const refus = await request(serveur()).get('/admin/overview').set('Cookie', c);
    expect(refus.body.code).toBe('PLATFORM_2FA_REQUIRED');
    viderLimiteur();
    await enrolerDeuxFacteurs(app, c, compte('op').password);
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
  });

  it('comptes d’organisation : non concernés', async () => {
    const c = cookies['client']!;
    expect((await request(serveur()).get('/organizations').set('Cookie', c)).status).toBe(200);
    const acces = await request(serveur()).get('/me/platform-access').set('Cookie', c);
    expect(acces.body.twoFactor).toMatchObject({ required: false, enrolled: false });
    viderLimiteur();
    const reauthOrg = await request(serveur())
      .post('/me/reauth')
      .set('Cookie', c)
      .send({ password: compte('client').password });
    expect(reauthOrg.status).toBe(200);
    // L'enrôlement de console ne leur est pas ouvert (aucun rôle plateforme).
    const enrol = await request(serveur()).post('/admin/two-factor/enrollment').set('Cookie', c);
    expect(enrol.status).toBe(403);
  });

  it('rotation `secrets:rewrap` : secret re-chiffré sous la nouvelle clé, codes toujours valides', async () => {
    const ancienne = process.env['SECRETS_MASTER_KEY']!;
    const ancienId = process.env['SECRETS_MASTER_KEY_ID']!;
    const rotation = keyringFromEnv({
      SECRETS_MASTER_KEY: randomBytes(32).toString('base64'),
      SECRETS_MASTER_KEY_ID: 'p8-rotation',
      SECRETS_MASTER_KEY_PREVIOUS: ancienne,
      SECRETS_MASTER_KEY_PREVIOUS_ID: ancienId,
    })!;
    const rewrap = app.get(RewrapService) as unknown as {
      keyring: unknown;
      run: RewrapService['run'];
    };
    const deuxFacteurs = app.get(PlatformTwoFactorService) as unknown as { keyring: unknown };
    const avant = { rewrap: rewrap.keyring, deuxFacteurs: deuxFacteurs.keyring };
    rewrap.keyring = rotation;
    deuxFacteurs.keyring = rotation;
    try {
      const rapport = await rewrap.run('e2e-p8');
      expect(rapport.rewrapped).toBeGreaterThanOrEqual(4);
      expect(rapport.remainingKeyIds).toEqual([]);
      const lignes = await db.collection('platform_two_factor').find({}).toArray();
      for (const l of lignes) expect(l['secret']['keyId']).toBe('p8-rotation');
      const traces = (await journal('secret.rewrapped')).filter(
        (e) => e['targetType'] === 'platform_two_factor',
      );
      expect(traces.length).toBe(lignes.length);
      // Idempotente.
      expect((await rewrap.run('e2e-p8')).rewrapped).toBe(0);
      // Le code du même téléphone passe toujours.
      const ok = await reauth(cookies['sa']!, {
        password: compte('sa').password,
        code: await codeCourant(db, ids['sa']!),
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    } finally {
      rewrap.keyring = avant.rewrap;
      deuxFacteurs.keyring = avant.deuxFacteurs;
    }
  });
});
