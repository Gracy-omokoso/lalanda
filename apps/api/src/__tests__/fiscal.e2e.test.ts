// Identité fiscale, facture normalisée et points de vente e-MCF contre la vraie
// application (ADR-0021 §2, §3, §4.1, §6, §10, §13 « B »).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → garde de
// ré-authentification → contrôleur → MongoDB (transactions) → VRAI coffre chiffré
// (`OrganizationSecretsService`, clé maîtresse tirée au hasard) → client e-MCF →
// FAUX serveur e-MCF local. Aucun appel à la DGI réelle.
//
// BASE DÉDIÉE, supprimée à la fin. AUCUN VRAI JETON : les jetons sont des
// littéraux inventés, marqués `ANTIFUITE` pour la recherche de fuites.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import {
  startFakeEdefServer,
  type FakeEdefServer,
  type FakeEdefTokenProfile,
} from '../edef/testing/fake-edef-server.js';
import { NormalizedInvoicingService } from '../fiscal/normalized-invoicing.service.js';
import { PointsOfSaleService } from '../fiscal/points-of-sale.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_fiscal_${tag}`;
// Le VRAI coffre : clé maîtresse de test, tirée au hasard pour cette exécution.
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
// Délai DGI au minimum admis (10 s) : le cas « serveur lent » en dépend.
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

const NIF = 'A0000000X';
const NIM = 'XX01000001-1';
const FUTUR = '2027-01-31T00:00:00';
const PASSE = '2026-01-01T00:00:00';
const MOT_DE_PASSE = 'Passw0rd!fiscal';

const jeton = (nom: string): string => `ANTIFUITE-${nom}-${tag}-0123456789abcdef`;
const J = {
  ok: jeton('ok'),
  ok2: jeton('ok2'),
  remplacant: jeton('remplacant'),
  refuse: jeton('refuse'),
  statusFalse: jeton('statusfalse'),
  autreNif: jeton('autrenif'),
  expire: jeton('expire'),
  desactive: jeton('desactive'),
  casse: jeton('casse'),
  panne: jeton('panne'),
  lent: jeton('lent'),
  orgBMemeNim: jeton('orgbmemenim'),
  production: jeton('production'),
};

const PROFILS: Record<string, FakeEdefTokenProfile> = {
  [J.ok]: { nif: NIF, nim: NIM, tokenValid: FUTUR },
  [J.ok2]: { nif: NIF, nim: 'XX01000002-1', tokenValid: FUTUR },
  [J.remplacant]: { nif: NIF, nim: NIM, tokenValid: FUTUR },
  [J.refuse]: { nif: NIF, nim: NIM, tokenValid: FUTUR, behaviour: 'unauthorized' },
  [J.statusFalse]: { nif: NIF, nim: NIM, tokenValid: FUTUR, behaviour: 'status_false' },
  [J.autreNif]: { nif: 'Z9999999Z', nim: NIM, tokenValid: FUTUR },
  [J.expire]: { nif: NIF, nim: NIM, tokenValid: PASSE },
  [J.desactive]: { nif: NIF, nim: NIM, tokenValid: FUTUR, emcfStatus: 'Désactivé' },
  [J.casse]: { nif: NIF, nim: NIM, tokenValid: FUTUR, behaviour: 'malformed' },
  [J.panne]: { nif: NIF, nim: NIM, tokenValid: FUTUR, behaviour: 'server_error' },
  [J.lent]: { nif: NIF, nim: NIM, tokenValid: FUTUR, behaviour: 'slow' },
  [J.orgBMemeNim]: { nif: NIF, nim: NIM, tokenValid: FUTUR },
  [J.production]: { nif: NIF, nim: 'XX01000099-1', tokenValid: FUTUR },
};

const FICHE = {
  legalName: 'Exemple SARL',
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif: 'a 000-0000x',
  rccm: null,
  nationalId: null,
  vatRegistered: true,
  headOffice: {
    line1: '1, avenue Exemple',
    line2: null,
    commune: 'Gombe',
    city: 'Kinshasa',
    province: 'Kinshasa',
  },
  phone: '+243 800 000 000',
  email: 'facturation@exemple.cd',
};

const MOTIF = 'Changement de logiciel de facturation, essai terminé.';

type Role = 'owner' | 'finance_director' | 'admin' | 'accountant' | 'viewer';

