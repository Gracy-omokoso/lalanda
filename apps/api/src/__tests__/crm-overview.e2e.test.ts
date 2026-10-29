// Fiche 360° et fil chronologique d'un compte contre la vraie application
// (ADR-0040 § 3.1.2, § 3.1.3 ; critère 7). ADR-0040 — C8.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB → moteurs `crm` et `receivables`. Couvre : sections d'un
// client (contacts, opportunités, devis, factures, encaissements, solde dû par
// devise, projets RUN, prochaines actions), d'un prospect (ventes `empty`), droits
// par rôle (Propriétaire, Commercial, Lecteur ; sections `hidden` sans
// `sales.read` / `work.read`), absence de toute donnée de trésorerie, isolation
// entre organisations (404) et pagination du fil par curseur.
//
// BASE DÉDIÉE, supprimée à la fin. NIF inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CrmOverviewService } from '../crm/overview/crm-overview.service.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_crm_overview_${tag}`;

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!crm-fiche360';
const ROLES = ['sales_rep', 'viewer'] as const;
type Role = 'owner' | (typeof ROLES)[number];
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

/** Centimes exacts d'un décimal à deux chiffres. */
const cents = (v: string) => BigInt(v.replace('.', ''));
const fromCents = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

e2eSuite('Fiche 360° et fil chronologique (ADR-0040 C8)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  // Jeu de données
  let customerId = '';
  let clientAccount = '';
  let prospectAccount = '';
  let accountB = '';
  let oppClient = '';
  let oppProspect = '';
  let usdInvoice: Record<string, any> = {};
  let cdfInvoice: Record<string, any> = {};
  let projectId = '';

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
  const overview = async (c: string[], accountId: string) =>
    ok(await get(c, `/crm/accounts/${accountId}/overview`));

  const corpsFacture = (currency: 'USD' | 'CDF') => ({
    type: 'FV',
    currency,
    priceMode: 'ht',
    customer: { customerId, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
  });

  /** Brouillon, tout à crédit, émission. */
  async function emettre(currency: 'USD' | 'CDF'): Promise<Record<string, any>> {
    const body = corpsFacture(currency);
    const d = ok(await post(asN(), '/sales/invoices', body), 201);
    const total = d.documentAmounts.calculation.totals.total as string;
    const p = ok(
      await put(asN(), `/sales/invoices/${d.id}`, {
        ...body,
        payments: [{ method: 'CREDIT', amount: total }],
        expectedRevision: d.revision,
      }),
    );
    return ok(await post(asN(), `/sales/invoices/${d.id}/issue`, { expectedRevision: p.revision }));
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(connection.modelNames().map((n) => connection.model(n).init()));
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of ['owner', ...ROLES, 'ownerB'] as const) {
      emails[c] = `crm-360-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `360 ${c}` });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    for (const role of ROLES) {
      const inv = await post(cookies['owner'], `/organizations/${orgN}/invitations`, {
        email: emails[role],
        role,
      });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await post(cookies[role], '/invitations/accept', { token: inv.body.token });
      expect(acc.status).toBe(201);
    }
    orgB = await orgDe('ownerB');

    ok(await put(asN(), '/organizations/current/fiscal-profile', fiche('A1111111X')));
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list: 'taxGroups',
      sha256: randomBytes(32).toString('hex'),
      payload: { a: 0, b: 16, c: 5, d: 0, e: 0, f: 16, g: 5, h: 0, i: 0 },
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });

    // Client : la fiche crée son compte (synchronisation C1).
    customerId = ok(
      await post(asN(), '/sales/customers', {
        type: 'PM',
        name: 'Client 360 SARL',
        nif: `T${tag.toUpperCase()}01`,
      }),
      201,
    ).id;
    const acc = await db.collection('crm_accounts').findOne({ organizationId: orgN, customerId });
    clientAccount = String(acc!._id);
    prospectAccount = ok(await post(asN(), '/crm/accounts', { name: 'Prospect 360' }), 201).account
      .id;
    accountB = ok(await post(asB(), '/crm/accounts', { name: 'Compte de B' }), 201).account.id;

    // Contacts
    ok(await post(asN(), '/crm/contacts', { name: 'Awa Client', accountId: clientAccount }), 201);
    ok(
      await post(asN(), '/crm/contacts', { name: 'Bob Prospect', accountId: prospectAccount }),
      201,
    );

    // Opportunités (l'`accountId` des opportunités est posé en direct jusqu'au lot C2).
    oppClient = ok(
      await post(asN(), '/crm/opportunities', {
        title: 'Mission client',
        customerId,
        currency: 'USD',
        amount: '1000.00',
      }),
      201,
    ).id;
    oppProspect = ok(
      await post(asN(), '/crm/opportunities', {
        title: 'Piste prospect',
        prospectName: 'Prospect 360',
        currency: 'CDF',
        amount: '250000.00',
      }),
      201,
    ).id;
    await db
      .collection('crm_opportunities')
      .updateOne({ _id: new ObjectId(oppProspect) }, { $set: { accountId: prospectAccount } });
    await db
      .collection('crm_opportunities')
      .updateOne({ _id: new ObjectId(oppClient) }, { $set: { accountId: clientAccount } });

    // Relance non faite sur le client.
    ok(
      await post(asN(), '/crm/activities', {
        kind: 'follow_up',
        subject: 'Relancer le client',
        opportunityId: oppClient,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      201,
    );

    // Devis du prospect, rattaché par l'opportunité (client de passage).
    ok(
      await post(asN(), '/sales/quotes', {
        currency: 'USD',
        priceMode: 'ht',
        customer: { customerId: null, walkIn: { name: 'Prospect 360' } },
        lines: [LIGNE],
        title: 'Devis prospect',
        opportunityId: oppProspect,
      }),
      201,
    );

    // Factures : USD réglée à moitié, CDF non réglée (critère 7).
    usdInvoice = await emettre('USD');
    cdfInvoice = await emettre('CDF');
    ok(
      await post(asN(), '/sales/receipts', {
        receivedOn: kinshasaDayOf(new Date()),
        amount: '46.40',
        currency: 'USD',
        method: 'MOBILEMONEY',
        reference: 'TX-360',
        note: null,
        allocations: [{ invoiceId: usdInvoice.id, amount: '46.40' }],
      }),
      201,
    );

    // Projet RUN lié au client.
    projectId = ok(
      await post(asN(), '/work/projects', {
        name: 'Projet 360',
        kind: 'client',
        links: { customerId },
      }),
      201,
    ).id;
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  // ── Sections ─────────────────────────────────────────────────────────────

  describe('sections d’un client', () => {
    it('toutes connues ; opportunités totalisées par devise (moteur crm)', async () => {
      const o = await overview(asN(), clientAccount);
      expect(o.account).toMatchObject({ id: clientAccount, kind: 'customer', customerId });
      const s = o.sections;
      expect(s.identity).toMatchObject({
        status: 'known',
        customer: { id: customerId, type: 'PM', nif: `T${tag.toUpperCase()}01` },
      });
      expect(s.contacts).toMatchObject({ status: 'known', items: [{ name: 'Awa Client' }] });
      expect(s.opportunities).toMatchObject({
        status: 'known',
        items: [{ id: oppClient, stageLabel: 'Lead', amount: '1000.00', currency: 'USD' }],
        totals: { basis: 'estimated', open: [{ currency: 'USD', total: '1000.00', count: 1 }] },
      });
      expect(s.nextActions).toMatchObject({
        status: 'known',
        items: [{ subject: 'Relancer le client', opportunityId: oppClient }],
      });
      expect(s.quotes).toEqual({ status: 'empty' });
      expect(s.invoices.status).toBe('known');
      expect(s.invoices.items.map((i: any) => i.id).sort()).toEqual(
        [usdInvoice.id, cdfInvoice.id].sort(),
      );
      expect(s.receipts).toMatchObject({
        status: 'known',
        items: [
          {
            amount: '46.40',
            currency: 'USD',
            allocations: [{ invoiceId: usdInvoice.id, amount: '46.40' }],
          },
        ],
      });
      expect(s.projects).toMatchObject({ status: 'known', items: [{ id: projectId }] });
    });

    it('critère 7 : solde dû par devise = règlements de /sales/settlements, sans conversion', async () => {
      const r = ok(
        await get(asN(), `/sales/settlements?invoiceIds=${usdInvoice.id},${cdfInvoice.id}`),
      ).items as Array<Record<string, any>>;
      expect(r).toHaveLength(2);
      const attendu = new Map<string, bigint>();
      for (const v of r) {
        attendu.set(
          v['currency'],
          (attendu.get(v['currency']) ?? 0n) + cents(v['settlement'].outstanding),
        );
      }
      const o = await overview(asN(), clientAccount);
      expect(o.sections.outstanding).toMatchObject({ status: 'known', overdueInvoices: 0 });
      const byCurrency = o.sections.outstanding.byCurrency as Array<Record<string, any>>;
      expect(byCurrency.map((c) => c['currency'])).toEqual(['CDF', 'USD']);
      for (const c of byCurrency) {
        expect(c['outstanding']).toBe(fromCents(attendu.get(c['currency'])!));
      }
      expect(byCurrency.find((c) => c['currency'] === 'USD')).toMatchObject({
        outstanding: '46.40',
        openCount: 1,
      });
    });
  });

  it('prospect : ventes `empty` (ni facture ni encaissement), devis rattaché par l’opportunité', async () => {
    const s = (await overview(asN(), prospectAccount)).sections;
    expect(s.identity).toMatchObject({ status: 'known', customer: null });
    expect(s.contacts).toMatchObject({ status: 'known', items: [{ name: 'Bob Prospect' }] });
    expect(s.opportunities).toMatchObject({
      status: 'known',
      totals: { open: [{ currency: 'CDF', total: '250000.00' }] },
    });
    expect(s.quotes).toMatchObject({
      status: 'known',
      items: [{ title: 'Devis prospect', opportunityId: oppProspect, status: 'draft' }],
    });
    expect(s.invoices).toEqual({ status: 'empty' });
    expect(s.receipts).toEqual({ status: 'empty' });
    expect(s.outstanding).toEqual({ status: 'empty' });
    expect(s.projects).toEqual({ status: 'empty' });
    expect(s.nextActions).toEqual({ status: 'empty' });
  });

  // ── Droits ───────────────────────────────────────────────────────────────

  describe('droits par rôle', () => {
    it('Commercial et Lecteur voient la même fiche que le Propriétaire', async () => {
      const ref = await overview(asN(), clientAccount);
      for (const role of ['sales_rep', 'viewer'] as const) {
        const o = await overview(asN(role), clientAccount);
        for (const [name, section] of Object.entries(o.sections)) {
          expect((section as any).status, `${role} ${name}`).toBe(
            (ref.sections as any)[name].status,
          );
        }
        expect(o.sections.outstanding).toEqual(ref.sections.outstanding);
      }
    });

    it('aucune donnée de trésorerie : ni compte d’encaissement, ni marge, ni coût', async () => {
      const o = await overview(asN('sales_rep'), clientAccount);
      for (const r of o.sections.receipts.items) expect(r).not.toHaveProperty('accountId');
      const texte = JSON.stringify(o);
      expect(texte).not.toMatch(/treasury|margin|hourlyCost|"cost"/i);
    });

    it('sans `sales.read` ni `work.read` : sections masquées et signalées, jamais de zéros', async () => {
      const service = app.get(CrmOverviewService);
      const o = await service.overview(orgN, clientAccount, { sales: false, work: false });
      for (const name of ['quotes', 'invoices', 'receipts', 'outstanding', 'projects'] as const) {
        expect(o.sections[name], name).toEqual({ status: 'hidden' });
      }
      expect(o.sections.contacts.status).toBe('known');
      expect(o.sections.opportunities.status).toBe('known');
      const fil = await service.timeline(
        orgN,
        clientAccount,
        {
          read: ['activity', 'opportunity', 'account'],
          hidden: ['quote', 'invoice', 'receipt', 'project'],
        },
        undefined,
      );
      expect(fil.hiddenSources).toEqual(['quote', 'invoice', 'receipt', 'project']);
      expect(
        fil.items.every((e) => ['activity', 'opportunity', 'account'].includes(e.source)),
      ).toBe(true);
    });
  });

  // ── Isolation ────────────────────────────────────────────────────────────

  it('isolation : compte d’une autre organisation ou forgé → 404', async () => {
    code(await get(asB(), `/crm/accounts/${clientAccount}/overview`), 404, 'CRM_ACCOUNT_NOT_FOUND');
    code(await get(asB(), `/crm/accounts/${clientAccount}/timeline`), 404, 'CRM_ACCOUNT_NOT_FOUND');
    code(await get(asN(), `/crm/accounts/${accountB}/overview`), 404, 'CRM_ACCOUNT_NOT_FOUND');
    code(
      await get(asN(), `/crm/accounts/${new ObjectId().toHexString()}/overview`),
      404,
      'CRM_ACCOUNT_NOT_FOUND',
    );
    code(await get(asN(), '/crm/accounts/pas-un-id/timeline'), 404, 'CRM_ACCOUNT_NOT_FOUND');
    // Le compte de B ne voit rien de N.
    const b = await overview(asB(), accountB);
    expect(b.sections.contacts).toEqual({ status: 'empty' });
    expect(b.sections.invoices).toEqual({ status: 'empty' });
  });

  // ── Fil chronologique ────────────────────────────────────────────────────

  describe('fil chronologique', () => {
    it('client : création du compte, opportunité, relance, factures, encaissement, projet', async () => {
      const fil = ok(await get(asN('sales_rep'), `/crm/accounts/${clientAccount}/timeline`));
      const types = new Set((fil.items as any[]).map((e) => e.type));
      for (const t of [
        'account.created',
        'opportunity.created',
        'activity.created',
        'invoice.issued',
        'receipt.recorded',
        'project.created',
      ]) {
        expect(types, t).toContain(t);
      }
      expect(fil.hiddenSources).toEqual([]);
      expect(fil.nextCursor).toBeNull();
      const filtre = ok(await get(asN(), `/crm/accounts/${clientAccount}/timeline?types=invoice`));
      expect((filtre.items as any[]).map((e) => e.type)).toEqual([
        'invoice.issued',
        'invoice.issued',
      ]);
      code(
        await get(asN(), `/crm/accounts/${clientAccount}/timeline?types=treasury`),
        400,
        'INVALID_REQUEST',
      );
      code(
        await get(asN(), `/crm/accounts/${clientAccount}/timeline?cursor=altere`),
        400,
        'INVALID_CURSOR',
      );
    });

    it('pagination par curseur : 50 par page, ordre décroissant, sans trou ni doublon', async () => {
      const base = Date.parse('2026-01-01T00:00:00.000Z');
      await db.collection('crm_activities').insertMany(
        Array.from({ length: 70 }, (_, i) => ({
          organizationId: orgN,
          kind: 'note',
          subject: `Note ${i}`,
          notes: null,
          dueAt: null,
          done: false,
          doneAt: null,
          opportunityId: null,
          contactId: null,
          customerId: null,
          accountId: prospectAccount,
          revision: 1,
          createdBy: 'test',
          updatedBy: 'test',
          // Deux notes par instant : le départage par identifiant est exercé.
          createdAt: new Date(base + Math.floor(i / 2) * 60_000),
          updatedAt: new Date(base),
          _schemaVersion: 1,
        })),
      );
      // Une note d'une autre organisation, même `accountId` forgé : jamais lue.
      await db.collection('crm_activities').insertOne({
        organizationId: orgB,
        kind: 'note',
        subject: 'Intrus',
        accountId: prospectAccount,
        done: false,
        createdAt: new Date(base),
      });
      const vus: any[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const q: string = cursor ? `?cursor=${cursor}` : '';
        const page = ok(await get(asN(), `/crm/accounts/${prospectAccount}/timeline${q}`));
        expect(page.items.length).toBeLessThanOrEqual(50);
        vus.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(2);
      expect(vus[0].type).not.toBe(undefined);
      const ids = vus.map((e) => `${e.type}|${e.id}`);
      expect(new Set(ids).size).toBe(ids.length);
      expect(vus.filter((e) => e.source === 'activity')).toHaveLength(70);
      expect(vus.some((e) => e.title === 'Intrus')).toBe(false);
      for (let i = 1; i < vus.length; i++) {
        expect(vus[i - 1].at >= vus[i].at, `ordre ${i}`).toBe(true);
      }
      // Compte, opportunité, devis du prospect également présents.
      const types = new Set(vus.map((e) => e.type));
      expect(types).toContain('account.created');
      expect(types).toContain('opportunity.created');
      expect(types).toContain('quote.created');
    });
  });
});
