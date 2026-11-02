// ADR-0053 — P4 : FONCTIONNALITÉS PAR OFFRE (critère 18).
//
// 1. Non-régression : avec la grille par défaut (entièrement ouverte), AUCUNE route
//    gardée ne répond `FEATURE_NOT_IN_PLAN`, pour chacune des cinq offres existantes.
//    Les mêmes routes, sous une grille de test qui ferme tout à `free`, le répondent :
//    la preuve porte donc bien sur des routes gardées.
// 2. Grille de test fermant `crm` à `free` : `POST /crm/opportunities` → 403
//    FEATURE_NOT_IN_PLAN (offre minimale `pro`), `GET /crm/opportunities` → 200
//    (patrimoine lisible) ; une dérogation active rouvre l'écriture, échue la referme,
//    levée la referme.
// 3. Console : lecture `platform.features.read`, écriture `platform.features.override`
//    sous ré-authentification, motif et échéance de 90 jours au plus, conflit
//    d'intérêts, miroir « Équipe Lalanda » sans l'opérateur, `GET /me/features`.

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { PLATFORM_MIRROR_ACTOR_ID } from '@lalanda/shared/platform';
import {
  DEFAULT_FEATURE_GRID,
  FEATURE_KEYS,
  FEATURES,
  PLANS,
  type FeatureGrid,
  type FeatureKey,
} from '@lalanda/shared/pricing';

import { FeatureAccessService } from '../admin/features/feature-access.service.js';
import type { PlatformRole } from '../authz/permissions.js';
import { BillingService } from '../billing/billing.service.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
// ADR-0053 — P8 : tout opérateur s'enrôle ; ré-authentification = mot de passe + code.
import { corpsReauth, enrolerDeuxFacteurs } from './platform-2fa-e2e.js';

const DAY_MS = 86_400_000;

function fermer(grid: FeatureGrid, keys: readonly FeatureKey[], plans: readonly string[]) {
  const out: Record<string, Record<string, boolean>> = {};
  for (const k of FEATURE_KEYS) {
    out[k] = { ...grid[k] };
    if (keys.includes(k)) for (const p of plans) out[k]![p] = false;
  }
  return out as unknown as FeatureGrid;
}

