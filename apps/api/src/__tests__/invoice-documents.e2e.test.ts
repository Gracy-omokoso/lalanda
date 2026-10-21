// Documents PDF des factures contre la vraie application (ADR-0025, S25g).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB (transactions) → modèle du document → rendu. Les
// factures normalisées le sont par le VRAI client e-MCF contre le FAUX serveur
// e-MCF local : aucun appel à la DGI réelle.
//
// Le rendu Chromium est remplacé par un double qui renvoie `%PDF-FAKE` suivi du
// HTML : la CI n'a pas Chromium (PUPPETEER_SKIP_DOWNLOAD), et le HTML est
// exactement ce que Chromium imprimerait — on y lit les mentions. Le rendu réel
// est couvert par `sales/documents/invoice-pdf.render.test.ts`.
//
// BASE DÉDIÉE, supprimée à la fin. NIF et jetons inventés (marqués ANTIFUITE).

import 'reflect-metadata';

import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { TEST_BANNER } from '../sales/documents/invoice-document.model.js';
import { qrCodeSvg } from '../sales/documents/invoice-qr.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_documents_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 600_000 });

const MOT_DE_PASSE = 'Passw0rd!documents';
const NIF_N = 'A0000000X';
const NIF_S = 'S0000000X';
const NIM = 'XX01000001-1';
const JETON = `ANTIFUITE-documents-${tag}-0123456789abcdef`;

const GROUPES: Record<string, number> = {
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
};

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

type Compte = 'owner' | 'analyst' | 'ownerS';

/** Lit le corps binaire d'une réponse supertest. */
function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

