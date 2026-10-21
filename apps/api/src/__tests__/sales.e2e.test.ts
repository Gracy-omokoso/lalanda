// Clients, catalogue et groupes de taxation contre la vraie application
// (ADR-0022 § S25c, critères d'acceptation « D1 »).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB. BASE DÉDIÉE, supprimée à la fin. Les NIF sont fictifs.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EdefReferenceSnapshotsService } from '../edef/edef-reference-snapshots.service.js';
import { CustomersService } from '../sales/customers.service.js';
import { SalesUsageService } from '../sales/sales-usage.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_sales_${tag}`;

const MOT_DE_PASSE = 'Passw0rd!ventes';

// Chaque cas enchaîne plusieurs requêtes authentifiées : 5 s par défaut ne
// suffisent pas sous charge (suites e2e parallèles).
vi.setConfig({ testTimeout: 60_000 });

const ROLES = [
  'owner',
  'admin',
  'finance_director',
  'accountant',
  'analyst',
  'advisor',
  'viewer',
] as const;
type Role = (typeof ROLES)[number];
type Compte = Role | 'ownerB' | 'superAdmin';

const ARTICLE = {
  code: 'LAIT-1L',
  name: 'Lait demi-écrémé 1 L',
  itemType: 'BIE',
  taxGroup: 'B',
  outOfScope: false,
  unitPrice: '464',
  priceMode: 'ttc',
  currency: 'CDF',
  unit: 'pièce',
  specificTax: null,
};

