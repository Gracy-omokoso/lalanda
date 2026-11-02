// ADR-0053 — P5 : JOURNAL PLATEFORME, EXPORT CSV ET ÉVÉNEMENTS DE SÉCURITÉ (§ 6.5, § 7).
//
// Critère 12 : aucun événement de portée `platform` n'est servi par `GET /audit-events`
//              d'une organisation ; le journal d'une organisation reste le sien.
// Plus, pour le lot P5 :
//   - filtres combinés (action, acteur, cible, période) et pagination par curseur ;
//   - minimisation : ni montant ni adresse IP dans la vue ni dans le fichier exporté ;
//   - export : motif obligatoire (400 REASON_REQUIRED), journalisé
//     (`platform.audit.exported`), réservé au super-administrateur, limité en débit ;
//   - événements de sécurité : des COMPTES par jour (refus, ré-authentifications,
//     session d'un compte bloqué, blocages), sans identifiant ni adresse.
//
// Les compteurs de sécurité sont globaux et d'autres suites peuvent en produire : les
// assertions portent sur des ÉCARTS minimaux, jamais sur des valeurs absolues.

import { ThrottlerStorage } from '@nestjs/throttler';
import type { INestApplication } from '@nestjs/common';
import { ObjectId, type Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PLATFORM_AUDIT_LIMITS, type PlatformSecuritySummaryView } from '@lalanda/shared/platform';

import type { PlatformRole } from '../authz/permissions.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

interface EvtVue {
  id: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  redactedKeys: number;
  createdAt: string;
}

