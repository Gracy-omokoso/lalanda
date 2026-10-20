// Documents de vente contre la vraie application (ADR-0023 § S25e, critères
// d'acceptation « E2 »).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB (transactions, replica set) → moteur `invoice-totals`
// (vraies fonctions, E1 fusionné). Organisation A : mode ordinaire. Organisation
// N : facture normalisée activée par le vrai parcours (fiche, point de vente
// testé contre un FAUX serveur e-MCF local, activation). S25f est simulé par
// des appels directs à `InvoiceNumberingService` et au journal.
//
// BASE DÉDIÉE, supprimée à la fin. NIF et jetons inventés.

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

import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { inFiscalTransaction } from '../fiscal/fiscal-transaction.js';
import { NormalizedInvoicingService } from '../fiscal/normalized-invoicing.service.js';
import { contentSha256Of } from '../sales/invoices/canonical.js';
import {
  SALES_INVOICE_NORMALIZER,
  type SalesInvoiceNormalizer,
} from '../sales/invoices/normalization.port.js';
import { InvoiceJournalService } from '../sales/invoices/invoice-journal.service.js';
import {
  InvoiceNumberingService,
  fiscalYearOf,
} from '../sales/invoices/invoice-numbering.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_invoices_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 120_000 });

const MOT_DE_PASSE = 'Passw0rd!factures';
const NIF_N = 'A0000000X';
const NIM = 'XX01000001-1';
const JETON = `ANTIFUITE-factures-${tag}-0123456789abcdef`;
const TAUX = '2262.32';

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
type Compte = Role | 'ownerB' | 'ownerN' | 'superAdmin';

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

/** Ligne libre : 2 h de conseil à 40,00, groupe B (16 %). */
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

