// Encaissements, statut de règlement et pont vers le réalisé (ADR-0031) contre la
// vraie application : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB (transactions, replica set) → moteur `receivables`.
//
// Organisation A (mode ordinaire) : encaissements AVANT tout projet (RUN sans
// BUILD), puis pont vers un projet `hello-world`. Organisation B : isolation.
// Organisation C : aucun projet, pont jamais configuré.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { SettlementClock } from '../sales/receipts/settlements.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_receipts_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!encaissements';
const ROLES = ['owner', 'admin', 'finance_director', 'accountant', 'analyst', 'viewer'] as const;
type Role = (typeof ROLES)[number];
type Compte = Role | 'ownerB' | 'ownerC';

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

/** 2 h de conseil à 40,00 HT, groupe B (16 %) : HT 80,00, TVA 12,80, total 92,80. */
const LIGNE = {
  source: 'free',
  code: 'CONSEIL-H',
  name: 'Conseil (heure)',
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: 'heure',
  quantity: '2',
  unitPrice: '40.00',
  specificTax: null,
  discount: null,
};

e2eSuite('encaissements, règlement et pont vers le réalisé (ADR-0031)', () => {
  let app: INestApplication;
  let db: Db;
  let orgA = '';
  let orgB = '';
  let orgC = '';
  let customer = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asA = (role: Role) => [...cookies[role], `active_org_id=${orgA}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const asC = () => [...cookies['ownerC'], `active_org_id=${orgC}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const issueCodes = (res: request.Response): string[] =>
    ((res.body?.details?.issues ?? []) as { code: string }[]).map((i) => i.code);
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

  const corps = (extra: Record<string, unknown> = {}) => ({
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customer, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    ...extra,
  });

  /** Brouillon, paiements déclarés (par défaut : tout à crédit), émission. */
  async function emettre(
    c: string[],
    body: Record<string, unknown> = corps(),
    payments: (total: string) => { method: string; amount: string }[] = (total) => [
      { method: 'CREDIT', amount: total },
    ],
  ): Promise<Record<string, any>> {
    const d = await post(c, '/sales/invoices', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const total = d.body.documentAmounts.calculation.totals.total as string;
    const p = await put(c, `/sales/invoices/${d.body.id}`, {
      ...body,
      payments: payments(total),
      expectedRevision: d.body.revision,
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const res = await post(c, `/sales/invoices/${d.body.id}/issue`, {
      expectedRevision: p.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }

  const encaissement = (
    allocations: { invoiceId: string; amount: string }[],
    extra: Record<string, unknown> = {},
  ) => ({
    receivedOn: today(),
    amount: allocations
      .map((a) => a.amount)
      .reduce((a, b) => (Math.round(Number(a) * 100 + Number(b) * 100) / 100).toFixed(2)),
    currency: 'USD',
    method: 'MOBILEMONEY',
    reference: 'TX-0001',
    note: null,
    allocations,
    ...extra,
  });

  const reglement = async (c: string[], invoiceId: string) => {
    const res = await get(c, `/sales/settlements/${invoiceId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    // `autoIndex` construit les index en arrière-plan : la garde de concurrence des
    // encaissements repose sur l'index unique de `sales_invoice_settlements` (en
    // production, `IndexesService` les pose au démarrage). On attend qu'ils existent.
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(connection.modelNames().map((n) => connection.model(n).init()));
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));
    for (const c of [...ROLES, 'ownerB', 'ownerC'] as const) {
      emails[c] = `encais-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Enc ${c}` });
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
    orgC = await orgDe('ownerC');
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
    customer = (
      await post(asA('owner'), '/sales/customers', {
        type: 'PM',
        name: 'Client Exemple SARL',
        nif: `T${tag.toUpperCase()}01`,
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

  // ── RUN sans BUILD : aucun projet dans l'organisation A à ce stade ─────────

  describe('encaissement partiel puis total', () => {
    let f1: Record<string, any>;

    it('facture à crédit : non payée, reste 92,80', async () => {
      f1 = await emettre(asA('owner'));
      expect(f1.amountOnCredit ?? '92.80').toBe('92.80');
      expect(await reglement(asA('viewer'), f1.id)).toMatchObject({
        status: 'unpaid',
        reason: null,
        dueDate: null,
        settlement: { due: '92.80', received: '0.00', outstanding: '92.80' },
      });
    });

    it('le Comptable encaisse 40,00 : partiellement payée', async () => {
      const r = await post(
        asA('accountant'),
        '/sales/receipts',
        encaissement([{ invoiceId: f1.id, amount: '40.00' }]),
      );
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body).toMatchObject({
        status: 'recorded',
        amount: '40.00',
        currency: 'USD',
        method: 'MOBILEMONEY',
        revision: 1,
        allocations: [{ invoiceId: f1.id, invoiceNumber: f1.number, amount: '40.00' }],
      });
      expect(await reglement(asA('owner'), f1.id)).toMatchObject({
        status: 'partially_paid',
        settlement: { received: '40.00', outstanding: '52.80' },
      });
    });

    it('dépasser le reste → 422 RECEIPT_ALLOCATION_EXCEEDS_BALANCE ; solde → payée', async () => {
      const trop = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: f1.id, amount: '52.81' }]),
      );
      expect(trop.status).toBe(422);
      expect(trop.body.code).toBe('RECEIPT_INVALID');
      expect(issueCodes(trop)).toEqual(['RECEIPT_ALLOCATION_EXCEEDS_BALANCE']);
      const solde = await post(
        asA('finance_director'),
        '/sales/receipts',
        encaissement([{ invoiceId: f1.id, amount: '52.80' }], { method: 'ESPECES' }),
      );
      expect(solde.status, JSON.stringify(solde.body)).toBe(201);
      expect(await reglement(asA('owner'), f1.id)).toMatchObject({
        status: 'paid',
        settlement: { received: '92.80', outstanding: '0.00', creditBalance: '0.00' },
      });
      const liste = await get(asA('viewer'), `/sales/receipts?invoiceId=${f1.id}`);
      expect(liste.status).toBe(200);
      expect(liste.body.items).toHaveLength(2);
    });

    it('formes refusées : CREDIT, nombre JSON, date future, somme ≠ montant', async () => {
      const credit = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: f1.id, amount: '1.00' }], { method: 'CREDIT' }),
      );
      expect(credit.status).toBe(400);
      const nombre = await post(asA('owner'), '/sales/receipts', {
        ...encaissement([{ invoiceId: f1.id, amount: '1.00' }]),
        amount: 1,
      });
      expect(nombre.status).toBe(400);
      expect(issueCodes(nombre)).toContain('DECIMAL_MUST_BE_STRING');
      const futur = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: f1.id, amount: '1.00' }], { receivedOn: '2999-01-01' }),
      );
      expect(futur.status).toBe(400);
      expect(futur.body.code).toBe('RECEIPT_DATE_IN_FUTURE');
    });
  });

  describe('multi-factures, devise, avoir, annulation', () => {
    let f2: Record<string, any>;
    let f3: Record<string, any>;

    it('un encaissement de 150,00 sur deux factures', async () => {
      f2 = await emettre(asA('owner'));
      f3 = await emettre(asA('owner'));
      const mauvais = await post(asA('owner'), '/sales/receipts', {
        ...encaissement([
          { invoiceId: f2.id, amount: '92.80' },
          { invoiceId: f3.id, amount: '57.20' },
        ]),
        amount: '150.01',
      });
      expect(mauvais.status).toBe(422);
      expect(issueCodes(mauvais)).toEqual(['RECEIPT_ALLOCATIONS_MISMATCH']);
      const r = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([
          { invoiceId: f2.id, amount: '92.80' },
          { invoiceId: f3.id, amount: '57.20' },
        ]),
      );
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.amount).toBe('150.00');
      const lot = await get(asA('viewer'), `/sales/settlements?invoiceIds=${f2.id},${f3.id}`);
      expect(lot.status).toBe(200);
      expect(lot.body.items.map((i: { status: string }) => i.status)).toEqual([
        'paid',
        'partially_paid',
      ]);
      expect(lot.body.items[1].settlement.outstanding).toBe('35.60');
    });

    it('devise différente → 409 RECEIPT_CURRENCY_MISMATCH (aucun taux)', async () => {
      const r = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: f3.id, amount: '10.00' }], { currency: 'CDF' }),
      );
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('RECEIPT_CURRENCY_MISMATCH');
    });

    it('avoir à crédit imputé sur la facture d’origine ; un avoir ne s’encaisse pas', async () => {
      const f4 = await emettre(asA('owner'));
      const avoir = await emettre(
        asA('owner'),
        corps({
          type: 'FA',
          creditNote: { nature: 'RAM', originInvoiceId: f4.id },
          lines: [{ source: 'origin', originLineIndex: 0, quantity: '1' }],
        }),
      );
      expect(avoir.documentAmounts.calculation.totals.total).toBe('46.40');
      expect(await reglement(asA('owner'), f4.id)).toMatchObject({
        status: 'partially_paid',
        settlement: { credited: '46.40', received: '0.00', outstanding: '46.40' },
      });
      expect(await reglement(asA('owner'), avoir.id)).toMatchObject({
        status: 'not_applicable',
        reason: 'CREDIT_NOTE',
        settlement: null,
      });
      const r = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: avoir.id, amount: '1.00' }]),
      );
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({
        code: 'INVOICE_NOT_SETTLEABLE',
        details: { reason: 'CREDIT_NOTE' },
      });
    });

    it('modification, révision périmée, annulation motivée puis définitive', async () => {
      const r = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: f3.id, amount: '10.00' }]),
      );
      expect(r.status).toBe(201);
      const modif = await put(asA('accountant'), `/sales/receipts/${r.body.id}`, {
        receipt: encaissement([{ invoiceId: f3.id, amount: '35.60' }], { method: 'VIREMENT' }),
        expectedRevision: 1,
      });
      expect(modif.status, JSON.stringify(modif.body)).toBe(200);
      expect(modif.body).toMatchObject({ amount: '35.60', revision: 2 });
      expect((await reglement(asA('owner'), f3.id)).status).toBe('paid');
      const perime = await put(asA('owner'), `/sales/receipts/${r.body.id}`, {
        receipt: encaissement([{ invoiceId: f3.id, amount: '1.00' }]),
        expectedRevision: 1,
      });
      expect(perime.status).toBe(409);
      expect(perime.body.code).toBe('STALE_REVISION');
      const annule = await post(asA('owner'), `/sales/receipts/${r.body.id}/cancel`, {
        reason: 'Virement rejeté par la banque',
        expectedRevision: 2,
      });
      expect(annule.status, JSON.stringify(annule.body)).toBe(200);
      expect(annule.body).toMatchObject({
        status: 'cancelled',
        cancellation: { reason: 'Virement rejeté par la banque' },
      });
      expect(await reglement(asA('owner'), f3.id)).toMatchObject({
        status: 'partially_paid',
        settlement: { outstanding: '35.60' },
      });
      const encore = await post(asA('owner'), `/sales/receipts/${r.body.id}/cancel`, {
        reason: 'Deuxième fois',
        expectedRevision: 3,
      });
      expect(encore.status).toBe(409);
      expect(encore.body.code).toBe('RECEIPT_CANCELLED');
      const audit = await db
        .collection('audit_events')
        .find({ organizationId: orgA, targetId: r.body.id })
        .toArray();
      expect(audit.map((e) => e['action']).sort()).toEqual([
        'sales.receipt.cancelled',
        'sales.receipt.recorded',
        'sales.receipt.updated',
      ]);
    });

    it('facture réglée à l’émission : payée, rien à encaisser ; brouillon : pas de règlement', async () => {
      const comptant = await emettre(asA('owner'), corps(), (total) => [
        { method: 'VIREMENT', amount: total },
      ]);
      expect((await reglement(asA('owner'), comptant.id)).status).toBe('paid');
      const r = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: comptant.id, amount: '1.00' }]),
      );
      expect(issueCodes(r)).toEqual(['RECEIPT_ALLOCATION_EXCEEDS_BALANCE']);
      const brouillon = await post(asA('owner'), '/sales/invoices', corps());
      expect((await reglement(asA('owner'), brouillon.body.id)).reason).toBe('NOT_FINAL');
      const surBrouillon = await post(
        asA('owner'),
        '/sales/receipts',
        encaissement([{ invoiceId: brouillon.body.id, amount: '1.00' }]),
      );
      expect(surBrouillon.body).toMatchObject({
        code: 'INVOICE_NOT_SETTLEABLE',
        details: { reason: 'NOT_FINAL' },
      });
    });

    it('échéance : jamais en retard sans elle ; dépassée → en retard', async () => {
      const f = await emettre(asA('owner'));
      const avant = await put(asA('admin'), `/sales/settlements/${f.id}/due-date`, {
        dueDate: '2001-01-01',
      });
      expect(avant.status).toBe(400);
      expect(avant.body.code).toBe('DUE_DATE_BEFORE_ISSUE');
      const ok = await put(asA('admin'), `/sales/settlements/${f.id}/due-date`, {
        dueDate: today(),
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ status: 'unpaid', dueDate: today() });
      const horloge = vi
        .spyOn(app.get(SettlementClock), 'now')
        .mockReturnValue(new Date(Date.now() + 10 * 24 * 3600 * 1000));
      try {
        expect(await reglement(asA('owner'), f.id)).toMatchObject({
          status: 'overdue',
          settlement: { overdue: true, outstanding: '92.80' },
        });
        const ouvertes = await get(asA('viewer'), '/sales/settlements?open=true');
        expect(ouvertes.status).toBe(200);
        const ids = ouvertes.body.items.map((i: { invoiceId: string }) => i.invoiceId);
        expect(ids).toContain(f.id);
        expect(
          ouvertes.body.items.every(
            (i: { settlement: { outstanding: string } }) => i.settlement.outstanding !== '0.00',
          ),
        ).toBe(true);
      } finally {
        horloge.mockRestore();
      }
      const retire = await put(asA('admin'), `/sales/settlements/${f.id}/due-date`, {
        dueDate: null,
      });
      expect(retire.body).toMatchObject({ dueDate: null, status: 'unpaid' });
    });

    it('deux encaissements simultanés du reste entier : un seul passe', async () => {
      const f = await emettre(asA('owner'));
      const [r1, r2] = await Promise.all(
        [1, 2].map(() =>
          post(
            asA('owner'),
            '/sales/receipts',
            encaissement([{ invoiceId: f.id, amount: '92.80' }]),
          ),
        ),
      );
      expect([r1.status, r2.status].sort()).toEqual([201, 422]);
      expect(await reglement(asA('owner'), f.id)).toMatchObject({
        status: 'paid',
        settlement: { received: '92.80' },
      });
    });

    it('totaux mensuels par devise, annulés exclus (moteur)', async () => {
      const res = await get(asA('viewer'), '/sales/receipts/summary');
      expect(res.status).toBe(200);
      const recus = await db
        .collection('sales_receipts')
        .find({ organizationId: orgA, status: 'recorded' })
        .toArray();
      const cents = recus.reduce((s, r) => s + Math.round(Number(r['amount']) * 100), 0);
      expect(res.body.months).toEqual([
        {
          month: today().slice(0, 7),
          currency: 'USD',
          total: (cents / 100).toFixed(2),
          count: recus.length,
        },
      ]);
    });
  });

  describe('permissions et isolation', () => {
    it('RBAC : lecture ouverte à sales.read, écriture à sales.receipt seulement', async () => {
      const f = await emettre(asA('owner'));
      for (const role of ['viewer', 'analyst', 'admin'] as const) {
        expect((await get(asA(role), '/sales/receipts')).status, role).toBe(200);
        const r = await post(
          asA(role),
          '/sales/receipts',
          encaissement([{ invoiceId: f.id, amount: '1.00' }]),
        );
        expect(r.status, role).toBe(403);
      }
      expect(
        (await put(asA('viewer'), `/sales/settlements/${f.id}/due-date`, { dueDate: null })).status,
      ).toBe(403);
    });

    it('une autre organisation ne voit rien et ne lettre rien (404)', async () => {
      const [unA] = (await get(asA('owner'), '/sales/receipts')).body.items as { id: string }[];
      const f = (await get(asA('owner'), '/sales/invoices?status=final')).body.items[0];
      expect((await get(asB(), `/sales/receipts/${unA!.id}`)).status).toBe(404);
      expect((await get(asB(), `/sales/settlements/${f.id}`)).status).toBe(404);
      expect((await get(asB(), `/sales/settlements?invoiceIds=${f.id}`)).body.items).toEqual([]);
      expect((await get(asB(), '/sales/receipts')).body.items).toEqual([]);
      const vol = await post(
        asB(),
        '/sales/receipts',
        encaissement([{ invoiceId: f.id, amount: '1.00' }]),
      );
      expect(vol.status).toBe(404);
      expect(vol.body.code).toBe('INVOICE_NOT_FOUND');
      const annul = await post(asB(), `/sales/receipts/${unA!.id}/cancel`, {
        reason: 'Tentative',
        expectedRevision: 1,
      });
      expect(annul.status).toBe(404);
    });
  });

  // ── Pont vers le réalisé BUILD ────────────────────────────────────────────

  describe('organisation sans plan BUILD', () => {
    it('pont désactivé ; synchroniser → 409 BRIDGE_NOT_CONFIGURED ; activer sans cible → 409', async () => {
      const vue = await get(asC(), '/sales/actuals-bridge');
      expect(vue.status).toBe(200);
      expect(vue.body).toMatchObject({ state: 'disabled', enabled: false, projectId: null });
      const sync = await post(asC(), '/sales/actuals-bridge/sync', {});
      expect(sync.status).toBe(409);
      expect(sync.body.code).toBe('BRIDGE_NOT_CONFIGURED');
      const activer = await put(asC(), '/sales/actuals-bridge', {
        enabled: true,
        projectId: null,
        revenueLineId: null,
        exerciseStart: null,
      });
      expect(activer.status).toBe(409);
      expect((await get(asC(), '/sales/actuals-bridge/candidates')).body.items).toEqual([]);
    });
  });

  describe('synchronisation vers le réalisé', () => {
    let projectId = '';
    const mois = () => today().slice(0, 7);
    /** CA HT attendu : factures FV de la série réelle moins avoirs, en centimes. */
    const caAttendu = async () => {
      const docs = await db
        .collection('sales_invoices')
        .find({ organizationId: orgA, status: 'issued' })
        .toArray();
      let cents = 0;
      for (const d of docs) {
        const ht = (
          d['documentAmounts'].calculation.totals.groups as { group: string; ht: string }[]
        )
          .filter((g) => !['H', 'I', 'J', 'L', 'N'].includes(g.group))
          .reduce((s, g) => s + Math.round(Number(g.ht) * 100), 0);
        cents += d['type'] === 'FA' ? -ht : ht;
      }
      return cents / 100;
    };
    const periode = async () => {
      const res = await get(asA('owner'), `/projects/${projectId}/actual-periods?year=1`);
      expect(res.status).toBe(200);
      return (res.body.periods as Record<string, any>[]).find((p) => p['month'] === 1);
    };

    it('projet sans plan validé → 409 NO_APPROVED_PLAN ; autre organisation → 404', async () => {
      const p = await post(asA('owner'), '/projects', {
        name: `Pont ${tag}`,
        templateSlug: 'hello-world',
        deviseAffichage: 'USD',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      projectId = p.body.id;
      const reglage = {
        enabled: true,
        projectId,
        revenueLineId: 'ca',
        exerciseStart: mois(),
      };
      const sansPlan = await put(asA('owner'), '/sales/actuals-bridge', reglage);
      expect(sansPlan.status).toBe(409);
      expect(sansPlan.body.code).toBe('NO_APPROVED_PLAN');
      const plan = await post(asA('owner'), `/projects/${projectId}/plans`, {});
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      const autre = await put(asB(), '/sales/actuals-bridge', reglage);
      expect(autre.status).toBe(404);
      const ligne = await put(asA('owner'), '/sales/actuals-bridge', {
        ...reglage,
        revenueLineId: 'ligne_inconnue',
      });
      expect(ligne.body.code).toBe('UNKNOWN_LINE');
      expect((await put(asA('viewer'), '/sales/actuals-bridge', reglage)).status).toBe(403);
      const ok = await put(asA('accountant'), '/sales/actuals-bridge', reglage);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({
        state: 'active',
        projectCurrency: 'USD',
        revenueLineId: 'ca',
        exerciseStart: mois(),
      });
    });

    it('simulation : rien n’est écrit', async () => {
      const r = await post(asA('owner'), '/sales/actuals-bridge/sync', { dryRun: true });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.counts).toMatchObject({ written: 1, unchanged: 0 });
      expect(r.body.entries[0]).toMatchObject({
        year: 1,
        month: 1,
        lineId: 'ca',
        outcome: 'written',
      });
      expect(await periode()).toBeUndefined();
    });

    it('écrit le CA HT (factures moins avoirs), étiqueté « issu des ventes » ; rejouer ne change rien', async () => {
      const attendu = await caAttendu();
      const r = await post(asA('owner'), '/sales/actuals-bridge/sync', {});
      expect(r.status).toBe(200);
      expect(r.body.counts).toMatchObject({ written: 1, unchanged: 0, removed: 0, blocked: 0 });
      expect(Number(r.body.entries[0].value)).toBe(attendu);
      const p = await periode();
      expect(p!['values']['ca']).toBe(attendu);
      expect(p!['sources']['ca']).toMatchObject({
        source: 'run.sales',
        calendarMonth: mois(),
        version: '1.0.0',
      });
      const avant = p!['updatedAt'];
      const encore = await post(asA('owner'), '/sales/actuals-bridge/sync', {});
      expect(encore.body.counts).toMatchObject({ written: 0, unchanged: 1 });
      expect((await periode())!['updatedAt']).toBe(avant);
      const vue = await get(asA('viewer'), '/sales/actuals-bridge');
      expect(vue.body.lastSync).toMatchObject({ written: 0, unchanged: 1 });
    });

    it('la ligne alimentée ne se saisit pas à la main ; les autres lignes, si', async () => {
      const ca = await put(asA('owner'), `/projects/${projectId}/actual-periods/1/1`, {
        values: { ca: 1 },
      });
      expect(ca.status).toBe(409);
      expect(ca.body.code).toBe('LINE_FED_BY_RUN');
      const efface = await put(asA('owner'), `/projects/${projectId}/actual-periods/1/1`, {
        values: { ca: null },
      });
      expect(efface.body.code).toBe('LINE_FED_BY_RUN');
      const autre = await put(asA('owner'), `/projects/${projectId}/actual-periods/1/1`, {
        values: { cout_variable: 30 },
      });
      expect(autre.status, JSON.stringify(autre.body)).toBe(200);
      expect(autre.body.sources['cout_variable']).toMatchObject({ source: 'manual' });
      expect(autre.body.sources['ca']).toMatchObject({ source: 'run.sales' });
    });

    it('une nouvelle vente est reportée ; une période clôturée ne bouge plus', async () => {
      await emettre(asA('owner'));
      const r = await post(asA('owner'), '/sales/actuals-bridge/sync', {});
      expect(r.body.counts).toMatchObject({ written: 1 });
      expect((await periode())!['values']['ca']).toBe(await caAttendu());
      const cloture = await post(asA('owner'), `/projects/${projectId}/actual-periods/1/1/close`);
      expect(cloture.status, JSON.stringify(cloture.body)).toBe(201);
      const fige = (await periode())!['values']['ca'];
      await emettre(asA('owner'));
      const bloque = await post(asA('owner'), '/sales/actuals-bridge/sync', {});
      expect(bloque.body.counts).toMatchObject({ written: 0, blocked: 1 });
      expect(bloque.body.entries[0]).toMatchObject({ outcome: 'PERIOD_CLOSED', storedValue: fige });
      expect(Number(bloque.body.entries[0].value)).toBe(await caAttendu());
      expect((await periode())!['values']['ca']).toBe(fige);
    });

    it('pont désactivé : saisie manuelle tracée ; réactivé : la saisie manuelle n’est pas écrasée', async () => {
      const reouv = await post(asA('owner'), `/projects/${projectId}/actual-periods/1/1/reopen`, {
        reason: 'Correction du réalisé',
      });
      expect(reouv.status, JSON.stringify(reouv.body)).toBe(201);
      const coupe = await put(asA('owner'), '/sales/actuals-bridge', {
        enabled: false,
        projectId,
        revenueLineId: 'ca',
        exerciseStart: mois(),
      });
      expect(coupe.body.state).toBe('disabled');
      expect((await post(asA('owner'), '/sales/actuals-bridge/sync', {})).status).toBe(409);
      const ancien = (await periode())!['values']['ca'];
      const manuel = await put(asA('owner'), `/projects/${projectId}/actual-periods/1/1`, {
        values: { ca: 123 },
      });
      expect(manuel.status, JSON.stringify(manuel.body)).toBe(200);
      expect(manuel.body.sources['ca']).toMatchObject({
        source: 'manual',
        replaced: { source: 'run.sales', value: ancien },
      });
      await put(asA('owner'), '/sales/actuals-bridge', {
        enabled: true,
        projectId,
        revenueLineId: 'ca',
        exerciseStart: mois(),
      });
      const r = await post(asA('owner'), '/sales/actuals-bridge/sync', {});
      expect(r.body.entries[0]).toMatchObject({
        outcome: 'MANUAL_VALUE_PRESENT',
        storedValue: 123,
      });
      expect((await periode())!['values']['ca']).toBe(123);
    });

    it('le plan validé n’est jamais écrit', async () => {
      const plans = await db.collection('financial_plans').find({ projectId }).toArray();
      expect(plans).toHaveLength(1);
      expect(plans[0]!['status']).toBe('approved');
      const audit = await db
        .collection('audit_events')
        .find({ organizationId: orgA, action: 'run.actuals.synced' })
        .toArray();
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });
  });
});