e2eSuite('documents PDF des factures (ADR-0025, S25g)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgN = '';
  let orgS = '';
  let customerN = '';
  let customerS = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asN = (c: 'owner' | 'analyst' = 'owner') => [...cookies[c], `active_org_id=${orgN}`];
  const asS = () => [...cookies['ownerS'], `active_org_id=${orgS}`];
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const pdf = (c: string[], id: string) =>
    binary(request(server()).get(`/sales/invoices/${id}/pdf`).set('Cookie', c));
  const duplicata = (c: string[], id: string) =>
    binary(request(server()).post(`/sales/invoices/${id}/duplicate`).set('Cookie', c).send({}));
  const text = (res: request.Response) => (res.body as Buffer).toString('utf8');
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };
  const enBase = (id: string) => db.collection('sales_invoices').findOne({ _id: new ObjectId(id) });
  const journal = async (id: string) =>
    (
      await db
        .collection('sales_invoice_journal')
        .find({ invoiceId: id })
        .sort({ seq: 1 })
        .toArray()
    ).map((e) => e['event'] as string);

  const corps = (customerId: string) => ({
    type: 'FV',
    currency: 'USD',
    priceMode: 'ht',
    customer: { customerId, printContactDetails: false },
    pointOfSaleId: null,
    lines: [LIGNE],
    payments: [],
    comments: { A: null, C: null },
    creditNote: null,
    showUsdCounterValue: false,
  });

  async function brouillonPret(c: string[], customerId: string) {
    const body = corps(customerId);
    const d = await post(c, '/sales/invoices', body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const total = d.body.documentAmounts.calculation.totals.total as string;
    const res = await put(c, `/sales/invoices/${d.body.id}`, {
      ...body,
      payments: [{ method: 'VIREMENT', amount: total }],
      expectedRevision: d.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  }

  async function normalisee() {
    const d = await brouillonPret(asN(), customerN);
    const res = await post(asN(), `/sales/invoices/${d.id}/normalize`, {
      expectedRevision: d.revision,
      exchangeRate: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('normalized');
    return res.body as Record<string, any>;
  }

  async function instantane(list: string, payload: unknown) {
    await db.collection('edef_reference_snapshots').insertOne({
      environment: 'test',
      list,
      sha256: randomBytes(32).toString('hex'),
      payload,
      fetchedAt: new Date(),
      _schemaVersion: 1,
    });
  }

  beforeAll(async () => {
    fake = await startFakeEdefServer({
      tokens: { [JETON]: { nif: NIF_N, nim: NIM, tokenValid: '2099-01-31T00:00:00' } },
      taxGroups: GROUPES,
    });
    process.env['DGI_EDEF_TEST_URL'] = fake.baseUrl;
    process.env['DGI_EDEF_PRODUCTION_URL'] = 'https://edef.invalid';
    app = await makeE2EApp();
    db = await dbOf(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    // Double du rendu Chromium : `%PDF-FAKE` + le HTML qui serait imprimé.
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html, opts) =>
      Buffer.from(
        `%PDF-FAKE\n${html}\n<!--header-->${opts?.headerTemplate ?? ''}\n<!--footer-->${opts?.footerTemplate ?? ''}`,
        'utf8',
      ),
    );

    for (const c of ['owner', 'analyst', 'ownerS'] as const) {
      emails[c] = `documents-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Doc ${c}` });
    const orgDe = async (c: Compte) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    orgN = await orgDe('owner');
    orgS = await orgDe('ownerS');
    const inv = await request(server())
      .post(`/organizations/${orgN}/invitations`)
      .set('Cookie', cookies['owner'])
      .send({ email: emails['analyst'], role: 'analyst' });
    expect(inv.status).toBe(201);
    cookies['analyst'] = await registerAndLogin(app, compte('analyst'));
    const acc = await request(server())
      .post('/invitations/accept')
      .set('Cookie', cookies['analyst'])
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);

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
      email: 'contact@exemple.cd',
    });
    expect((await put(asN(), '/organizations/current/fiscal-profile', fiche(NIF_N))).status).toBe(
      200,
    );
    expect((await put(asS(), '/organizations/current/fiscal-profile', fiche(NIF_S))).status).toBe(
      200,
    );

    // Organisation N : facture normalisée, environnement de TEST, faux serveur.
    const reauth = async () =>
      expect((await post(cookies['owner'], '/me/reauth', { password: MOT_DE_PASSE })).status).toBe(
        200,
      );
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

    await instantane('taxGroups', GROUPES);
    await instantane('currencyRates', [
      {
        type: 'USD',
        description: 'Dollar (fictif)',
        date: '2026-10-19T00:00:00+01:00',
        rate: 2262.32,
      },
    ]);
    await instantane('clientTypes', [{ type: 'PM', description: 'Personne morale (fictif)' }]);
    await instantane('referenceTypes', [{ type: 'RRR', description: 'Remise (fictif)' }]);

    const cN = await post(asN(), '/sales/customers', {
      type: 'PM',
      name: 'Client Exemple SARL',
      nif: `T${tag.toUpperCase()}01`,
    });
    expect(cN.status, JSON.stringify(cN.body)).toBe(201);
    customerN = cN.body.id;
    const cS = await post(asS(), '/sales/customers', {
      type: 'PM',
      name: 'Client Ordinaire SARL',
      nif: `S${tag.toUpperCase()}02`,
    });
    expect(cS.status, JSON.stringify(cS.body)).toBe(201);
    customerS = cS.body.id;
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) await (await dbOf(app)).dropDatabase();
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, 60_000);

  it('brouillon → PRO FORMA (filigrane de test), pas de duplicata', async () => {
    const d = await brouillonPret(asN(), customerN);
    const res = await pdf(asN(), d.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${d.proformaRef}.pdf"`);
    const t = text(res);
    expect(t.startsWith('%PDF-FAKE')).toBe(true);
    expect(t).toContain('PRO FORMA — non valable comme facture');
    expect(t).toContain(TEST_BANNER);
    expect(t).not.toContain('Facture n°');

    const dup = await duplicata(asN(), d.id);
    expect(dup.status).toBe(409);
    expect(JSON.parse(text(dup)).code).toBe('DUPLICATE_NOT_ALLOWED');
    expect((await enBase(d.id))?.['duplicateCount']).toBe(0);
  });

  it('facture normalisée de test : intitulé, éléments DGI tels que reçus, QR exact, filigrane', async () => {
    const v = await normalisee();
    const res = await pdf(asN(), v.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${v.number}.pdf"`);
    const t = text(res);
    expect(t).toContain('Facture normalisée');
    expect(t).toContain(`Facture n° <b>${v.number}</b>`);
    expect(v.series).toBe('test');
    expect(t).toContain(v.normalization.codeDefDgi);
    expect(t).toContain(v.normalization.nim);
    expect(t).toContain(v.normalization.dgiDateTime);
    expect(t).toContain(await qrCodeSvg(v.normalization.qrCode));
    expect(t).toContain(TEST_BANNER);
    expect(t).toContain('class="test-mark">TEST<');
    expect(t).not.toContain('DUPLICATA');
    // Montants CDF figés, jamais recalculés.
    expect(t).toContain('Montants en francs congolais (CDF) — font foi');
    expect(t).toContain('Contre-valeur');

    // Original répétable, à l'identique ; rien au journal électronique.
    const avant = await journal(v.id);
    const again = await pdf(asN(), v.id);
    expect(text(again)).toBe(t);
    expect(await journal(v.id)).toEqual(avant);
  });

  it('duplicata : n° 1 puis n° 2, incrément atomique, journal, contenu figé intact', async () => {
    const v = await normalisee();
    const avant = await enBase(v.id);

    const d1 = await duplicata(asN(), v.id);
    expect(d1.status, text(d1).slice(0, 300)).toBe(200);
    expect(d1.headers['x-duplicate-number']).toBe('1');
    expect(d1.headers['content-disposition']).toBe(
      `attachment; filename="${v.number}-duplicata-1.pdf"`,
    );
    expect(text(d1)).toContain('DUPLICATA n° 1');
    expect(text(d1)).toContain(`Facture n° <b>${v.number}</b>`);

    const d2 = await duplicata(asN(), v.id);
    expect(d2.headers['x-duplicate-number']).toBe('2');
    expect(text(d2)).toContain('DUPLICATA n° 2');

    const apres = await enBase(v.id);
    expect(apres?.['duplicateCount']).toBe(2);
    expect(apres?.['revision']).toBe(avant?.['revision']);
    expect(apres?.['contentSha256']).toBe(avant?.['contentSha256']);
    expect((await journal(v.id)).filter((e) => e === 'duplicate_issued')).toHaveLength(2);
    const j = await request(server()).get('/sales/journal').set('Cookie', asN());
    expect(j.body.chainValid).toBe(true);
  });

  it('duplicatas simultanés : numéros distincts, aucun perdu', async () => {
    const v = await normalisee();
    const res = await Promise.all([1, 2, 3].map(() => duplicata(asN(), v.id)));
    const nums = res
      .filter((r) => r.status === 200)
      .map((r) => r.headers['x-duplicate-number'])
      .sort();
    expect(res.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    expect(nums.length).toBeGreaterThanOrEqual(1);
    expect(new Set(nums).size).toBe(nums.length);
    expect((await enBase(v.id))?.['duplicateCount']).toBe(nums.length);
    expect((await journal(v.id)).filter((e) => e === 'duplicate_issued')).toHaveLength(nums.length);
  });

  it('rendu saturé (503) : aucun numéro de duplicata consommé, rien au journal', async () => {
    const v = await normalisee();
    vi.mocked(app.get(PdfRenderingService).render).mockRejectedValueOnce(
      new ServiceUnavailableException({ code: 'REPORT_RENDER_BUSY', message: 'saturé' }),
    );
    const res = await duplicata(asN(), v.id);
    expect(res.status).toBe(503);
    expect((await enBase(v.id))?.['duplicateCount']).toBe(0);
    expect(await journal(v.id)).not.toContain('duplicate_issued');
  });

  it('RBAC : l’analyste lit l’original, pas de duplicata (403)', async () => {
    const v = await normalisee();
    expect((await pdf(asN('analyst'), v.id)).status).toBe(200);
    expect((await duplicata(asN('analyst'), v.id)).status).toBe(403);
  });

  it('isolation : un document d’une autre organisation répond 404', async () => {
    const v = await normalisee();
    expect((await pdf(asS(), v.id)).status).toBe(404);
    expect((await duplicata(asS(), v.id)).status).toBe(404);
    expect((await pdf(asS(), 'pas-un-id')).status).toBe(404);
  });

  it('organisation ordinaire : « Facture », sans filigrane de test ni bloc DGI', async () => {
    const d = await brouillonPret(asS(), customerS);
    const res = await post(asS(), `/sales/invoices/${d.id}/issue`, {
      expectedRevision: d.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const doc = await pdf(asS(), d.id);
    expect(doc.status).toBe(200);
    const t = text(doc);
    expect(t).toContain('>Facture<');
    expect(t).not.toContain(TEST_BANNER);
    expect(t).not.toContain('test-mark"');
    expect(t).not.toContain('Éléments de sécurité DGI');
    expect(t).toContain('Montants en dollars américains (USD)');
    const dup = await duplicata(asS(), d.id);
    expect(dup.status).toBe(200);
    expect(text(dup)).toContain('DUPLICATA n° 1');
  });
});
