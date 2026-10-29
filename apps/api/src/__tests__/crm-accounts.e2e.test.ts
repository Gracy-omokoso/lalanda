// Comptes CRM 360° contre la vraie application (ADR-0040 § 2.1, § 2.2, § 3.1 ;
// critères 5, 6, 17 et 18). ADR-0040 — C1.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleurs → MongoDB. Couvre : prospects (création, homonymes, liste, mise à
// jour, archivage, suppression), contacts rattachés à un compte (et compatibilité
// N-1), conversion prospect → client par les règles de Ventes (NIF obligatoire),
// fusion, synchronisation fiche client → compte, réconciliation, rapport de
// migration, RBAC (le Commercial gère les comptes mais ne convertit pas) et
// isolation entre organisations (404 sur tout identifiant forgé).
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CrmAccountsReconcileJob } from '../crm/accounts/crm-accounts-reconcile.job.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_comptes_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-comptes';
const ROLES = ['admin', 'sales_rep', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
type Compte = Role | 'ownerB';

/** NIF fictif unique (5 à 20 lettres ou chiffres). */
const nif = (n: number) => `T${tag.toUpperCase()}${String(n).padStart(3, '0')}`;

e2eSuite('Comptes CRM 360° (ADR-0040 C1)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  const userIds = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asN = (role: Role = 'owner') => [...cookies[role], `active_org_id=${orgN}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const del = (c: string[], path: string) => request(server()).delete(path).set('Cookie', c);
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const ok = (res: request.Response, status = 200) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Record<string, any>;
  };
  const code = (res: request.Response, status: number, expected: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.code).toBe(expected);
  };

  async function prospect(name: string, c: string[] = asN(), extra: Record<string, unknown> = {}) {
    return ok(await post(c, '/crm/accounts', { name, ...extra }), 201) as {
      account: Record<string, any>;
      warnings: Array<{ code: string; accountId: string }>;
    };
  }
  async function contact(body: Record<string, unknown>, c: string[] = asN()) {
    return ok(
      await post(c, '/crm/contacts', {
        name: `Personne ${randomBytes(2).toString('hex')}`,
        ...body,
      }),
      201,
    );
  }
  async function client(name: string, n: number, c: string[] = asN()) {
    return ok(await post(c, '/sales/customers', { type: 'PM', name, nif: nif(n) }), 201);
  }
  const accountOfCustomer = (customerId: string) =>
    db.collection('crm_accounts').findOne({ organizationId: orgN, customerId });

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-comptes-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Comptes ${c}`,
    });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    for (const role of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');
    for (const m of await db.collection('memberships').find({}).toArray()) {
      const who = (Object.keys(emails) as Compte[]).find(
        (c) =>
          (c === 'ownerB' ? m['organizationId'] === orgB : m['organizationId'] === orgN) &&
          m['role'] === (c === 'ownerB' ? 'owner' : c),
      );
      if (who) userIds[who] = m['userId'] as string;
    }
    expect(Object.keys(userIds).sort()).toEqual([
      'admin',
      'owner',
      'ownerB',
      'sales_rep',
      'viewer',
    ]);
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Prospects ────────────────────────────────────────────────────────────

  describe('prospects', () => {
    it('créer : le Commercial crée un prospect, il en est responsable ; un homonyme est signalé, pas refusé', async () => {
      const a = await prospect('Kin Logistique', asN('sales_rep'), { industry: 'Transport' });
      expect(a.account).toMatchObject({
        kind: 'prospect',
        customerId: null,
        name: 'Kin Logistique',
        ownerId: userIds['sales_rep'],
        industry: 'Transport',
        active: true,
        conversion: null,
        mergedInto: null,
        revision: 1,
      });
      expect(a.warnings).toEqual([]);
      const b = await prospect('  KIN  logistique ');
      expect(b.account.ownerId).toBe(userIds['owner']);
      expect(b.warnings).toEqual([{ code: 'CRM_ACCOUNT_SIMILAR_NAME', accountId: a.account.id }]);
    });

    it('corps strict ; responsable sans `crm.manage` refusé ; membre inconnu 404', async () => {
      code(
        await post(asN(), '/crm/accounts', { name: 'X', kind: 'customer' }),
        400,
        'INVALID_REQUEST',
      );
      code(await post(asN(), '/crm/accounts', { name: '' }), 400, 'INVALID_REQUEST');
      code(
        await post(asN(), '/crm/accounts', { name: 'Y', ownerId: userIds['viewer'] }),
        400,
        'CRM_OWNER_NOT_ELIGIBLE',
      );
      code(
        await post(asN(), '/crm/accounts', { name: 'Y', ownerId: new ObjectId().toHexString() }),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      const sansResp = await prospect('Sans responsable', asN(), { ownerId: null });
      expect(sansResp.account.ownerId).toBeNull();
    });

    it('liste triée par nom, filtres (kind, ownerId=me, q) et pagination ; compteurs', async () => {
      const p = await prospect('Zèbre Conseil', asN('sales_rep'));
      await contact({ accountId: p.account.id });
      await contact({ accountId: p.account.id });
      const page = ok(await get(asN('viewer'), '/crm/accounts?q=zebre'));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: p.account.id,
        counts: { contacts: 2, openOpportunities: 0 },
        nextActivity: null,
      });
      const mine = ok(await get(asN('sales_rep'), '/crm/accounts?ownerId=me&kind=prospect'));
      expect(mine.items.every((i: { ownerId: string }) => i.ownerId === userIds['sales_rep'])).toBe(
        true,
      );
      expect(mine.items.map((i: { name: string }) => i.name)).toContain('Zèbre Conseil');
      const p1 = ok(await get(asN(), '/crm/accounts?limit=1'));
      expect(p1.items).toHaveLength(1);
      expect(p1.nextCursor).toEqual(expect.any(String));
      const p2 = ok(await get(asN(), `/crm/accounts?limit=1&cursor=${p1.nextCursor}`));
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
      code(await get(asN(), '/crm/accounts?cursor=abc'), 400, 'INVALID_CURSOR');
      code(await get(asN(), '/crm/accounts?ownerId=nobody'), 400, 'INVALID_REQUEST');
    });

    it('modifier : révision attendue, renommage recopié sur les contacts ; archiver et restaurer', async () => {
      const p = await prospect('Ancien Nom');
      const k = await contact({ accountId: p.account.id });
      expect(k).toMatchObject({
        companyName: 'Ancien Nom',
        customerId: null,
        accountName: 'Ancien Nom',
      });
      code(
        await put(asN(), `/crm/accounts/${p.account.id}`, { expectedRevision: 9, name: 'Z' }),
        409,
        'STALE_REVISION',
      );
      const u = ok(
        await put(asN('sales_rep'), `/crm/accounts/${p.account.id}`, {
          expectedRevision: 1,
          name: 'Nouveau Nom',
          origin: 'Salon',
          website: 'https://exemple.cd',
        }),
      );
      expect(u.account).toMatchObject({ name: 'Nouveau Nom', origin: 'Salon', revision: 2 });
      expect(ok(await get(asN(), `/crm/contacts/${k.id}`))).toMatchObject({
        companyName: 'Nouveau Nom',
        accountName: 'Nouveau Nom',
      });
      const arch = ok(
        await post(asN(), `/crm/accounts/${p.account.id}/archive`, { expectedRevision: 2 }),
      );
      expect(arch).toMatchObject({ active: false, revision: 3 });
      const liste = ok(await get(asN(), '/crm/accounts?q=nouveau nom'));
      expect(liste.items).toHaveLength(0);
      const archives = ok(await get(asN(), '/crm/accounts?q=nouveau nom&active=false'));
      expect(archives.items).toHaveLength(1);
      expect(
        ok(await post(asN(), `/crm/accounts/${p.account.id}/restore`, { expectedRevision: 3 })),
      ).toMatchObject({ active: true, revision: 4 });
    });

    it('supprimer : seulement un prospect sans contact, opportunité ni activité', async () => {
      const vide = await prospect('Éphémère');
      const utilise = await prospect('Utilisé');
      await contact({ accountId: utilise.account.id });
      const r = await del(asN(), `/crm/accounts/${utilise.account.id}`);
      code(r, 409, 'CRM_ACCOUNT_IN_USE');
      expect(r.body.details).toMatchObject({ contacts: 1 });
      expect((await del(asN('sales_rep'), `/crm/accounts/${vide.account.id}`)).status).toBe(204);
      code(await get(asN(), `/crm/accounts/${vide.account.id}`), 404, 'CRM_ACCOUNT_NOT_FOUND');
    });
  });

  // ── Contacts ─────────────────────────────────────────────────────────────

  describe('contacts rattachés à un compte (§ 2.2)', () => {
    it('`accountId` : `customerId` et `companyName` recopiés du compte ; `null` : sans entreprise', async () => {
      const p = await prospect('Bois du Mayombe');
      const k = await contact({ accountId: p.account.id.toUpperCase(), companyName: 'Ignoré' });
      expect(k).toMatchObject({
        kind: 'prospect',
        accountId: p.account.id,
        accountName: 'Bois du Mayombe',
        companyName: 'Bois du Mayombe',
        customerId: null,
      });
      const seul = await contact({ accountId: null, companyName: 'Ignorée aussi' });
      expect(seul).toMatchObject({ accountId: null, companyName: null, customerId: null });
      const filtre = ok(await get(asN(), `/crm/contacts?accountId=${p.account.id}`));
      expect(filtre.items.map((i: { id: string }) => i.id)).toEqual([k.id]);
    });

    it('compatibilité N-1 : `companyName` sans `accountId` → le prospect de même nom normalisé, créé au besoin', async () => {
      const k1 = await contact({ companyName: 'Atelier Ngaliema' }, asN('sales_rep'));
      expect(k1.accountId).toEqual(expect.any(String));
      const k2 = await contact({ companyName: '  atelier   NGALIEMA ' });
      expect(k2.accountId).toBe(k1.accountId);
      expect(k2.companyName).toBe('Atelier Ngaliema');
      const compte = ok(await get(asN(), `/crm/accounts/${k1.accountId}`));
      expect(compte).toMatchObject({ kind: 'prospect', ownerId: userIds['sales_rep'] });
    });

    it('compatibilité N-1 : `customerId` sans `accountId` → le compte du client', async () => {
      const c = await client('Brasserie Exemple', 1);
      const k = await contact({ customerId: c.id });
      const compte = await accountOfCustomer(c.id);
      expect(k).toMatchObject({
        kind: 'customer_contact',
        customerId: c.id,
        accountId: String(compte!._id),
        companyName: null,
      });
    });

    it('compte fusionné : 409 ; compte inconnu : 404', async () => {
      const a = await prospect('Source fusion contact');
      const b = await prospect('Cible fusion contact');
      ok(
        await post(asN(), `/crm/accounts/${a.account.id}/merge`, {
          targetAccountId: b.account.id,
          expectedRevision: 1,
        }),
      );
      code(
        await post(asN(), '/crm/contacts', { name: 'Z', accountId: a.account.id }),
        409,
        'CRM_ACCOUNT_MERGED',
      );
      code(
        await post(asN(), '/crm/contacts', { name: 'Z', accountId: new ObjectId().toHexString() }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(
        await post(asN(), '/crm/contacts', { name: 'Z', accountId: 'pas-un-id' }),
        400,
        'INVALID_REQUEST',
      );
    });
  });

  // ── Conversion ───────────────────────────────────────────────────────────

  describe('conversion prospect → client (§ 3.1.1, critère 5)', () => {
    it('le Commercial ne convertit pas (403, `sales.manage`) ; le Lecteur non plus', async () => {
      const p = await prospect('Prospect du commercial', asN('sales_rep'));
      const corps = {
        mode: 'create',
        customer: { type: 'PM', name: 'Prospect du commercial', nif: nif(90) },
        expectedRevision: 1,
      };
      for (const role of ['sales_rep', 'viewer'] as const) {
        const r = await post(asN(role), `/crm/accounts/${p.account.id}/convert`, corps);
        expect(r.status, role).toBe(403);
        expect(r.body).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(await db.collection('customers').countDocuments({ nif: nif(90) })).toBe(0);
    });

    it('PM sans NIF : 400 NIF_REQUIRED_FOR_TYPE (règle de Ventes) ; NIF connu : 409 CUSTOMER_NIF_EXISTS ; NIF valide : même compte devenu client', async () => {
      const deja = await client('Déjà Client SA', 2);
      const p = await prospect('Mines du Katanga', asN('sales_rep'));
      const k = await contact({ accountId: p.account.id });
      // Opportunité et activité rattachées au compte (champ `accountId` posé par la
      // migration et par le lot C2 / C4 : écrit ici directement).
      const opp = ok(
        await post(asN(), '/crm/opportunities', {
          title: 'Audit des mines',
          prospectName: 'Mines du Katanga',
          currency: 'USD',
          amount: '5000',
        }),
        201,
      );
      await db
        .collection('crm_opportunities')
        .updateOne({ _id: new ObjectId(opp.id) }, { $set: { accountId: p.account.id } });
      const act = ok(
        await post(asN(), '/crm/activities', {
          kind: 'call',
          subject: 'Appeler le DG',
          opportunityId: opp.id,
        }),
        201,
      );
      await db
        .collection('crm_activities')
        .updateOne({ _id: new ObjectId(act.id) }, { $set: { accountId: p.account.id } });

      const url = `/crm/accounts/${p.account.id}/convert`;
      const sansNif = await post(asN('admin'), url, {
        mode: 'create',
        customer: { type: 'PM', name: 'Mines du Katanga SA' },
        expectedRevision: 1,
      });
      code(sansNif, 400, 'INVALID_REQUEST');
      expect(sansNif.body.details.issues).toContainEqual(
        expect.objectContaining({ path: 'customer.nif', code: 'NIF_REQUIRED_FOR_TYPE' }),
      );
      const doublon = await post(asN('admin'), url, {
        mode: 'create',
        customer: { type: 'PM', name: 'Mines du Katanga SA', nif: nif(2) },
        expectedRevision: 1,
      });
      code(doublon, 409, 'CUSTOMER_NIF_EXISTS');
      expect(doublon.body.details).toEqual({ existingId: deja.id });
      code(
        await post(asN('admin'), url, {
          mode: 'create',
          customer: { type: 'PM', name: 'Mines du Katanga SA', nif: nif(3) },
          expectedRevision: 7,
        }),
        409,
        'STALE_REVISION',
      );
      // Rien n'a été créé par les tentatives refusées.
      expect(
        await db
          .collection('customers')
          .countDocuments({ organizationId: orgN, name: 'Mines du Katanga SA' }),
      ).toBe(0);

      const conv = ok(
        await post(asN('admin'), url, {
          mode: 'create',
          customer: { type: 'PM', name: 'Mines du Katanga SA', nif: nif(3), email: 'dg@mines.cd' },
          expectedRevision: 1,
        }),
      );
      expect(conv).toMatchObject({ mode: 'created', merged: false });
      expect(conv.account).toMatchObject({
        id: p.account.id,
        kind: 'customer',
        customerId: conv.customerId,
        name: 'Mines du Katanga SA',
        ownerId: userIds['sales_rep'],
        conversion: { customerId: conv.customerId, convertedBy: userIds['admin'], mode: 'created' },
        revision: 2,
      });
      // Un seul compte pour la fiche : la synchronisation n'en a pas créé un second.
      expect(
        await db
          .collection('crm_accounts')
          .countDocuments({ organizationId: orgN, customerId: conv.customerId }),
      ).toBe(1);
      // La fiche client porte l'identité fiscale, par les règles de Ventes.
      expect(ok(await get(asN('sales_rep'), `/sales/customers/${conv.customerId}`))).toMatchObject({
        type: 'PM',
        nif: nif(3),
        name: 'Mines du Katanga SA',
      });
      // Contacts, opportunités et activités portent le `customerId`.
      expect(ok(await get(asN(), `/crm/contacts/${k.id}`))).toMatchObject({
        kind: 'customer_contact',
        customerId: conv.customerId,
        accountId: p.account.id,
        companyName: null,
      });
      expect(
        await db.collection('crm_opportunities').findOne({ _id: new ObjectId(opp.id) }),
      ).toMatchObject({
        accountId: p.account.id,
        customerId: conv.customerId,
        prospectName: null,
      });
      expect(
        await db.collection('crm_activities').findOne({ _id: new ObjectId(act.id) }),
      ).toMatchObject({
        accountId: p.account.id,
        customerId: conv.customerId,
      });
      expect(
        await db.collection('audit_events').countDocuments({
          organizationId: orgN,
          action: 'crm.account.converted',
          targetId: p.account.id,
        }),
      ).toBe(1);
      // La facturation DGI n'est pas affaiblie : le NIF reste obligatoire sur la fiche.
      const sansNifVentes = await put(asN(), `/sales/customers/${conv.customerId}`, {
        type: 'PM',
        name: 'Mines du Katanga SA',
        nif: null,
        expectedRevision: 1,
      });
      code(sansNifVentes, 400, 'INVALID_REQUEST');
      expect(sansNifVentes.body.details.issues).toContainEqual(
        expect.objectContaining({ code: 'NIF_REQUIRED_FOR_TYPE' }),
      );
      // Un compte client ne se reconvertit pas.
      code(
        await post(asN(), url, { mode: 'link', customerId: deja.id, expectedRevision: 2 }),
        409,
        'CRM_ACCOUNT_NOT_PROSPECT',
      );
    });

    it('`link` vers une fiche qui a son compte : le prospect y est fusionné', async () => {
      const c = await client('Cimenterie Exemple', 4);
      const compteClient = await accountOfCustomer(c.id);
      const p = await prospect('Cimenterie (prospect)');
      const k = await contact({ accountId: p.account.id });
      const conv = ok(
        await post(asN(), `/crm/accounts/${p.account.id}/convert`, {
          mode: 'link',
          customerId: c.id,
          expectedRevision: 1,
        }),
      );
      expect(conv).toMatchObject({ mode: 'linked', merged: true, customerId: c.id });
      expect(conv.account.id).toBe(String(compteClient!._id));
      expect(ok(await get(asN(), `/crm/contacts/${k.id}`))).toMatchObject({
        accountId: String(compteClient!._id),
        customerId: c.id,
      });
      expect(ok(await get(asN(), `/crm/accounts/${p.account.id}`))).toMatchObject({
        mergedInto: String(compteClient!._id),
        active: false,
      });
    });

    it('`link` vers une fiche sans compte (synchronisation perdue) : le prospect devient son compte', async () => {
      const c = await client('Orpheline SA', 5);
      await db.collection('crm_accounts').deleteOne({ organizationId: orgN, customerId: c.id });
      const p = await prospect('Orpheline (prospect)');
      const conv = ok(
        await post(asN(), `/crm/accounts/${p.account.id}/convert`, {
          mode: 'link',
          customerId: c.id,
          expectedRevision: 1,
        }),
      );
      expect(conv).toMatchObject({ mode: 'linked', merged: false });
      expect(conv.account).toMatchObject({
        id: p.account.id,
        kind: 'customer',
        customerId: c.id,
        name: 'Orpheline SA',
        conversion: { mode: 'linked' },
      });
    });
  });

  // ── Fusion ───────────────────────────────────────────────────────────────

  describe('fusion (§ 3.1)', () => {
    it('réaffecte contacts, opportunités et activités ; la source garde la trace et sort des listes', async () => {
      const source = await prospect('Doublon Sarl');
      const cible = await prospect('Doublon SARL (vrai)');
      const k = await contact({ accountId: source.account.id });
      code(
        await post(asN(), `/crm/accounts/${source.account.id}/merge`, {
          targetAccountId: source.account.id,
          expectedRevision: 1,
        }),
        409,
        'CRM_ACCOUNT_MERGE_INTO_SELF',
      );
      code(
        await post(asN(), `/crm/accounts/${source.account.id}/merge`, {
          targetAccountId: cible.account.id,
          expectedRevision: 3,
        }),
        409,
        'STALE_REVISION',
      );
      const r = ok(
        await post(asN('sales_rep'), `/crm/accounts/${source.account.id}/merge`, {
          targetAccountId: cible.account.id,
          expectedRevision: 1,
        }),
      );
      expect(r.account.id).toBe(cible.account.id);
      expect(r.moved).toMatchObject({ contacts: 1 });
      expect(ok(await get(asN(), `/crm/contacts/${k.id}`))).toMatchObject({
        accountId: cible.account.id,
        companyName: 'Doublon SARL (vrai)',
      });
      const liste = ok(await get(asN(), '/crm/accounts?q=doublon'));
      expect(liste.items.map((i: { id: string }) => i.id)).toEqual([cible.account.id]);
      code(
        await put(asN(), `/crm/accounts/${source.account.id}`, { expectedRevision: 2, notes: 'x' }),
        409,
        'CRM_ACCOUNT_MERGED',
      );
    });

    it('un compte client ne se fusionne pas dans un autre', async () => {
      const c = await client('Client non fusionnable', 6);
      const compte = await accountOfCustomer(c.id);
      const cible = await prospect('Cible quelconque');
      code(
        await post(asN(), `/crm/accounts/${String(compte!._id)}/merge`, {
          targetAccountId: cible.account.id,
          expectedRevision: compte!['revision'],
        }),
        409,
        'CRM_ACCOUNT_NOT_PROSPECT',
      );
    });
  });

  // ── Synchronisation ──────────────────────────────────────────────────────

  describe('synchronisation fiche client → compte (§ 2.1, critère 6)', () => {
    it('création, renommage, désactivation, réactivation de la fiche recopiés ; le CRM ne renomme pas un client', async () => {
      const c = await client('Pharmacie du Fleuve', 7);
      const compte = await accountOfCustomer(c.id);
      expect(compte).toMatchObject({
        kind: 'customer',
        name: 'Pharmacie du Fleuve',
        ownerId: null,
        active: true,
      });
      const id = String(compte!._id);
      const k = await contact({ accountId: id });
      expect(k).toMatchObject({ customerId: c.id, companyName: null, kind: 'customer_contact' });

      ok(
        await put(asN(), `/sales/customers/${c.id}`, {
          type: 'PM',
          name: 'Pharmacie du Grand Fleuve',
          nif: nif(7),
          expectedRevision: 1,
        }),
      );
      const renomme = ok(await get(asN(), `/crm/accounts/${id}`));
      expect(renomme.name).toBe('Pharmacie du Grand Fleuve');
      code(
        await put(asN(), `/crm/accounts/${id}`, {
          expectedRevision: renomme.revision,
          name: 'Autre nom',
        }),
        409,
        'CRM_ACCOUNT_IDENTITY_FROM_CUSTOMER',
      );
      // Champs commerciaux : modifiables ; même nom renvoyé : accepté.
      const commercial = ok(
        await put(asN('sales_rep'), `/crm/accounts/${id}`, {
          expectedRevision: renomme.revision,
          name: 'Pharmacie du Grand Fleuve',
          ownerId: userIds['sales_rep'],
          industry: 'Santé',
        }),
      );
      expect(commercial.account).toMatchObject({
        ownerId: userIds['sales_rep'],
        industry: 'Santé',
      });
      code(
        await post(asN(), `/crm/accounts/${id}/archive`, {
          expectedRevision: commercial.account.revision,
        }),
        409,
        'CRM_ACCOUNT_FOLLOWS_CUSTOMER',
      );
      code(await del(asN(), `/crm/accounts/${id}`), 409, 'CRM_ACCOUNT_FOLLOWS_CUSTOMER');

      ok(await post(asN(), `/sales/customers/${c.id}/deactivate`));
      expect(ok(await get(asN(), `/crm/accounts/${id}`)).active).toBe(false);
      ok(await post(asN(), `/sales/customers/${c.id}/reactivate`));
      expect(ok(await get(asN(), `/crm/accounts/${id}`)).active).toBe(true);

      // Fiche jamais facturée supprimée : le compte redevient prospect, son fil reste.
      expect((await del(asN(), `/sales/customers/${c.id}`)).status).toBe(204);
      expect(ok(await get(asN(), `/crm/accounts/${id}`))).toMatchObject({
        kind: 'prospect',
        customerId: null,
        name: 'Pharmacie du Grand Fleuve',
        ownerId: userIds['sales_rep'],
        industry: 'Santé',
      });
      expect(ok(await get(asN(), `/crm/contacts/${k.id}`))).toMatchObject({
        accountId: id,
        customerId: null,
        companyName: 'Pharmacie du Grand Fleuve',
        kind: 'prospect',
      });
    });

    it('réconciliation : une synchronisation perdue est rattrapée, un second passage n’écrit rien', async () => {
      const c = await client('Synchro Perdue', 8);
      await db.collection('crm_accounts').deleteOne({ organizationId: orgN, customerId: c.id });
      await db
        .collection('customers')
        .updateOne({ _id: new ObjectId(c.id) }, { $set: { name: 'Synchro Perdue SA' } });
      const autre = await client('Renommée hors synchro', 9);
      await db
        .collection('customers')
        .updateOne({ _id: new ObjectId(autre.id) }, { $set: { name: 'Renommée hors synchro SA' } });
      const job = app.get(CrmAccountsReconcileJob);
      const r1 = await job.run();
      expect(r1).toMatchObject({ created: 1, updated: 1, failed: 0 });
      expect(await accountOfCustomer(c.id)).toMatchObject({
        name: 'Synchro Perdue SA',
        kind: 'customer',
      });
      expect(await accountOfCustomer(autre.id)).toMatchObject({ name: 'Renommée hors synchro SA' });
      expect(await job.run()).toEqual({
        examined: 0,
        created: 0,
        updated: 0,
        reverted: 0,
        failed: 0,
      });
    });
  });

  // ── Rapport de migration ─────────────────────────────────────────────────

  describe('rapport de migration (§ 2.7)', () => {
    it('404 avant la migration ; après : servi à `crm.manage` (Commercial compris), refusé au Lecteur', async () => {
      code(
        await get(asN(), '/crm/accounts/migration-report'),
        404,
        'CRM_MIGRATION_REPORT_NOT_FOUND',
      );
      await db.collection('crm_contacts').insertOne({
        organizationId: orgN,
        name: 'Ancien contact',
        jobTitle: null,
        email: null,
        phone: null,
        customerId: null,
        companyName: 'Héritage SARL',
        notes: null,
        sortName: 'ancien contact',
        searchKey: 'ancien contact heritage sarl',
        revision: 1,
        createdBy: userIds['owner'],
        updatedBy: userIds['owner'],
        createdAt: new Date(),
        updatedAt: new Date(),
        _schemaVersion: 1,
      });
      const migration = (await import(
        new URL('../../migrations/20261030-0001-crm-accounts.mjs', import.meta.url).href
      )) as { up(db: Db, o: { quiet: boolean }): Promise<unknown> };
      await migration.up(db, { quiet: true });
      const r = ok(await get(asN('sales_rep'), '/crm/accounts/migration-report'));
      expect(r).toMatchObject({
        organizationId: orgN,
        migration: '20261030-0001-crm-accounts',
        accountsCreated: { prospect: 1 },
      });
      expect((await get(asN('viewer'), '/crm/accounts/migration-report')).status).toBe(403);
      // L'organisation B n'a rien migré : pas de rapport, jamais celui de N.
      code(
        await get(asB(), '/crm/accounts/migration-report'),
        404,
        'CRM_MIGRATION_REPORT_NOT_FOUND',
      );
    });
  });

  // ── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('Lecteur : lit (crm.read), n’écrit pas (crm.manage)', async () => {
      const p = await prospect('Lu par le lecteur');
      ok(await get(asN('viewer'), '/crm/accounts'));
      ok(await get(asN('viewer'), `/crm/accounts/${p.account.id}`));
      const refus = [
        await post(asN('viewer'), '/crm/accounts', { name: 'Non' }),
        await put(asN('viewer'), `/crm/accounts/${p.account.id}`, {
          expectedRevision: 1,
          notes: 'x',
        }),
        await post(asN('viewer'), `/crm/accounts/${p.account.id}/archive`, { expectedRevision: 1 }),
        await post(asN('viewer'), `/crm/accounts/${p.account.id}/restore`, { expectedRevision: 1 }),
        await del(asN('viewer'), `/crm/accounts/${p.account.id}`),
        await post(asN('viewer'), `/crm/accounts/${p.account.id}/merge`, {
          targetAccountId: p.account.id,
          expectedRevision: 1,
        }),
      ];
      for (const r of refus) {
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ code: 'FORBIDDEN', action: 'crm.manage' });
      }
    });

    it('Commercial : lit et gère les comptes, consulte les clients, n’en crée pas', async () => {
      ok(await get(asN('sales_rep'), '/crm/accounts'));
      ok(await get(asN('sales_rep'), '/sales/customers'));
      const r = await post(asN('sales_rep'), '/sales/customers', { type: 'PP', name: 'Interdit' });
      expect(r.status).toBe(403);
    });
  });

  // ── Isolation ────────────────────────────────────────────────────────────

  describe('isolation entre organisations (critère 18)', () => {
    it('tout identifiant d’une autre organisation répond 404, dans l’URL comme dans le corps', async () => {
      const pN = await prospect('Secret de N');
      const pB = await prospect('Prospect de B', asB());
      const cN = await client('Client de N', 10);
      const id = pN.account.id;

      code(await get(asB(), `/crm/accounts/${id}`), 404, 'CRM_ACCOUNT_NOT_FOUND');
      code(
        await put(asB(), `/crm/accounts/${id}`, { expectedRevision: 1, notes: 'x' }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(
        await post(asB(), `/crm/accounts/${id}/archive`, { expectedRevision: 1 }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(
        await post(asB(), `/crm/accounts/${id}/restore`, { expectedRevision: 1 }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(await del(asB(), `/crm/accounts/${id}`), 404, 'CRM_ACCOUNT_NOT_FOUND');
      code(
        await post(asB(), `/crm/accounts/${id}/merge`, {
          targetAccountId: pB.account.id,
          expectedRevision: 1,
        }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      // `targetAccountId` forgé : le prospect de B ne se fusionne pas dans un compte de N.
      code(
        await post(asB(), `/crm/accounts/${pB.account.id}/merge`, {
          targetAccountId: id,
          expectedRevision: 1,
        }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      code(
        await post(asB(), `/crm/accounts/${id}/convert`, {
          mode: 'create',
          customer: { type: 'PP', name: 'Vol' },
          expectedRevision: 1,
        }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      // `customerId` forgé : une fiche de N ne se rattache pas à un prospect de B.
      code(
        await post(asB(), `/crm/accounts/${pB.account.id}/convert`, {
          mode: 'link',
          customerId: cN.id,
          expectedRevision: 1,
        }),
        404,
        'CUSTOMER_NOT_FOUND',
      );
      // `ownerId` forgé : un membre de N n'est pas responsable dans B.
      code(
        await post(asB(), '/crm/accounts', { name: 'Z', ownerId: userIds['owner'] }),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      code(
        await put(asB(), `/crm/accounts/${pB.account.id}`, {
          expectedRevision: 1,
          ownerId: userIds['sales_rep'],
        }),
        404,
        'CRM_MEMBER_NOT_FOUND',
      );
      // `accountId` forgé dans un contact.
      code(
        await post(asB(), '/crm/contacts', { name: 'Z', accountId: id }),
        404,
        'CRM_ACCOUNT_NOT_FOUND',
      );
      // Listes : rien de N chez B ; la synchronisation de N ne crée rien chez B.
      const listeB = ok(await get(asB(), '/crm/accounts?limit=100'));
      expect(listeB.items.map((i: { id: string }) => i.id)).toEqual([pB.account.id]);
      expect(ok(await get(asB(), '/crm/contacts?accountId=' + id)).items).toEqual([]);
      // Rien n'a bougé chez N.
      expect(ok(await get(asN(), `/crm/accounts/${id}`))).toMatchObject({
        revision: 1,
        mergedInto: null,
      });
      expect(await db.collection('crm_accounts').countDocuments({ organizationId: orgB })).toBe(1);
    });
  });
});
