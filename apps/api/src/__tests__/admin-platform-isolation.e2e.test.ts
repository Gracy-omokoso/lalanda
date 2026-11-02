// ADR-0053 — P0 : CONSOLE SANS ORGANISATION ET ISOLATION DANS LES DEUX SENS.
//
// Critère 1 : un opérateur sans aucune appartenance ouvre la console ; sans rôle
// plateforme, il reçoit 403 FORBIDDEN (jamais NO_ORGANIZATION).
// Critère 2 : les 12 rôles d'organisation, Propriétaire compris, sans rôle plateforme,
// reçoivent 403 sur TOUTES les routes de la console, découvertes par introspection de
// l'application montée — une route de console nouvelle est couverte d'office.
// Critère 3 : les 6 rôles plateforme, sans appartenance, reçoivent 403 NO_ORGANIZATION ou
// 404 ORG_NOT_FOUND sur TOUTES les routes d'organisation (`@RequirePermission`) ; un
// opérateur membre de A seulement reçoit 404 sur une ressource de B.
// Critère 15 (volet P0) : chaque rôle plateforme, `platform_billing` compris, ouvre
// `GET /admin/overview` ; `/me/platform-access` rend ses actions plateforme.
//
// Les appartenances des 12 rôles sont posées en base : cette suite mesure la garde des
// routes plateforme, pas le parcours d'invitation (déjà prouvé par `rbac-matrix`), et le
// Chef de projet n'est pas attribuable par invitation.

import 'reflect-metadata';

import { RequestMethod, type INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  PLATFORM_CONSOLE_ROUTE_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_PLATFORM_ACTIONS_KEY,
  REQUIRED_PLATFORM_ROLES_KEY,
} from '../authz/authz.decorators.js';
import {
  ORG_ROLES,
  PLATFORM_ROLES,
  type OrgRole,
  type PlatformRole,
} from '../authz/permissions.js';
import { platformActionsOf } from '../authz/platform-actions.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';
// ADR-0053 — P8 : tout opérateur s'enrôle avant d'ouvrir la console.
import { enrolerDeuxFacteurs } from './platform-2fa-e2e.js';

interface RouteDecouverte {
  cle: string;
  methode: 'get' | 'post' | 'put' | 'patch' | 'delete';
  chemin: string;
  console: boolean;
  actions: string[];
  plateforme: boolean;
}

