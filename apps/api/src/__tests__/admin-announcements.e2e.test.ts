// ADR-0053 — P6 : ANNONCES DE LA PLATEFORME (`/admin/announcements/**`, `/me/announcements`).
//
// Critère 19 : l'auteur n'approuve pas (`409 SELF_APPROVAL_FORBIDDEN`) quand un autre
//              approbateur existe ; `send` sans le nombre exact → `409 AUDIENCE_COUNT_MISMATCH` ;
//              l'annonce atteint exactement les Propriétaires d'organisations `pro` au Congo,
//              et aucun autre ; aucun e-mail n'est émis (MailService espionné).
// Plus : aucun rôle d'organisation ne crée d'annonce ; une organisation hors cible ne la
// voit pas ; la vue du destinataire ne révèle pas la catégorie ; fermer est idempotent et
// sans doublon ; l'aperçu précède la soumission ; annulation motivée ; approbateur unique
// marqué ; une date de fin passée est refusée ; chaque étape au journal plateforme.

import { ThrottlerStorage } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi, type MockInstance } from 'vitest';

import type { PlatformRole } from '../authz/permissions.js';
import { MailService } from '../mail/mail.service.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('ADR-0053 — P6 : annonces par catégorie, circuit à deux personnes', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const orgs: Record<string, string> = {};
  const espions: MockInstance[] = [];
  let annonce = '';
  let approuve = 0;

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p6-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P6 ${cle}` };
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
      reason: `suite e2e P6 ${tag}`,
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
      .send({ password: compte(cle).password });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const poster = (cle: string, chemin: string, corps: object = {}) =>
    request(serveur()).post(chemin).set('Cookie', cookies[cle]!).send(corps);
  const mesAnnonces = (cle: string) =>
    request(serveur()).get('/me/announcements').set('Cookie', cookies[cle]!);
  const abonner = (organizationId: string, plan: string, status: string) =>
    db.collection('subscriptions').updateOne(
      { organizationId },
      {
        $set: { plan, status, billingInterval: 'month', updatedAt: new Date() },
        $setOnInsert: { statusHistory: [], _schemaVersion: 1, createdAt: new Date() },
      },
      { upsert: true },
    );
  const BROUILLON = {
    title: 'Maintenance planifiée',
    body: 'Lalanda sera indisponible samedi de 2 h à 4 h.',
    audience: { ownersOnly: true, plans: ['pro'], countries: ['CD'] },
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    // Base propre à ce fichier : les détenteurs d'approbation sont exactement les nôtres.
    await db.collection('platform_roles').deleteMany({});
    await db.collection('platform_announcements').deleteMany({});
    await db.collection('platform_announcement_receipts').deleteMany({});

    // Clients : A (pro, CD) — Propriétaire `a`, lecteur `lecteur` ; B (pro, FR) ;
    // C (gratuite, CD). Chacun garde son organisation personnelle, ramenée à `free`.
    for (const cle of ['a', 'lecteur', 'b', 'c']) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      const liste = await request(serveur()).get('/organizations').set('Cookie', cookies[cle]);
      orgs[cle] = (liste.body.organizations as { id: string }[])[0]!.id;
      await abonner(orgs[cle], 'free', 'canceled');
    }
    await abonner(orgs['a']!, 'pro', 'active');
    await abonner(orgs['b']!, 'pro', 'active');
    await db
      .collection('organizations')
      .updateOne({ _id: new ObjectId(orgs['b']) }, { $set: { pays: 'FR' } });
    await db
      .collection('organizations')
      .updateMany(
        { _id: { $in: ['a', 'c', 'lecteur'].map((k) => new ObjectId(orgs[k])) } },
        { $set: { pays: 'CD' } },
      );
    await db.collection('memberships').insertOne({
      userId: ids['lecteur'],
      organizationId: orgs['a'],
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

    // Opérateurs sans organisation.
    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['pa', 'platform_admin'],
      ['sup', 'platform_support'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      await db.collection('memberships').deleteMany({ userId: ids[cle] });
      await poserRole(ids[cle]!, role);
    }

    // Aucun e-mail ne doit partir : chaque méthode de MailService est espionnée.
    const mail = app.get(MailService) as unknown as Record<string, unknown>;
    const proto = Object.getPrototypeOf(mail) as Record<string, unknown>;
    for (const nom of Object.getOwnPropertyNames(proto)) {
      if (nom.startsWith('send') && typeof mail[nom] === 'function') {
        espions.push(vi.spyOn(mail as never, nom as never));
      }
    }
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.collection('platform_roles').deleteMany({ reason: `suite e2e P6 ${tag}` });
      await db.collection('platform_announcements').deleteMany({});
      await db.collection('platform_announcement_receipts').deleteMany({});
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Accès ───────────────────────────────────────────────────────────────────

  it('aucun rôle d’organisation ni le Support ne crée d’annonce (403, action plateforme)', async () => {
    viderLimiteur();
    for (const cle of ['a', 'lecteur', 'sup']) {
      const res = await poster(cle, '/admin/announcements', BROUILLON);
      expect(res.status, cle).toBe(403);
      expect(res.body).toMatchObject({
        code: 'FORBIDDEN',
        action: 'platform.announcements.draft',
      });
    }
    expect(await db.collection('platform_announcements').countDocuments({})).toBe(0);
  });

  it('sans ré-authentification, toute écriture → 401 REAUTH_REQUIRED ; l’aperçu n’en demande pas', async () => {
    viderLimiteur();
    const factice = '0123456789abcdef01234567';
    for (const [verbe, chemin] of [
      ['post', '/admin/announcements'],
      ['put', `/admin/announcements/${factice}`],
      ['post', `/admin/announcements/${factice}/submit`],
      ['post', `/admin/announcements/${factice}/approve`],
      ['post', `/admin/announcements/${factice}/send`],
      ['post', `/admin/announcements/${factice}/cancel`],
    ] as const) {
      const res = await request(serveur())[verbe](chemin).set('Cookie', cookies['sa']!).send({});
      expect(res.status, `${verbe} ${chemin}`).toBe(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    }
    const apercu = await poster('sa', `/admin/announcements/${factice}/preview`);
    expect(apercu.status).toBe(404);
  });

  it('les opérateurs se ré-authentifient', async () => {
    for (const cle of ['sa', 'pa']) await reauth(cle);
  });

  // ── Circuit (critère 19) ────────────────────────────────────────────────────

  it('brouillon : catégorie invalide ou date de fin passée → 400', async () => {
    const role = await poster('pa', '/admin/announcements', {
      ...BROUILLON,
      audience: { orgRoles: ['pirate'] },
    });
    expect(role.status).toBe(400);
    expect(role.body.code).toBe('AUDIENCE_INVALID');
    const passe = await poster('pa', '/admin/announcements', {
      ...BROUILLON,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(passe.status).toBe(400);
    expect(passe.body.code).toBe('ANNOUNCEMENT_EXPIRED');
    const html = await poster('pa', '/admin/announcements', {
      ...BROUILLON,
      audience: { projectName: 'x' },
    });
    expect(html.status).toBe(400);
  });

  it('l’auteur prépare ; l’aperçu précède la soumission et donne un NOMBRE, jamais une liste', async () => {
    const cree = await poster('pa', '/admin/announcements', BROUILLON);
    expect(cree.status, JSON.stringify(cree.body)).toBe(201);
    expect(cree.body).toMatchObject({ status: 'draft', channel: 'in_app' });
    annonce = cree.body.id as string;

    const tot = await poster('pa', `/admin/announcements/${annonce}/submit`);
    expect(tot.status).toBe(409);
    expect(tot.body.code).toBe('PREVIEW_REQUIRED');

    const apercu = await poster('pa', `/admin/announcements/${annonce}/preview`);
    expect(apercu.status).toBe(200);
    expect(typeof apercu.body.previewCount).toBe('number');
    expect(apercu.body.previewCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(apercu.body)).not.toContain('@lalanda-test.local');

    // Une autre personne ne réécrit pas le brouillon de l'auteur.
    const autre = await request(serveur())
      .put(`/admin/announcements/${annonce}`)
      .set('Cookie', cookies['sa']!)
      .send(BROUILLON);
    expect(autre.status).toBe(403);
    expect(autre.body.code).toBe('ANNOUNCEMENT_NOT_AUTHOR');

    const soumis = await poster('pa', `/admin/announcements/${annonce}/submit`);
    expect(soumis.status).toBe(200);
    expect(soumis.body.status).toBe('pending_approval');
  });

  it('critère 19 — l’auteur n’approuve pas quand un autre approbateur existe (409)', async () => {
    const res = await poster('pa', `/admin/announcements/${annonce}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('la seconde personne approuve ; le nombre est recalculé', async () => {
    const res = await poster('sa', `/admin/announcements/${annonce}/approve`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', soleApprover: false });
    approuve = res.body.audienceCountAtApproval as number;
    expect(approuve).toBeGreaterThanOrEqual(1);
  });

  it('critère 19 — `send` sans le nombre exact → 409 AUDIENCE_COUNT_MISMATCH ; rien n’est livré', async () => {
    for (const corps of [{ confirmedAudienceCount: approuve + 1 }, { confirmedAudienceCount: 0 }]) {
      const res = await poster('sa', `/admin/announcements/${annonce}/send`, corps);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUDIENCE_COUNT_MISMATCH');
    }
    const sans = await poster('sa', `/admin/announcements/${annonce}/send`, {});
    expect(sans.status).toBe(400);
    expect(await db.collection('platform_announcement_receipts').countDocuments({})).toBe(0);
  });

  it('critère 19 — envoyée, elle atteint exactement les Propriétaires `pro` au Congo', async () => {
    const res = await poster('sa', `/admin/announcements/${annonce}/send`, {
      confirmedAudienceCount: approuve,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'sent', recipientCount: approuve });
    expect(res.body.sentAt).not.toBeNull();
    expect(new Date(res.body.expiresAt as string).getTime()).toBeGreaterThan(Date.now());

    const accuses = await db
      .collection('platform_announcement_receipts')
      .find({ announcementId: annonce })
      .toArray();
    expect(accuses).toHaveLength(approuve);
    const destinataires = new Set(accuses.map((r) => String(r['userId'])));
    expect(destinataires.size).toBe(approuve);
    expect(destinataires.has(ids['a']!)).toBe(true);
    for (const hors of ['lecteur', 'b', 'c', 'sa', 'pa', 'sup']) {
      expect(destinataires.has(ids[hors]!), hors).toBe(false);
    }
    // Chaque destinataire est Propriétaire d'une organisation `pro` au Congo.
    for (const userId of destinataires) {
      const appartenances = await db
        .collection('memberships')
        .find({ userId, role: 'owner' })
        .toArray();
      const orgIds = appartenances.map((m) => String(m['organizationId']));
      const congo = await db
        .collection('organizations')
        .find({ _id: { $in: orgIds.map((o) => new ObjectId(o)) }, pays: 'CD' })
        .toArray();
      const pro = await db.collection('subscriptions').countDocuments({
        organizationId: { $in: congo.map((o) => String(o['_id'])) },
        plan: 'pro',
      });
      expect(pro, userId).toBeGreaterThan(0);
    }
  });

  it('un second envoi ne double rien (idempotence)', async () => {
    const res = await poster('sa', `/admin/announcements/${annonce}/send`, {
      confirmedAudienceCount: approuve,
    });
    expect(res.status).toBe(409);
    expect(
      await db
        .collection('platform_announcement_receipts')
        .countDocuments({ announcementId: annonce }),
    ).toBe(approuve);
  });

  it('critère 19 — aucun e-mail n’est émis', () => {
    expect(espions.length).toBeGreaterThan(3);
    for (const espion of espions) expect(espion).not.toHaveBeenCalled();
  });

  // ── Livraison in-app ────────────────────────────────────────────────────────

  it('le destinataire la lit, sans catégorie ni nombre ni auteur', async () => {
    const res = await mesAnnonces('a');
    expect(res.status).toBe(200);
    const liste = res.body.announcements as Array<Record<string, unknown>>;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({
      id: annonce,
      kind: 'platform.announcement',
      title: BROUILLON.title,
      body: BROUILLON.body,
      readAt: null,
      dismissedAt: null,
    });
    expect(Object.keys(liste[0]!).sort()).toEqual(
      ['body', 'dismissedAt', 'expiresAt', 'id', 'kind', 'readAt', 'startsAt', 'title'].sort(),
    );
    const texte = JSON.stringify(res.body);
    for (const fuite of ['audience', 'CD', 'pro', orgs['b']!, ids['sa']!, ids['pa']!]) {
      expect(texte, fuite).not.toContain(fuite);
    }
  });

  it('une organisation hors cible ne la voit pas (lecteur de A, B au Congo-non, C gratuite)', async () => {
    for (const cle of ['lecteur', 'b', 'c']) {
      const res = await mesAnnonces(cle);
      expect(res.status, cle).toBe(200);
      expect(res.body.announcements, cle).toEqual([]);
      const lire = await poster(cle, `/me/announcements/${annonce}/dismiss`);
      expect(lire.status, cle).toBe(404);
    }
  });

  it('lire puis fermer : idempotent, sans doublon', async () => {
    const lue = await poster('a', `/me/announcements/${annonce}/read`);
    expect(lue.status).toBe(200);
    expect(lue.body.readAt).not.toBeNull();
    const fermee = await poster('a', `/me/announcements/${annonce}/dismiss`);
    expect(fermee.status).toBe(200);
    expect(fermee.body.dismissedAt).not.toBeNull();
    expect(fermee.body.readAt).toBe(lue.body.readAt);
    const encore = await poster('a', `/me/announcements/${annonce}/dismiss`);
    expect(encore.body.dismissedAt).toBe(fermee.body.dismissedAt);
    const liste = await mesAnnonces('a');
    expect(liste.body.announcements).toHaveLength(1);
  });

  // ── Annulation, approbateur unique, catégorie « tous » ──────────────────────

  it('annuler exige un motif ; annulée, elle ne se soumet plus', async () => {
    const cree = await poster('pa', '/admin/announcements', BROUILLON);
    const id = cree.body.id as string;
    const sans = await poster('pa', `/admin/announcements/${id}/cancel`, {});
    expect(sans.status).toBe(400);
    const ok = await poster('pa', `/admin/announcements/${id}/cancel`, {
      reason: 'Texte à reprendre avec le support.',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('canceled');
    const apres = await poster('pa', `/admin/announcements/${id}/submit`);
    expect(apres.status).toBe(409);
  });

  it('approbateur unique : l’auteur s’approuve, geste marqué `soleApprover`', async () => {
    await db
      .collection('platform_roles')
      .updateMany({ userId: ids['sa'] }, { $set: { revokedAt: new Date() } });
    try {
      const cree = await poster('pa', '/admin/announcements', {
        ...BROUILLON,
        audience: { ownersOnly: true, countries: ['FR'] },
      });
      const id = cree.body.id as string;
      await poster('pa', `/admin/announcements/${id}/preview`);
      await poster('pa', `/admin/announcements/${id}/submit`);
      const res = await poster('pa', `/admin/announcements/${id}/approve`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.soleApprover).toBe(true);
    } finally {
      await db
        .collection('platform_roles')
        .updateMany({ userId: ids['sa'] }, { $set: { revokedAt: null } });
    }
  });

  // ── Journal plateforme ──────────────────────────────────────────────────────

  it('tout l’enchaînement est au journal plateforme, avec les rôles réels', async () => {
    const res = await request(serveur())
      .get('/admin/audit-events?limit=500')
      .set('Cookie', cookies['sa']!);
    expect(res.status).toBe(200);
    const evenements = (res.body.events as Array<Record<string, unknown>>).filter(
      (e) => e['targetId'] === annonce,
    );
    const actions = evenements.map((e) => e['action']);
    for (const a of [
      'platform.announcement.drafted',
      'platform.announcement.previewed',
      'platform.announcement.submitted',
      'platform.announcement.approved',
      'platform.announcement.send_refused',
      'platform.announcement.sent',
    ]) {
      expect(actions, a).toContain(a);
    }
    const envoi = evenements.find((e) => e['action'] === 'platform.announcement.sent')!;
    expect(envoi['actorUserId']).toBe(ids['sa']);
    expect(envoi['actorRole']).toBe('platform_super_admin');
    // Rien au journal d'une organisation cliente.
    const client = await request(serveur())
      .get('/audit-events?limit=500')
      .set('Cookie', [...cookies['a']!, `active_org_id=${orgs['a']}`]);
    expect(JSON.stringify(client.body)).not.toContain('announcement');
  });
});