e2eSuite('ventes — clients, catalogue, groupes de taxation (ADR-0022 chantier D1)', () => {
  let app: INestApplication;
  let db: Db;
  let orgId = '';
  let orgB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;
  let superAdminOrg = '';

  const server = () => app.getHttpServer();
  const asA = (role: Role) => [...cookies[role], `active_org_id=${orgId}`];
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

  const issueCodes = (res: request.Response): string[] =>
    ((res.body?.details?.issues ?? []) as { code: string }[]).map((i) => i.code);

  let nifSeq = 0;
  /** NIF fictif unique pour l'exécution. */
  const nif = () => `T${tag.toUpperCase()}${String(++nifSeq).padStart(4, '0')}`;

  async function createCustomer(body: Record<string, unknown>, c = asA('owner')) {
    const res = await post(c, '/sales/customers', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; revision: number; nif: string | null };
  }

  async function createItem(body: Record<string, unknown>, c = asA('owner')) {
    const res = await post(c, '/sales/catalog-items', { ...ARTICLE, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; revision: number };
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);

    for (const c of [...ROLES, 'ownerB', 'superAdmin'] as const) {
      emails[c] = `ventes-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Ventes ${c}`,
    });

    cookies['owner'] = await registerAndLogin(app, compte('owner'));
    const orgs = await request(server()).get('/organizations').set('Cookie', cookies['owner']);
    orgId = (orgs.body.organizations as { id: string }[])[0]!.id;

    for (const role of ROLES.filter((r) => r !== 'owner')) {
      const inv = await request(server())
        .post(`/organizations/${orgId}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
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

    // Super-administrateur plateforme SANS appartenance à l'organisation A ni
    // accès délégué : il n'a que son organisation personnelle.
    cookies['superAdmin'] = await registerAndLogin(app, compte('superAdmin'));
    const orgsS = await request(server())
      .get('/organizations')
      .set('Cookie', cookies['superAdmin']);
    superAdminOrg = (orgsS.body.organizations as { id: string }[])[0]!.id;
    // Les comptes better-auth ne vivent pas dans la base dédiée de la suite :
    // l'identifiant se lit dans la session.
    const session = await request(server())
      .get('/auth/get-session')
      .set('Cookie', cookies['superAdmin']);
    const superAdminId = String(session.body?.user?.id ?? '');
    expect(superAdminId).not.toBe('');
    await db.collection('platform_roles').insertOne({
      userId: superAdminId,
      role: 'platform_super_admin',
      grantedBy: null,
      reason: 'e2e ventes',
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => {
    // Quota global (100 req/min par IP) : on vide le compteur, on ne désactive pas le garde.
    // Les minuteurs d'expiration sont annulés AVANT de vider le compteur : sinon
    // ils se déclenchent plus tard sur une clé disparue (erreur non gérée).
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
    }
  }, E2E_HOOK_TIMEOUT_MS);

  // ── Permissions ─────────────────────────────────────────────────────────

  describe('permissions sales.read / sales.manage', () => {
    for (const role of ['owner', 'admin', 'finance_director', 'accountant'] as const) {
      it(`${role} : lit et écrit`, async () => {
        expect((await get(asA(role), '/sales/customers')).status).toBe(200);
        expect((await get(asA(role), '/sales/catalog-items')).status).toBe(200);
        expect((await get(asA(role), '/sales/tax-groups')).status).toBe(200);
        const c = await createCustomer({ type: 'PP', name: `Client ${role}` }, asA(role));
        const res = await put(asA(role), `/sales/customers/${c.id}`, {
          expectedRevision: 1,
          type: 'PP',
          name: `Client ${role} modifié`,
        });
        expect(res.status).toBe(200);
        await createItem({ code: `ART-${role}` }, asA(role));
      });
    }
    for (const role of ['analyst', 'viewer'] as const) {
      it(`${role} : lit, n'écrit pas`, async () => {
        expect((await get(asA(role), '/sales/customers')).status).toBe(200);
        expect((await get(asA(role), '/sales/catalog-items')).status).toBe(200);
        expect((await get(asA(role), '/sales/tax-groups')).status).toBe(200);
        const res = await post(asA(role), '/sales/customers', { type: 'PP', name: 'Interdit' });
        expect(res.status).toBe(403);
        expect(res.body.action).toBe('sales.manage');
        const res2 = await post(asA(role), '/sales/catalog-items', ARTICLE);
        expect(res2.status).toBe(403);
      });
    }
    it('advisor : aucun accès', async () => {
      for (const path of ['/sales/customers', '/sales/catalog-items', '/sales/tax-groups']) {
        const res = await get(asA('advisor'), path);
        expect(res.status, path).toBe(403);
        expect(res.body.action).toBe('sales.read');
      }
    });
  });

  // ── Clients ─────────────────────────────────────────────────────────────

  describe('clients — champs requis par type', () => {
    it.each([
      ['PP', {}, 'NAME_REQUIRED'],
      ['PM', { nif: 'A1234567X' }, 'NAME_REQUIRED'],
      ['PM', { name: 'Exemple SARL' }, 'NIF_REQUIRED_FOR_TYPE'],
      ['PC', { name: 'Commerçant' }, 'NIF_REQUIRED_FOR_TYPE'],
      ['PC', { nif: 'A1234567X' }, 'NAME_REQUIRED'],
      ['PL', { name: 'Avocat' }, 'NIF_REQUIRED_FOR_TYPE'],
      ['PL', { nif: 'A1234567X' }, 'NAME_REQUIRED'],
      ['AO', { name: 'Ambassade' }, 'EXEMPTION_REFERENCE_REQUIRED'],
      ['AO', { exemptionReference: 'EXO-1' }, 'NAME_REQUIRED'],
      [
        'PM',
        { name: 'X', nif: 'A1234567X', exemptionReference: 'EXO' },
        'EXEMPTION_REFERENCE_NOT_ALLOWED',
      ],
      ['PP', { name: 'X', nif: '12' }, 'NIF_INVALID'],
    ])('%s %j → 400 %s', async (type, extra, code) => {
      const res = await post(asA('owner'), '/sales/customers', { type, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
      expect(issueCodes(res)).toContain(code);
    });

    it('chaque type valide → 201', async () => {
      const pp = await createCustomer({ type: 'PP', name: 'Jean Client' });
      expect(pp.nif).toBeNull();
      await createCustomer({ type: 'PM', name: 'Exemple SARL', nif: nif() });
      await createCustomer({ type: 'PC', name: 'Boutique', nif: nif() });
      await createCustomer({ type: 'PL', name: 'Cabinet', nif: nif() });
      const ao = await post(asA('owner'), '/sales/customers', {
        type: 'AO',
        name: 'Ambassade Exemple',
        exemptionReference: 'EXO-2026-001',
      });
      expect(ao.status).toBe(201);
      expect(ao.body.typeLabel).toBe('Ambassades et organisations internationales');
      expect(ao.body.exemptionReference).toBe('EXO-2026-001');
    });

    it('vue complète conforme au contrat', async () => {
      const res = await post(asA('owner'), '/sales/customers', {
        type: 'PM',
        name: '  Contrat SARL ',
        nif: `a ${tag}-0001x`,
        exemptionReference: null,
        phone: '+243 800 000 000',
        email: 'compta@exemple.cd',
        address: '1, avenue Exemple, Gombe, Kinshasa',
      });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'id',
          'type',
          'typeLabel',
          'name',
          'nif',
          'exemptionReference',
          'phone',
          'email',
          'address',
          'active',
          'deactivatedAt',
          'invoiced',
          'revision',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(res.body).toMatchObject({
        name: 'Contrat SARL',
        nif: `A${tag.toUpperCase()}0001X`,
        typeLabel: 'Personne morale',
        active: true,
        invoiced: false,
        revision: 1,
        deactivatedAt: null,
      });
    });

    it('champ inconnu → 400', async () => {
      const res = await post(asA('owner'), '/sales/customers', {
        type: 'PP',
        name: 'X',
        organizationId: orgB,
      });
      expect(res.status).toBe(400);
      expect(issueCodes(res)).toContain('UNKNOWN_FIELD');
    });

    it('NIF : normalisé ; doublon → 409 existingId ; autre organisation → 201', async () => {
      const n = nif();
      const a = await createCustomer({
        type: 'PM',
        name: 'Doublon SARL',
        nif: `${n.slice(0, 3).toLowerCase()} ${n.slice(3, 6)}-${n.slice(6)}`,
      });
      expect(a.nif).toBe(n);
      const dup = await post(asA('owner'), '/sales/customers', {
        type: 'PC',
        name: 'Autre nom',
        nif: n,
      });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('CUSTOMER_NIF_EXISTS');
      expect(dup.body.details.existingId).toBe(a.id);
      // Un client désactivé garde son NIF.
      expect((await post(asA('owner'), `/sales/customers/${a.id}/deactivate`)).status).toBe(200);
      expect(
        (await post(asA('owner'), '/sales/customers', { type: 'PM', name: 'Y', nif: n })).status,
      ).toBe(409);
      // Même NIF dans une autre organisation : permis.
      expect(
        (await post(asB(), '/sales/customers', { type: 'PM', name: 'B SARL', nif: n })).status,
      ).toBe(201);
      // Doublon par modification.
      const b = await createCustomer({ type: 'PM', name: 'Second', nif: nif() });
      const res = await put(asA('owner'), `/sales/customers/${b.id}`, {
        expectedRevision: 1,
        type: 'PM',
        name: 'Second',
        nif: n,
      });
      expect(res.status).toBe(409);
      expect(res.body.details.existingId).toBe(a.id);
    });
  });

  describe('clients — révision, recherche, pagination', () => {
    it('deux PUT sur la même révision : un 200, un 409 STALE_REVISION', async () => {
      const c = await createCustomer({ type: 'PP', name: 'Concurrence' });
      const corps = (name: string) => ({ expectedRevision: 1, type: 'PP', name });
      const [r1, r2] = await Promise.all([
        put(asA('owner'), `/sales/customers/${c.id}`, corps('Un')),
        put(asA('admin'), `/sales/customers/${c.id}`, corps('Deux')),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const perdant = r1.status === 409 ? r1 : r2;
      expect(perdant.body.code).toBe('STALE_REVISION');
      expect(perdant.body.details.currentRevision).toBe(2);
    });

    it('recherche insensible à la casse et aux accents ; métacaractères échappés', async () => {
      await createCustomer({ type: 'PP', name: `KINSHASA Dépôt ${tag}` });
      await createCustomer({ type: 'PP', name: `Élevé ${tag}` });
      const k = await get(asA('owner'), `/sales/customers?q=kinshasa%20depot%20${tag}`);
      expect(k.status).toBe(200);
      expect(k.body.items.map((i: { name: string }) => i.name)).toEqual([`KINSHASA Dépôt ${tag}`]);
      const e = await get(asA('owner'), `/sales/customers?q=eleve%20${tag}`);
      expect(e.body.items).toHaveLength(1);
      const all = await get(asA('owner'), '/sales/customers?q=.*&status=all');
      expect(all.status).toBe(200);
      expect(all.body.items).toHaveLength(0);
      const pm = await get(asA('owner'), '/sales/customers?type=PM&status=all&limit=100');
      expect(pm.body.items.every((i: { type: string }) => i.type === 'PM')).toBe(true);
    });

    it('120 clients → 50/50/20 sans doublon ni trou, noms identiques compris', async () => {
      const svc = app.get(CustomersService);
      const actor = { userId: 'e2e', role: 'owner' };
      for (let i = 0; i < 120; i++) {
        const name =
          i < 40 ? `Pagination même nom ${tag}` : `Pagination ${tag} ${String(i).padStart(3, '0')}`;
        await svc.create(
          orgB,
          {
            type: 'PP',
            name,
            nif: null,
            exemptionReference: null,
            phone: null,
            email: null,
            address: null,
          },
          actor,
        );
      }
      const ids: string[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;
      do {
        const qs: string = `q=pagination&limit=50${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await get(asB(), `/sales/customers?${qs}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        sizes.push(res.body.items.length);
        ids.push(...res.body.items.map((i: { id: string }) => i.id));
        cursor = res.body.nextCursor;
      } while (cursor);
      expect(sizes).toEqual([50, 50, 20]);
      expect(new Set(ids).size).toBe(120);
    });

    it('curseur altéré → 400 INVALID_CURSOR ; limite hors bornes → 400', async () => {
      const first = await get(asB(), '/sales/customers?q=pagination&limit=2');
      const bad = `${String(first.body.nextCursor).slice(0, -3)}zzz`;
      const res = await get(asB(), `/sales/customers?cursor=${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_CURSOR');
      expect((await get(asB(), '/sales/customers?cursor=%7B%7D')).body.code).toBe('INVALID_CURSOR');
      expect((await get(asB(), '/sales/customers?limit=101')).status).toBe(400);
    });

    it('statut : active par défaut, inactive, all', async () => {
      const c = await createCustomer({ type: 'PP', name: `Statut ${tag}` });
      await post(asA('owner'), `/sales/customers/${c.id}/deactivate`);
      const q = `q=statut%20${tag}`;
      expect((await get(asA('owner'), `/sales/customers?${q}`)).body.items).toHaveLength(0);
      expect(
        (await get(asA('owner'), `/sales/customers?${q}&status=inactive`)).body.items,
      ).toHaveLength(1);
      expect((await get(asA('owner'), `/sales/customers?${q}&status=all`)).body.items).toHaveLength(
        1,
      );
    });
  });

  // ── Catalogue ───────────────────────────────────────────────────────────

  describe('catalogue — règles', () => {
    it('article valide : vue conforme, prix normalisé', async () => {
      const res = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: `LAIT-${tag}`,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({
        code: `LAIT-${tag}`,
        edefCode: `LAIT-${tag}`,
        unitPrice: '464.00',
        priceMode: 'ttc',
        currency: 'CDF',
        taxGroupAvailable: true,
        specificTax: null,
        invoiced: false,
        revision: 1,
      });
    });

    it.each([
      [{ itemType: 'TAX' }, 'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP'],
      [{ taxGroup: 'L' }, 'ITEM_TYPE_NOT_ALLOWED_FOR_GROUP'],
      [{ outOfScope: true }, 'OUT_OF_SCOPE_ONLY_GROUP_A'],
      [{ code: 'hors champ' }, 'CODE_RESERVED'],
      [{ unitPrice: 464 }, 'DECIMAL_MUST_BE_STRING'],
      [{ unitPrice: '1.234' }, 'PRICE_TOO_PRECISE'],
      [{ unitPrice: '0' }, 'PRICE_NOT_POSITIVE'],
      [
        { taxGroup: 'N', itemType: 'TAX', specificTax: { kind: 'per_unit', amount: '75' } },
        'SPECIFIC_TAX_NOT_ALLOWED',
      ],
      [{ taxGroup: 'Q' }, 'UNKNOWN_TAX_GROUP'],
      [{ currency: 'EUR' }, 'CURRENCY_NOT_SUPPORTED'],
      [{ currency: 'usd' }, 'CURRENCY_NOT_SUPPORTED'],
      [{ currency: null }, 'CURRENCY_NOT_SUPPORTED'],
      [{ specificTax: { kind: 'per_unit', amount: 75 } }, 'DECIMAL_MUST_BE_STRING'],
    ])('%j → 400 %s', async (patch, code) => {
      const res = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: null,
        ...patch,
      });
      expect(res.status).toBe(400);
      expect(issueCodes(res)).toContain(code);
    });

    it('devise USD (ADR-0023 E4) : article créé, listé, modifié, sans conversion', async () => {
      const code = `USD-${tag}`;
      const created = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code,
        unitPrice: '40',
        currency: 'USD',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({ currency: 'USD', unitPrice: '40.00' });

      const listed = await get(asA('owner'), `/sales/catalog-items?q=${code}`);
      expect(listed.status).toBe(200);
      expect(listed.body.items).toHaveLength(1);
      expect(listed.body.items[0]).toMatchObject({ currency: 'USD', unitPrice: '40.00' });

      // Modification : le prix reste en USD ; retour au CDF possible, sans conversion.
      const usd = await put(asA('owner'), `/sales/catalog-items/${created.body.id}`, {
        ...ARTICLE,
        code,
        unitPrice: '42.5',
        currency: 'USD',
        expectedRevision: 1,
      });
      expect(usd.status, JSON.stringify(usd.body)).toBe(200);
      expect(usd.body).toMatchObject({ currency: 'USD', unitPrice: '42.50', revision: 2 });
      const cdf = await put(asA('owner'), `/sales/catalog-items/${created.body.id}`, {
        ...ARTICLE,
        code,
        unitPrice: '96150',
        currency: 'CDF',
        expectedRevision: 2,
      });
      expect(cdf.status).toBe(200);
      expect(cdf.body).toMatchObject({ currency: 'CDF', unitPrice: '96150.00' });
      const lu = await get(asA('owner'), `/sales/catalog-items/${created.body.id}`);
      expect(lu.body.currency).toBe('CDF');
    });

    it('devise absente → CDF ; article existant sans le champ lu en CDF', async () => {
      const { currency: _omise, ...sansDevise } = ARTICLE;
      const res = await post(asA('owner'), '/sales/catalog-items', { ...sansDevise, code: null });
      expect(res.status).toBe(201);
      expect(res.body.currency).toBe('CDF');

      // Article antérieur à E4 : champ retiré directement en base.
      const a = await createItem({ code: null });
      await db
        .collection('catalog_items')
        .updateOne({ _id: new ObjectId(a.id) }, { $unset: { currency: '' } });
      expect((await get(asA('owner'), `/sales/catalog-items/${a.id}`)).body.currency).toBe('CDF');
    });

    it('hors champ en groupe A : edefCode « HORS CHAMP », code propre conservé', async () => {
      const res = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: `EXO-${tag}`,
        taxGroup: 'A',
        outOfScope: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe(`EXO-${tag}`);
      expect(res.body.edefCode).toBe('HORS CHAMP');
    });

    it('TAX en L et N ; taxe spécifique conservée en chaînes', async () => {
      expect(
        (
          await post(asA('owner'), '/sales/catalog-items', {
            ...ARTICLE,
            code: null,
            taxGroup: 'L',
            itemType: 'TAX',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await post(asA('owner'), '/sales/catalog-items', {
            ...ARTICLE,
            code: null,
            taxGroup: 'N',
            itemType: 'TAX',
          })
        ).status,
      ).toBe(201);
      const pu = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: null,
        specificTax: { kind: 'per_unit', amount: '75' },
      });
      expect(pu.body.specificTax).toEqual({ kind: 'per_unit', amount: '75.00' });
      const pct = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: null,
        priceMode: 'ht',
        specificTax: { kind: 'percent', rate: '10' },
      });
      expect(pct.body.specificTax).toEqual({ kind: 'percent', rate: '10.00' });
    });

    it('doublon de code, casse ignorée → 409 existingId', async () => {
      const a = await createItem({ code: `Dup-${tag}` });
      const res = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: `DUP-${tag}`,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CATALOG_CODE_EXISTS');
      expect(res.body.details.existingId).toBe(a.id);
    });

    it('recherche et filtres', async () => {
      await createItem({ code: `EAU-${tag}`, name: `Eau minérale Élevée ${tag}`, taxGroup: 'C' });
      const res = await get(
        asA('owner'),
        `/sales/catalog-items?q=eau%20minerale%20elevee&taxGroup=C&itemType=BIE`,
      );
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect((await get(asA('owner'), '/sales/catalog-items?taxGroup=Q')).status).toBe(400);
    });

    it('révision du catalogue : PUT périmé → 409', async () => {
      const a = await createItem({ code: null });
      const body = { ...ARTICLE, code: null, unitPrice: '500', expectedRevision: 1 };
      expect((await put(asA('owner'), `/sales/catalog-items/${a.id}`, body)).status).toBe(200);
      const res = await put(asA('owner'), `/sales/catalog-items/${a.id}`, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('STALE_REVISION');
      expect(res.body.details.currentRevision).toBe(2);
    });
  });

  // ── Suppression, désactivation, markInvoiced, audit ───────────────────────

  describe('suppression et désactivation', () => {
    it('client jamais facturé → 204, document absent ; audit sans donnée personnelle', async () => {
      const c = await createCustomer({
        type: 'PM',
        name: 'Effacé SARL',
        nif: nif(),
        email: 'x@exemple.cd',
        phone: '+243 811 111 111',
      });
      const res = await del(asA('owner'), `/sales/customers/${c.id}`);
      expect(res.status).toBe(204);
      expect(await db.collection('customers').countDocuments({ _id: new ObjectId(c.id) })).toBe(0);
      const ev = await db
        .collection('audit_events')
        .findOne({ organizationId: orgId, action: 'customer.deleted', targetId: c.id });
      expect(ev).not.toBeNull();
      expect(JSON.stringify(ev!['metadata'] ?? {})).not.toMatch(
        /Effacé|x@exemple|811|T[0-9A-F]{8}/,
      );
      expect((await get(asA('owner'), `/sales/customers/${c.id}`)).status).toBe(404);
    });

    it('client facturé → 409 à la suppression, document intact ; désactivation idempotente', async () => {
      const c = await createCustomer({ type: 'PP', name: 'Facturé' });
      const usage = app.get(SalesUsageService);
      await usage.markInvoiced(orgId, { customerId: c.id, catalogItemIds: [] });
      const first = await db.collection('customers').findOne({ _id: new ObjectId(c.id) });
      expect(first!['firstInvoicedAt']).toBeInstanceOf(Date);
      await usage.markInvoiced(orgId, { customerId: c.id, catalogItemIds: [] });
      const second = await db.collection('customers').findOne({ _id: new ObjectId(c.id) });
      expect(second!['firstInvoicedAt']).toEqual(first!['firstInvoicedAt']);

      const res = await del(asA('owner'), `/sales/customers/${c.id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_ALREADY_INVOICED');
      expect((await get(asA('owner'), `/sales/customers/${c.id}`)).body.invoiced).toBe(true);

      const d1 = await post(asA('owner'), `/sales/customers/${c.id}/deactivate`);
      expect(d1.status).toBe(200);
      expect(d1.body.active).toBe(false);
      expect(d1.body.deactivatedAt).not.toBeNull();
      const d2 = await post(asA('owner'), `/sales/customers/${c.id}/deactivate`);
      expect(d2.status).toBe(200);
      expect(d2.body.revision).toBe(d1.body.revision);
      const r = await post(asA('owner'), `/sales/customers/${c.id}/reactivate`);
      expect(r.status).toBe(200);
      expect(r.body.active).toBe(true);
      expect(r.body.deactivatedAt).toBeNull();
      const evs = await db
        .collection('audit_events')
        .find({ organizationId: orgId, targetId: c.id })
        .toArray();
      expect(evs.map((e) => e['action']).sort()).toEqual([
        'customer.deactivated',
        'customer.reactivated',
      ]);
    });

    it('markInvoiced ne touche pas une autre organisation', async () => {
      const c = await createCustomer({ type: 'PP', name: 'Intouchable' });
      const item = await createItem({ code: null });
      await app
        .get(SalesUsageService)
        .markInvoiced(orgB, { customerId: c.id, catalogItemIds: [item.id] });
      expect(
        (await db.collection('customers').findOne({ _id: new ObjectId(c.id) }))!['firstInvoicedAt'],
      ).toBeNull();
      expect(
        (await db.collection('catalog_items').findOne({ _id: new ObjectId(item.id) }))![
          'firstInvoicedAt'
        ],
      ).toBeNull();
    });

    it('article : jamais facturé → 204 ; facturé → 409 ; audit', async () => {
      const a = await createItem({ code: null });
      expect((await del(asA('owner'), `/sales/catalog-items/${a.id}`)).status).toBe(204);
      expect(await db.collection('catalog_items').countDocuments({ _id: new ObjectId(a.id) })).toBe(
        0,
      );

      const b = await createItem({ code: null });
      await app
        .get(SalesUsageService)
        .markInvoiced(orgId, { customerId: null, catalogItemIds: [b.id] });
      const res = await del(asA('owner'), `/sales/catalog-items/${b.id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CATALOG_ITEM_ALREADY_INVOICED');
      expect(
        (await post(asA('owner'), `/sales/catalog-items/${b.id}/deactivate`)).body.active,
      ).toBe(false);
      expect(
        (await post(asA('owner'), `/sales/catalog-items/${b.id}/reactivate`)).body.active,
      ).toBe(true);
      const actions = (
        await db
          .collection('audit_events')
          .find({ organizationId: orgId, targetId: { $in: [a.id, b.id] } })
          .toArray()
      ).map((e) => e['action']);
      expect(actions.sort()).toEqual([
        'catalog_item.deactivated',
        'catalog_item.deleted',
        'catalog_item.reactivated',
      ]);
    });
  });

  // ── Isolation ─────────────────────────────────────────────────────────────

  describe('isolation par organisation', () => {
    it('chaque route sur une ressource d’une autre organisation → 404', async () => {
      const c = await createCustomer({ type: 'PP', name: 'Secret A' });
      const i = await createItem({ code: null });
      const corpsClient = { expectedRevision: 1, type: 'PP', name: 'Pirate' };
      const corpsArticle = { ...ARTICLE, code: null, expectedRevision: 1 };
      const tentatives = [
        get(asB(), `/sales/customers/${c.id}`),
        put(asB(), `/sales/customers/${c.id}`, corpsClient),
        post(asB(), `/sales/customers/${c.id}/deactivate`),
        post(asB(), `/sales/customers/${c.id}/reactivate`),
        del(asB(), `/sales/customers/${c.id}`),
        get(asB(), `/sales/catalog-items/${i.id}`),
        put(asB(), `/sales/catalog-items/${i.id}`, corpsArticle),
        post(asB(), `/sales/catalog-items/${i.id}/deactivate`),
        post(asB(), `/sales/catalog-items/${i.id}/reactivate`),
        del(asB(), `/sales/catalog-items/${i.id}`),
      ];
      for (const res of await Promise.all(tentatives)) {
        expect(res.status, `${res.req.method} ${res.req.path}`).toBe(404);
        expect(['CUSTOMER_NOT_FOUND', 'CATALOG_ITEM_NOT_FOUND']).toContain(res.body.code);
      }
      // Les listes de B ne montrent rien de A.
      const listB = await get(asB(), '/sales/customers?q=secret%20a&status=all');
      expect(listB.body.items).toHaveLength(0);
      // Rien n'a bougé côté A.
      const still = await get(asA('owner'), `/sales/customers/${c.id}`);
      expect(still.body).toMatchObject({ name: 'Secret A', revision: 1, active: true });
      // Identifiant mal formé → 404, pas 500.
      expect((await get(asA('owner'), '/sales/customers/pas-un-id')).status).toBe(404);
    });

    it('super-administrateur sans appartenance ni accès délégué → aucun accès aux données de A', async () => {
      const c = await createCustomer({ type: 'PP', name: `Confidentiel ${tag}` });
      const asSuper = [...cookies['superAdmin'], `active_org_id=${orgId}`];
      const res = await get(asSuper, `/sales/customers/${c.id}`);
      expect(res.status).toBe(404);
      const list = await get(asSuper, `/sales/customers?q=confidentiel%20${tag}&status=all`);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(0);
      const me = await get(asSuper, '/me/permissions');
      expect(me.body.organizationId).toBe(superAdminOrg);
    });
  });

  // ── Groupes de taxation (en dernier : les instantanés sont globaux) ───────

  describe('groupes de taxation', () => {
    let itemP = '';

    it('sans instantané : liste par défaut, 16 groupes, taux null', async () => {
      const res = await get(asA('viewer'), '/sales/tax-groups');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        source: 'default',
        environment: 'test',
        fetchedAt: null,
        sha256: null,
      });
      expect(res.body.groups).toHaveLength(16);
      expect(res.body.groups.map((g: { letter: string }) => g.letter).join('')).toBe(
        'ABCDEFGHIJKLMNOP',
      );
      expect(res.body.groups.every((g: { ratePercent: unknown }) => g.ratePercent === null)).toBe(
        true,
      );
      expect(res.body.groups[0]).toEqual({
        letter: 'A',
        label: 'Exonéré et hors champ',
        ratePercent: null,
        itemTypes: ['BIE', 'SER'],
        outOfScopeAllowed: true,
      });
      itemP = (await createItem({ code: null, taxGroup: 'P' })).id;
    });

    it('un instantané de l’autre environnement est ignoré', async () => {
      await app
        .get(EdefReferenceSnapshotsService)
        .record('production', 'taxGroups', { a: 0, b: 16 });
      const res = await get(asA('owner'), '/sales/tax-groups');
      expect(res.body.source).toBe('default');
    });

    it('instantané de l’environnement : ses lettres et ses taux ; lettre absente non proposée', async () => {
      const snaps = app.get(EdefReferenceSnapshotsService);
      await snaps.record('test', 'taxGroups', { a: 0, b: 15 });
      const rates = {
        a: 0,
        b: 16,
        c: 5,
        d: 0,
        e: 0,
        f: 16,
        g: 5,
        h: 0,
        i: 0,
        j: 0,
        k: 0,
        l: 0,
        m: 0,
        n: 0,
        o: 1,
      };
      const rec = await snaps.record('test', 'taxGroups', rates);
      const latest = await snaps.latest('test', 'taxGroups');
      expect(latest?.sha256).toBe(rec.sha256);

      const res = await get(asA('owner'), '/sales/tax-groups');
      expect(res.body.source).toBe('dgi_snapshot');
      expect(res.body.sha256).toBe(rec.sha256);
      expect(typeof res.body.fetchedAt).toBe('string');
      expect(res.body.groups.map((g: { letter: string }) => g.letter).join('')).toBe(
        'ABCDEFGHIJKLMNO',
      );
      expect(res.body.groups.find((g: { letter: string }) => g.letter === 'B').ratePercent).toBe(
        '16',
      );
      expect(res.body.groups.find((g: { letter: string }) => g.letter === 'O').ratePercent).toBe(
        '1',
      );

      const item = await get(asA('owner'), `/sales/catalog-items/${itemP}`);
      expect(item.status).toBe(200);
      expect(item.body.taxGroupAvailable).toBe(false);
      const list = await get(asA('owner'), '/sales/catalog-items?taxGroup=P');
      expect(
        list.body.items.every((i: { taxGroupAvailable: boolean }) => !i.taxGroupAvailable),
      ).toBe(true);

      // Créer en P, ou modifier sans changer de groupe → 400 UNKNOWN_TAX_GROUP.
      const create = await post(asA('owner'), '/sales/catalog-items', {
        ...ARTICLE,
        code: null,
        taxGroup: 'P',
      });
      expect(create.status).toBe(400);
      expect(issueCodes(create)).toEqual(['UNKNOWN_TAX_GROUP']);
      const body = { ...ARTICLE, code: null, taxGroup: 'P', expectedRevision: 1 };
      expect(issueCodes(await put(asA('owner'), `/sales/catalog-items/${itemP}`, body))).toEqual([
        'UNKNOWN_TAX_GROUP',
      ]);
      // Changer de groupe le rend à nouveau utilisable.
      const moved = await put(asA('owner'), `/sales/catalog-items/${itemP}`, {
        ...body,
        taxGroup: 'B',
      });
      expect(moved.status).toBe(200);
      expect(moved.body.taxGroupAvailable).toBe(true);
    });
  });
});