e2eSuite('ADR-0053 — P5 : journal plateforme, export et sécurité', () => {
  let app: INestApplication;
  let db: Db;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  const rolesPoses: ObjectId[] = [];
  const evenementsPoses: ObjectId[] = [];
  let orgClient = '';

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p5-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P5 ${cle}` };
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
  const poserRole = async (userId: string, role: PlatformRole) => {
    const r = await db.collection('platform_roles').insertOne({
      userId,
      role,
      grantedBy: null,
      reason: `suite e2e P5 ${tag}`,
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    rolesPoses.push(r.insertedId);
  };
  const reauth = async (cle: string) => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/admin/reauth')
      .set('Cookie', cookies[cle]!)
      .send({ password: compte(cle).password });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const journal = (cle: string, qs: string) =>
    request(serveur()).get(`/admin/audit-events?${qs}`).set('Cookie', cookies[cle]!);
  const securite = async (): Promise<PlatformSecuritySummaryView> => {
    const res = await request(serveur())
      .get('/admin/security-events')
      .set('Cookie', cookies['sa']!);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as PlatformSecuritySummaryView;
  };
  /** Les compteurs s'écrivent après la réponse observée : on attend qu'ils apparaissent. */
  const attendreTotaux = async (
    avant: PlatformSecuritySummaryView['totals'],
    ecarts: Partial<PlatformSecuritySummaryView['totals']>,
  ): Promise<PlatformSecuritySummaryView> => {
    let dernier = await securite();
    for (let i = 0; i < 40; i += 1) {
      const ok = Object.entries(ecarts).every(
        ([k, n]) => dernier.totals[k as keyof typeof avant] - avant[k as keyof typeof avant] >= n!,
      );
      if (ok) return dernier;
      await new Promise((r) => setTimeout(r, 50));
      dernier = await securite();
    }
    return dernier;
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);

    // Opérateurs sans organisation : super-administrateur, administrateur plateforme,
    // support, finance.
    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
      ['pa', 'platform_admin'],
      ['sup', 'platform_support'],
      ['fac', 'platform_billing'],
    ] as const) {
      cookies[cle] = await registerAndLogin(app, compte(cle));
      ids[cle] = await idDeSession(cookies[cle]);
      await db.collection('memberships').deleteMany({ userId: ids[cle] });
      await poserRole(ids[cle]!, role);
    }

    // Client : Propriétaire de son organisation personnelle, sans rôle plateforme.
    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['client']);
    orgClient = (orgs.body.organizations as { id: string }[])[0]!.id;

    // Un compte à bloquer.
    cookies['cible'] = await registerAndLogin(app, compte('cible'));
    ids['cible'] = await idDeSession(cookies['cible']);
    cookies['survivant'] = await registerAndLogin(app, compte('survivant'));
    ids['survivant'] = await idDeSession(cookies['survivant']);

    // Un événement plateforme ancien dont les métadonnées portent un montant et une IP :
    // la vue et l'export doivent les taire.
    const ins = await db.collection('audit_events').insertOne({
      organizationId: 'platform',
      actorUserId: ids['sa'],
      actorRole: 'platform_super_admin',
      action: `p5.test.${tag}`,
      targetType: 'organization',
      targetId: orgClient,
      metadata: {
        internalNote: `Note témoin ${tag}`,
        amountDueCents: 987654,
        currency: 'USD',
        ip: '203.0.113.77',
        userAgent: 'TemoinAgent/1.0',
      },
      _schemaVersion: 1,
      createdAt: new Date('2026-01-15T10:00:00Z'),
    });
    evenementsPoses.push(ins.insertedId);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (app) {
      await db.collection('platform_roles').deleteMany({ _id: { $in: rolesPoses } });
      await db.collection('audit_events').deleteMany({ _id: { $in: evenementsPoses } });
      await db
        .collection('audit_events')
        .deleteMany({ organizationId: 'platform', actorUserId: { $in: Object.values(ids) } });
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Accès ───────────────────────────────────────────────────────────────────

  it('§ 5.2 — lecture : super-administrateur et administrateur ; ni support ni finance ni client', async () => {
    viderLimiteur();
    for (const cle of ['sa', 'pa']) {
      expect((await journal(cle, 'limit=1')).status, cle).toBe(200);
      expect(
        (await request(serveur()).get('/admin/security-events').set('Cookie', cookies[cle]!))
          .status,
        cle,
      ).toBe(200);
    }
    for (const cle of ['sup', 'fac', 'client']) {
      for (const chemin of [
        '/admin/audit-events',
        '/admin/security-events',
        '/admin/audit-events/export.csv?reason=security',
      ]) {
        const res = await request(serveur()).get(chemin).set('Cookie', cookies[cle]!);
        expect(res.status, `${cle} ${chemin}`).toBe(403);
      }
    }
    // L'export est au seul super-administrateur.
    const pa = await request(serveur())
      .get('/admin/audit-events/export.csv?reason=security')
      .set('Cookie', cookies['pa']!);
    expect(pa.status).toBe(403);
    expect(pa.body).toMatchObject({ code: 'FORBIDDEN', action: 'platform.audit.export' });
  });

  // ── Filtres et pagination ─────────────────────────────────────────────────

  it('filtres combinés : action, acteur, cible et période', async () => {
    viderLimiteur();
    // Deux lectures de fiche journalisées, par deux opérateurs.
    for (const cle of ['sa', 'pa']) {
      const res = await request(serveur())
        .get(`/admin/organizations/${orgClient}?reason=support`)
        .set('Cookie', cookies[cle]!);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const base = `action=platform.organization.viewed&targetType=organization&targetId=${orgClient}`;

    const tous = await journal('sa', base);
    expect(tous.status).toBe(200);
    const acteurs = (tous.body.events as EvtVue[]).map((e) => e.actorUserId);
    expect(acteurs).toEqual(expect.arrayContaining([ids['sa'], ids['pa']]));

    const parActeur = await journal('sa', `${base}&actorUserId=${ids['pa']}`);
    expect((parActeur.body.events as EvtVue[]).map((e) => e.actorUserId)).toEqual([ids['pa']]);
    expect((parActeur.body.events as EvtVue[])[0]!.metadata['reason']).toBe('support');

    const today = new Date().toISOString().slice(0, 10);
    const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      ((await journal('sa', `${base}&from=${today}&to=${today}`)).body.events as EvtVue[]).length,
    ).toBeGreaterThanOrEqual(2);
    expect((await journal('sa', `${base}&from=${demain}`)).body.events).toEqual([]);
    expect((await journal('sa', `${base}&to=2026-01-01`)).body.events).toEqual([]);

    // Une autre cible : rien.
    expect(
      (await journal('sa', `action=platform.organization.viewed&targetId=${'f'.repeat(24)}`)).body
        .events,
    ).toEqual([]);
  });

  it('pagination : curseur sans saut ni doublon ; filtres invalides → 400', async () => {
    viderLimiteur();
    const base = `action=platform.organization.viewed&targetId=${orgClient}`;
    const p1 = await journal('sa', `${base}&limit=1`);
    expect(p1.status).toBe(200);
    expect(p1.body.events).toHaveLength(1);
    expect(typeof p1.body.nextCursor).toBe('string');
    const p2 = await journal(
      'sa',
      `${base}&limit=1&before=${encodeURIComponent(p1.body.nextCursor as string)}`,
    );
    expect(p2.body.events).toHaveLength(1);
    expect(p2.body.events[0].id).not.toBe(p1.body.events[0].id);
    expect(new Date(p2.body.events[0].createdAt).getTime()).toBeLessThanOrEqual(
      new Date(p1.body.events[0].createdAt).getTime(),
    );

    for (const qs of [
      'limit=501',
      'from=hier',
      'action=$ne',
      'actorUserId[$ne]=x',
      'before=pas-un-curseur',
      'from=2026-11-02&to=2026-11-01',
    ]) {
      const res = await journal('sa', qs);
      expect(res.status, qs).toBe(400);
    }
  });

  // ── Minimisation ──────────────────────────────────────────────────────────

  it('ni montant ni adresse IP dans la vue : liste blanche, clés retirées comptées', async () => {
    viderLimiteur();
    const res = await journal('sa', `action=p5.test.${tag}`);
    expect(res.status).toBe(200);
    const [evt] = res.body.events as EvtVue[];
    expect(evt).toBeDefined();
    expect(evt!.metadata).toEqual({ internalNote: `Note témoin ${tag}` });
    expect(evt!.redactedKeys).toBe(4);
    const brut = JSON.stringify(res.body);
    for (const temoin of ['987654', '203.0.113.77', 'TemoinAgent', 'amountDueCents']) {
      expect(brut, temoin).not.toContain(temoin);
    }
  });

  // ── Export ────────────────────────────────────────────────────────────────

  it('export : motif obligatoire, CSV minimisé, export journalisé avec son motif', async () => {
    viderLimiteur();
    const sans = await request(serveur())
      .get(`/admin/audit-events/export.csv?action=p5.test.${tag}`)
      .set('Cookie', cookies['sa']!);
    expect(sans.status).toBe(400);
    expect(sans.body.code).toBe('REASON_REQUIRED');

    const res = await request(serveur())
      .get(`/admin/audit-events/export.csv?action=p5.test.${tag}&reason=security`)
      .set('Cookie', cookies['sa']!)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toMatch(
      /attachment; filename="journal-plateforme-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers['x-export-truncated']).toBe('0');
    const csv = res.body as string;
    const lignes = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lignes[0]).toMatch(/^date;action;acteur;roles_acteur;type_cible;cible;motif;/);
    expect(lignes).toHaveLength(2);
    expect(lignes[1]).toContain(`Note témoin ${tag}`);
    for (const temoin of ['987654', '203.0.113.77', 'TemoinAgent', 'USD']) {
      expect(csv, temoin).not.toContain(temoin);
    }

    const trace = await journal('sa', `action=platform.audit.exported&actorUserId=${ids['sa']}`);
    const [exporte] = trace.body.events as EvtVue[];
    expect(exporte).toBeDefined();
    expect(exporte!.actorRole).toBe('platform_super_admin');
    expect(exporte!.metadata).toMatchObject({
      reason: 'security',
      rowCount: 1,
      truncated: false,
      filterAction: `p5.test.${tag}`,
    });
  });

  it(`export limité en débit : ${PLATFORM_AUDIT_LIMITS.exportPerHour} par heure et par opérateur, puis 429`, async () => {
    viderLimiteur();
    const exporter = () =>
      request(serveur())
        .get(`/admin/audit-events/export.csv?action=p5.test.${tag}&reason=support`)
        .set('Cookie', cookies['sa']!);
    for (let i = 0; i < PLATFORM_AUDIT_LIMITS.exportPerHour; i += 1) {
      expect((await exporter()).status, `export n° ${i + 1}`).toBe(200);
    }
    const refuse = await exporter();
    expect(refuse.status).toBe(429);
    expect(refuse.body.code).toBe('PLATFORM_AUDIT_EXPORT_RATE_LIMITED');
    viderLimiteur();
  });

  // ── Événements de sécurité ────────────────────────────────────────────────

  it('événements de sécurité : refus, ré-authentifications, compte bloqué — des comptes seulement', async () => {
    viderLimiteur();
    const avant = (await securite()).totals;

    // Ré-authentification échouée puis réussie.
    const ko = await request(serveur())
      .post('/admin/reauth')
      .set('Cookie', cookies['pa']!)
      .send({ password: 'mauvais-mot-de-passe' });
    expect(ko.status).toBe(401);
    await reauth('sa');
    // Refus 403 sur la console : support et client.
    expect((await journal('sup', 'limit=1')).status).toBe(403);
    expect(
      (await request(serveur()).get('/admin/overview').set('Cookie', cookies['client']!)).status,
    ).toBe(403);
    // Écriture sans ré-authentification.
    const sansReauth = await request(serveur())
      .post(`/admin/users/${ids['cible']}/block`)
      .set('Cookie', cookies['pa']!)
      .send({ reasonCategory: 'abuse', internalNote: 'Comptes multiples suspects.' });
    expect(sansReauth.status).toBe(401);
    // Blocage, puis session antérieure refusée.
    const bloque = await request(serveur())
      .post(`/admin/users/${ids['cible']}/block`)
      .set('Cookie', cookies['sa']!)
      .send({ reasonCategory: 'abuse', internalNote: 'Comptes multiples suspects.' });
    expect(bloque.status, JSON.stringify(bloque.body)).toBe(201);
    // Le blocage révoque les sessions (401 ensuite). Une session qui lui SURVIT (posée en
    // base sans révocation) est refusée par la garde : 403 ACCOUNT_BLOCKED, compté.
    await db
      .collection('user')
      .updateOne({ _id: new ObjectId(ids['survivant']) }, { $set: { disabledAt: new Date() } });
    const refusee = await request(serveur())
      .get('/organizations')
      .set('Cookie', cookies['survivant']!);
    expect(refusee.status).toBe(403);
    expect(refusee.body.code).toBe('ACCOUNT_BLOCKED');

    const apres = await attendreTotaux(avant, {
      reauth_failed: 1,
      reauth_succeeded: 1,
      console_forbidden: 2,
      reauth_required: 1,
      account_blocked: 1,
      blocked_session_refused: 1,
    });
    const ecart = (k: keyof typeof avant) => apres.totals[k] - avant[k];
    expect(ecart('reauth_failed')).toBeGreaterThanOrEqual(1);
    expect(ecart('reauth_succeeded')).toBeGreaterThanOrEqual(1);
    expect(ecart('console_forbidden')).toBeGreaterThanOrEqual(2);
    expect(ecart('reauth_required')).toBeGreaterThanOrEqual(1);
    expect(ecart('account_blocked')).toBeGreaterThanOrEqual(1);
    expect(ecart('blocked_session_refused')).toBeGreaterThanOrEqual(1);
    expect(apres.totals.audit_exported).toBeGreaterThanOrEqual(1);
    expect(apres.blockedAccountsNow).toBeGreaterThanOrEqual(1);

    // Agrégat seulement : aucun identifiant, aucune adresse, aucune organisation.
    const brut = JSON.stringify(apres);
    for (const temoin of [...Object.values(ids), orgClient, tag, '@lalanda-test.local']) {
      expect(brut, temoin).not.toContain(temoin);
    }
    expect(apres.days).toHaveLength(PLATFORM_AUDIT_LIMITS.securityDefaultDays);

    // Période bornée.
    const trop = await request(serveur())
      .get('/admin/security-events?from=2026-01-01&to=2026-11-01')
      .set('Cookie', cookies['sa']!);
    expect(trop.status).toBe(400);
  });

  // ── Critère 12 ──────────────────────────────────────────────────────────────

  it('critère 12 — le journal d’une organisation ne sert aucun événement plateforme', async () => {
    viderLimiteur();
    const res = await request(serveur())
      .get('/audit-events?limit=500')
      .set('Cookie', [...cookies['client']!, `active_org_id=${orgClient}`]);
    expect(res.status).toBe(200);
    const brut = JSON.stringify(res.body);
    for (const temoin of [
      `p5.test.${tag}`,
      `Note témoin ${tag}`,
      'platform.audit.exported',
      'platform.organization.viewed',
      ids['sa']!,
      ids['pa']!,
    ]) {
      expect(brut, temoin).not.toContain(temoin);
    }
    // Et le filtre du journal plateforme ne sort jamais de sa portée.
    const plat = await journal('sa', `targetId=${orgClient}&limit=500`);
    expect(
      (plat.body.events as EvtVue[]).every(
        (e) => !e.actorUserId.startsWith('platform:') && e.actorRole !== 'platform',
      ),
    ).toBe(true);
  });
});
