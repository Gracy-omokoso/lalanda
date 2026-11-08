// Tableaux de bord des écrans Achats et Trésorerie (ADR-0071) contre la vraie
// application : cookie → AuthGuard → PermissionsGuard → contrôleur → MongoDB → moteur.
//
//   GET /purchases/invoices/stats   GET /purchases/payables/stats   GET /purchases/orders/stats
//   GET /treasury/expenses/stats    GET /treasury/accounts/stats
//
// Achats : documents insérés tels que les services les écrivent (le circuit de saisie
// est couvert par ses propres e2e) ; trésorerie : comptes et dépenses par l'API.
// Vérifie les chiffres, la concordance avec les listes, l'isolation et les droits.
//
// BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import {
  PayablesStatsSchema,
  PurchaseOrderStatsSchema,
  SupplierInvoiceStatsSchema,
} from '@lalanda/shared/purchases';
import { AccountStatsSchema, ExpenseStatsSchema } from '@lalanda/shared/treasury';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_run_stats_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!tableaux-achats';
type Compte = 'owner' | 'sales_rep' | 'ownerB';

/** Jour de Kinshasa décalé de `n` jours. */
function jour(n: number): string {
  const d = new Date(`${kinshasaDayOf(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

e2eSuite('tableaux de bord des achats et de la trésorerie (ADR-0071)', () => {
  let app: INestApplication;
  let db: Db;
  let orgA = '';
  let orgB = '';
  let moiA = '';
  const cookies = {} as Record<Compte, string[]>;
  const server = () => app.getHttpServer();
  const asA = (c: 'owner' | 'sales_rep') => [...cookies[c], `active_org_id=${orgA}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body: unknown) =>
    request(server()).post(path).set('Cookie', c).send(body);

  const supplierId = new ObjectId().toHexString();
  let n = 0;
  const facture = (over: Record<string, unknown>) => {
    n += 1;
    return {
      organizationId: orgA,
      internalNumber: `FF-T-${tag}-${n}`,
      supplierId,
      supplierReference: `REF-${n}`,
      kind: 'invoice',
      creditedInvoiceId: null,
      status: 'validated',
      currency: 'USD',
      invoiceDate: jour(0),
      receivedOn: jour(0),
      dueDate: jour(30),
      orderIds: [],
      lines: [],
      subtotal: '100.00',
      taxes: [],
      total: '100.00',
      deductibleVat: null,
      costAllocations: [{ category: 'achats', workProjectId: null, amount: '100.00' }],
      matching: { mode: 'none', status: 'not_applicable', variances: [] },
      attachment: null,
      disputed: null,
      forcedValidation: null,
      revision: 1,
      createdBy: 'test',
      updatedBy: 'test',
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(connection.modelNames().map((m) => connection.model(m).init()));
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    const email = (c: Compte) => `runstats-${c}-${tag}@lalanda-test.local`;
    const compte = (c: Compte) => ({ email: email(c), password: MOT_DE_PASSE, name: `Run ${c}` });
    cookies['owner'] = await registerAndLogin(app, compte('owner'));
    const orgs = await get(cookies['owner'], '/organizations');
    orgA = (orgs.body.organizations as { id: string }[])[0]!.id;
    const session = await get(cookies['owner'], '/auth/get-session');
    moiA = String(session.body.user.id);
    const inv = await post(cookies['owner'], `/organizations/${orgA}/invitations`, {
      email: email('sales_rep'),
      role: 'sales_rep',
    });
    expect(inv.status).toBe(201);
    cookies['sales_rep'] = await registerAndLogin(app, compte('sales_rep'));
    const acc = await post(cookies['sales_rep'], '/invitations/accept', { token: inv.body.token });
    expect(acc.status).toBe(201);
    cookies['ownerB'] = await registerAndLogin(app, compte('ownerB'));
    const orgsB = await get(cookies['ownerB'], '/organizations');
    orgB = (orgsB.body.organizations as { id: string }[])[0]!.id;
  }, 900_000);

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  it('factures fournisseurs : chiffres du moteur, compteurs égaux aux listes, isolation', async () => {
    const ouverte = new ObjectId();
    const enRetard = new ObjectId();
    await db.collection('supplier_invoices').insertMany([
      facture({ _id: ouverte }),
      facture({ _id: enRetard, invoiceDate: jour(-40), dueDate: jour(-10), total: '50.00' }),
      facture({
        status: 'draft',
        total: '30.00',
        matching: { mode: 'two_way', status: 'variance', variances: [] },
      }),
      facture({ currency: 'CDF', total: '1000.00', costAllocations: [] }),
      facture({ status: 'cancelled', disputed: { by: 'x', at: new Date(), reason: 'test' } }),
    ]);
    await db.collection('supplier_payments').insertOne({
      organizationId: orgA,
      number: `PF-T-${tag}`,
      supplierId,
      currency: 'USD',
      paidOn: jour(0),
      amount: '40.00',
      accountId: null,
      method: 'cash',
      paymentMethodId: null,
      reference: null,
      allocations: [{ invoiceId: ouverte.toHexString(), amount: '40.00' }],
      expenseIds: [],
      origin: 'recorded',
      linkedExpense: null,
      status: 'recorded',
      cancellation: null,
      revision: 1,
      createdBy: 'test',
      updatedBy: 'test',
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await get(asA('owner'), '/purchases/invoices/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(SupplierInvoiceStatsSchema.safeParse(res.body).success).toBe(true);
    const s = res.body;
    expect(s.statusCounts).toEqual({
      all: 5,
      draft: 1,
      variance: 1,
      validated: 3,
      overdue: 1,
      disputed: 1,
    });
    const usd = s.byCurrency.find((c: { currency: string }) => c.currency === 'USD');
    expect(usd.outstanding).toEqual({ amount: '110.00', count: 2 });
    expect(usd.overdue).toEqual({ amount: '50.00', count: 1 });
    expect(usd.thisMonth.amount).toBe('100.00');
    expect(s.truncated).toBe(false);

    // Concordance avec les filtres de la liste.
    for (const [q, attendu] of [
      ['', s.statusCounts.all],
      ['?status=draft', s.statusCounts.draft],
      ['?status=validated', s.statusCounts.validated],
      ['?due=overdue', s.statusCounts.overdue],
      ['?disputed=true', s.statusCounts.disputed],
    ] as const) {
      const l = await get(asA('owner'), `/purchases/invoices${q}`);
      expect(l.status, q).toBe(200);
      expect(l.body.items.length, q).toBe(attendu);
    }

    const b = await get(asB(), '/purchases/invoices/stats');
    expect(b.status).toBe(200);
    expect(b.body.statusCounts.all).toBe(0);
    expect(b.body.byCurrency).toEqual([]);
  });

  it('à payer : dû, échu, délai moyen ; « stats » n’est pas un identifiant', async () => {
    const res = await get(asA('owner'), '/purchases/payables/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PayablesStatsSchema.safeParse(res.body).success).toBe(true);
    const usd = res.body.byCurrency.find((c: { currency: string }) => c.currency === 'USD');
    expect(usd.due).toEqual({ amount: '110.00', count: 2 });
    expect(usd.overdue).toEqual({ amount: '50.00', count: 1 });
    expect(usd.thisMonth.amount).toBe('40.00');
    expect(usd.averageDelay.days).toBe(0);
    expect(usd.topSuppliers[0].supplierId).toBe(supplierId);
    expect(res.body.groupCounts.overdue).toBe(1);
    const ech = await get(asA('owner'), '/purchases/payables');
    expect(ech.status).toBe(200);
    const echUsd = ech.body.aging.find((c: { currency: string }) => c.currency === 'USD');
    expect(usd.aging.open).toEqual(echUsd.open);
  });

  it('commandes : compteurs des filtres et délai d’approbation', async () => {
    const base = {
      organizationId: orgA,
      requestedBy: moiA,
      title: 'Test',
      justification: null,
      supplierId,
      supplierName: null,
      currency: 'USD',
      lines: [],
      declaredTaxes: [],
      totals: { subtotal: '200.00', taxes: '0.00', total: '200.00', engineVersion: '1.0.0' },
      expectedOn: null,
      deliveryAddress: null,
      requiredApprovals: null,
      approvals: [],
      approvedTotal: null,
      submittedAt: null,
      submittedOn: null,
      approvedAt: null,
      sentAt: null,
      sentVia: null,
      cancellation: null,
      closedAt: null,
      revision: 1,
      createdBy: moiA,
      updatedBy: moiA,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('purchase_orders').insertMany([
      { ...base, phase: 'request', status: 'draft', requestNumber: null, orderNumber: null },
      {
        ...base,
        phase: 'request',
        status: 'submitted',
        requestNumber: `DA-${tag}-1`,
        orderNumber: null,
        submittedOn: jour(-1),
        submittedAt: new Date(),
        requestedBy: 'quelqu-un',
      },
      {
        ...base,
        phase: 'order',
        status: 'sent',
        requestNumber: `DA-${tag}-2`,
        orderNumber: `BC-${tag}-2`,
        submittedOn: jour(-2),
        approvedAt: new Date(),
      },
    ]);
    const res = await get(asA('owner'), '/purchases/orders/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PurchaseOrderStatsSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.statusCounts).toEqual({ all: 3, mine: 2, draft: 1, submitted: 1, order: 1 });
    const usd = res.body.byCurrency[0];
    expect(usd.open).toEqual({ amount: '200.00', count: 1 });
    expect(usd.pendingApproval).toEqual({ amount: '200.00', count: 1 });
    expect(usd.averageApprovalDelay.days).toBe(2);
    for (const [q, attendu] of [
      ['', 3],
      ['?status=draft', 1],
      ['?status=submitted', 1],
      ['?phase=order', 1],
      ['?requestedBy=me', 2],
    ] as const) {
      const l = await get(asA('owner'), `/purchases/orders${q}`);
      expect(l.status, q).toBe(200);
      expect(l.body.items.length, q).toBe(attendu);
    }
  });

  it('dépenses et comptes : moteur, concordance avec la liste et les soldes', async () => {
    const compte = await post(asA('owner'), '/treasury/accounts', {
      name: 'Caisse USD',
      kind: 'cash',
      currency: 'USD',
      openingBalance: '100.00',
      openingDate: '2026-01-01',
    });
    expect(compte.status, JSON.stringify(compte.body)).toBe(201);
    for (const [amount, category] of [
      ['30.00', 'loyer'],
      ['5.00', 'marketing'],
    ] as const) {
      const d = await post(asA('owner'), '/treasury/expenses', {
        spentOn: jour(0),
        amount,
        currency: 'USD',
        category,
        label: `Dépense ${category}`,
        accountId: compte.body.id,
      });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
    }
    const res = await get(asA('owner'), '/treasury/expenses/stats');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ExpenseStatsSchema.safeParse(res.body).success).toBe(true);
    const usd = res.body.byCurrency[0];
    expect(usd.thisMonth).toEqual({ amount: '35.00', count: 2 });
    expect(usd.byCategoryThisMonth[0]).toMatchObject({ category: 'loyer', amount: '30.00' });
    expect(usd.withoutAttachmentThisMonth.count).toBe(2);
    expect(res.body.statusCounts).toEqual({ recorded: 2, cancelled: 0, all: 2 });
    const mois = jour(0).slice(0, 7);
    const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const liste = await get(
      asA('owner'),
      `/treasury/expenses?status=all&from=${mois}-01&to=${fin}&limit=200`,
    );
    expect(liste.status).toBe(200);
    expect(liste.body.items.length).toBe(res.body.statusCounts.all);
    expect((await get(asA('owner'), '/treasury/expenses/stats?month=2026-13')).status).toBe(400);

    const a = await get(asA('owner'), '/treasury/accounts/stats');
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(AccountStatsSchema.safeParse(a.body).success).toBe(true);
    const comptes = await get(asA('owner'), '/treasury/accounts');
    expect(a.body.byCurrency[0].balance).toBe(comptes.body.totalsByCurrency.USD);
    expect(a.body.byCurrency[0].balance).toBe('65.00');
    expect(a.body.byCurrency[0].thisMonth.outflows).toBe('35.00');
    expect(a.body.byCurrency[0].accounts[0]).toMatchObject({ name: 'Caisse USD' });

    const b = await get(asB(), '/treasury/expenses/stats');
    expect(b.body.byCurrency).toEqual([]);
  });

  it('droits : un rôle sans lecture des achats ni de la trésorerie est refusé partout', async () => {
    for (const path of [
      '/purchases/invoices/stats',
      '/purchases/payables/stats',
      '/purchases/orders/stats',
      '/treasury/expenses/stats',
      '/treasury/accounts/stats',
    ]) {
      const r = await get(asA('sales_rep'), path);
      expect(r.status, path).toBe(403);
    }
    const anonyme = await request(server()).get('/purchases/invoices/stats');
    expect(anonyme.status).toBe(401);
  });
});
