// Tableau de bord des devis — `GET /sales/quotes/stats` (ADR-0067) contre la vraie
// application : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleur →
// MongoDB → moteur `computeQuoteStats`.
//
// Organisation A : devis CDF (brouillon, envoyé, accepté, refusé, expiré), un devis
// USD (sans taux : exclu des montants et compté). Organisation B : isolation.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { QuoteStatsSchema } from '@lalanda/shared/sales-invoices';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_quote_stats_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!tableau-devis';
const ROLES = ['owner', 'viewer', 'analyst', 'sales_rep'] as const;
type Role = (typeof ROLES)[number];
type Compte = Role | 'ownerB';

const fiche = (nif: string) => ({
  legalName: 'Exemple SARL',
  tradeName: null,
  legalForm: 'sarl',
  legalFormOther: null,
  nif,
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
});

/** Prix HT `prix`, groupe B (16 %) : total TTC = prix × 1,16. */
const ligne = (prix: string) => ({
  source: 'free',
  code: 'CONSEIL',
  name: 'Conseil',
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'forfait',
  quantity: '1',
  unitPrice: prix,
  specificTax: null,
  discount: null,
});

e2eSuite('tableau de bord des devis (ADR-0067)', () => {
  let app: INestApplication;
  let db: Db;
  let orgA = '';
  let orgB = '';
  let clientA = '';
  let clientB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asA = (role: Role) => [...cookies[role], `active_org_id=${orgA}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };

  const corps = (customer: string, currency: 'CDF' | 'USD', prix: string) => ({
    currency,
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    lines: [ligne(prix)],
    title: 'Mission de conseil',
  });

  /** Devis créé puis mené jusqu'à l'état voulu. */
  async function devis(
    c: string[],
    body: Record<string, unknown>,
    jusqua: 'draft' | 'sent' | 'accepted' | 'refused' = 'sent',
  ): Promise<Record<string, any>> {
    const d = await post(c, '/sales/quotes', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    if (jusqua === 'draft') return d.body;
    const s = await post(c, `/sales/quotes/${d.body.id}/send`, {
      expectedRevision: d.body.revision,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    if (jusqua === 'sent') return s.body;
    const action = jusqua === 'accepted' ? 'accept' : 'refuse';
    const f = await post(c, `/sales/quotes/${d.body.id}/${action}`, {
      expectedRevision: s.body.revision,
    });
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    return f.body;
  }

  const stats = async (c: string[]) => {
    const res = await get(c, '/sales/quotes/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const parsed = QuoteStatsSchema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    return res.body as Record<string, any>;
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(connection.modelNames().map((n) => connection.model(n).init()));
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    for (const c of [...ROLES, 'ownerB'] as const) {
      emails[c] = `qstats-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({
      email: emails[c],
      password: MOT_DE_PASSE,
      name: `Stats ${c}`,
    });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgA = await orgDe('owner');
    for (const role of ROLES.filter((r) => r !== 'owner')) {
      const inv = await request(server())
        .post(`/organizations/${orgA}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: emails[role], role });
      expect(inv.status, `invitation ${role}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');
    for (const [c, nif] of [
      [asA('owner'), 'A1111111X'],
      [asB(), 'B2222222X'],
    ] as const) {
      const res = await put(c, '/organizations/current/fiscal-profile', fiche(nif));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list: 'taxGroups',
      sha256: randomBytes(32).toString('hex'),
      payload: {
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
        p: 1,
      },
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
    clientA = (
      await post(asA('owner'), '/sales/customers', {
        type: 'PM',
        name: 'Hôtel Lisanga',
        nif: `T${tag.toUpperCase()}01`,
      })
    ).body.id;
    clientB = (
      await post(asB(), '/sales/customers', {
        type: 'PM',
        name: 'Client de B SARL',
        nif: `T${tag.toUpperCase()}02`,
      })
    ).body.id;
  }, 240_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  it('organisation vide : tout à zéro, CDF par défaut', async () => {
    const s = await stats(asA('owner'));
    expect(s).toMatchObject({
      currency: 'CDF',
      currencySource: 'default_cdf',
      truncated: false,
      open: { count: 0, amount: '0.00', notConvertible: [] },
      conversion: { sent: 0, accepted: 0, ratePercent: null },
      statusCounts: { all: 0 },
    });
    expect(s.months).toHaveLength(12);
  });

  it('statuts, montants en cours et acceptés, taux de transformation', async () => {
    // 100 000 HT → 116 000 TTC.
    await devis(asA('owner'), corps(clientA, 'CDF', '100000.00'), 'draft');
    await devis(asA('owner'), corps(clientA, 'CDF', '100000.00'), 'sent');
    await devis(asA('owner'), corps(clientA, 'CDF', '200000.00'), 'accepted');
    await devis(asA('owner'), corps(clientA, 'CDF', '100000.00'), 'refused');
    const expire = await devis(asA('owner'), corps(clientA, 'CDF', '100000.00'), 'sent');
    await db
      .collection('sales_quotes')
      .updateOne(
        { _id: new ObjectId(expire.id as string) },
        { $set: { validUntil: '2026-01-01' } },
      );

    const s = await stats(asA('viewer'));
    expect(s.statusCounts).toEqual({
      all: 5,
      draft: 1,
      sent: 1,
      accepted: 1,
      refused: 1,
      expired: 1,
    });
    expect(s.open).toEqual({ count: 1, amount: '116000.00', notConvertible: [] });
    expect(s.acceptedThisMonth).toMatchObject({ count: 1, amount: '232000.00' });
    // Envoyés sur 90 jours : 4 (le brouillon ne compte pas) ; acceptés : 1 → 25 %.
    expect(s.conversion).toMatchObject({ sent: 4, accepted: 1, ratePercent: 25 });
    expect(s.months.at(-1)).toMatchObject({ sent: 4, accepted: 1, acceptedAmount: '232000.00' });

    // Concordance avec la liste, onglet par onglet.
    for (const statut of ['all', 'draft', 'sent', 'accepted', 'refused', 'expired'] as const) {
      const liste = await get(asA('owner'), `/sales/quotes?status=${statut}`);
      expect(liste.status).toBe(200);
      expect(liste.body.items, statut).toHaveLength(s.statusCounts[statut]);
    }
  });

  it('devis USD sans taux : exclu des montants, compté, total dans sa devise', async () => {
    await devis(asA('owner'), corps(clientA, 'USD', '100.00'), 'sent');
    const s = await stats(asA('owner'));
    expect(s.open).toEqual({
      count: 2,
      amount: '116000.00',
      notConvertible: [{ currency: 'USD', count: 1, total: '116.00' }],
    });
    expect(s.excluded.notConvertible).toEqual([{ currency: 'USD', count: 1, total: '116.00' }]);
  });

  it('isolation : B ne voit rien de A, A ne voit rien de B', async () => {
    await db
      .collection('accounting_settings')
      .insertOne({ organizationId: orgB, bookCurrency: 'USD', _schemaVersion: 1 });
    await devis(asB(), corps(clientB, 'USD', '10.00'), 'sent');
    const b = await stats(asB());
    expect(b).toMatchObject({ currency: 'USD', currencySource: 'accounting_book' });
    expect(b.statusCounts).toMatchObject({ all: 1, sent: 1 });
    expect(b.open).toEqual({ count: 1, amount: '11.60', notConvertible: [] });

    const a = await stats(asA('owner'));
    expect(a.statusCounts.all).toBe(6);
    expect(a.currency).toBe('CDF');
  });

  it('liste triée par validité croissante, pagination par curseur conservée', async () => {
    const vus: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await get(asA('owner'), `/sales/quotes?sort=valid_until&limit=2${q}`);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      vus.push(...(page.body.items as { validUntil: string }[]).map((i) => i.validUntil));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(vus).toHaveLength(6);
    expect([...vus].sort()).toEqual(vus);
    expect(vus[0]).toBe('2026-01-01');
    const mauvais = await get(asA('owner'), '/sales/quotes?sort=valid_until&cursor=abc');
    expect(mauvais.status).toBe(400);
  });

  it('même droit que la liste ; paramètres invalides refusés', async () => {
    for (const role of ROLES) {
      const liste = await get(asA(role), '/sales/quotes');
      const tableau = await get(asA(role), '/sales/quotes/stats');
      expect(tableau.status, role).toBe(liste.status);
    }
    expect((await get(asA('owner'), '/sales/quotes/stats?months=99')).status).toBe(400);
    expect((await get(asA('owner'), '/sales/quotes/stats?autre=1')).status).toBe(400);
    const six = await get(asA('owner'), '/sales/quotes/stats?months=6');
    expect(six.status).toBe(200);
    expect(six.body.months).toHaveLength(6);
    const anonyme = await request(server()).get('/sales/quotes/stats');
    expect(anonyme.status).toBe(401);
  });
});
