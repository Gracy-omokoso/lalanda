// ADR-0053 — P2 : COMPTES, ORGANISATIONS, BLOCAGE ET SUSPENSION EFFECTIFS, MINIMISATION.
//
// Critère 6 : `GET /admin/users` sans `q` de trois caractères → 400 SEARCH_REQUIRED.
// Critère 7 : fiche détaillée sans motif → 400 REASON_REQUIRED ; avec, lecture journalisée.
// Critère 8 : un compte bloqué n'ouvre plus de session (403 ACCOUNT_BLOCKED) ni n'utilise
//             une session antérieure ; débloqué, il se reconnecte. Bloquer sans motif → 400.
// Critère 9 : organisation en `read_only` → lecture 200, écriture 423 ; en `full`, tout 423
//             sauf `GET /organizations` ; les autres organisations du membre restent intactes.
// Critère 11 (volet P2) : miroir « Équipe Lalanda » côté client, jamais l'opérateur.
// Critère 13 (volet P2) : conflit d'intérêts → 409 PLATFORM_SELF_DEALING ; seul détenteur
//             → 200 marqué `soleOperator`.
// Critère 14 : sans ré-authentification, toute écriture de la console → 401 REAUTH_REQUIRED.
// Critère 16 : rôle sans motif → 400 ; Support sans échéance → 400 ; à soi-même → 409.
// Plus : la session de console expire après 12 heures d'inactivité ; un compte NON bloqué
// n'est jamais refusé (cas nominal).

import { ThrottlerStorage } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PLATFORM_MIRROR_ACTOR_ID } from '@lalanda/shared/platform';

import type { PlatformRole } from '../authz/permissions.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
// ADR-0053 — P8 : tout opérateur s'enrôle ; ré-authentification = mot de passe + code.
import { corpsReauth, enrolerDeuxFacteurs } from './platform-2fa-e2e.js';

