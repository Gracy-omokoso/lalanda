// Modèles de facture sur mesure contre la vraie application (ADR-0029).
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard →
// contrôleur → validation du paquet → MinIO → MongoDB → gel → moteur de rendu.
// Les factures normalisées le sont par le VRAI client e-MCF contre le FAUX
// serveur e-MCF local : aucun appel à la DGI réelle. Le rendu Chromium est
// remplacé par un double qui renvoie `%PDF-FAKE` suivi du HTML (on y lit le
// modèle, les zones du moteur, les mentions) ; le rendu réel est couvert par
// `templates/custom/custom-templates.render.test.ts`.
//
// Exigences prouvées : RBAC, paquets hostiles refusés avec rapport et sans
// trace, installation, version immuable, aperçu EXEMPLE (PDF, PNG), activation,
// gel (identifiant + version + empreinte), réimpression IDENTIQUE après une
// nouvelle version et un changement de modèle, duplicata figé, isolation entre
// organisations, intégrité (archive altérée ⇒ 409).
//
// Prérequis : MongoDB et MinIO (`S3_*`). BASE DÉDIÉE, supprimée à la fin ;
// objets des paquets supprimés du bucket à la fin. NIF et jetons inventés.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { BrandingService } from '../branding/branding.service.js';
import { startFakeEdefServer, type FakeEdefServer } from '../edef/testing/fake-edef-server.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { TEST_BANNER } from '../sales/documents/invoice-document.model.js';
import { qrCodeSvg } from '../sales/documents/invoice-qr.js';
import { writeZip } from '../security/zip-reader.js';
import { contentSha256Of } from '../sales/invoices/canonical.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
process.env['MONGODB_DB'] = `lalanda_e2e_surmesure_${tag}`;
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

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(HERE, '../../../../docs/modeles-facture/exemple-ocre');

const MOT_DE_PASSE = 'Passw0rd!surmesure';
const NIF_N = 'A0000000X';
const NIF_S = 'S0000000X';
const NIM = 'XX01000001-1';
const JETON = `ANTIFUITE-surmesure-${tag}-0123456789abcdef`;

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

/** Fichiers du paquet d'exemple du dépôt. */
function exemple(): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(EXAMPLE, full).split(sep).join('/'), readFileSync(full));
    }
  };
  walk(EXAMPLE);
  return out;
}

/** Archive du paquet d'exemple, avec des fichiers remplacés et une version donnée. */
function paquet(over: Record<string, string> = {}, version = '1.0.0', racine = ''): Buffer {
  const files = exemple();
  const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
  files.set('manifest.json', Buffer.from(JSON.stringify({ ...manifest, version }, null, 2)));
  for (const [k, v] of Object.entries(over)) files.set(k, Buffer.from(v, 'utf8'));
  return writeZip([...files].map(([name, data]) => ({ name: `${racine}${name}`, data })));
}

function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