const VERBES: Partial<Record<RequestMethod, RouteDecouverte['methode']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const premier = (v: unknown): string => String(Array.isArray(v) ? v[0] : (v ?? ''));
const joindre = (a: string, b: string): string =>
  `/${[a, b]
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

/** Toutes les routes de l'application MONTÉE (modules réellement chargés). */
function decouvrirRoutes(app: INestApplication): RouteDecouverte[] {
  const routes: RouteDecouverte[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const classe = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!classe?.prototype) continue;
      const proto = classe.prototype as Record<string, unknown>;
      const base = premier(Reflect.getMetadata('path', classe));
      for (const nom of Object.getOwnPropertyNames(proto)) {
        if (nom === 'constructor' || typeof proto[nom] !== 'function') continue;
        const handler = proto[nom] as object;
        const chemin = Reflect.getMetadata('path', handler) as unknown;
        if (chemin === undefined) continue;
        const verbe = VERBES[Reflect.getMetadata('method', handler) as RequestMethod];
        if (!verbe) continue;
        const lire = <T>(k: string): T | undefined =>
          (Reflect.getMetadata(k, handler) ?? Reflect.getMetadata(k, classe)) as T | undefined;
        routes.push({
          cle: `${classe.name}.${nom}`,
          methode: verbe,
          chemin: joindre(base, premier(chemin)),
          console: lire<boolean>(PLATFORM_CONSOLE_ROUTE_KEY) === true,
          actions: lire<string[]>(REQUIRED_PERMISSIONS_KEY) ?? [],
          plateforme: Boolean(
            lire<string[]>(REQUIRED_PLATFORM_ROLES_KEY)?.length ||
            lire<string[]>(REQUIRED_PLATFORM_ACTIONS_KEY)?.length,
          ),
        });
      }
    }
  }
  return routes;
}

e2eSuite('ADR-0053 — P0 : console sans organisation, isolation dans les deux sens', () => {
  let app: INestApplication;
  const tag = randomBytes(4).toString('hex');
  const emails: string[] = [];
  const cookies: Record<string, string[]> = {};
  const userIds: Record<string, string> = {};
  let orgA = '';
  let orgB = '';
  let projetB = '';
  let routes: RouteDecouverte[] = [];

  const serveur = () => app.getHttpServer();
  const compte = (cle: string) => {
    const email = `p0-${cle.replace(/_/g, '-')}-${tag}@lalanda-test.local`;
    if (!emails.includes(email)) emails.push(email);
    return { email, password: `Passw0rd!${cle}`, name: `P0 ${cle}` };
  };
  const viderLimiteur = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const idDeSession = async (c: string[]): Promise<string> => {
    const s = await request(serveur()).get('/auth/get-session').set('Cookie', c);
    const id = String(s.body?.user?.id ?? '');
    expect(id).not.toBe('');
    return id;
  };
  /** Chemin concret : `:orgId` → organisation A ; tout autre paramètre → identifiant factice. */
  const concret = (chemin: string): string =>
    chemin
      .replace(/:orgId\b/g, orgA)
      .replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, '0123456789abcdef01234567');
  const envoyer = (r: RouteDecouverte, c: string[]) =>
    request(serveur())[r.methode](concret(r.chemin)).set('Cookie', c).send({});

  const ROLES_ORG = [...ORG_ROLES] as OrgRole[];
  const operateur = (role: PlatformRole) => `op_${role}`;

  beforeAll(async () => {
    app = await makeE2EApp();
    const db = await dbOf(app);
    routes = decouvrirRoutes(app);

    // ── Organisation A : le Propriétaire, puis un membre par rôle (posé en base) ──
    cookies['owner'] = await registerAndLogin(app, compte('owner'));
    const orgs = await request(serveur()).get('/organizations').set('Cookie', cookies['owner']);
    orgA = (orgs.body.organizations as { id: string }[])[0]!.id;
    for (const role of ROLES_ORG) {
      if (role === 'owner') continue;
      cookies[role] = await registerAndLogin(app, compte(role));
      userIds[role] = await idDeSession(cookies[role]);
      await db.collection('memberships').insertOne({
        userId: userIds[role],
        organizationId: orgA,
        role,
        canClosePeriods: false,
        grants: [],
        revokes: [],
        permissionsRevision: 0,
        acceptedAt: new Date(),
        _schemaVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // ── Organisation B et une ressource connue ─────────────────────────────────
    cookies['ownerB'] = await registerAndLogin(app, compte('ownerB'));
    const orgsB = await request(serveur()).get('/organizations').set('Cookie', cookies['ownerB']);
    orgB = (orgsB.body.organizations as { id: string }[])[0]!.id;
    const projet = await request(serveur())
      .post('/projects')
      .set('Cookie', [...cookies['ownerB'], `active_org_id=${orgB}`])
      .send({ name: `Projet B ${tag}`, templateSlug: 'hello-world' });
    expect(projet.status, JSON.stringify(projet.body)).toBe(201);
    projetB = projet.body.id;

    // ── Opérateurs : un par rôle plateforme, SANS AUCUNE appartenance ─────────
    const poserRole = async (userId: string, role: PlatformRole) =>
      db.collection('platform_roles').insertOne({
        userId,
        role,
        grantedBy: null,
        reason: `suite e2e ADR-0053 P0 ${tag}`,
        expiresAt: null,
        revokedAt: null,
        _schemaVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    for (const role of PLATFORM_ROLES) {
      const cle = operateur(role);
      cookies[cle] = await registerAndLogin(app, compte(cle));
      userIds[cle] = await idDeSession(cookies[cle]);
      await db.collection('memberships').deleteMany({ userId: userIds[cle] });
      await poserRole(userIds[cle], role);
      viderLimiteur();
      await enrolerDeuxFacteurs(app, cookies[cle], compte(cle).password);
    }

    // Compte sans organisation ni rôle ; opérateur bloqué ; opérateur membre de A.
    cookies['sansRien'] = await registerAndLogin(app, compte('sansRien'));
    userIds['sansRien'] = await idDeSession(cookies['sansRien']);
    await db.collection('memberships').deleteMany({ userId: userIds['sansRien'] });

    cookies['bloque'] = await registerAndLogin(app, compte('bloque'));
    userIds['bloque'] = await idDeSession(cookies['bloque']);
    await db.collection('memberships').deleteMany({ userId: userIds['bloque'] });
    await poserRole(userIds['bloque'], 'platform_super_admin');
    await db
      .collection('user')
      .updateOne({ _id: new ObjectId(userIds['bloque']) }, { $set: { disabledAt: new Date() } });

    cookies['opMembreA'] = await registerAndLogin(app, compte('opMembreA'));
    userIds['opMembreA'] = await idDeSession(cookies['opMembreA']);
    await db.collection('memberships').deleteMany({ userId: userIds['opMembreA'] });
    await db.collection('memberships').insertOne({
      userId: userIds['opMembreA'],
      organizationId: orgA,
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
    await poserRole(userIds['opMembreA'], 'platform_super_admin');
    viderLimiteur();
    await enrolerDeuxFacteurs(app, cookies['opMembreA'], compte('opMembreA').password);
  }, E2E_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (app) {
      await (
        await dbOf(app)
      )
        .collection('platform_roles')
        .deleteMany({ reason: `suite e2e ADR-0053 P0 ${tag}` });
    }
    await teardown(app, emails);
  }, E2E_HOOK_TIMEOUT_MS);

  it('la découverte voit la console et les routes d’organisation (jamais à vide)', () => {
    const consoleRoutes = routes.filter((r) => r.console);
    expect(consoleRoutes.length).toBeGreaterThan(15);
    expect(routes.filter((r) => r.actions.length > 0).length).toBeGreaterThan(100);
    // Toute route `/admin/**` découverte est une route de console.
    for (const r of routes.filter((x) => x.chemin.startsWith('/admin'))) {
      expect(r.console, r.cle).toBe(true);
    }
  });

  it('critère 1 — sans appartenance, le super-administrateur ouvre la console', async () => {
    viderLimiteur();
    const c = cookies[operateur('platform_super_admin')]!;
    const acces = await request(serveur()).get('/me/platform-access').set('Cookie', c);
    expect(acces.status, JSON.stringify(acces.body)).toBe(200);
    expect(acces.body.isPlatformOperator).toBe(true);
    expect(acces.body.actions).toEqual(platformActionsOf(['platform_super_admin']));
    const tableau = await request(serveur()).get('/admin/overview').set('Cookie', c);
    expect(tableau.status, JSON.stringify(tableau.body)).toBe(200);
    // Le comportement S21b reste : lecture des organisations ouverte au super-administrateur.
    expect((await request(serveur()).get('/admin/organizations').set('Cookie', c)).status).toBe(
      200,
    );
  });

  it('critère 1 — sans rôle plateforme ni organisation : 403 FORBIDDEN, jamais NO_ORGANIZATION', async () => {
    viderLimiteur();
    const c = cookies['sansRien']!;
    const tableau = await request(serveur()).get('/admin/overview').set('Cookie', c);
    expect(tableau.status).toBe(403);
    expect(tableau.body.code).toBe('FORBIDDEN');
    const acces = await request(serveur()).get('/me/platform-access').set('Cookie', c);
    expect(acces.status).toBe(200);
    expect(acces.body).toMatchObject({ isPlatformOperator: false, actions: [] });
    // Et l'espace organisation lui reste fermé.
    const projets = await request(serveur()).get('/projects').set('Cookie', c);
    expect(projets.status).toBe(403);
    expect(projets.body.code).toBe('NO_ORGANIZATION');
  });

  it('critère 15 (P0) — chaque rôle plateforme ouvre le tableau de bord et lit ses actions', async () => {
    for (const role of PLATFORM_ROLES) {
      viderLimiteur();
      const c = cookies[operateur(role)]!;
      const tableau = await request(serveur()).get('/admin/overview').set('Cookie', c);
      expect(tableau.status, `${role} : ${JSON.stringify(tableau.body)}`).toBe(200);
      const acces = await request(serveur()).get('/me/platform-access').set('Cookie', c);
      expect(acces.body.actions, role).toEqual(platformActionsOf([role]));
    }
    // Les routes non encore converties gardent leur plancher S21b (lot P2).
    for (const role of ['platform_billing', 'platform_template_editor'] as const) {
      const res = await request(serveur())
        .get('/admin/users')
        .set('Cookie', cookies[operateur(role)]!);
      expect(res.status, role).toBe(403);
    }
  });

  it('un compte bloqué n’ouvre pas la console (403 ACCOUNT_BLOCKED, message générique)', async () => {
    viderLimiteur();
    const res = await request(serveur()).get('/admin/overview').set('Cookie', cookies['bloque']!);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'ACCOUNT_BLOCKED',
      message: 'Votre compte est bloqué. Contactez le support.',
    });
  });

  it('une route plateforme hors `/admin` fonctionne sans organisation (Country Packs)', async () => {
    viderLimiteur();
    const res = await request(serveur())
      .post('/accounting/platform/chart-packs')
      .set('Cookie', cookies[operateur('platform_country_pack_manager')]!)
      .send({});
    // Le corps vide est refusé par la validation : la garde, elle, a laissé passer.
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  it('critère 2 — les 12 rôles d’organisation, sans rôle plateforme : 403 sur toute la console', async () => {
    const consoleGardee = routes.filter((r) => r.console && r.plateforme);
    expect(consoleGardee.length).toBeGreaterThan(15);
    expect(ROLES_ORG).toHaveLength(12);
    const ecarts: string[] = [];
    for (const role of ROLES_ORG) {
      viderLimiteur();
      const c = [...cookies[role]!, `active_org_id=${orgA}`];
      for (const r of consoleGardee) {
        const res = await envoyer(r, c);
        if (res.status !== 403 || res.body?.code !== 'FORBIDDEN') {
          ecarts.push(`${role} × ${r.methode.toUpperCase()} ${r.chemin} → ${res.status}`);
        }
      }
    }
    expect(ecarts).toEqual([]);
  }, 300_000);

  it('critère 3 — les 6 rôles plateforme, sans appartenance : aucune route d’organisation', async () => {
    const routesOrg = routes.filter((r) => r.actions.length > 0);
    const ecarts: string[] = [];
    for (const role of PLATFORM_ROLES) {
      const c = [...cookies[operateur(role)]!, `active_org_id=${orgA}`];
      let n = 0;
      for (const r of routesOrg) {
        if (n++ % 80 === 0) viderLimiteur();
        const res = await envoyer(r, c);
        const refus =
          (res.status === 403 && res.body?.code === 'NO_ORGANIZATION') ||
          (res.status === 404 && res.body?.code === 'ORG_NOT_FOUND');
        if (!refus) ecarts.push(`${role} × ${r.methode.toUpperCase()} ${r.chemin} → ${res.status}`);
      }
    }
    expect(ecarts).toEqual([]);
  }, 600_000);

  it('critère 3 — un opérateur membre de A seulement reçoit 404 sur les ressources de B', async () => {
    viderLimiteur();
    const c = [...cookies['opMembreA']!, `active_org_id=${orgB}`];
    const membres = await request(serveur()).get(`/organizations/${orgB}/members`).set('Cookie', c);
    expect(membres.status).toBe(404);
    expect(membres.body.code).toBe('ORG_NOT_FOUND');
    // Le cookie visant B est ignoré (non-membre) : il agit dans A, où le projet n'existe pas.
    const projet = await request(serveur()).get(`/projects/${projetB}`).set('Cookie', c);
    expect(projet.status, JSON.stringify(projet.body)).toBe(404);
    // Son rôle plateforme ne lui ouvre rien de plus dans A que son rôle d'organisation.
    const invitations = await request(serveur())
      .get(`/organizations/${orgA}/invitations`)
      .set('Cookie', [...cookies['opMembreA']!, `active_org_id=${orgA}`]);
    expect(invitations.status).toBe(403);
    expect(invitations.body).toMatchObject({ code: 'FORBIDDEN', role: 'viewer' });
    // Et la console lui reste ouverte, indépendamment de son appartenance.
    expect((await request(serveur()).get('/admin/overview').set('Cookie', c)).status).toBe(200);
  });
});
