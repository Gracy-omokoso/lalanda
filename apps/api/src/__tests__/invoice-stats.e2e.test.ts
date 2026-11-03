// Tableau de bord des factures — `GET /sales/invoices/stats` (ADR-0056) contre la
// vraie application : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB → moteur `computeInvoiceStats`.
//
// Organisation A : factures CDF à crédit (une soldée, une en partie, une en retard),
// un brouillon, une facture USD sans taux puis avec un taux figé. Organisation B :
// isolation (rien de A ne s'y voit, et inversement).
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import { InvoiceStatsSchema } from '@lalanda/shared/sales-invoices';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { SettlementClock } from '../sales/receipts/settlements.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_invoice_stats_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!tableau-factures';
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

e2eSuite('tableau de bord des factures (ADR-0056)', () => {
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
  const today = () => kinshasaDayOf(new Date());

  const corps = (customer: string, currency: 'CDF' | 'USD', prix: string) => ({
    type: 'FV',
    currency,
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    pointOfSaleId: null,
    lines: [ligne(prix)],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
  });

  /** Brouillon puis émission, tout à crédit sauf `comptant` réglé en espèces. */
  async function emettre(
    c: string[],
    body: Record<string, unknown>,
    comptant = '0.00',
  ): Promise<Record<string, any>> {
    const d = await post(c, '/sales/invoices', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const total = d.body.documentAmounts.calculation.totals.total as string;
    const credit = (Math.round(Number(total) * 100 - Number(comptant) * 100) / 100).toFixed(2);
    const payments =
      comptant === '0.00'
        ? [{ method: 'CREDIT', amount: total }]
        : [
            { method: 'ESPECES', amount: comptant },
            { method: 'CREDIT', amount: credit },
          ];
    const p = await put(c, `/sales/invoices/${d.body.id}`, {
      ...body,
      payments,
      expectedRevision: d.body.revision,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const res = await post(c, `/sales/invoices/${d.body.id}/issue`, {
      expectedRevision: p.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }

  const encaisser = async (invoiceId: string, amount: string, currency = 'CDF') => {
    const r = await post(asA('owner'), '/sales/receipts', {
      receivedOn: today(),
      amount,
      currency,
      method: 'MOBILEMONEY',
      reference: null,
      note: null,
      allocations: [{ invoiceId, amount }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  };

  const stats = async (c: string[]) => {
    const res = await get(c, '/sales/invoices/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const parsed = InvoiceStatsSchema.safeParse(res.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    return res.body as Record<string, any>;
  };
  const categorie = (s: Record<string, any>, c: string) =>
    (s.categories as { category: string; count: number }[]).find((x) => x.category === c)?.count;

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(connection.modelNames().map((n) => connection.model(n).init()));
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    for (const c of [...ROLES, 'ownerB'] as const) {
      emails[c] = `stats-${c}-${tag}@lalanda-test.local`;
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

  let f1: Record<string, any>;
  let f2: Record<string, any>;
  let f3: Record<string, any>;
  let usd: Record<string, any>;

  it('organisation vide : tout à zéro, CDF par défaut', async () => {
    const s = await stats(asA('owner'));
    expect(s).toMatchObject({
      currency: 'CDF',
      currencySource: 'default_cdf',
      truncated: false,
      totals: { billed: '0.00', collected: '0.00', collectedRatePercent: null },
      outstanding: { amount: '0.00', count: 0 },
      overdue: { amount: '0.00', count: 0 },
      statusCounts: { all: 0 },
      topCustomers: [],
    });
    expect(s.months).toHaveLength(12);
  });

  it('factures CDF : facturé, encaissé (comptant + lettrage), reste', async () => {
    // 100 000 HT → 116 000 TTC chacune.
    f1 = await emettre(asA('owner'), corps(clientA, 'CDF', '100000.00'));
    f2 = await emettre(asA('owner'), corps(clientA, 'CDF', '100000.00'), '16000.00');
    f3 = await emettre(asA('owner'), corps(clientA, 'CDF', '100000.00'));
    await encaisser(f1.id, '116000.00');
    await encaisser(f2.id, '50000.00');
    const brouillon = await post(asA('owner'), '/sales/invoices', corps(clientA, 'CDF', '5.00'));
    expect(brouillon.status).toBe(201);

    const s = await stats(asA('viewer'));
    expect(s.totals).toMatchObject({
      billed: '348000.00',
      collected: '182000.00', // 116 000 + 16 000 comptant + 50 000
      collectedRatePercent: 52,
      invoiceCount: 3,
    });
    // f2 : 100 000 − 50 000 = 50 000 ; f3 : 116 000.
    expect(s.outstanding).toEqual({ amount: '166000.00', count: 2 });
    expect(s.statusCounts).toMatchObject({ all: 4, draft: 1, issued: 3, final: 3 });
    expect(categorie(s, 'paid')).toBe(1);
    expect(categorie(s, 'to_collect')).toBe(2);
    expect(categorie(s, 'draft')).toBe(1);
    expect(s.topCustomers).toEqual([{ key: clientA, name: 'Hôtel Lisanga', billed: '348000.00' }]);
    const mois = s.months.at(-1);
    expect(mois).toMatchObject({ billed: '348000.00', collected: '182000.00' });

    // Concordance avec la liste : même nombre de documents.
    const liste = await get(asA('owner'), '/sales/invoices?status=all');
    expect(liste.status).toBe(200);
    expect(liste.body.items).toHaveLength(s.statusCounts.all);
  });

  it('« en retard » : échéance dépassée et non soldée', async () => {
    const r = await put(asA('owner'), `/sales/settlements/${f3.id}/due-date`, {
      dueDate: today(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const horloge = vi
      .spyOn(app.get(SettlementClock), 'now')
      .mockReturnValue(new Date(Date.now() + 10 * 24 * 3600 * 1000));
    try {
      const s = await stats(asA('owner'));
      expect(s.overdue).toEqual({ amount: '116000.00', count: 1 });
      expect(categorie(s, 'overdue')).toBe(1);
      expect(categorie(s, 'to_collect')).toBe(1);
    } finally {
      horloge.mockRestore();
    }
  });

  it('facture USD sans taux : exclue des montants et comptée ; avec taux figé : convertie', async () => {
    usd = await emettre(asA('owner'), corps(clientA, 'USD', '100.00'));
    let s = await stats(asA('owner'));
    expect(s.totals.billed).toBe('348000.00');
    expect(s.excluded.notConvertible).toEqual([{ currency: 'USD', count: 1, total: '116.00' }]);
    expect(s.statusCounts.final).toBe(4);

    // Taux figé sur la facture (comme après une normalisation) : 1 USD = 2 800 CDF.
    await db
      .collection('sales_invoices')
      .updateOne(
        { _id: new ObjectId(usd.id as string) },
        { $set: { conversion: { from: 'USD', to: 'CDF', rate: '2800' } } },
      );
    await encaisser(usd.id, '16.00', 'USD');
    s = await stats(asA('owner'));
    expect(s.excluded.notConvertible).toEqual([]);
    expect(s.totals.billed).toBe('672800.00'); // 348 000 + 116 × 2 800
    expect(s.totals.collected).toBe('226800.00'); // 182 000 + 16 × 2 800
  });

  it('devise de tenue de la comptabilité retenue si elle est choisie', async () => {
    await db
      .collection('accounting_settings')
      .insertOne({ organizationId: orgB, bookCurrency: 'USD', _schemaVersion: 1 });
    const s = await stats(asB());
    expect(s).toMatchObject({ currency: 'USD', currencySource: 'accounting_book' });
  });

  it('isolation : B ne voit rien de A, A ne voit rien de B', async () => {
    await emettre(asB(), corps(clientB, 'USD', '10.00'));
    const b = await stats(asB());
    expect(b.statusCounts).toMatchObject({ all: 1, final: 1 });
    expect(b.totals.billed).toBe('11.60');
    expect(b.topCustomers.map((c: { key: string }) => c.key)).toEqual([clientB]);
    expect(JSON.stringify(b)).not.toContain(clientA);

    const a = await stats(asA('owner'));
    expect(a.statusCounts.all).toBe(5);
    expect(JSON.stringify(a)).not.toContain(clientB);
    expect(a.currency).toBe('CDF');
  });

  it('même droit que la liste ; paramètres invalides refusés', async () => {
    for (const role of ROLES) {
      const liste = await get(asA(role), '/sales/invoices');
      const tableau = await get(asA(role), '/sales/invoices/stats');
      expect(tableau.status, role).toBe(liste.status);
    }
    expect((await get(asA('owner'), '/sales/invoices/stats?months=99')).status).toBe(400);
    expect((await get(asA('owner'), '/sales/invoices/stats?autre=1')).status).toBe(400);
    const six = await get(asA('owner'), '/sales/invoices/stats?months=6');
    expect(six.status).toBe(200);
    expect(six.body.months).toHaveLength(6);
    const anonyme = await request(server()).get('/sales/invoices/stats');
    expect(anonyme.status).toBe(401);
  });
});