e2eSuite('ventes — factures et avoirs (ADR-0023 chantier E2)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgA = '';
  let orgB = '';
  let orgN = '';
  let customerPM = '';
  let customerAO = '';
  let itemCdf = '';
  let itemUsd = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asA = (role: Role) => [...cookies[role], `active_org_id=${orgA}`];
  const asB = () => [...cookies['ownerB'], `active_org_id=${orgB}`];
  const asN = () => [...cookies['ownerN'], `active_org_id=${orgN}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const del = (c: string[], path: string) => request(server()).delete(path).set('Cookie', c);
  const codes = (res: request.Response): string[] =>
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

  const corps = (extra: Record<string, unknown> = {}) => ({
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId: customerPM, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
    ...extra,
  });

  async function brouillon(c: string[], body: Record<string, unknown>) {
    const res = await post(c, '/sales/invoices', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Record<string, any>;
  }

  /** Brouillon puis PUT avec un paiement unique égal au total du moteur. */
  async function brouillonPret(c: string[], body: Record<string, unknown>) {
    const d = await brouillon(c, body);
    const total = d.documentAmounts.calculation.totals.total as string;
    const res = await put(c, `/sales/invoices/${d.id}`, {
      ...body,
      payments: [{ method: 'VIREMENT', amount: total }],
      expectedRevision: d.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  }

  async function emettre(c: string[], body: Record<string, unknown> = corps()) {
    const d = await brouillonPret(c, body);
    const res = await post(c, `/sales/invoices/${d.id}/issue`, { expectedRevision: d.revision });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  }

  async function normaliser(body: Record<string, unknown>, exchangeRate: unknown = null) {
    const d = await brouillonPret(asN(), body);
    const res = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
      expectedRevision: d.revision,
      exchangeRate,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  }

  async function instantane(list: string, payload: unknown, fetchedAt = new Date()) {
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list,
      sha256: randomBytes(32).toString('hex'),
      payload,
      fetchedAt,
      _schemaVersion: 1,
    });
  }

  const connection = () => app.get<Connection>(getConnectionToken());
  const numbering = () => app.get(InvoiceNumberingService);

  /** Faux S25f : réserve un numéro et l'écrit dans `normalization.reservedNumber`. */
  async function reserver(organizationId: string, invoiceId: string) {
    return inFiscalTransaction(connection(), async (session) => {
      const r = await numbering().reserve(organizationId, invoiceId, 'test', { session });
      await connection()
        .collection('sales_invoices')
        .updateOne(
          { _id: new ObjectId(invoiceId) },
          { $set: { 'normalization.reservedNumber': r.number } },
          { session },
        );
      return r;
    });
  }

  /** Faux S25f : normalisation réussie (numéro confirmé, code DEF/DGI). */
  async function reussir(organizationId: string, invoiceId: string) {
    await reserver(organizationId, invoiceId);
    await inFiscalTransaction(connection(), async (session) => {
      await numbering().confirm(organizationId, invoiceId, new Date(), { session });
      await connection()
        .collection('sales_invoices')
        .updateOne(
          { _id: new ObjectId(invoiceId), status: 'pending_normalization' },
          {
            $set: {
              status: 'normalized',
              'normalization.codeDefDgi': `DEF-${invoiceId.slice(-6)}`,
              // Verrou ADR-0024 § 4.3 : pas de « facture » sans code DEF/DGI ni QR code.
              'normalization.qrCode': `QR-${invoiceId.slice(-6)}`,
              'normalization.nim': NIM,
              'normalization.normalizedAt': new Date(),
            },
          },
          { session },
        );
    });
  }

  /** Faux S25f : refus définitif, numéro rendu. */
  async function refuser(organizationId: string, invoiceId: string, rendre = true) {
    await inFiscalTransaction(connection(), async (session) => {
      let released = false;
      if (rendre) {
        released = (await numbering().release(organizationId, invoiceId, { session })).released;
      }
      await connection()
        .collection('sales_invoices')
        .updateOne(
          { _id: new ObjectId(invoiceId) },
          {
            $set: {
              status: 'normalization_failed',
              ...(released ? { 'normalization.reservedNumber': null } : {}),
              'normalization.lastError': { code: 'X', message: 'Refus simulé' },
            },
          },
          { session },
        );
    });
  }

  async function docEnBase(id: string) {
    return db.collection('sales_invoices').findOne({ _id: new ObjectId(id) });
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: { [JETON]: { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' } },
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);
    // S25f est SIMULÉ dans cette suite (faux S25f ci-dessus) : la normalisation
    // réelle (ADR-0024, F2) est court-circuitée et a sa propre suite
    // (`normalization.e2e.test.ts`).
    vi.spyOn(
      app.get<SalesInvoiceNormalizer>(SALES_INVOICE_NORMALIZER),
      'normalizeNow',
    ).mockResolvedValue('deferred');
    // Un seul port d'écoute : sans cela, supertest ouvre un serveur par requête et
    // cinquante requêtes simultanées finissent en ECONNRESET.
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    for (const c of [...ROLES, 'ownerB', 'ownerN', 'superAdmin'] as const) {
      emails[c] = `factures-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Fact ${c}` });
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
    orgN = await orgDe('ownerN');
    await orgDe('superAdmin');
    const session = await request(server())
      .get('/auth/get-session')
      .set('Cookie', cookies['superAdmin']);
    await db.collection('platform_roles').insertOne({
      userId: String(session.body.user.id),
      role: 'platform_super_admin',
      grantedBy: null,
      reason: 'e2e factures',
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Fiches fiscales (vendeur), A et B en mode ordinaire.
    for (const [c, nif] of [
      [asA('owner'), 'A1111111X'],
      [asB(), 'B2222222X'],
      [asN(), NIF_N],
    ] as const) {
      const res = await put(c, '/organizations/current/fiscal-profile', fiche(nif));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }

    // Organisation N : point de vente testé contre le faux e-MCF, puis activation.
    const reauth = async () => {
      const r = await post(cookies['ownerN'], '/me/reauth', { password: MOT_DE_PASSE });
      expect(r.status).toBe(200);
    };
    await reauth();
    const pos = await post(asN(), '/organizations/current/normalized-invoicing/points-of-sale', {
      label: 'Boutique',
      environment: 'test',
      expectedNim: null,
      token: JETON,
    });
    expect(pos.status, JSON.stringify(pos.body)).toBe(201);
    await reauth();
    const act = await post(asN(), '/organizations/current/normalized-invoicing/activate', {
      environment: 'test',
    });
    expect(act.status, JSON.stringify(act.body)).toBe(200);

    customerPM = (
      await post(asA('owner'), '/sales/customers', {
        type: 'PM',
        name: 'Client Exemple SARL',
        nif: `T${tag.toUpperCase()}01`,
      })
    ).body.id;
    customerAO = (
      await post(asA('owner'), '/sales/customers', {
        type: 'AO',
        name: 'Ambassade Exemple',
        exemptionReference: 'EXO-2026-17',
      })
    ).body.id;
    const article = (body: Record<string, unknown>) =>
      post(asA('owner'), '/sales/catalog-items', {
        code: null,
        name: 'Article',
        itemType: 'BIE',
        taxGroup: 'B',
        outOfScope: false,
        unitPrice: '116.00',
        priceMode: 'ttc',
        currency: 'CDF',
        unit: 'pièce',
        specificTax: null,
        ...body,
      });
    const a1 = await article({ code: 'LAIT-CDF' });
    expect(a1.status, JSON.stringify(a1.body)).toBe(201);
    itemCdf = a1.body.id;
    const a2 = await article({ code: 'LICENCE-USD', currency: 'USD', unitPrice: '50.00' });
    expect(a2.status, JSON.stringify(a2.body)).toBe(201);
    itemUsd = a2.body.id;
  }, 240_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, 60_000);

  // ── Prérequis : aucun instantané de taux ─────────────────────────────────

  describe('sans taux DGI relevés', () => {
    it('le brouillon s’enregistre (pro forma) ; l’émission → 409 TAX_RATES_UNAVAILABLE', async () => {
      const d = await brouillon(asA('owner'), corps());
      expect(d.status).toBe('draft');
      expect(d.documentAmounts.calculation).toMatchObject({ ok: false, totals: null });
      expect(d.readiness.blockers.map((b: { code: string }) => b.code)).toContain(
        'TAX_RATES_UNAVAILABLE',
      );
      const res = await post(asA('owner'), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TAX_RATES_UNAVAILABLE');
      expect((await docEnBase(d.id))?.['status']).toBe('draft');
    });

    it('taux de référence absent → GET 404', async () => {
      const res = await get(asA('viewer'), '/sales/exchange-rate-reference');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('EXCHANGE_RATE_REFERENCE_UNAVAILABLE');
    });

    it('relève les instantanés : groupes A–S (forme réelle du 19 oct.), taux USD périmé', async () => {
      await instantane('taxGroups', {
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
        q: 8,
        r: 8,
        s: 0,
      });
      // Relevé il y a trois jours : trop ancien pour servir de référence.
      await instantane(
        'currencyRates',
        [
          {
            type: 'USD',
            description: 'United States Dollar',
            date: '2026-10-16T00:00:00+01:00',
            rate: 2250,
          },
        ],
        new Date(Date.now() - 3 * 24 * 3600 * 1000),
      );
      expect((await get(asA('viewer'), '/sales/exchange-rate-reference')).status).toBe(404);
    });
  });

  // ── Brouillons ────────────────────────────────────────────────────────────

  describe('brouillons (pro forma)', () => {
    it('référence PF-, jamais de numéro ; montants USD calculés par le moteur', async () => {
      const d = await brouillon(asA('accountant'), corps());
      expect(d.proformaRef).toMatch(/^PF-\d{4}-\d{6}$/);
      expect(d).toMatchObject({
        status: 'draft',
        documentKind: 'proforma',
        documentLabel: 'Pro forma — non valable comme facture',
        number: null,
        series: null,
        currency: 'USD',
        revision: 1,
      });
      expect(d.documentAmounts.label).toBe('Montants du document (USD)');
      expect(d.documentAmounts.calculation.totals).toMatchObject({
        total: '92.80',
        vatTotal: '12.80',
      });
      expect(d.lines[0]).toMatchObject({ amount: '80.00', edefCode: 'CONSEIL-H' });
      expect(d.readiness).toMatchObject({ action: 'issue', ready: false });
      // Aucun paiement saisi : signalé par le moteur (`checkPayments`).
      expect(d.readiness.blockers.map((b: { code: string }) => b.code)).toContain('NO_PAYMENTS');
    });

    it('formes refusées : montant en nombre, groupe Q, commentaire B, avoir sans nature', async () => {
      const r1 = await post(
        asA('owner'),
        '/sales/invoices',
        corps({ lines: [{ ...LIGNE, unitPrice: 40 }] }),
      );
      expect(r1.status).toBe(400);
      expect(codes(r1)).toContain('DECIMAL_MUST_BE_STRING');
      const r2 = await post(
        asA('owner'),
        '/sales/invoices',
        corps({ lines: [{ ...LIGNE, taxGroup: 'Q' }] }),
      );
      expect(codes(r2)).toContain('UNKNOWN_TAX_GROUP');
      const r3 = await post(
        asA('owner'),
        '/sales/invoices',
        corps({ comments: { A: null, B: 'x', C: null } }),
      );
      expect(codes(r3)).toContain('COMMENT_LINE_RESERVED');
      const r4 = await post(asA('owner'), '/sales/invoices', corps({ type: 'FA' }));
      expect(codes(r4)).toContain('CREDIT_NOTE_REQUIRED_FOR_TYPE');
      const r5 = await post(
        asA('owner'),
        '/sales/invoices',
        corps({ lines: Array(201).fill(LIGNE) }),
      );
      expect(codes(r5)).toContain('LINE_LIMIT_EXCEEDED');
      const r6 = await post(
        asA('owner'),
        '/sales/invoices',
        corps({ customer: { customerId: null, walkIn: { name: 'X', type: 'PM' } } }),
      );
      expect(codes(r6)).toContain('WALK_IN_MUST_BE_PP');
    });

    it('article CDF dans un document USD : prix à saisir (CATALOG_CURRENCY_MISMATCH) ; article USD repris', async () => {
      const r = await post(
        asA('owner'),
        '/sales/invoices',
        corps({
          lines: [
            {
              source: 'catalog',
              catalogItemId: itemCdf,
              quantity: '1',
              unitPrice: null,
              discount: null,
            },
          ],
        }),
      );
      expect(r.status).toBe(400);
      expect(codes(r)).toContain('CATALOG_CURRENCY_MISMATCH');
      const ok = await brouillon(
        asA('owner'),
        corps({
          lines: [
            {
              source: 'catalog',
              catalogItemId: itemCdf,
              quantity: '1',
              unitPrice: '10.00',
              discount: null,
            },
            {
              source: 'catalog',
              catalogItemId: itemUsd,
              quantity: '1',
              unitPrice: null,
              discount: null,
            },
          ],
        }),
      );
      expect(ok.lines[0]).toMatchObject({ unitPrice: '10.00', priceOverridden: true });
      // Article USD saisi TTC (50,00), document HT : conversion par le moteur.
      expect(ok.lines[1]).toMatchObject({ unitPrice: '43.10', priceOverridden: false });
    });

    it('remise en montant : libellé dans la devise du document', async () => {
      const d = await brouillon(
        asA('owner'),
        corps({ lines: [{ ...LIGNE, discount: { kind: 'total_amount', value: '10.00' } }] }),
      );
      expect(d.lines[0]).toMatchObject({ originalPrice: '40.00', unitPrice: '35.00' });
      expect(d.lines[0].priceModification).toContain('USD');
    });

    it('client AO : commentaire A automatique « Réf. Exo. : … »', async () => {
      const d = await brouillon(
        asA('owner'),
        corps({
          customer: { customerId: customerAO, printContactDetails: false },
          comments: { A: 'autre', C: 'Acompte FT' },
        }),
      );
      expect(d.comments).toMatchObject({ A: 'Réf. Exo. : EXO-2026-17', C: 'Acompte FT', B: null });
    });

    it('PUT révision périmée → 409 STALE_REVISION ; DELETE d’un brouillon → 204', async () => {
      const d = await brouillon(asA('owner'), corps());
      const stale = await put(asA('owner'), `/sales/invoices/${d.id}`, {
        ...corps(),
        expectedRevision: 9,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_REVISION');
      expect((await del(asA('owner'), `/sales/invoices/${d.id}`)).status).toBe(204);
      expect((await get(asA('owner'), `/sales/invoices/${d.id}`)).status).toBe(404);
    });
  });

  // ── Émission, mode ordinaire ─────────────────────────────────────────────

  describe('émission (organisation ordinaire)', () => {
    let emise: Record<string, any>;

    it('paiements ≠ total → 422 INVOICE_NOT_ISSUABLE (PAYMENTS_TOTAL_MISMATCH)', async () => {
      const d = await brouillon(
        asA('owner'),
        corps({ payments: [{ method: 'ESPECES', amount: '10.00' }] }),
      );
      const res = await post(asA('owner'), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVOICE_NOT_ISSUABLE');
      expect(codes(res)).toContain('PAYMENTS_TOTAL_MISMATCH');
    });

    it('émet : facture, numéro définitif, contenu figé, taux A–P seulement, markInvoiced', async () => {
      emise = await emettre(asA('owner'));
      const year = fiscalYearOf(new Date());
      expect(emise).toMatchObject({
        status: 'issued',
        documentKind: 'invoice',
        documentLabel: 'Facture',
        number: `${year}-000001`,
        series: 'real',
        fiscalYear: year,
        emissionMode: 'standard',
        environment: null,
      });
      expect(emise.seller).toMatchObject({ nif: 'A1111111X', legalName: 'Exemple SARL' });
      expect(emise.operator.userId).not.toBe('');
      expect(emise.taxRates).toMatchObject({ source: 'dgi_snapshot', environment: 'test' });
      const enBase = await docEnBase(emise.id);
      expect(Object.keys(enBase?.['taxRates']?.['rates'] ?? {}).join('')).toBe('ABCDEFGHIJKLMNOP');
      expect(enBase?.['calculationVersion']).toBe('1.1.0');
      expect(enBase?.['roundingPolicyId']).toBe('dgi-cd-2026.2');
      expect(contentSha256Of(enBase as Record<string, unknown>)).toBe(enBase?.['contentSha256']);
      const client = await db.collection('customers').findOne({ _id: new ObjectId(customerPM) });
      expect(client?.['firstInvoicedAt']).toBeInstanceOf(Date);
    });

    it('immuable : PUT et DELETE → 409 INVOICE_NOT_DRAFT', async () => {
      const p = await put(asA('owner'), `/sales/invoices/${emise.id}`, {
        ...corps(),
        expectedRevision: emise.revision,
      });
      expect(p.status).toBe(409);
      expect(p.body.code).toBe('INVOICE_NOT_DRAFT');
      const d = await del(asA('owner'), `/sales/invoices/${emise.id}`);
      expect(d.status).toBe(409);
    });

    it('idempotence : même révision rejouée → 200, même numéro, une seule entrée de journal', async () => {
      const avant = await db
        .collection('sales_invoice_journal')
        .countDocuments({ organizationId: orgA });
      const res = await post(asA('owner'), `/sales/invoices/${emise.id}/issue`, {
        expectedRevision: emise.revision - 1,
      });
      expect(res.status).toBe(200);
      expect(res.body.number).toBe(emise.number);
      expect(
        await db.collection('sales_invoice_journal').countDocuments({ organizationId: orgA }),
      ).toBe(avant);
      const autre = await post(asA('owner'), `/sales/invoices/${emise.id}/issue`, {
        expectedRevision: 99,
      });
      expect(autre.status).toBe(409);
      expect(autre.body.code).toBe('INVOICE_NOT_DRAFT');
    });

    it('normaliser dans une organisation ordinaire → 409 NORMALIZATION_NOT_ENABLED', async () => {
      const d = await brouillonPret(asA('owner'), corps());
      const res = await post(asA('owner'), `/sales/invoices/${d.id}/normalize`, {
        expectedRevision: d.revision,
        exchangeRate: null,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NORMALIZATION_NOT_ENABLED');
    });

    it('audit sans donnée personnelle du client', async () => {
      const ev = await db
        .collection('audit_events')
        .findOne({ organizationId: orgA, action: 'sales_invoice.issued', targetId: emise.id });
      expect(ev?.['metadata']).toMatchObject({ type: 'FV', mode: 'standard', currency: 'USD' });
      expect(JSON.stringify(ev)).not.toContain('Client Exemple');
    });

    it('50 émissions concurrentes → numéros contigus sans doublon, dates croissantes, journal sans trou', async () => {
      const drafts: Record<string, any>[] = [];
      for (let i = 0; i < 50; i += 1) {
        if (i % 20 === 0) clearThrottle();
        drafts.push(await brouillonPret(asA('owner'), corps()));
      }
      clearThrottle();
      const res = await Promise.all(
        drafts.map((d) =>
          post(asA('accountant'), `/sales/invoices/${d.id}/issue`, {
            expectedRevision: d.revision,
          }),
        ),
      );
      for (const r of res) expect(r.status, JSON.stringify(r.body)).toBe(200);
      const all = await db
        .collection('sales_invoices')
        .find({ organizationId: orgA, status: 'issued' })
        .sort({ number: 1 })
        .toArray();
      const seqs = all.map((d) => Number.parseInt(String(d['number']).slice(5), 10));
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
      expect(seqs.length).toBeGreaterThanOrEqual(51);
      for (let i = 1; i < all.length; i += 1) {
        expect((all[i]!['issuedAt'] as Date).getTime()).toBeGreaterThanOrEqual(
          (all[i - 1]!['issuedAt'] as Date).getTime(),
        );
      }
      const journal = await get(asA('viewer'), '/sales/journal?limit=200');
      expect(journal.status).toBe(200);
      expect(journal.body.chainValid).toBe(true);
      const seqJ = (journal.body.items as { seq: number }[]).map((e) => e.seq).reverse();
      expect(seqJ).toEqual(Array.from({ length: seqJ.length }, (_, i) => i + 1));
    });

    it('liste : statut final, recherche par numéro, curseur', async () => {
      const page = await get(asA('viewer'), '/sales/invoices?status=final&limit=10');
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(10);
      expect(page.body.nextCursor).not.toBeNull();
      const suite = await get(
        asA('viewer'),
        `/sales/invoices?status=final&limit=10&cursor=${page.body.nextCursor}`,
      );
      const ids = new Set(
        [...page.body.items, ...suite.body.items].map((i: { id: string }) => i.id),
      );
      expect(ids.size).toBe(20);
      const q = await get(asA('viewer'), `/sales/invoices?q=${emise.number}`);
      expect(q.body.items.map((i: { id: string }) => i.id)).toContain(emise.id);
      // La série du numéro est dans le résumé de liste (badge « TEST » du web).
      const ligne = q.body.items.find((i: { id: string }) => i.id === emise.id);
      expect(ligne.series).toBe('real');
      expect((await get(asA('viewer'), '/sales/invoices?cursor=zzz')).body.code).toBe(
        'INVALID_CURSOR',
      );
    });
  });

  // ── Numérotation (service) ───────────────────────────────────────────────

  describe('numérotation', () => {
    it('31 déc. 23 h 59 et 1ᵉʳ janv. 0 h 00 à Kinshasa → deux années', async () => {
      const org = `org-annee-${tag}`;
      const a = await inFiscalTransaction(connection(), (session) =>
        numbering().assignOnIssue(org, { session, now: new Date('2030-12-31T23:59:00+01:00') }),
      );
      const b = await inFiscalTransaction(connection(), (session) =>
        numbering().assignOnIssue(org, { session, now: new Date('2031-01-01T00:00:00+01:00') }),
      );
      expect(a).toMatchObject({ number: '2030-000001', fiscalYear: 2030 });
      expect(b).toMatchObject({ number: '2031-000001', fiscalYear: 2031 });
    });

    it('échec après l’incrément → aucun numéro consommé', async () => {
      const org = `org-echec-${tag}`;
      await expect(
        inFiscalTransaction(connection(), async (session) => {
          await numbering().assignOnIssue(org, { session });
          throw new Error('échec injecté');
        }),
      ).rejects.toThrow('échec injecté');
      const n = await inFiscalTransaction(connection(), (session) =>
        numbering().assignOnIssue(org, { session }),
      );
      expect(n.number).toMatch(/-000001$/);
    });

    it('deux organisations → séries indépendantes', async () => {
      const d = await emettre(
        asB(),
        corps({ customer: { customerId: null, walkIn: { name: null } } }),
      );
      expect(d.number).toMatch(/-000001$/);
      expect(d.customer).toMatchObject({ customerId: null, type: 'PP' });
    });
  });

  // ── Mode normalisé ───────────────────────────────────────────────────────

  describe('organisation en facture normalisée', () => {
    const corpsN = (extra: Record<string, unknown> = {}) =>
      corps({ customer: { customerId: null, walkIn: { name: 'Client comptoir' } }, ...extra });

    it('taux de référence périmé → normaliser 409 EXCHANGE_RATE_REFERENCE_UNAVAILABLE', async () => {
      const d = await brouillonPret(asN(), corpsN());
      expect(d.readiness.action).toBe('normalize');
      expect(d.pointOfSaleId).not.toBeNull();
      const res = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
        expectedRevision: d.revision,
        exchangeRate: null,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('EXCHANGE_RATE_REFERENCE_UNAVAILABLE');
      await instantane('currencyRates', [
        {
          type: 'USD',
          description: 'United States Dollar',
          date: '2026-10-19T00:00:00+01:00',
          rate: 2262.32,
        },
      ]);
      const ref = await get(asN(), '/sales/exchange-rate-reference');
      expect(ref.body).toMatchObject({ currency: 'USD', rate: TAUX, tolerancePercent: '1' });
    });

    it('émettre → 409 NORMALIZATION_REQUIRED', async () => {
      const d = await brouillonPret(asN(), corpsN());
      const res = await post(asN(), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NORMALIZATION_REQUIRED');
    });

    it('normaliser un document USD : pro forma, aucun numéro, deux jeux de montants étiquetés', async () => {
      const n = await normaliser(corpsN());
      expect(n).toMatchObject({
        status: 'pending_normalization',
        documentKind: 'proforma',
        documentLabel: 'Pro forma — non valable comme facture',
        number: null,
        series: null,
        emissionMode: 'normalized',
        environment: 'test',
      });
      expect(n.isf).not.toBeNull();
      expect(n.conversion).toMatchObject({
        from: 'USD',
        to: 'CDF',
        rate: TAUX,
        rateSource: 'dgi_currency_rates',
        conversionVersion: '1.0.0',
      });
      expect(n.normalizedAmounts.label).toBe('Montants normalisés (CDF) — font foi');
      expect(n.normalizedAmounts.currency).toBe('CDF');
      // 40,00 USD × 2 262,32 = 90 492,80 CDF (cas de référence d'E1).
      expect(n.normalizedAmounts.lines[0].unitPrice).toBe('90492.80');
      expect(n.normalizedAmounts.counterValueUsd).toMatchObject({ rate: TAUX });
      const paid = n.normalizedAmounts.payments.map((p: { amount: string }) => p.amount);
      expect(paid).toEqual([n.normalizedAmounts.calculation.total]);
      expect(n.normalization).toMatchObject({
        attempts: 0,
        reservedNumber: null,
        codeDefDgi: null,
      });
      // Correspondance § S25e.10 : tout ce que S25f enverra est présent.
      const enBase = await docEnBase(n.id);
      expect(enBase?.['seller']?.['nif']).toBe(NIF_N);
      expect(enBase?.['operator']).not.toBeNull();
      expect(enBase?.['priceMode']).toBe('ht');
      expect(enBase?.['normalization']?.['pointOfSaleId']).toBe(n.pointOfSaleId);
      expect(contentSha256Of(enBase as Record<string, unknown>)).toBe(enBase?.['contentSha256']);
    });

    it('taux saisi hors ±1 % → 422 ; dans la tolérance → user_within_tolerance', async () => {
      const d = await brouillonPret(asN(), corpsN());
      const hors = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
        expectedRevision: d.revision,
        exchangeRate: { rate: '2400.00', date: '2026-10-19' },
      });
      expect(hors.status).toBe(422);
      expect(codes(hors)).toContain('EXCHANGE_RATE_OUT_OF_TOLERANCE');
      const ok = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
        expectedRevision: d.revision,
        exchangeRate: { rate: '2270.00', date: '2026-10-19' },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.conversion).toMatchObject({
        rate: '2270',
        rateSource: 'user_within_tolerance',
      });
    });

    it('document CDF : conversion identité ; contre-valeur USD sur demande', async () => {
      const cdf = await normaliser(corpsN({ currency: 'CDF' }));
      expect(cdf.conversion).toMatchObject({ from: 'CDF', rate: '1', rateSource: 'identity' });
      expect(cdf.normalizedAmounts.counterValueUsd).toBeNull();
      expect(cdf.normalizedAmounts.calculation.total).toBe(
        cdf.documentAmounts.calculation.totals.total,
      );
      const avec = await normaliser(corpsN({ currency: 'CDF', showUsdCounterValue: true }));
      expect(avec.normalizedAmounts.counterValueUsd).toMatchObject({ rate: TAUX });
    });

    it('deux « Normaliser » simultanés → un seul gel, deux 200 identiques', async () => {
      const d = await brouillonPret(asN(), corpsN());
      const avant = await db
        .collection('sales_invoice_journal')
        .countDocuments({ organizationId: orgN });
      const [a, b] = await Promise.all(
        [0, 1].map(() =>
          post(asN(), `/sales/invoices/${d.id}/normalize`, {
            expectedRevision: d.revision,
            exchangeRate: null,
          }),
        ),
      );
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.revision).toBe(b.body.revision);
      expect(a.body.normalizedAmounts).toEqual(b.body.normalizedAmounts);
      expect(
        await db.collection('sales_invoice_journal').countDocuments({ organizationId: orgN }),
      ).toBe(avant + 1);
    });

    it('faux S25f : un seul bail, numéro rendu puis repris, confirmé → facture TEST-', async () => {
      const x = await normaliser(corpsN());
      const y = await normaliser(corpsN());
      const rx = await reserver(orgN, x.id);
      expect(rx.number).toMatch(/^TEST-\d{4}-000001$/);
      await expect(reserver(orgN, y.id)).rejects.toMatchObject({
        response: { code: 'NORMALIZATION_IN_PROGRESS' },
      });
      // Rejeu : même numéro.
      expect((await reserver(orgN, x.id)).number).toBe(rx.number);
      // Refus : numéro rendu, le suivant le reprend.
      await refuser(orgN, x.id);
      const ry = await reserver(orgN, y.id);
      expect(ry.number).toBe(rx.number);
      // Pro forma tant que S25f n'a pas confirmé : le numéro réservé n'est pas exposé comme numéro.
      expect((await get(asN(), `/sales/invoices/${y.id}`)).body.number).toBeNull();
      await inFiscalTransaction(connection(), async (session) => {
        await numbering().confirm(orgN, y.id, new Date(), { session });
        await connection()
          .collection('sales_invoices')
          .updateOne(
            { _id: new ObjectId(y.id) },
            {
              $set: {
                status: 'normalized',
                // Verrou ADR-0024 § 4.3 : éléments de sécurité exigés pour « facture ».
                'normalization.codeDefDgi': 'DEF-Y',
                'normalization.qrCode': 'QR-Y',
              },
            },
            { session },
          );
      });
      const vue = (await get(asN(), `/sales/invoices/${y.id}`)).body;
      expect(vue).toMatchObject({
        status: 'normalized',
        documentKind: 'invoice',
        number: rx.number,
        series: 'test',
      });
      const enBase = await docEnBase(y.id);
      expect(contentSha256Of(enBase as Record<string, unknown>)).toBe(enBase?.['contentSha256']);
    });

    it('numéro réservé qui n’est plus le dernier → conservé par sa facture', async () => {
      const x = await normaliser(corpsN());
      const rx = await reserver(orgN, x.id);
      // Bail expiré : une autre facture prend le suivant.
      await db
        .collection('sales_invoice_counters')
        .updateOne(
          { organizationId: orgN, series: 'test' },
          { $set: { 'inFlight.until': new Date(0) } },
        );
      const y = await normaliser(corpsN());
      const ry = await reserver(orgN, y.id);
      expect(ry.number).not.toBe(rx.number);
      const released = await inFiscalTransaction(connection(), (session) =>
        numbering().release(orgN, x.id, { session }),
      );
      expect(released.released).toBe(false);
      await refuser(orgN, y.id);
    });
  });

  // ── Avoirs ───────────────────────────────────────────────────────────────

  describe('avoirs', () => {
    let origine: Record<string, any>;

    it('règles d’origine : brouillon, type, devise', async () => {
      const draft = await brouillon(asA('owner'), corps());
      const r1 = await post(asA('owner'), `/sales/invoices/${draft.id}/credit-notes`, {
        nature: 'RAM',
        scope: 'remaining',
      });
      expect(r1.body.code).toBe('CREDIT_NOTE_ORIGIN_NOT_FINAL');
      origine = await emettre(asA('owner'), corps({ lines: [{ ...LIGNE, quantity: '3' }] }));
      const ea = await post(
        asA('owner'),
        '/sales/invoices',
        corps({
          type: 'EA',
          creditNote: { nature: 'RAM', originInvoiceId: origine.id },
          lines: [],
        }),
      );
      expect(ea.body.code).toBe('CREDIT_NOTE_ORIGIN_TYPE');
      const devise = await post(
        asA('owner'),
        '/sales/invoices',
        corps({
          type: 'FA',
          currency: 'CDF',
          creditNote: { nature: 'RAM', originInvoiceId: origine.id },
          lines: [],
        }),
      );
      expect(devise.body.code).toBe('CREDIT_NOTE_CURRENCY_MISMATCH');
      const mode = await post(
        asA('owner'),
        '/sales/invoices',
        corps({
          type: 'FA',
          priceMode: 'ttc',
          creditNote: { nature: 'RAM', originInvoiceId: origine.id },
          lines: [],
        }),
      );
      expect(mode.body.code).toBe('CREDIT_NOTE_PRICE_MODE_MISMATCH');
    });

    it('avoir partiel, cumul, dépassement → 422 CREDIT_NOTE_QUANTITY_EXCEEDED', async () => {
      const cn = await post(asA('owner'), `/sales/invoices/${origine.id}/credit-notes`, {
        nature: 'RAM',
        scope: 'empty',
      });
      expect(cn.status, JSON.stringify(cn.body)).toBe(201);
      expect(cn.body).toMatchObject({
        type: 'FA',
        creditNote: { nature: 'RAM', originInvoiceId: origine.id },
      });
      const corpsAvoir = (q: string) =>
        corps({
          type: 'FA',
          creditNote: { nature: 'RAM', originInvoiceId: origine.id },
          lines: [{ source: 'origin', originLineIndex: 0, quantity: q }],
        });
      const a1 = await emettre(asA('owner'), corpsAvoir('1'));
      expect(a1.creditNote).toMatchObject({
        reference: origine.number,
        originNumber: origine.number,
      });
      expect(a1.lines[0]).toMatchObject({ unitPrice: '40.00', source: 'origin' });
      const vue = (await get(asA('owner'), `/sales/invoices/${origine.id}`)).body;
      expect(vue.lines[0]).toMatchObject({ credited: '1', remaining: '2' });
      expect(vue.creditNotes).toHaveLength(2);
      // Deux avoirs concurrents de 2 alors qu'il en reste 2 → un seul gelé.
      const d1 = await brouillonPret(asA('owner'), corpsAvoir('2'));
      const d2 = await brouillonPret(asA('owner'), corpsAvoir('2'));
      const [r1, r2] = await Promise.all(
        [d1, d2].map((d) =>
          post(asA('owner'), `/sales/invoices/${d.id}/issue`, { expectedRevision: d.revision }),
        ),
      );
      expect([r1.status, r2.status].sort()).toEqual([200, 422]);
      expect(codes(r1.status === 422 ? r1 : r2)).toContain('CREDIT_NOTE_QUANTITY_EXCEEDED');
      const rien = await post(asA('owner'), `/sales/invoices/${origine.id}/credit-notes`, {
        nature: 'RAN',
        scope: 'remaining',
      });
      expect(rien.body.code).toBe('CREDIT_NOTE_NOTHING_REMAINING');
      // Le contenu figé de l'origine n'a pas bougé sous les avoirs.
      const enBase = await docEnBase(origine.id);
      expect(contentSha256Of(enBase as Record<string, unknown>)).toBe(enBase?.['contentSha256']);
    });

    it('RRR sans origine → référence « RRR »', async () => {
      const rrr = await emettre(
        asA('owner'),
        corps({ type: 'FA', creditNote: { nature: 'RRR', originInvoiceId: null } }),
      );
      expect(rrr.creditNote).toMatchObject({
        nature: 'RRR',
        reference: 'RRR',
        originInvoiceId: null,
      });
    });

    it('origine USD normalisée : prix CDF recopiés, taux d’origine ; reprise en brouillon restitue', async () => {
      const corpsN = { customer: { customerId: null, walkIn: { name: 'Comptoir' } } };
      const o = await normaliser(corps({ ...corpsN, lines: [{ ...LIGNE, quantity: '3' }] }));
      await reussir(orgN, o.id);
      const draft = await post(asN(), `/sales/invoices/${o.id}/credit-notes`, {
        nature: 'COR',
        scope: 'remaining',
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      const total = draft.body.documentAmounts.calculation.totals.total;
      const ready = await put(asN(), `/sales/invoices/${draft.body.id}`, {
        ...corps({ ...corpsN, type: 'FA', creditNote: { nature: 'COR', originInvoiceId: o.id } }),
        lines: [{ source: 'origin', originLineIndex: 0, quantity: '3' }],
        payments: [{ method: 'VIREMENT', amount: total }],
        expectedRevision: draft.body.revision,
      });
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
      const n = await post(asN(), `/sales/invoices/${draft.body.id}/normalize`, {
        expectedRevision: ready.body.revision,
        exchangeRate: null,
      });
      expect(n.status, JSON.stringify(n.body)).toBe(200);
      const origineVue = (await get(asN(), `/sales/invoices/${o.id}`)).body;
      expect(n.body.normalizedAmounts.lines[0].unitPrice).toBe(
        origineVue.normalizedAmounts.lines[0].unitPrice,
      );
      expect(n.body.conversion).toMatchObject({
        rateSource: 'origin_invoice',
        originInvoiceId: o.id,
        rate: TAUX,
      });
      expect(n.body.creditNote.reference).toBe(`DEF-${o.id.slice(-6)}`);
      expect(origineVue.lines[0]).toMatchObject({ credited: '3', remaining: '0' });

      // Reprise en brouillon : refusée tant que pending ; après un refus S25f, quantités restituées.
      const pending = await post(asN(), `/sales/invoices/${n.body.id}/back-to-draft`, {
        expectedRevision: n.body.revision,
      });
      expect(pending.body.code).toBe('NOT_RETURNABLE_TO_DRAFT');
      await reserver(orgN, n.body.id);
      await refuser(orgN, n.body.id, false);
      const reserve = await get(asN(), `/sales/invoices/${n.body.id}`);
      const bloque = await post(asN(), `/sales/invoices/${n.body.id}/back-to-draft`, {
        expectedRevision: reserve.body.revision,
      });
      expect(bloque.body.code).toBe('NUMBER_RESERVED');
      await refuser(orgN, n.body.id, true);
      const retour = await post(asN(), `/sales/invoices/${n.body.id}/back-to-draft`, {
        expectedRevision: reserve.body.revision,
      });
      expect(retour.status, JSON.stringify(retour.body)).toBe(200);
      expect(retour.body).toMatchObject({
        status: 'draft',
        conversion: null,
        normalizedAmounts: null,
      });
      expect((await get(asN(), `/sales/invoices/${o.id}`)).body.lines[0]).toMatchObject({
        remaining: '3',
      });
      const ev = await db
        .collection('sales_invoice_journal')
        .findOne({ organizationId: orgN, event: 'returned_to_draft' });
      expect(ev?.['invoiceId']).toBe(n.body.id);
    });
  });

  // ── RBAC et isolation ────────────────────────────────────────────────────

  describe('permissions et isolation', () => {
    for (const role of ['owner', 'finance_director', 'accountant'] as const) {
      it(`${role} : brouillon et émission → 200`, async () => {
        const e = await emettre(asA(role));
        expect(e.status).toBe('issued');
      });
    }

    it('admin : brouillon 201, émission 403 sales.invoice', async () => {
      const d = await brouillonPret(asA('admin'), corps());
      const res = await post(asA('admin'), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status).toBe(403);
      expect(res.body.action).toBe('sales.invoice');
    });

    for (const role of ['analyst', 'viewer'] as const) {
      it(`${role} : lecture seule`, async () => {
        expect((await get(asA(role), '/sales/invoices')).status).toBe(200);
        expect((await get(asA(role), '/sales/journal')).status).toBe(200);
        expect((await post(asA(role), '/sales/invoices', corps())).status).toBe(403);
      });
    }

    it('advisor : 403 sur la lecture', async () => {
      expect((await get(asA('advisor'), '/sales/invoices')).status).toBe(403);
    });

    it('autre organisation → 404 sur chaque route ; super-administrateur sans accès → 404', async () => {
      const e = await emettre(asA('owner'));
      const d = await brouillon(asA('owner'), corps());
      const asSuper = [...cookies['superAdmin'], `active_org_id=${orgA}`];
      for (const c of [asB(), asSuper]) {
        expect((await get(c, `/sales/invoices/${e.id}`)).status).toBe(404);
        expect(
          (
            await put(c, `/sales/invoices/${d.id}`, {
              ...corps({ customer: { customerId: null, walkIn: { name: null } } }),
              expectedRevision: 1,
            })
          ).status,
        ).toBe(404);
        expect((await del(c, `/sales/invoices/${d.id}`)).status).toBe(404);
        expect(
          (
            await post(c, `/sales/invoices/${e.id}/credit-notes`, {
              nature: 'RAN',
              scope: 'remaining',
            })
          ).status,
        ).toBe(404);
        expect(
          (await post(c, `/sales/invoices/${d.id}/issue`, { expectedRevision: 1 })).status,
        ).toBe(404);
        expect(
          (
            await post(c, `/sales/invoices/${d.id}/normalize`, {
              expectedRevision: 1,
              exchangeRate: null,
            })
          ).status,
        ).toBe(404);
        expect(
          (await post(c, `/sales/invoices/${d.id}/back-to-draft`, { expectedRevision: 1 })).status,
        ).toBe(404);
        const list = await get(c, `/sales/invoices?q=${e.number}`);
        expect(list.body.items).toHaveLength(0);
      }
      expect((await docEnBase(d.id))?.['status']).toBe('draft');
    });
  });

  // ── Journal (en dernier : altère une entrée) ─────────────────────────────

  describe('journal électronique', () => {
    it('emissionModeOf lit dans la transaction', async () => {
      const mode = await inFiscalTransaction(connection(), (session) =>
        app.get(NormalizedInvoicingService).emissionModeOf(orgN, { session }),
      );
      expect(mode).toBe('normalized');
    });

    it('seq concurrent sans trou ; altération → chainValid false', async () => {
      const journal = app.get(InvoiceJournalService);
      const org = `org-journal-${tag}`;
      const entree = {
        event: 'issued' as const,
        invoiceId: null,
        proformaRef: null,
        number: null,
        series: null,
        type: null,
        creditNature: null,
        originNumber: null,
        documentTotals: null,
        normalizedTotals: null,
        conversion: null,
        contentSha256: null,
        codeDefDgi: null,
        nim: null,
        counters: null,
        actor: null,
      };
      await Promise.all(
        Array.from({ length: 20 }, () =>
          inFiscalTransaction(connection(), (session) => journal.append(org, entree, { session })),
        ),
      );
      expect(await journal.verify(org)).toBe(true);
      const seqs = (
        await db.collection('sales_invoice_journal').find({ organizationId: org }).toArray()
      )
        .map((e) => e['seq'] as number)
        .sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      expect((await get(asA('viewer'), '/sales/journal')).body.chainValid).toBe(true);
      await db
        .collection('sales_invoice_journal')
        .updateOne({ organizationId: orgA, seq: 2 }, { $set: { number: '2026-999999' } });
      expect((await get(asA('viewer'), '/sales/journal')).body.chainValid).toBe(false);
    });
  });

  // ── Assujettissement du vendeur (ADR-0023, amendement du 20 oct. 2026) ────

  describe('vendeur non assujetti à la TVA', () => {
    const corpsB = (extra: Record<string, unknown> = {}) =>
      corps({ customer: { customerId: null, walkIn: { name: null } }, ...extra });
    const corpsN = (extra: Record<string, unknown> = {}) =>
      corps({ customer: { customerId: null, walkIn: { name: 'Client comptoir' } }, ...extra });
    const LIGNE_K = { ...LIGNE, code: 'CONSEIL-K', taxGroup: 'K' };
    const assujetti = async (c: string[], nif: string, vatRegistered: boolean) => {
      const res = await put(c, '/organizations/current/fiscal-profile', {
        ...fiche(nif),
        vatRegistered,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };
    const blockerCodes = (d: Record<string, any>) =>
      (d.readiness.blockers as { code: string }[]).map((b) => b.code);
    let origineB: Record<string, any>;

    it('constat de production : groupe B en brouillon → empêchement visible, totaux calculés', async () => {
      // Facture émise quand l'organisation était assujettie : elle servira d'origine.
      origineB = await emettre(asB(), corpsB());
      await assujetti(asB(), 'B2222222X', false);
      const d = await brouillonPret(asB(), corpsB());
      expect(d.status).toBe('draft');
      expect(d.documentAmounts.calculation.ok).toBe(true);
      expect(d.readiness.ready).toBe(false);
      const b = (d.readiness.blockers as Record<string, any>[]).find(
        (x) => x.code === 'TAX_GROUP_REQUIRES_VAT_REGISTRATION',
      );
      expect(b).toMatchObject({ lineIndex: 0 });
      expect(b?.message).toContain(
        'Votre profil fiscal indique que l’entreprise n’est pas assujettie à la TVA',
      );
      expect(b?.message).toContain('Utilisez le groupe K');
      expect(d.readiness.warnings).toEqual([]);
    });

    it('émettre en groupe B → 422 INVOICE_NOT_ISSUABLE, aucun numéro consommé', async () => {
      const d = await brouillonPret(asB(), corpsB());
      const res = await post(asB(), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVOICE_NOT_ISSUABLE');
      expect(codes(res)).toEqual(['TAX_GROUP_REQUIRES_VAT_REGISTRATION']);
      expect(res.body.details.issues[0]).toMatchObject({
        lineIndex: 0,
        details: { taxGroup: 'B' },
      });
      const enBase = await docEnBase(d.id);
      expect(enBase?.['status']).toBe('draft');
      expect(enBase?.['number'] ?? null).toBeNull();
    });

    it('groupe K → émis normalement, TVA nulle, vendeur figé non assujetti', async () => {
      const d = await brouillonPret(asB(), corpsB({ lines: [LIGNE_K] }));
      expect(blockerCodes(d)).not.toContain('TAX_GROUP_REQUIRES_VAT_REGISTRATION');
      expect(d.readiness).toMatchObject({ ready: true, warnings: [] });
      const res = await post(asB(), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('issued');
      expect(res.body.seller).toMatchObject({ vatRegistered: false });
      expect(res.body.documentAmounts.calculation.totals.vatTotal).toBe('0.00');
    });

    it('la facture déjà émise en B reste intacte et s’annule par un avoir', async () => {
      const enBase = await docEnBase(origineB.id);
      expect(enBase?.['status']).toBe('issued');
      expect(contentSha256Of(enBase as Record<string, unknown>)).toBe(enBase?.['contentSha256']);
      const avoir = await emettre(
        asB(),
        corpsB({
          type: 'FA',
          creditNote: { nature: 'RAN', originInvoiceId: origineB.id },
          lines: [{ source: 'origin', originLineIndex: 0, quantity: '2' }],
        }),
      );
      expect(avoir).toMatchObject({ status: 'issued', type: 'FA' });
      expect(avoir.lines[0]).toMatchObject({ taxGroup: 'B' });
    });

    it('vendeur assujetti en groupe K → avertissement, jamais bloquant', async () => {
      await assujetti(asB(), 'B2222222X', true);
      const d = await brouillonPret(asB(), corpsB({ lines: [LIGNE_K] }));
      expect(d.readiness.ready).toBe(true);
      expect(d.readiness.warnings).toMatchObject([
        { code: 'TAX_GROUP_K_WHILE_VAT_REGISTERED', lineIndex: 0 },
      ]);
      const res = await post(asB(), `/sales/invoices/${d.id}/issue`, {
        expectedRevision: d.revision,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it('normaliser en groupe B pour un vendeur non assujetti → 422, rien n’est envoyé', async () => {
      await assujetti(asN(), NIF_N, false);
      try {
        const d = await brouillonPret(asN(), corpsN());
        expect(blockerCodes(d)).toContain('TAX_GROUP_REQUIRES_VAT_REGISTRATION');
        const res = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
          expectedRevision: d.revision,
          exchangeRate: null,
        });
        expect(res.status).toBe(422);
        expect(codes(res)).toContain('TAX_GROUP_REQUIRES_VAT_REGISTRATION');
        expect((await docEnBase(d.id))?.['status']).toBe('draft');
      } finally {
        await assujetti(asN(), NIF_N, true);
      }
    });
  });
});