e2eSuite('fiscalité — fiche, facture normalisée, points de vente (ADR-0021 chantier B)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgId = '';
  let orgB = '';
  let posId = '';
  const cookies = {} as Record<Role | 'ownerB', string[]>;
  const emails = {} as Record<Role | 'ownerB', string>;
  const mails: MailMessage[] = [];
  /** Toutes les réponses reçues — balayées à la fin à la recherche d'un jeton. */
  const reponses: unknown[] = [];

  const server = () => app.getHttpServer();
  const asA = (role: Role) => [...cookies[role], `active_org_id=${orgId}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const BASE = '/organizations/current/normalized-invoicing';

  async function keep<T extends request.Response>(p: Promise<T>): Promise<T> {
    const res = await p;
    reponses.push(res.body);
    return res;
  }
  const get = (c: string[], path: string) => keep(request(server()).get(path).set('Cookie', c));
  const post = (c: string[], path: string, body?: unknown) =>
    keep(
      request(server())
        .post(path)
        .set('Cookie', c)
        .send(body ?? {}),
    );
  const put = (c: string[], path: string, body: unknown) =>
    keep(request(server()).put(path).set('Cookie', c).send(body));
  const patch = (c: string[], path: string, body: unknown) =>
    keep(request(server()).patch(path).set('Cookie', c).send(body));

  async function reauth(c: string[]): Promise<void> {
    const res = await request(server())
      .post('/me/reauth')
      .set('Cookie', c)
      .send({ password: MOT_DE_PASSE });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function compter(collection: string, organizationId = orgId): Promise<number> {
    return db.collection(collection).countDocuments({ organizationId });
  }

  async function evenements(action: string, organizationId = orgId): Promise<number> {
    return db.collection('audit_events').countDocuments({ organizationId, action });
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({ tokens: PROFILS, slowMs: 15_000 });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);

    const transport = app.get(MailTransport);
    vi.spyOn(transport, 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { delivered: true };
    });

    for (const role of [
      'owner',
      'finance_director',
      'admin',
      'accountant',
      'viewer',
      'ownerB',
    ] as const) {
      emails[role] = `fiscal-${role}-${tag}@lalanda-test.local`;
    }
    const compte = (r: Role | 'ownerB') => ({
      email: emails[r],
      password: MOT_DE_PASSE,
      name: `Fiscal ${r}`,
    });

    cookies['owner'] = await registerAndLogin(app, compte('owner'));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies['owner']);
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;

    for (const role of ['finance_director', 'admin', 'accountant', 'viewer'] as const) {
      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status, `acceptation ${role}`).toBe(201);
    }

    cookies['ownerB'] = await registerAndLogin(app, compte('ownerB'));
    const orgsB = await request(server()).get('/organizations').set('Cookie', cookies['ownerB']);
    orgB = (orgsB.body.organizations as { id: string }[])[0]!.id;
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    // Les quotas (100 req/min par IP, 10 écritures/h par utilisateur) protègent la
    // production ; ici, ils feraient échouer en 429 des cas sans rapport avec ce
    // qu'on teste. On vide le compteur, on ne désactive pas le garde.
    // Les minuteurs d'expiration sont annulés AVEC les compteurs, comme dans les
    // autres suites : vider seulement `storage` laissait des minuteurs (60 s)
    // relire une clé disparue. Sous charge, la suite dure assez pour qu'ils se
    // déclenchent — « Cannot destructure property 'totalHits' », erreur non
    // gérée qui fait échouer l'exécution alors que tous les tests passent.
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  });

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  // ── RBAC ──────────────────────────────────────────────────────────────────

  describe('permission fiscal.manage', () => {
    for (const role of ['owner', 'finance_director'] as const) {
      it(`${role} → 200`, async () => {
        expect((await get(asA(role), '/organizations/current/fiscal-profile')).status).toBe(200);
        expect((await get(asA(role), BASE)).status).toBe(200);
      });
    }
    for (const role of ['admin', 'accountant', 'viewer'] as const) {
      it(`${role} → 403 FORBIDDEN`, async () => {
        const res = await get(asA(role), '/organizations/current/fiscal-profile');
        expect(res.status).toBe(403);
        expect(res.body.action).toBe('fiscal.manage');
        expect((await get(asA(role), BASE)).status).toBe(403);
      });
    }
  });

  // ── Fiche fiscale ─────────────────────────────────────────────────────────

  describe('fiche fiscale', () => {
    it('sans fiche : profile null, verrou ouvert, formes juridiques servies', async () => {
      const res = await get(asA('owner'), '/organizations/current/fiscal-profile');
      expect(res.body.profile).toBeNull();
      expect(res.body.locks).toEqual({ nif: false });
      expect(res.body.options.legalForms).toContainEqual({ value: 'autre', label: 'Autre' });
    });

    it('point de vente sans fiche → 409 FISCAL_PROFILE_REQUIRED, rien d’écrit', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/points-of-sale`, {
        label: 'Boutique',
        environment: 'test',
        expectedNim: null,
        token: J.ok,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('FISCAL_PROFILE_REQUIRED');
      expect(await compter('emcf_points_of_sale')).toBe(0);
    });

    it('prérequis : tout manque avant la fiche', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/activate`, { environment: 'test' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NORMALIZED_INVOICING_PREREQUISITES');
      expect(res.body.details.missing).toEqual(
        expect.arrayContaining(['fiscal_profile', 'country_cd', 'active_point_of_sale']),
      );
    });

    it('champ inconnu → 400 ; « autre » sans précision → 400', async () => {
      const inconnu = await put(asA('owner'), '/organizations/current/fiscal-profile', {
        ...FICHE,
        isf: 'XXX',
      });
      expect(inconnu.status).toBe(400);
      expect(inconnu.body.code).toBe('INVALID_REQUEST');
      const autre = await put(asA('owner'), '/organizations/current/fiscal-profile', {
        ...FICHE,
        legalForm: 'autre',
      });
      expect(autre.status).toBe(400);
      expect(autre.body.details.issues[0].path).toBe('legalFormOther');
    });

    it('enregistre : NIF normalisé, pays par défaut celui de l’organisation, audit sans valeur', async () => {
      const res = await put(asA('owner'), '/organizations/current/fiscal-profile', FICHE);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.profile.nif).toBe(NIF);
      expect(res.body.profile.headOffice.country).toBe('CD');
      const ev = await db
        .collection('audit_events')
        .findOne({ organizationId: orgId, action: 'fiscal_profile.updated' });
      expect(ev?.['metadata']).toMatchObject({ creation: true });
      expect(String(ev?.['metadata']?.['champs'])).toContain('nif');
      expect(JSON.stringify(ev)).not.toContain(NIF);
      expect(JSON.stringify(ev)).not.toContain('facturation@exemple.cd');
    });

    it('isolation : l’organisation B ne voit pas la fiche de A', async () => {
      const res = await get(asB(), '/organizations/current/fiscal-profile');
      expect(res.body.profile).toBeNull();
    });
  });

  // ── Points de vente : test du jeton avant écriture ─────────────────────────

  describe('points de vente — test avant écriture', () => {
    const creer = (token: string, extra: Record<string, unknown> = {}) =>
      post(asA('owner'), `${BASE}/points-of-sale`, {
        label: 'Boutique Gombe',
        environment: 'test',
        expectedNim: null,
        token,
        ...extra,
      });

    it('sans ré-authentification → 401 REAUTH_REQUIRED, avant tout 400', async () => {
      const res = await post(asA('finance_director'), `${BASE}/points-of-sale`, { nimporte: 1 });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('REAUTH_REQUIRED');
    });

    const echecs: Array<[string, string, Record<string, unknown>, number, string]> = [
      ['jeton refusé (401)', J.refuse, {}, 422, 'EMCF_TOKEN_REJECTED'],
      ['status = false', J.statusFalse, {}, 422, 'EMCF_STATUS_FALSE'],
      ['NIF différent', J.autreNif, {}, 422, 'EMCF_NIF_MISMATCH'],
      ['NIM attendu différent', J.ok, { expectedNim: 'XX09999999-1' }, 422, 'EMCF_NIM_MISMATCH'],
      ['jeton expiré', J.expire, {}, 422, 'EMCF_TOKEN_EXPIRED'],
      ['e-MCF désactivé à la DGI', J.desactive, {}, 422, 'EMCF_DISABLED_AT_DGI'],
      ['réponse illisible', J.casse, {}, 422, 'EDEF_INVALID_RESPONSE'],
      ['DGI en panne (5xx)', J.panne, {}, 502, 'EDEF_UNREACHABLE'],
    ];
    for (const [libelle, token, extra, http, code] of echecs) {
      it(`${libelle} → ${http} ${code}, ni document ni secret`, async () => {
        await reauth(asA('owner'));
        const res = await creer(token, extra);
        expect(res.status, JSON.stringify(res.body)).toBe(http);
        expect(res.body.code).toBe(code);
        expect(await compter('emcf_points_of_sale')).toBe(0);
        expect(await compter('organization_secrets')).toBe(0);
      });
    }

    it('erreur DGI 5xx : details.kind = server', async () => {
      await reauth(asA('owner'));
      const res = await creer(J.panne);
      expect(res.body.details.kind).toBe('server');
    });

    it('jeton mal formé → 400, sans écho du jeton', async () => {
      await reauth(asA('owner'));
      const malForme = `ANTIFUITE mal forme ${tag} avec espaces`;
      const res = await creer(malForme);
      expect(res.status).toBe(400);
      expect(res.body.details.issues[0].path).toBe('token');
      expect(JSON.stringify(res.body)).not.toContain(malForme);
    });

    it('production fermée → 409, AUCUNE requête reçue par le faux serveur', async () => {
      await reauth(asA('owner'));
      const avant = fake.requests.length;
      const res = await creer(J.production, { environment: 'production' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DGI_PRODUCTION_UNAVAILABLE');
      expect(fake.requests.length).toBe(avant);
    });

    it('jeton valide → 201, last4 seul, secret chiffré au coffre, audit strict', async () => {
      await reauth(asA('owner'));
      const res = await creer(J.ok);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      posId = res.body.id;
      expect(res.body.status).toBe('active');
      expect(res.body.token).toMatchObject({ configured: true, last4: J.ok.slice(-4) });
      expect(res.body.dgi).toMatchObject({ nif: NIF, nim: NIM, emcfStatus: 'Actif' });
      expect(JSON.stringify(res.body)).not.toContain(J.ok);
      // Le faux serveur a bien reçu le jeton : preuve qu'il sert.
      expect(fake.requests.some((r) => r.authorization === `Bearer ${J.ok}`)).toBe(true);
      // Au coffre : un document, chiffré — jamais la valeur en clair.
      const secret = await db.collection('organization_secrets').findOne({ organizationId: orgId });
      expect(secret?.['ownerId']).toBe(posId);
      expect(JSON.stringify(secret)).not.toContain(J.ok);
      expect(await evenements('emcf_point_of_sale.created')).toBe(1);
    });

    it('même NIM dans une autre organisation → 409 EMCF_ALREADY_REGISTERED, sans la nommer', async () => {
      const fiche = await put(asB(), '/organizations/current/fiscal-profile', FICHE);
      expect(fiche.status).toBe(200);
      await reauth(asB());
      const res = await post(asB(), `${BASE}/points-of-sale`, {
        label: 'Doublon',
        environment: 'test',
        expectedNim: null,
        token: J.orgBMemeNim,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EMCF_ALREADY_REGISTERED');
      expect(JSON.stringify(res.body)).not.toContain(orgId);
      expect(await compter('emcf_points_of_sale', orgB)).toBe(0);
      expect(await compter('organization_secrets', orgB)).toBe(0);
    });

    it('point de vente d’une autre organisation → 404 POINT_OF_SALE_NOT_FOUND', async () => {
      for (const res of [
        await post(asB(), `${BASE}/points-of-sale/${posId}/test`),
        await get(asB(), `${BASE}/points-of-sale/${posId}/reference-data`),
        await patch(asB(), `${BASE}/points-of-sale/${posId}`, { label: 'pirate' }),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('POINT_OF_SALE_NOT_FOUND');
      }
      expect((await post(asA('owner'), `${BASE}/points-of-sale/pas-un-id/test`)).status).toBe(404);
    });
  });

  // ── Facture normalisée ─────────────────────────────────────────────────────

  describe('facture normalisée', () => {
    it('prérequis réunis : canActivate', async () => {
      const res = await get(asA('owner'), BASE);
      expect(res.body.state).toBe('disabled');
      expect(res.body.canActivate).toBe(true);
      expect(res.body.prerequisites).toMatchObject({
        fiscalProfileComplete: true,
        countryIsCd: true,
        activePointOfSaleInEnvironment: true,
        productionAvailable: false,
        nifAvailable: true,
      });
      expect(await app.get(NormalizedInvoicingService).emissionModeOf(orgId)).toBe('standard');
    });

    it('activation sans ré-authentification → 401', async () => {
      const res = await post(asA('finance_director'), `${BASE}/activate`, { environment: 'test' });
      expect(res.status).toBe(401);
    });

    it('panne de l’écriture d’audit → l’état ne change pas', async () => {
      await reauth(asA('owner'));
      const audit = app.get(AuditService);
      const espion = vi
        .spyOn(audit, 'recordStrict')
        .mockRejectedValueOnce(new Error('audit en panne (simulée)'));
      const res = await post(asA('owner'), `${BASE}/activate`, { environment: 'test' });
      espion.mockRestore();
      expect(res.status).toBe(500);
      expect((await get(asA('owner'), BASE)).body.state).toBe('disabled');
      expect(await evenements('normalized_invoicing.enabled')).toBe(0);
    });

    it('deux activations concurrentes → activée, un seul événement', async () => {
      await reauth(asA('owner'));
      await reauth(asA('finance_director'));
      const [a, b] = await Promise.all([
        post(asA('owner'), `${BASE}/activate`, { environment: 'test' }),
        post(asA('finance_director'), `${BASE}/activate`, { environment: 'test' }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await evenements('normalized_invoicing.enabled')).toBe(1);
      const vue = (await get(asA('owner'), BASE)).body;
      expect(vue.state).toBe('enabled');
      expect(vue.firstActivatedAt).not.toBeNull();
      expect(await app.get(NormalizedInvoicingService).emissionModeOf(orgId)).toBe('normalized');
    });

    it('déjà activée → 200 sans nouvel événement', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/activate`, { environment: 'test' });
      expect(res.status).toBe(200);
      expect(await evenements('normalized_invoicing.enabled')).toBe(1);
    });

    it('même NIF déjà activé ailleurs → nif_elsewhere pour l’organisation B', async () => {
      await reauth(asB());
      const res = await post(asB(), `${BASE}/activate`, { environment: 'test' });
      expect(res.status).toBe(409);
      expect(res.body.details.missing).toContain('nif_elsewhere');
      expect(JSON.stringify(res.body)).not.toContain(orgId);
    });

    it('verrou du NIF pendant l’activation ; les autres champs passent', async () => {
      const nif = await put(asA('owner'), '/organizations/current/fiscal-profile', {
        ...FICHE,
        nif: 'B1111111Y',
      });
      expect(nif.status).toBe(409);
      expect(nif.body.code).toBe('FISCAL_IDENTITY_LOCKED');
      const autre = await put(asA('owner'), '/organizations/current/fiscal-profile', {
        ...FICHE,
        phone: '+243 811 111 111',
      });
      expect(autre.status).toBe(200);
      expect(autre.body.locks).toEqual({ nif: true });
    });

    it('retrait du dernier point de vente actif → 409 LAST_ACTIVE_POINT_OF_SALE', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/points-of-sale/${posId}/disable`, {});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LAST_ACTIVE_POINT_OF_SALE');
    });

    it('passage en production fermée → 409 DGI_PRODUCTION_UNAVAILABLE', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/environment`, { environment: 'production' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DGI_PRODUCTION_UNAVAILABLE');
    });

    it('R4 : un test en échec ne désactive pas la facture normalisée', async () => {
      fake.setToken(J.ok, { ...PROFILS[J.ok]!, behaviour: 'unauthorized' });
      const res = await post(asA('owner'), `${BASE}/points-of-sale/${posId}/test`);
      fake.setToken(J.ok, PROFILS[J.ok]!);
      expect(res.status).toBe(200);
      expect(res.body.lastTest).toMatchObject({ ok: false, code: 'EMCF_TOKEN_REJECTED' });
      expect(res.body.status).toBe('failing');
      expect((await get(asA('owner'), BASE)).body.state).toBe('enabled');
      const ok = await post(asA('owner'), `${BASE}/points-of-sale/${posId}/test`);
      expect(ok.body.lastTest).toMatchObject({ ok: true });
      expect(ok.body.status).toBe('active');
    });

    it('désactivation : sans ré-auth → 401 ; motif absent ou trop court → 400', async () => {
      // On ferme toutes les fenêtres ouvertes plus haut.
      await db.collection('platform_reauth').deleteMany({});
      const sansReauth = await post(asA('finance_director'), `${BASE}/deactivate`, {
        reason: MOTIF,
      });
      expect(sansReauth.status).toBe(401);
      expect(sansReauth.body.code).toBe('REAUTH_REQUIRED');
      await reauth(asA('owner'));
      for (const corps of [{}, { reason: 'trop court' }]) {
        const res = await post(asA('owner'), `${BASE}/deactivate`, corps);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_REQUEST');
      }
      expect((await get(asA('owner'), BASE)).body.state).toBe('enabled');
    });

    it('désactivation motivée → disabled, firstActivatedAt conservé, audit strict, e-mail aux Propriétaires', async () => {
      const premier = (await get(asA('owner'), BASE)).body.firstActivatedAt;
      const evAvant = await evenements('normalized_invoicing.disabled');
      mails.length = 0;
      await reauth(asA('finance_director'));
      const res = await post(asA('finance_director'), `${BASE}/deactivate`, { reason: MOTIF });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.state).toBe('disabled');
      expect(res.body.deactivationReason).toBe(MOTIF);
      expect(res.body.firstActivatedAt).toBe(premier);
      expect(await evenements('normalized_invoicing.disabled')).toBe(evAvant + 1);
      expect(await app.get(NormalizedInvoicingService).emissionModeOf(orgId)).toBe('standard');
      // Un message, au seul Propriétaire, qui dit le motif.
      expect(mails.map((m) => m.to)).toEqual([emails['owner']]);
      expect(mails[0]!.subject).toContain('facture normalisée désactivée');
      expect(mails[0]!.text).toContain(MOTIF);
    });

    it('un échec d’envoi de l’e-mail ne bloque pas la désactivation', async () => {
      await reauth(asA('owner'));
      expect((await post(asA('owner'), `${BASE}/activate`, { environment: 'test' })).status).toBe(
        200,
      );
      const transport = app.get(MailTransport);
      const espion = vi.spyOn(transport, 'send').mockRejectedValue(new Error('SMTP en panne'));
      const res = await post(asA('owner'), `${BASE}/deactivate`, { reason: MOTIF });
      espion.mockImplementation(async (m: MailMessage) => {
        mails.push(m);
        return { delivered: true };
      });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('disabled');
    });

    it('désactivée : changement d’environnement vers la production toujours refusé (fermée)', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/environment`, { environment: 'production' });
      expect(res.status).toBe(409);
    });
  });

  // ── Listes de référence ────────────────────────────────────────────────────

  describe('listes de référence', () => {
    it('lecture : sept listes, instantanés, aucun avertissement si les taux concordent', async () => {
      const res = await get(asA('owner'), `${BASE}/points-of-sale/${posId}/reference-data`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Object.keys(res.body.lists).sort()).toEqual(
        [
          'clientTypes',
          'currencyRates',
          'invoiceTypes',
          'itemTypes',
          'paymentTypes',
          'referenceTypes',
          'taxGroups',
        ].sort(),
      );
      expect(res.body.failures).toEqual({});
      expect(res.body.warnings).toEqual([]);
      expect(await db.collection('edef_reference_snapshots').countDocuments({})).toBe(7);
    });

    it('deux lectures identiques → un seul instantané ; contenu changé → un second, et avertissement', async () => {
      await get(asA('owner'), `${BASE}/points-of-sale/${posId}/reference-data`);
      expect(
        await db.collection('edef_reference_snapshots').countDocuments({ list: 'taxGroups' }),
      ).toBe(1);
      fake.setTaxGroups({ a: 0, b: 16, c: 8, o: 1 });
      const res = await get(asA('owner'), `${BASE}/points-of-sale/${posId}/reference-data`);
      fake.setTaxGroups({ a: 0, b: 16, c: 5, o: 1 });
      expect(
        await db.collection('edef_reference_snapshots').countDocuments({ list: 'taxGroups' }),
      ).toBe(2);
      expect(res.body.warnings).toEqual([
        { code: 'TAX_RATE_DIFFERS_FROM_PACK', group: 'c', dgi: 8, pack: 5 },
      ]);
    });
  });

  // ── Jeton : remplacement, retrait, réactivation ─────────────────────────────

  describe('cycle de vie du jeton', () => {
    it('PATCH libellé sans ré-authentification', async () => {
      const res = await patch(asA('owner'), `${BASE}/points-of-sale/${posId}`, {
        label: 'Boutique Gombe 2',
      });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Boutique Gombe 2');
    });

    it('remplacement : test avant écriture, audit last4 avant/après', async () => {
      await reauth(asA('owner'));
      const refuse = await put(asA('owner'), `${BASE}/points-of-sale/${posId}/token`, {
        token: J.refuse,
      });
      expect(refuse.status).toBe(422);
      const res = await put(asA('owner'), `${BASE}/points-of-sale/${posId}/token`, {
        token: J.remplacant,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.token.last4).toBe(J.remplacant.slice(-4));
      const ev = await db
        .collection('audit_events')
        .findOne({ organizationId: orgId, action: 'emcf_point_of_sale.token_replaced' });
      expect(ev?.['metadata']).toMatchObject({
        last4Before: J.ok.slice(-4),
        last4After: J.remplacant.slice(-4),
      });
      const resolu = await app.get(PointsOfSaleService).resolveActiveToken(orgId, posId);
      expect(resolu?.token.expose()).toBe(J.remplacant);
      expect(resolu?.environment).toBe('test');
    });

    it('retrait (facture normalisée désactivée) : jeton détruit, document conservé', async () => {
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/points-of-sale/${posId}/disable`, {
        reason: 'Boutique fermée',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('disabled');
      expect(res.body.token.configured).toBe(false);
      expect(await compter('organization_secrets')).toBe(0);
      expect(await compter('emcf_points_of_sale')).toBe(1);
      expect(await evenements('emcf_point_of_sale.disabled')).toBe(1);
      expect(await app.get(PointsOfSaleService).resolveActiveToken(orgId, posId)).toBeNull();
    });

    it('réactivation par un nouveau jeton', async () => {
      await reauth(asA('owner'));
      const res = await put(asA('owner'), `${BASE}/points-of-sale/${posId}/token`, {
        token: J.ok,
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('active');
    });
  });

  // ── Anti-fuite ─────────────────────────────────────────────────────────────

  describe('anti-fuite', () => {
    it('aucun jeton dans les réponses, l’audit ni le journal des échanges', async () => {
      const tous = Object.values(J);
      const corpus = [
        JSON.stringify(reponses),
        JSON.stringify(await db.collection('audit_events').find({}).toArray()),
        JSON.stringify(await db.collection('edef_exchanges').find({}).toArray()),
        JSON.stringify(await db.collection('emcf_points_of_sale').find({}).toArray()),
      ].join('\n');
      for (const t of tous) expect(corpus, `jeton ${t.slice(0, 18)}…`).not.toContain(t);
      expect(corpus).not.toMatch(/Bearer /);
    });

    it('un échange journalisé par appel DGI, sans en-tête', async () => {
      const echanges = await db
        .collection('edef_exchanges')
        .find({ organizationId: orgId })
        .toArray();
      expect(echanges.length).toBeGreaterThan(5);
      for (const e of echanges) {
        expect(Object.keys(e)).not.toContain('headers');
        expect(e['requestBody']).toBeNull();
      }
      expect(echanges.map((e) => e['outcome'])).toEqual(
        expect.arrayContaining(['ok', 'unauthorized', 'server', 'invalid_response']),
      );
    });
  });

  // ── DGI injoignable (en dernier : lent, puis serveur arrêté) ────────────────

  describe('DGI injoignable', () => {
    it('serveur lent → 502 EDEF_UNREACHABLE (timeout) en moins du délai + 1 s', async () => {
      await reauth(asA('owner'));
      const debut = Date.now();
      const res = await post(asA('owner'), `${BASE}/points-of-sale`, {
        label: 'Lent',
        environment: 'test',
        expectedNim: null,
        token: J.lent,
      });
      const duree = Date.now() - debut;
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('EDEF_UNREACHABLE');
      expect(res.body.details.kind).toBe('timeout');
      expect(duree).toBeLessThan(10_000 + 1_000);
      expect(await compter('emcf_points_of_sale')).toBe(1);
    }, 30_000);

    it('serveur arrêté → 502 EDEF_UNREACHABLE (network)', async () => {
      await fake.close();
      await reauth(asA('owner'));
      const res = await post(asA('owner'), `${BASE}/points-of-sale`, {
        label: 'Coupure',
        environment: 'test',
        expectedNim: null,
        token: J.ok2,
      });
      expect(res.status).toBe(502);
      expect(res.body.details.kind).toBe('network');
    }, 30_000);
  });
});