e2eSuite('ADR-0053 — P4 : fonctionnalités par offre', () => {
  let app: INestApplication;
  let db: Db;
  let features: FeatureAccessService;
  let billing: BillingService;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const ids: Record<string, string> = {};
  let org = '';

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p4-${cle.toLowerCase()}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P4 ${cle}` };
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
  const client = () => [...cookies['client']!, `active_org_id=${org}`];
  const reauth = async (cle: string) => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/admin/reauth')
      .set('Cookie', cookies[cle]!)
      .send(await corpsReauth(app, db, cookies[cle]!, compte(cle).password));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  };
  const derogation = (over: Record<string, unknown> = {}) => ({
    targetOrganizationId: org,
    feature: 'crm',
    value: true,
    reasonCategory: 'request',
    internalNote: 'Essai du CRM demandé par le client.',
    endsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    ...over,
  });
  const ecrireOpportunite = () =>
    request(serveur()).post('/crm/opportunities').set('Cookie', client()).send({});

  /** Routes d'écriture gardées, relevées dans le routeur Express (trois par fonctionnalité). */
  const routesGardees = (): Array<{ feature: FeatureKey; method: string; path: string }> => {
    const pile = (
      app.getHttpAdapter().getInstance() as {
        _router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
      }
    )._router.stack;
    const out: Array<{ feature: FeatureKey; method: string; path: string }> = [];
    for (const feature of FEATURE_KEYS) {
      const prefixes = FEATURES[feature].apiPrefixes.map((p) => p.replace(/:[A-Za-z]+/g, ':'));
      const trouvees = pile
        .filter((l) => l.route)
        .flatMap((l) =>
          Object.keys(l.route!.methods)
            .filter((m) => m !== 'get' && m !== 'head' && m !== '_all')
            .map((m) => ({ method: m, path: l.route!.path })),
        )
        .filter(({ path }) => {
          const p = path.replace(/:[A-Za-z]+/g, ':');
          return prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`));
        })
        .filter(({ path }) => !path.startsWith('/public/'))
        .slice(0, 3);
      expect(trouvees.length, `aucune route d'écriture pour ${feature}`).toBeGreaterThan(0);
      for (const r of trouvees) out.push({ feature, ...r });
    }
    return out;
  };
  const appeler = (r: { method: string; path: string }) => {
    const chemin = r.path.replace(/:[A-Za-z]+/g, new ObjectId().toHexString());
    const req = request(serveur());
    const verbe = r.method as 'post' | 'put' | 'patch' | 'delete';
    return req[verbe](chemin).set('Cookie', client()).send({});
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    features = app.get(FeatureAccessService);
    billing = app.get(BillingService);
    await db.collection('platform_roles').deleteMany({});
    await db.collection('platform_feature_overrides').deleteMany({});
    await db.collection('platform_plan_grants').deleteMany({});

    const poserRole = (userId: string, role: PlatformRole) =>
      db.collection('platform_roles').insertOne({
        userId,
        role,
        grantedBy: null,
        reason: `suite e2e P4 ${tag}`,
        expiresAt: null,
        revokedAt: null,
        _schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const idDeSession = async (c: string[]) =>
      String(
        (await request(serveur()).get('/auth/get-session').set('Cookie', c)).body?.user?.id ?? '',
      );

    cookies['client'] = await registerAndLogin(app, compte('client'));
    ids['client'] = await idDeSession(cookies['client']);
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['client']);
    org = (orgs.body.organizations as { id: string }[])[0]!.id;

    for (const [cle, role] of [
      ['sa', 'platform_super_admin'],
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
    await db.collection('memberships').insertOne({
      userId: ids['saMembre'],
      organizationId: org,
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

  afterEach(() => {
    features?.replaceGridForTesting(null);
  });

  afterAll(async () => {
    await db?.collection('platform_feature_overrides').deleteMany({ targetOrganizationId: org });
    await db?.collection('platform_roles').deleteMany({ reason: `suite e2e P4 ${tag}` });
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  it('critère 18 — grille par défaut : aucune route gardée ne répond FEATURE_NOT_IN_PLAN, quelle que soit l’offre', async () => {
    expect(features.currentGrid()).toBe(DEFAULT_FEATURE_GRID);
    const routes = routesGardees();
    for (const plan of PLANS) {
      await billing.setPlan(org, plan);
      for (const r of routes) {
        const res = await appeler(r);
        expect(
          res.body?.code,
          `${plan} ${r.method.toUpperCase()} ${r.path} → ${res.status}`,
        ).not.toBe('FEATURE_NOT_IN_PLAN');
      }
    }

    // Témoin : les MÊMES routes, toutes fermées à `free`, sont bien gardées.
    await billing.setPlan(org, 'free');
    features.replaceGridForTesting(fermer(DEFAULT_FEATURE_GRID, FEATURE_KEYS, ['free']));
    for (const r of routes) {
      const res = await appeler(r);
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(403);
      expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    }
  });

  it('GET /me/features : tout est compris dans l’offre par défaut', async () => {
    await billing.setPlan(org, 'free');
    const res = await request(serveur()).get('/me/features').set('Cookie', client());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.features).toHaveLength(FEATURE_KEYS.length);
    for (const f of res.body.features as Array<{ status: string }>)
      expect(f.status).toBe('included');
  });

  it('critère 18 — grille fermant `crm` à `free` : écriture 403, lecture 200 ; `pro` intact', async () => {
    await billing.setPlan(org, 'free');
    features.replaceGridForTesting(fermer(DEFAULT_FEATURE_GRID, ['crm'], ['free']));

    const ecrit = await ecrireOpportunite();
    expect(ecrit.status).toBe(403);
    expect(ecrit.body).toMatchObject({
      code: 'FEATURE_NOT_IN_PLAN',
      feature: 'crm',
      minimalPlan: 'pro',
    });
    const lit = await request(serveur()).get('/crm/opportunities').set('Cookie', client());
    expect(lit.status, JSON.stringify(lit.body)).toBe(200);

    const moi = await request(serveur()).get('/me/features').set('Cookie', client());
    const crm = (
      moi.body.features as Array<{ key: string; status: string; minimalPlan: string }>
    ).find((f) => f.key === 'crm');
    expect(crm).toMatchObject({ status: 'not_in_plan', minimalPlan: 'pro' });

    await billing.setPlan(org, 'pro');
    expect((await ecrireOpportunite()).body?.code).not.toBe('FEATURE_NOT_IN_PLAN');
  });

  it('console : lecture ouverte au support, écriture refusée au support et sans ré-authentification', async () => {
    const vue = await request(serveur()).get('/admin/features').set('Cookie', cookies['sup']!);
    expect(vue.status, JSON.stringify(vue.body)).toBe(200);
    expect(vue.body.closedCells).toBe(0);
    expect(vue.body.features).toHaveLength(FEATURE_KEYS.length);

    const client403 = await request(serveur()).get('/admin/features').set('Cookie', client());
    expect(client403.status).toBe(403);

    const sup = await request(serveur())
      .post('/admin/features/overrides')
      .set('Cookie', cookies['sup']!)
      .send(derogation());
    expect(sup.status).toBe(403);

    const sansReauth = await request(serveur())
      .post('/admin/features/overrides')
      .set('Cookie', cookies['sa']!)
      .send(derogation());
    expect(sansReauth.status).toBe(401);
    expect(sansReauth.body.code).toBe('REAUTH_REQUIRED');
  });

  it('console : motif, échéance de 90 jours au plus, valeur ouvrante, catalogue, conflit d’intérêts', async () => {
    await reauth('sa');
    const poster = (body: unknown, cle = 'sa') =>
      request(serveur()).post('/admin/features/overrides').set('Cookie', cookies[cle]!).send(body);

    const sansMotif = await poster(derogation({ internalNote: '' }));
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe('REASON_REQUIRED');

    const tropLoin = await poster(
      derogation({ endsAt: new Date(Date.now() + 91 * DAY_MS).toISOString() }),
    );
    expect(tropLoin.status).toBe(400);
    expect(tropLoin.body.code).toBe('OVERRIDE_EXPIRY_INVALID');

    const fermante = await poster(derogation({ value: false }));
    expect(fermante.status).toBe(400);
    expect(fermante.body.code).toBe('OVERRIDE_VALUE_UNSUPPORTED');

    const inconnue = await poster(derogation({ feature: 'teleportation' }));
    expect(inconnue.status).toBe(400);
    expect(inconnue.body.code).toBe('UNKNOWN_FEATURE');

    // `saMembre` est membre de l'organisation, `sa` détient aussi l'action → 409.
    await reauth('saMembre');
    const conflit = await poster(derogation(), 'saMembre');
    expect(conflit.status).toBe(409);
    expect(conflit.body.code).toBe('PLATFORM_SELF_DEALING');
  });

  it('critère 18 — une dérogation active rouvre l’écriture, échue ou levée la referme ; le client voit l’effet, jamais l’opérateur', async () => {
    await billing.setPlan(org, 'free');
    features.replaceGridForTesting(fermer(DEFAULT_FEATURE_GRID, ['crm'], ['free']));
    await reauth('sa');

    const accord = await request(serveur())
      .post('/admin/features/overrides')
      .set('Cookie', cookies['sa']!)
      .send(derogation());
    expect(accord.status, JSON.stringify(accord.body)).toBe(201);
    const overrideId = String(accord.body.id);

    expect((await ecrireOpportunite()).body?.code).not.toBe('FEATURE_NOT_IN_PLAN');

    const moi = await request(serveur()).get('/me/features').set('Cookie', client());
    const crm = (moi.body.features as Array<Record<string, unknown>>).find((f) => f.key === 'crm');
    expect(crm).toMatchObject({ status: 'override', overrideReason: 'Demande du client' });
    expect(JSON.stringify(moi.body)).not.toContain(ids['sa']!);
    expect(JSON.stringify(moi.body)).not.toContain('Essai du CRM');

    // Miroir « Équipe Lalanda » : l'effet, jamais l'opérateur ni la note interne.
    const journal = await request(serveur()).get('/audit-events?limit=500').set('Cookie', client());
    expect(journal.status).toBe(200);
    const miroir = (journal.body.events as Array<Record<string, unknown>>).find(
      (e) => e.action === 'platform.feature.override_granted',
    );
    expect(miroir).toMatchObject({ actorUserId: PLATFORM_MIRROR_ACTOR_ID });
    expect(JSON.stringify(journal.body)).not.toContain(ids['sa']!);
    expect(JSON.stringify(journal.body)).not.toContain('Essai du CRM');

    // La console la liste.
    const vue = await request(serveur()).get('/admin/features').set('Cookie', cookies['sa']!);
    expect((vue.body.overrides as Array<{ id: string }>).map((o) => o.id)).toContain(overrideId);

    // Échue : refermée.
    await db
      .collection('platform_feature_overrides')
      .updateOne(
        { _id: new ObjectId(overrideId) },
        { $set: { endsAt: new Date(Date.now() - 1000) } },
      );
    expect((await ecrireOpportunite()).body?.code).toBe('FEATURE_NOT_IN_PLAN');

    // Nouvelle dérogation, puis levée : refermée.
    const seconde = await request(serveur())
      .post('/admin/features/overrides')
      .set('Cookie', cookies['sa']!)
      .send(derogation());
    expect(seconde.status).toBe(201);
    expect((await ecrireOpportunite()).body?.code).not.toBe('FEATURE_NOT_IN_PLAN');
    const sansNote = await request(serveur())
      .delete(`/admin/features/overrides/${String(seconde.body.id)}`)
      .set('Cookie', cookies['sa']!)
      .send({});
    expect(sansNote.status).toBe(400);
    const levee = await request(serveur())
      .delete(`/admin/features/overrides/${String(seconde.body.id)}`)
      .set('Cookie', cookies['sa']!)
      .send({ internalNote: 'Essai terminé, levée anticipée.' });
    expect(levee.status, JSON.stringify(levee.body)).toBe(200);
    expect((await ecrireOpportunite()).body?.code).toBe('FEATURE_NOT_IN_PLAN');

    // Journal plateforme : l'acteur réel et ses rôles.
    const plateforme = await request(serveur())
      .get('/admin/audit-events?action=feature.override_granted')
      .set('Cookie', cookies['sa']!);
    const evt = (plateforme.body.events as Array<Record<string, unknown>>)[0]!;
    expect(evt).toMatchObject({ actorUserId: ids['sa'], actorRole: 'platform_super_admin' });
  });

  it('cohérence avec P3 — un octroi actif (`plan.granted`) fait l’offre effective de la garde ; retiré, elle repart', async () => {
    await billing.setPlan(org, 'free');
    features.replaceGridForTesting(fermer(DEFAULT_FEATURE_GRID, ['crm'], ['free']));
    expect((await ecrireOpportunite()).body?.code).toBe('FEATURE_NOT_IN_PLAN');

    await reauth('sa');
    const octroi = await request(serveur())
      .post('/admin/billing/grants')
      .set('Cookie', cookies['sa']!)
      .send({
        targetOrganizationId: org,
        plan: 'pro',
        reasonCategory: 'request',
        clientMessage: 'Offre Pro accordée pour un mois.',
        internalNote: 'Octroi court pour la suite P4.',
        endsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      });
    expect(octroi.status, JSON.stringify(octroi.body)).toBe(201);
    expect(octroi.body.status).toBe('active');

    // Offre effective = `pro` : l'écriture passe, `GET /me/features` le dit.
    expect((await ecrireOpportunite()).body?.code).not.toBe('FEATURE_NOT_IN_PLAN');
    const moi = await request(serveur()).get('/me/features').set('Cookie', client());
    expect(moi.body.plan).toBe('pro');
    expect(
      (moi.body.features as Array<{ key: string; status: string }>).find((f) => f.key === 'crm')
        ?.status,
    ).toBe('included');

    const retrait = await request(serveur())
      .delete(`/admin/billing/grants/${String(octroi.body.id)}`)
      .set('Cookie', cookies['sa']!)
      .send({ internalNote: 'Fin de l’octroi de test.', clientMessage: 'Fin de l’offre Pro.' });
    expect(retrait.status, JSON.stringify(retrait.body)).toBe(200);
    expect((await ecrireOpportunite()).body?.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});