e2eSuite('ADR-0053 — P2 : blocage, suspension, minimisation, ré-authentification', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let orgS = '';
  let orgT = '';

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p2-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P2 ${cle}` };
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
      reason: `suite e2e P2 ${tag}`,
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const reauth = async (cle: string) => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/admin/reauth')
      .set('Cookie', cookies[cle]!)
      .send(await corpsReauth(app, db, cookies[cle]!, compte(cle).password));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const premiereOrg = async (c: string[]): Promise<string> => {
    const orgs = await request(serveur()).get('/organizations').set('Cookie', c);
    return (orgs.body.organizations as { id: string }[])[0]!.id;
  };
  const journalOrg = async (c: string[], org: string) =>
    request(serveur())
      .get('/audit-events?limit=500')
      .set('Cookie', [...c, `active_org_id=${org}`]);
  const journalPlateforme = async (action: string) =>
    request(serveur())
      .get(`/admin/audit-events?action=${encodeURIComponent(action)}`)
      .set('Cookie', cookies['sa']!);

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    // Base propre à ce fichier : les détenteurs d'actions doivent être exactement les nôtres.
    await db.collection('platform_roles').deleteMany({});
    await db.collection('organization_suspensions').deleteMany({});

    // Opérateurs : super-administrateur (sans organisation), administrateur plateforme,
    // support ; un super-administrateur membre de l'organisation S (conflit d'intérêts).
    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['pa', 'platform_admin'],
      ['sup', 'platform_support'],
      ['saMembre', 'platform_super_admin'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      if (cle !== 'saMembre') await db.collection('memberships').deleteMany({ userId: ids[cle] });
      await poserRole(ids[cle]!, role);
      viderLimiteur();
      await enrolerDeuxFacteurs(app, cookies[cle]!, compte(cle).password);
    }

    // Client : Propriétaire de S (son organisation personnelle) et de T (créée en base).
    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    orgS = await premiereOrg(cookies['client']);
    const t = await request(serveur())
      .post('/organizations')
      .set('Cookie', cookies['client'])
      .send({ name: `Org T ${tag}`, type: 'agence', pays: 'CD' });
    expect([200, 201], JSON.stringify(t.body)).toContain(t.status);
    orgT = String(t.body.id);
    // `saMembre` est membre de S.
    await db.collection('memberships').insertOne({
      userId: ids['saMembre'],
      organizationId: orgS,
      role: 'viewer',
      canClosePeriods: false,
      grants: [],
      revokes: [],
      permissionsRevision: 0,
      acceptedAt: new Date(),
      _schemaVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Un témoin jamais bloqué ; un compte à bloquer, membre de S.
    cookies['temoin'] = await registerAndLogin(app, compte('temoin'));
    cookies['cible'] = await registerAndLogin(app, compte('cible'));
    ids['cible'] = await idDeSession(cookies['cible']);
    await db.collection('memberships').insertOne({
      userId: ids['cible'],
      organizationId: orgS,
      role: 'viewer',
      canClosePeriods: false,
      grants: [],
      revokes: [],
      permissionsRevision: 0,
      acceptedAt: new Date(),
      _schemaVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (app) {
      await db.collection('platform_roles').deleteMany({});
      await db.collection('organization_suspensions').deleteMany({});
      await db.collection('platform_console_activity').deleteMany({});
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Ré-authentification (critère 14) ────────────────────────────────────────

  it('critère 14 — sans ré-authentification, chaque écriture de la console → 401 REAUTH_REQUIRED', async () => {
    viderLimiteur();
    const c = cookies['sa']!;
    const ecritures: Array<[string, string, object]> = [
      ['post', `/admin/organizations/${orgS}/suspend`, {}],
      ['post', `/admin/organizations/${orgS}/restore`, {}],
      ['delete', `/admin/organizations/${orgS}/suspend`, {}],
      ['patch', `/admin/organizations/${orgS}/plan`, { plan: 'pro' }],
      ['post', `/admin/users/${ids['cible']}/block`, {}],
      ['post', `/admin/users/${ids['cible']}/unblock`, {}],
      ['patch', `/admin/users/${ids['cible']}/disabled`, { disabled: true }],
      ['post', `/admin/users/${ids['cible']}/platform-roles`, { role: 'platform_admin' }],
      ['delete', `/admin/users/${ids['cible']}/platform-roles/platform_admin`, {}],
    ];
    for (const [verbe, chemin, corps] of ecritures) {
      const req = request(serveur()) as unknown as Record<string, (p: string) => request.Test>;
      const res = await req[verbe]!(chemin).set('Cookie', c).send(corps);
      expect(res.status, `${verbe} ${chemin}`).toBe(401);
      expect(res.body.code, `${verbe} ${chemin}`).toBe('REAUTH_REQUIRED');
    }
  });

  it('tout opérateur peut se ré-authentifier (plus seulement le super-administrateur)', async () => {
    await reauth('sa');
    await reauth('pa');
    await reauth('sup');
    await reauth('saMembre');
  });

  // ── Minimisation (critères 6 et 7) ──────────────────────────────────────────

  it('critère 6 — `GET /admin/users` sans recherche de trois caractères → 400 SEARCH_REQUIRED', async () => {
    viderLimiteur();
    for (const cle of ['sa', 'pa', 'sup']) {
      for (const q of ['', '?q=', '?q=ab', '?q=%20%20ab%20']) {
        const res = await request(serveur()).get(`/admin/users${q}`).set('Cookie', cookies[cle]!);
        expect(res.status, `${cle} ${q}`).toBe(400);
        expect(res.body.code).toBe('SEARCH_REQUIRED');
        expect(JSON.stringify(res.body)).not.toContain('@');
      }
    }
    const ok = await request(serveur())
      .get(`/admin/users?q=${encodeURIComponent(`p2-client-${tag}`)}`)
      .set('Cookie', cookies['sup']!);
    expect(ok.status).toBe(200);
    expect(ok.body.users).toHaveLength(1);
  });

  it('organisations : première page sans recherche ; au-delà, recherche obligatoire', async () => {
    viderLimiteur();
    const c = cookies['pa']!;
    expect((await request(serveur()).get('/admin/organizations').set('Cookie', c)).status).toBe(
      200,
    );
    const loin = await request(serveur()).get('/admin/organizations?limit=200').set('Cookie', c);
    expect(loin.status).toBe(400);
    expect(loin.body.code).toBe('SEARCH_REQUIRED');
    const court = await request(serveur()).get('/admin/organizations?q=ab').set('Cookie', c);
    expect(court.body.code).toBe('SEARCH_REQUIRED');
  });

  it('critère 7 — fiche détaillée : motif obligatoire, lecture journalisée avec le motif', async () => {
    viderLimiteur();
    const c = cookies['pa']!;
    const sans = await request(serveur()).get(`/admin/organizations/${orgS}`).set('Cookie', c);
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');
    const faux = await request(serveur())
      .get(`/admin/organizations/${orgS}?reason=curiosite`)
      .set('Cookie', c);
    expect(faux.body.code).toBe('REASON_REQUIRED');
    const avec = await request(serveur())
      .get(`/admin/organizations/${orgS}?reason=support`)
      .set('Cookie', c);
    expect(avec.status, JSON.stringify(avec.body)).toBe(200);
    expect(avec.body.ownerEmail).toBe(compte('client').email);
    const fiche = await request(serveur())
      .get(`/admin/users/${ids['client']}?reason=security`)
      .set('Cookie', c);
    expect(fiche.status).toBe(200);
    expect(fiche.body.organizations.map((o: { id: string }) => o.id)).toContain(orgS);

    const lus = await journalPlateforme('platform.organization.viewed');
    const evt = (lus.body.events as { targetId: string; metadata: { reason: string } }[]).find(
      (e) => e.targetId === orgS,
    );
    expect(evt?.metadata.reason).toBe('support');
    const lusU = await journalPlateforme('platform.user.viewed');
    expect(lusU.body.events.some((e: { targetId: string }) => e.targetId === ids['client'])).toBe(
      true,
    );
  });

  it('le support ne bloque pas, n’attribue pas de rôle et ne lit pas le journal plateforme', async () => {
    viderLimiteur();
    const c = cookies['sup']!;
    const bloquer = await request(serveur())
      .post(`/admin/users/${ids['cible']}/block`)
      .set('Cookie', c)
      .send({ reasonCategory: 'abuse', internalNote: 'Essai de droits.' });
    expect(bloquer.status).toBe(403);
    expect(bloquer.body.action).toBe('platform.users.block');
    expect((await request(serveur()).get('/admin/audit-events').set('Cookie', c)).status).toBe(403);
    const pa = await request(serveur())
      .post(`/admin/users/${ids['cible']}/platform-roles`)
      .set('Cookie', cookies['pa']!)
      .send({ role: 'platform_admin', reason: 'Renfort de l’équipe.' });
    expect(pa.status).toBe(403);
  });

  // ── Blocage (critère 8) ─────────────────────────────────────────────────────

  it('critère 8 — bloquer sans catégorie ou sans note → 400 REASON_REQUIRED', async () => {
    viderLimiteur();
    for (const corps of [
      {},
      { reasonCategory: 'abuse' },
      { reasonCategory: 'abuse', internalNote: 'court' },
      { internalNote: 'Spam répété sur les devis.' },
    ]) {
      const res = await request(serveur())
        .post(`/admin/users/${ids['cible']}/block`)
        .set('Cookie', cookies['pa']!)
        .send(corps);
      expect(res.status, JSON.stringify(corps)).toBe(400);
      expect(res.body.code, JSON.stringify(corps)).toBe('REASON_REQUIRED');
    }
    // Route historique : même exigence.
    const ancien = await request(serveur())
      .patch(`/admin/users/${ids['cible']}/disabled`)
      .set('Cookie', cookies['pa']!)
      .send({ disabled: true });
    expect(ancien.status).toBe(400);
    expect(ancien.body.code).toBe('REASON_REQUIRED');
  });

  it('cas nominal — un compte non bloqué travaille et se reconnecte normalement', async () => {
    viderLimiteur();
    expect(
      (await request(serveur()).get('/projects').set('Cookie', cookies['temoin']!)).status,
    ).toBe(200);
    const login = await request(serveur())
      .post('/auth/sign-in/email')
      .send({ email: compte('temoin').email, password: compte('temoin').password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
  });

  it('critère 8 — bloqué : session antérieure refusée, connexion refusée ; débloqué : reconnexion', async () => {
    viderLimiteur();
    expect(
      (await request(serveur()).get('/projects').set('Cookie', cookies['cible']!)).status,
    ).toBe(200);
    const bloque = await request(serveur())
      .post(`/admin/users/${ids['cible']}/block`)
      .set('Cookie', cookies['pa']!)
      .send({ reasonCategory: 'abuse', internalNote: 'Spam répété sur les devis.' });
    expect(bloque.status, JSON.stringify(bloque.body)).toBe(201);
    expect(bloque.body.disabledAt).not.toBeNull();

    // Session antérieure : révoquée, et même rejouée, refusée.
    const avant = await request(serveur()).get('/projects').set('Cookie', cookies['cible']!);
    expect([401, 403]).toContain(avant.status);

    // Nouvelle connexion : refusée par le crochet de création de session.
    const login = await request(serveur())
      .post('/auth/sign-in/email')
      .send({ email: compte('cible').email, password: compte('cible').password });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('ACCOUNT_BLOCKED');
    expect(
      await db.collection('session').countDocuments({ userId: new ObjectId(ids['cible']) }),
    ).toBe(0);

    // Le témoin n'est pas touché.
    expect(
      (await request(serveur()).get('/projects').set('Cookie', cookies['temoin']!)).status,
    ).toBe(200);

    // Débloquer sans note → 400 ; avec → 201, reconnexion.
    const sansNote = await request(serveur())
      .post(`/admin/users/${ids['cible']}/unblock`)
      .set('Cookie', cookies['pa']!)
      .send({});
    expect(sansNote.body.code).toBe('REASON_REQUIRED');
    const debloque = await request(serveur())
      .post(`/admin/users/${ids['cible']}/unblock`)
      .set('Cookie', cookies['pa']!)
      .send({ internalNote: 'Contestation acceptée.' });
    expect(debloque.status, JSON.stringify(debloque.body)).toBe(201);
    expect(debloque.body.disabledAt).toBeNull();
    const retour = await request(serveur())
      .post('/auth/sign-in/email')
      .send({ email: compte('cible').email, password: compte('cible').password });
    expect(retour.status, JSON.stringify(retour.body)).toBe(200);
    const raw = retour.headers['set-cookie'] as unknown as string[];
    cookies['cible'] = raw.map((x) => x.split(';')[0]!);
    expect(
      (await request(serveur()).get('/projects').set('Cookie', cookies['cible']!)).status,
    ).toBe(200);
  });

  it('critère 8 — une session encore en base d’un compte bloqué est refusée par AuthGuard', async () => {
    viderLimiteur();
    await db
      .collection('user')
      .updateOne({ _id: new ObjectId(ids['cible']) }, { $set: { disabledAt: new Date() } });
    try {
      const res = await request(serveur()).get('/projects').set('Cookie', cookies['cible']!);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_BLOCKED',
        message: 'Votre compte est bloqué. Contactez le support.',
      });
    } finally {
      await db
        .collection('user')
        .updateOne({ _id: new ObjectId(ids['cible']) }, { $set: { disabledAt: null } });
    }
    expect(
      (await request(serveur()).get('/projects').set('Cookie', cookies['cible']!)).status,
    ).toBe(200);
  });

  // ── Suspension (critère 9) et conflit d'intérêts (critère 13) ───────────────

  it('suspendre sans motif → 400 ; un opérateur membre de S, avec un autre détenteur → 409', async () => {
    viderLimiteur();
    const sans = await request(serveur())
      .post(`/admin/organizations/${orgS}/suspend`)
      .set('Cookie', cookies['pa']!)
      .send({ reason: 'ancien corps sans catégorie' });
    expect(sans.status).toBe(400);
    const conflit = await request(serveur())
      .post(`/admin/organizations/${orgS}/suspend`)
      .set('Cookie', cookies['saMembre']!)
      .send({
        reasonCategory: 'abuse',
        clientMessage: 'Activité anormale constatée.',
        internalNote: 'Signalement interne n° 12.',
      });
    expect(conflit.status).toBe(409);
    expect(conflit.body.code).toBe('PLATFORM_SELF_DEALING');
    expect(await db.collection('organization_suspensions').countDocuments({})).toBe(0);
  });

  it('critère 9 — `read_only` : lecture 200, écriture 423, l’autre organisation intacte', async () => {
    viderLimiteur();
    const res = await request(serveur())
      .post(`/admin/organizations/${orgS}/suspend`)
      .set('Cookie', cookies['pa']!)
      .send({
        reasonCategory: 'abuse',
        clientMessage: 'Activité anormale constatée.',
        internalNote: 'Signalement interne n° 12.',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ suspended: true, suspensionMode: 'read_only' });

    const cS = [...cookies['client']!, `active_org_id=${orgS}`];
    const cT = [...cookies['client']!, `active_org_id=${orgT}`];
    expect((await request(serveur()).get('/projects').set('Cookie', cS)).status).toBe(200);
    const ecrire = await request(serveur())
      .post('/projects')
      .set('Cookie', cS)
      .send({ name: `Bloqué ${tag}`, templateSlug: 'hello-world' });
    expect(ecrire.status).toBe(423);
    expect(ecrire.body.code).toBe('ORGANIZATION_SUSPENDED');
    const membres = await request(serveur())
      .get(`/organizations/${orgS}/members`)
      .set('Cookie', cS);
    expect(membres.status).toBe(200);

    const ailleurs = await request(serveur())
      .post('/projects')
      .set('Cookie', cT)
      .send({ name: `Libre ${tag}`, templateSlug: 'hello-world' });
    expect(ailleurs.status, JSON.stringify(ailleurs.body)).toBe(201);
    // La session du membre n'a pas été révoquée.
    expect((await request(serveur()).get('/organizations').set('Cookie', cS)).status).toBe(200);
  });

  it('critère 9 — rétablir exige un motif, puis l’écriture revient ; `full` : tout 423 sauf la liste', async () => {
    viderLimiteur();
    const sans = await request(serveur())
      .post(`/admin/organizations/${orgS}/restore`)
      .set('Cookie', cookies['pa']!)
      .send({});
    expect(sans.body.code).toBe('REASON_REQUIRED');
    const ok = await request(serveur())
      .post(`/admin/organizations/${orgS}/restore`)
      .set('Cookie', cookies['pa']!)
      .send({ liftReason: 'Vérification faite.', liftedClientMessage: 'Accès rétabli.' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.suspended).toBe(false);
    const cS = [...cookies['client']!, `active_org_id=${orgS}`];
    const ecrire = await request(serveur())
      .post('/projects')
      .set('Cookie', cS)
      .send({ name: `Rétabli ${tag}`, templateSlug: 'hello-world' });
    expect(ecrire.status, JSON.stringify(ecrire.body)).toBe(201);

    const full = await request(serveur())
      .post(`/admin/organizations/${orgS}/suspend`)
      .set('Cookie', cookies['pa']!)
      .send({
        reasonCategory: 'fraud',
        clientMessage: 'Compte gelé.',
        internalNote: 'Fraude au paiement avérée.',
        mode: 'full',
      });
    expect(full.status).toBe(201);
    const lire = await request(serveur()).get('/projects').set('Cookie', cS);
    expect(lire.status).toBe(423);
    expect(lire.body).toMatchObject({ code: 'ORGANIZATION_SUSPENDED', mode: 'full' });
    expect((await request(serveur()).get('/organizations').set('Cookie', cS)).status).toBe(200);
    // Levée par la route historique, motivée.
    const leve = await request(serveur())
      .delete(`/admin/organizations/${orgS}/suspend`)
      .set('Cookie', cookies['pa']!)
      .send({ liftReason: 'Remboursement reçu.', liftedClientMessage: 'Accès rétabli.' });
    expect(leve.status, JSON.stringify(leve.body)).toBe(200);
    expect((await request(serveur()).get('/projects').set('Cookie', cS)).status).toBe(200);
  });

  it('critère 13 — seul détenteur, l’opérateur membre suspend : permis et marqué `soleOperator`', async () => {
    viderLimiteur();
    // Les autres détenteurs de `platform.orgs.suspend` sont révoqués le temps du test.
    const autres = [ids['sa'], ids['pa']];
    await db
      .collection('platform_roles')
      .updateMany({ userId: { $in: autres } }, { $set: { revokedAt: new Date() } });
    try {
      const res = await request(serveur())
        .post(`/admin/organizations/${orgS}/suspend`)
        .set('Cookie', cookies['saMembre']!)
        .send({
          reasonCategory: 'request',
          clientMessage: 'Suspension à votre demande.',
          internalNote: 'Demande écrite du Propriétaire.',
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const leve = await request(serveur())
        .post(`/admin/organizations/${orgS}/restore`)
        .set('Cookie', cookies['saMembre']!)
        .send({ liftReason: 'Fin de la demande.', liftedClientMessage: 'Accès rétabli.' });
      expect(leve.status, JSON.stringify(leve.body)).toBe(201);
    } finally {
      await db
        .collection('platform_roles')
        .updateMany({ userId: { $in: autres } }, { $set: { revokedAt: null } });
    }
    const evts = await journalPlateforme('organization.suspended');
    const marque = (
      evts.body.events as { actorUserId: string; metadata: Record<string, unknown> }[]
    ).filter((e) => e.actorUserId === ids['saMembre']);
    expect(marque).toHaveLength(1);
    expect(marque[0]!.metadata['soleOperator']).toBe(true);
  });

  it('critère 11 — le client voit « Équipe Lalanda », jamais un opérateur ni une note interne', async () => {
    viderLimiteur();
    const res = await journalOrg(cookies['client']!, orgS);
    expect(res.status).toBe(200);
    const events = res.body.events as {
      action: string;
      actorUserId: string;
      actorRole: string;
      metadata: Record<string, unknown>;
    }[];
    const miroirs = events.filter((e) => e.actorUserId === PLATFORM_MIRROR_ACTOR_ID);
    const actions = miroirs.map((e) => e.action);
    for (const a of [
      'platform.organization.suspended',
      'platform.organization.restored',
      'platform.member.blocked',
      'platform.member.unblocked',
    ]) {
      expect(actions, a).toContain(a);
    }
    for (const e of miroirs) expect(e.actorRole).toBe('platform');
    const suspendu = miroirs.find((e) => e.action === 'platform.organization.suspended')!;
    expect(suspendu.metadata['clientMessage']).toBeTruthy();
    expect(String(suspendu.metadata['platformEventRef'])).toMatch(/^[0-9a-f]{24}$/);

    // Balayage : aucun identifiant (ni suffixe) ni rôle d'opérateur, aucune note interne.
    const brut = JSON.stringify(res.body);
    for (const cle of ['sa', 'pa', 'sup', 'saMembre']) {
      expect(brut, cle).not.toContain(ids[cle]!.slice(-8));
    }
    expect(brut).not.toMatch(/platform_(super_admin|admin|support|billing)/);
    for (const note of ['Signalement interne', 'Fraude au paiement', 'Spam répété']) {
      expect(brut).not.toContain(note);
    }
  });

  // ── Rôles plateforme (critère 16) ───────────────────────────────────────────

  it('critère 16 — motif obligatoire, échéance du Support, jamais à soi-même, adresse vérifiée', async () => {
    viderLimiteur();
    const c = cookies['sa']!;
    const cible = ids['temoinId'] ?? (ids['temoinId'] = await idDeSession(cookies['temoin']!));
    const post = (userId: string, corps: object) =>
      request(serveur()).post(`/admin/users/${userId}/platform-roles`).set('Cookie', c).send(corps);

    const sansMotif = await post(cible, { role: 'platform_admin' });
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe('REASON_REQUIRED');
    const support = await post(cible, { role: 'platform_support', reason: 'Renfort du support.' });
    expect(support.status).toBe(400);
    expect(support.body.code).toBe('SUPPORT_EXPIRY_REQUIRED');
    const soi = await post(ids['sa']!, {
      role: 'platform_admin',
      reason: 'Je me promeus moi-même.',
    });
    expect(soi.status).toBe(409);
    expect(soi.body.code).toBe('SELF_GRANT_FORBIDDEN');
    const nonVerifie = await post(cible, {
      role: 'platform_admin',
      reason: 'Renfort de l’équipe.',
    });
    expect(nonVerifie.status).toBe(409);
    expect(nonVerifie.body.code).toBe('EMAIL_NOT_VERIFIED');

    await db
      .collection('user')
      .updateOne({ _id: new ObjectId(cible) }, { $set: { emailVerified: true } });
    const ok = await post(cible, {
      role: 'platform_support',
      reason: 'Renfort du support.',
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const retrait = await request(serveur())
      .delete(`/admin/users/${cible}/platform-roles/platform_support`)
      .set('Cookie', c);
    expect(retrait.status).toBe(200);
  });

  it('changement d’offre historique : motif obligatoire, puis octroi et miroir côté client (P3)', async () => {
    viderLimiteur();
    const sans = await request(serveur())
      .patch(`/admin/organizations/${orgT}/plan`)
      .set('Cookie', cookies['sa']!)
      .send({ plan: 'free' });
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');
    const motif = {
      reasonCategory: 'request',
      clientMessage: 'Offre Pro accordée.',
      internalNote: 'Geste commercial validé.',
    };
    // `free` sans octroi en cours : rien à retirer.
    const rien = await request(serveur())
      .patch(`/admin/organizations/${orgT}/plan`)
      .set('Cookie', cookies['sa']!)
      .send({ plan: 'free', ...motif });
    expect(rien.status).toBe(409);
    expect(rien.body.code).toBe('NO_ACTIVE_GRANT');
    // ADR-0053 P3 : le palliatif `SECOND_PERSON_REQUIRED` est levé. Sans échéance, avec
    // d'autres détenteurs : l'octroi attend une seconde personne.
    const pro = await request(serveur())
      .patch(`/admin/organizations/${orgT}/plan`)
      .set('Cookie', cookies['sa']!)
      .send({ plan: 'pro', ...motif });
    expect(pro.status, JSON.stringify(pro.body)).toBe(200);
    expect(pro.body.grant).toMatchObject({ plan: 'pro', status: 'pending_approval' });
    const approuve = await request(serveur())
      .post(`/admin/billing/grants/${pro.body.grant.id}/approve`)
      .set('Cookie', cookies['pa']!)
      .send({});
    expect(approuve.status, JSON.stringify(approuve.body)).toBe(200);
    expect(approuve.body.status).toBe('active');
    // `free` retire l'octroi en cours.
    const retour = await request(serveur())
      .patch(`/admin/organizations/${orgT}/plan`)
      .set('Cookie', cookies['sa']!)
      .send({ plan: 'free', ...motif, clientMessage: 'Retour à votre offre.' });
    expect(retour.status, JSON.stringify(retour.body)).toBe(200);
    expect(retour.body.grant.status).toBe('revoked');
    const journal = await journalOrg(cookies['client']!, orgT);
    const actions = (journal.body.events as { action: string; actorUserId: string }[]).filter((e) =>
      e.action.startsWith('platform.billing.plan_grant'),
    );
    expect(actions.map((e) => e.action).sort()).toEqual([
      'platform.billing.plan_grant_revoked',
      'platform.billing.plan_granted',
    ]);
    for (const e of actions) expect(e.actorUserId).toBe(PLATFORM_MIRROR_ACTOR_ID);
  });

  // ── Session de console de 12 heures (§ 2.4) ─────────────────────────────────

  it('la console se referme après 12 h d’inactivité et se rouvre par une ré-authentification', async () => {
    viderLimiteur();
    const c = cookies['pa']!;
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
    await db
      .collection('platform_console_activity')
      .updateMany(
        { userId: ids['pa'] },
        { $set: { lastSeenAt: new Date(Date.now() - 13 * 3_600_000) } },
      );
    // La dernière ré-authentification précède l'inactivité, comme dans la vie réelle.
    await db
      .collection('platform_reauth')
      .updateMany(
        { userId: ids['pa'] },
        { $set: { confirmedAt: new Date(Date.now() - 14 * 3_600_000) } },
      );
    const expire = await request(serveur()).get('/admin/overview').set('Cookie', c);
    expect(expire.status).toBe(401);
    expect(expire.body.code).toBe('CONSOLE_SESSION_EXPIRED');
    // L'espace organisation n'est pas touché (le PA n'a pas d'organisation : 403 NO_ORGANIZATION,
    // jamais CONSOLE_SESSION_EXPIRED).
    const org = await request(serveur()).get('/projects').set('Cookie', c);
    expect(org.body.code).not.toBe('CONSOLE_SESSION_EXPIRED');
    await reauth('pa');
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
  });
});