e2eSuite('modèles de facture sur mesure (ADR-0029)', () => {
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
  const installer = (c: string[], bytes: Buffer, type = 'application/zip') =>
    request(server())
      .post('/sales/invoice-template-packages')
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
  const activer = async (packageId: string, options: Record<string, unknown> = {}) => {
    const cur = await get(asN(), '/sales/invoice-template-packages');
    const res = await put(asN(), '/sales/invoice-template/custom', {
      packageId,
      options: { palette: null, accent: null, font: null, ...options },
      expectedRevision: cur.body.revision,
    });
    return res;
  };
  const choisirIntegre = async (templateId: string | null) => {
    const cur = await get(asN(), '/sales/invoice-templates');
    const res = await put(asN(), '/sales/invoice-template', {
      templateId,
      options: { palette: null, accent: null, font: null },
      expectedRevision: cur.body.revision,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

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
    vi.spyOn(app.get(PdfRenderingService), 'renderPng').mockImplementation(async (html) =>
      Buffer.from(`PNG-FAKE\n${html}`, 'utf8'),
    );

    for (const c of ['owner', 'analyst', 'ownerS'] as const) {
      emails[c] = `surmesure-${c}-${tag}@lalanda-test.local`;
    }
    const compte = (c: Compte) => ({ email: emails[c], password: MOT_DE_PASSE, name: `SM ${c}` });
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
          for (const a of await d.collection('invoice_template_packages').find().toArray()) {
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

  // ── RBAC et refus ──────────────────────────────────────────────────────────

  it('RBAC : l’analyste consulte la liste, n’installe ni n’active', async () => {
    const list = await get(asN('analyst'), '/sales/invoice-template-packages');
    expect(list.status).toBe(200);
    expect(list.body.packages).toEqual([]);
    expect(list.body.limits.maxArchiveBytes).toBe(3 * 1024 * 1024);
    expect((await installer(asN('analyst'), paquet())).status).toBe(403);
    expect(
      (
        await put(asN('analyst'), '/sales/invoice-template/custom', {
          packageId: 'a'.repeat(32),
          options: { palette: null, accent: null, font: null },
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect(await db.collection('invoice_template_packages').countDocuments()).toBe(0);
  });

  it('paquets hostiles : refusés (422) avec un rapport lisible, rien n’est stocké', async () => {
    const tpl = exemple().get('gabarit.html')!.toString('utf8');
    const css = exemple().get('style.css')!.toString('utf8');
    const cas: Array<[string, Buffer, string]> = [
      [
        'script',
        paquet({ 'gabarit.html': `${tpl}<script>fetch('x')</script>` }),
        'TEMPLATE_TAG_FORBIDDEN',
      ],
      [
        'url externe',
        paquet({ 'style.css': `${css}\n.page { background: url(https://evil.example/p.png); }` }),
        'CSS_VALUE_FORBIDDEN',
      ],
      [
        'masquage de la zone DGI',
        paquet({ 'style.css': `${css}\n.lx-dgi-securite { display: none; }` }),
        'CSS_SELECTOR_FORBIDDEN',
      ],
      [
        'mention retirée',
        paquet({ 'gabarit.html': tpl.replace('{{document.total}}', '') }),
        'TEMPLATE_MENTION_MISSING',
      ],
      [
        'chemin ..',
        writeZip(
          [...exemple()]
            .map(([name, data]) => ({ name, data }))
            .concat([{ name: '../x.txt', data: Buffer.from('x') }]),
        ),
        'PACKAGE_BAD_PATH',
      ],
      [
        'bombe',
        writeZip([{ name: 'gabarit.html', data: Buffer.alloc(1_900_000, 0x20) }]),
        'ZIP_BOMB',
      ],
      ['pas une archive', Buffer.from('<html>bonjour</html>'), 'ZIP_MALFORMED'],
    ];
    for (const [nom, bytes, code] of cas) {
      const res = await installer(asN(), bytes);
      expect(res.status, `${nom} : ${JSON.stringify(res.body).slice(0, 400)}`).toBe(422);
      expect(res.body.code).toBe('TEMPLATE_PACKAGE_INVALID');
      expect(res.body.details.report.ok).toBe(false);
      expect(
        res.body.details.report.errors.map((e: { code: string }) => e.code),
        nom,
      ).toContain(code);
      expect(typeof res.body.details.report.errors[0].message).toBe('string');
    }
    const html = await installer(asN(), paquet(), 'text/html');
    expect(html.status).toBe(415);
    const gros = await installer(asN(), Buffer.alloc(3 * 1024 * 1024 + 10));
    expect(gros.status).toBe(413);
    expect(await db.collection('invoice_template_packages').countDocuments()).toBe(0);
    // Paquet inconnu : introuvable (aperçu, activation).
    expect(
      (await get(asN(), `/sales/invoice-template-packages/${'b'.repeat(32)}/preview`)).status,
    ).toBe(404);
    expect((await activer('b'.repeat(32))).status).toBe(404);
    expect((await activer('pas-un-identifiant')).status).toBe(400);
  });

  // ── Installation, versions, aperçu, activation, gel ────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'installation, version immuable, aperçu, activation, gel et réimpression IDENTIQUE',
    async () => {
      const v1 = await installer(asN(), paquet());
      expect(v1.status, JSON.stringify(v1.body).slice(0, 600)).toBe(201);
      expect(v1.body.created).toBe(true);
      expect(v1.body.report.ok).toBe(true);
      const p1 = v1.body.installed as Record<string, any>;
      expect(p1).toMatchObject({ templateId: 'lalanda.ocre', version: '1.0.0', name: 'Ocre' });
      expect(p1.contentSha256).toBe(v1.body.report.digest);
      const enreg = await db
        .collection('invoice_template_packages')
        .findOne({ packageId: p1.packageId });
      expect(enreg?.['organizationId']).toBe(orgN);
      expect(enreg?.['objectKey']).toBe(`template-packages/${p1.packageId}`);
      expect(String(enreg?.['objectKey'])).not.toContain(orgN);

      // Même version, même contenu (recompressé dans un dossier) : idempotent.
      const encore = await installer(asN(), paquet({}, '1.0.0', 'ocre/'));
      expect(encore.status).toBe(200);
      expect(encore.body.created).toBe(false);
      expect(encore.body.installed.packageId).toBe(p1.packageId);
      // Même version, autre contenu : refus.
      const css = exemple().get('style.css')!.toString('utf8');
      const autre = await installer(
        asN(),
        paquet({ 'style.css': `${css}\n.page { color: #000000; }` }),
      );
      expect(autre.status).toBe(409);
      expect(autre.body.code).toBe('TEMPLATE_VERSION_EXISTS');
      expect(autre.body.message).toContain('1.0.1');

      // Aperçu : facture fictive EXEMPLE, zones du moteur, avant toute activation.
      const ap = await binary(
        get(
          asN('analyst'),
          `/sales/invoice-template-packages/${p1.packageId}/preview?palette=mono`,
        ),
      );
      expect(ap.status).toBe(200);
      expect(ap.headers['content-disposition']).toBe(
        'inline; filename="apercu-modele-lalanda-ocre-1.0.0.pdf"',
      );
      const apercu = text(ap);
      expect(apercu).toContain('data-template="sur-mesure@1.0.0"');
      expect(apercu).toContain('<main class="lx-modele">');
      expect(apercu).toContain('class="dgi-watermark sample">EXEMPLE<');
      expect(apercu).toContain('modèle Ocre (sur mesure) 1.0.0');
      expect(apercu).toContain('Exemple SARL');
      const png = await binary(
        get(asN(), `/sales/invoice-template-packages/${p1.packageId}/preview?format=png`),
      );
      expect(png.status).toBe(200);
      expect(png.headers['content-type']).toContain('image/png');

      // Activation : options contrôlées contre le manifeste.
      const police = await activer(p1.packageId, { font: 'manrope' });
      expect(police.status).toBe(409);
      expect(police.body.code).toBe('FONT_NOT_ALLOWED');
      const ok = await activer(p1.packageId, { accent: '#7c2d12', font: 'source-serif-4' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.current.packageId).toBe(p1.packageId);
      expect(ok.body.packages.find((p: { active: boolean }) => p.active).packageId).toBe(
        p1.packageId,
      );
      const vue = await get(asN(), '/sales/invoice-templates');
      expect(vue.body.current).toMatchObject({
        templateId: 'sur-mesure',
        version: '1.0.0',
        resolved: { palette: 'brand', accent: '#7c2d12', font: 'source-serif-4' },
        package: {
          packageId: p1.packageId,
          id: 'lalanda.ocre',
          version: '1.0.0',
          sha256: p1.contentSha256,
        },
      });

      // Gel : identifiant, version et EMPREINTE du paquet figés.
      const v = await normalisee();
      const doc = await enBase(v.id);
      expect(doc?.['presentation']).toMatchObject({
        template: { id: 'sur-mesure', version: '1.0.0' },
        package: {
          packageId: p1.packageId,
          id: 'lalanda.ocre',
          name: 'Ocre',
          version: '1.0.0',
          sha256: p1.contentSha256,
        },
        options: { palette: 'brand', accent: '#7c2d12', font: 'source-serif-4' },
      });
      expect(contentSha256Of(doc as Record<string, unknown>)).toBe(doc?.['contentSha256']);
      expect((await get(asN(), '/sales/journal')).body.chainValid).toBe(true);

      const original = await pdf(asN(), v.id);
      expect(original.status).toBe(200);
      const avant = text(original);
      expect(avant).toContain('data-template="sur-mesure@1.0.0"');
      expect(avant).toContain('modèle Ocre (sur mesure) 1.0.0');
      const qr = await qrCodeSvg(v.normalization.qrCode);
      const main = avant.indexOf('<main class="lx-modele">');
      const fin = avant.indexOf('</main>');
      const securite = avant.indexOf('<section class="lx-dgi lx-dgi-securite">');
      expect(securite).toBeGreaterThan(fin);
      expect(avant.slice(securite)).toContain(qr);
      expect(avant.slice(securite)).toContain(v.normalization.codeDefDgi);
      expect(avant.slice(0, main)).toContain(TEST_BANNER);
      expect(avant).toContain('class="dgi-watermark">TEST<');
      expect(avant).not.toMatch(/src="https?:/);

      // Nouvelle version, activée ; puis un modèle intégré : rien ne bouge.
      const v2 = await installer(
        asN(),
        paquet({ 'style.css': `${css}\n.page { color: #000000; }` }, '1.0.1'),
      );
      expect(v2.status).toBe(201);
      expect((await activer(v2.body.installed.packageId)).status).toBe(200);
      expect(text(await pdf(asN(), v.id))).toBe(avant);
      const d2 = await brouillonPret(asN(), customerN);
      expect(text(await pdf(asN(), d2.id))).toContain('modèle Ocre (sur mesure) 1.0.1');
      await choisirIntegre('classique');
      expect(text(await pdf(asN(), v.id))).toBe(avant);
      // Le duplicata reprend la présentation FIGÉE.
      const dup = text(await duplicata(asN(), v.id));
      expect(dup).toContain('data-template="sur-mesure@1.0.0"');
      expect(dup).toContain('modèle Ocre (sur mesure) 1.0.0');
      expect(dup).toContain('DUPLICATA n° 1');
      expect(dup.slice(0, dup.indexOf('<main class="lx-modele">'))).toContain('DUPLICATA n° 1');

      const liste = await get(asN(), '/sales/invoice-template-packages');
      expect(liste.body.packages.map((p: { version: string }) => p.version).sort()).toEqual([
        '1.0.0',
        '1.0.1',
      ]);
      expect(liste.body.current).toBeNull();
    },
  );

  // ── Isolation ──────────────────────────────────────────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'isolation : une organisation ne voit, n’active ni n’imprime le paquet d’une autre',
    async () => {
      const pN = (await get(asN(), '/sales/invoice-template-packages')).body.packages[0];
      expect(pN).toBeDefined();
      const listeS = await get(asS(), '/sales/invoice-template-packages');
      expect(listeS.body.packages).toEqual([]);
      expect(
        (await get(asS(), `/sales/invoice-template-packages/${pN.packageId}/preview`)).status,
      ).toBe(404);
      const curS = await get(asS(), '/sales/invoice-template-packages');
      const act = await put(asS(), '/sales/invoice-template/custom', {
        packageId: pN.packageId,
        options: { palette: null, accent: null, font: null },
        expectedRevision: curS.body.revision,
      });
      expect(act.status).toBe(404);
      // Une présentation forgée désignant le paquet de N est refusée pour S.
      const service = app.get(BrandingService);
      const forge = {
        template: { id: 'sur-mesure' as const, version: '1.0.0' },
        package: {
          packageId: pN.packageId as string,
          id: pN.templateId as string,
          name: pN.name as string,
          version: pN.version as string,
          sha256: pN.contentSha256 as string,
        },
        options: { palette: 'brand' as const, accent: '#9a3412', font: 'inter' as const },
        identity: {
          primaryColor: null,
          secondaryColor: null,
          font: null,
          logos: { primary: null, horizontal: null, symbol: null, light: null },
        },
      };
      await expect(service.resolveForRender(orgS, forge)).rejects.toMatchObject({
        response: { code: 'TEMPLATE_PACKAGE_INTEGRITY' },
      });
      await expect(service.resolveForRender(orgN, forge)).resolves.toMatchObject({
        template: { id: 'sur-mesure' },
      });
    },
  );

  // ── Intégrité ──────────────────────────────────────────────────────────────

  it.skipIf(!S3_CONFIGURE)(
    'intégrité : une archive figée altérée bloque la réimpression (409), jamais un faux',
    async () => {
      const v3 = await installer(asN(), paquet({}, '3.0.0'));
      expect(v3.status).toBe(201);
      const p3 = v3.body.installed as Record<string, any>;
      expect((await activer(p3.packageId)).status).toBe(200);
      // Gel SANS rendu préalable : aucune compilation en cache.
      const v = await normalisee();
      const storage = app.get(ObjectStorageService);
      const bucket = storage.uploadsBucket()!;
      const enreg = await db
        .collection('invoice_template_packages')
        .findOne({ packageId: p3.packageId });
      // Archive VALIDE mais différente à la même clé.
      const css = exemple().get('style.css')!.toString('utf8');
      await storage.putObject(
        bucket,
        enreg!['objectKey'] as string,
        paquet({ 'style.css': `${css}\n.page { color: #111111; }` }, '3.0.0'),
        'application/zip',
      );
      const res = await get(asN(), `/sales/invoices/${v.id}/pdf`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEMPLATE_PACKAGE_INTEGRITY');
      await choisirIntegre(null);
    },
  );
});
