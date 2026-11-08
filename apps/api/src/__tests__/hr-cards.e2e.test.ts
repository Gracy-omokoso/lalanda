// Cartes de service et cartes de visite contre la vraie application (ADR-0069).
//
// Couvre : RBAC (lecture `hr.read`, écriture `hr.manage`, Lecteur refusé) ; photo
// refusée sans consentement, acceptée ensuite, effacée au retrait du consentement ;
// émission, export PDF (QR présent) et PNG 300 dpi ; réémission qui rend l'ancien
// jeton « non valide » ; révocation ; jeton inconnu ou mal formé ⇒ MÊME réponse ;
// photo publique seulement avec second accord ; sortie ⇒ « N'est plus en fonction » ;
// anonymisation ⇒ « Carte non valide » et photo effacée ; isolation entre
// organisations (fiche, lot, profil, paquet) ; lot et planche ; paquet sur mesure.
//
// Le rendu Chromium est remplacé par un témoin (le HTML est capturé et vérifié) :
// la suite ne dépend pas de la présence de Chromium. Le rendu réel est couvert par
// `hr/cards/card-templates.render.test.ts`. Personnes inventées.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { crc32, writeZip } from '../security/zip-reader.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td) >>> 0, 0);
  return Buffer.concat([len, td, c]);
}
/** PNG RVB uni (valide pour la porte d'image et pour le recadrage). */
function png(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc(h * (w * 3 + 1), 0x80);
  for (let y = 0; y < h; y += 1) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function zipDir(dir: string): Buffer {
  const files: Array<{ name: string; data: Buffer }> = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ name: relative(dir, full).split(sep).join('/'), data: readFileSync(full) });
    }
  };
  walk(dir);
  return writeZip(files);
}

e2eSuite('RH — cartes de service et de visite (ADR-0069)', () => {
  let fx: HrFixture;
  let db: Db;
  const objects = new Map<string, Buffer>();
  const rendered: string[] = [];
  const id = { A: '', C: '', X: '' };

  const raw = (c: HrAccount, method: 'put' | 'post', path: string, body: Buffer, type: string) => {
    const agent = request(fx.app.getHttpServer());
    return (method === 'put' ? agent.put(path) : agent.post(path))
      .set('Cookie', fx.as(c))
      .set('content-type', type)
      .send(body);
  };
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const pub = (path: string) => request(fx.app.getHttpServer()).get(path);
  const profile = async (c: HrAccount, employeeId: string) =>
    ok(await fx.get(c, `/hr/employees/${employeeId}/card`));

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-cartes');
    db = fx.db;
    const storage = fx.app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'rh-test';
    storage.putObject = async (bucket, key, body) => {
      objects.set(`${bucket}/${key}`, Buffer.from(body));
    };
    storage.getObject = async (bucket, key) => {
      const o = objects.get(`${bucket}/${key}`);
      return o ? { body: o, contentType: null } : null;
    };
    storage.deleteObject = async (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
    };
    const renderer = fx.app.get(PdfRenderingService);
    renderer.render = async (html: string) => {
      rendered.push(html);
      return Buffer.from(`%PDF-1.4 témoin ${html.length}`);
    };
    renderer.renderPng = async (
      html: string,
      opts: { width: number; height: number; printScale?: number },
    ) => {
      rendered.push(html);
      const s = opts.printScale ?? 1;
      return png(Math.ceil(Math.ceil(opts.width) * s), Math.ceil(Math.ceil(opts.height) * s));
    };

    id.A = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Mbuyi ${tag}`, { jobTitle: 'Chef de quai', employeeNumber: `M-${tag}` }),
      ),
      201,
    )['id'];
    id.C = ok(await fx.post('owner', '/hr/employees', fiche(`Kasongo ${tag}`)), 201)['id'];
    id.X = ok(await fx.post('ownerB', '/hr/employees', fiche(`Autre ${tag}`)), 201)['id'];
  }, 900_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  it('RBAC : le Lecteur ne lit ni n’écrit ; le Responsable RH gère', async () => {
    expect((await fx.get('viewer', `/hr/employees/${id.A}/card`)).status).toBe(403);
    expect((await fx.put('viewer', '/hr/cards/settings', {})).status).toBe(403);
    const p = await profile('hr_manager', id.A);
    expect(p['verification']['issued']).toBe(false);
    expect(p['publicStatus']).toBe('invalid');
    const s = ok(await fx.get('hr_manager', '/hr/cards/settings'));
    expect(s['templates']).toHaveLength(20);
    expect(s['badge']['templateId']).toBe('badge-h-bandeau');
  });

  it('photo : refusée sans consentement, acceptée ensuite, effacée au retrait', async () => {
    code(
      await raw('hr_manager', 'put', `/hr/employees/${id.A}/card/photo`, png(64, 80), 'image/png'),
      409,
      'CARD_PHOTO_CONSENT_REQUIRED',
    );
    let p = ok(
      await fx.put('hr_manager', `/hr/employees/${id.A}/card/consent`, {
        expectedRevision: 0,
        photo: true,
        photoPublic: false,
      }),
    );
    expect(p['consent']['photo']).toBe(true);
    expect(p['consent']['by']).toBe(fx.userIds['hr_manager']);
    p = ok(
      await raw('hr_manager', 'put', `/hr/employees/${id.A}/card/photo`, png(64, 80), 'image/png'),
    );
    expect(p['photo']['width']).toBe(64);
    const photo = await binary(fx.get('owner', `/hr/employees/${id.A}/card/photo`));
    expect(photo.status).toBe(200);
    expect(photo.headers['x-content-type-options']).toBe('nosniff');
    // Retrait du consentement : la photo et son objet disparaissent.
    const doc = await db.collection('hr_card_profiles').findOne({ employeeId: id.A });
    const key = `rh-test/hr-card-photos/${doc!['photo']['objectId']}`;
    expect(objects.has(key)).toBe(true);
    p = ok(
      await fx.put('hr_manager', `/hr/employees/${id.A}/card/consent`, {
        expectedRevision: p['revision'],
        photo: false,
        photoPublic: false,
      }),
    );
    expect(p['photo']).toBeNull();
    expect(objects.has(key)).toBe(false);
    // Nouveau consentement, avec publication sur la page de vérification.
    p = ok(
      await fx.put('hr_manager', `/hr/employees/${id.A}/card/consent`, {
        expectedRevision: p['revision'],
        photo: true,
        photoPublic: true,
      }),
    );
    ok(
      await raw('hr_manager', 'put', `/hr/employees/${id.A}/card/photo`, png(64, 80), 'image/png'),
    );
    const audit = await db
      .collection('audit_events')
      .find({ targetId: id.A, action: /^hr\.card_/ })
      .toArray();
    expect(audit.map((a) => a['action'])).toEqual(
      expect.arrayContaining([
        'hr.card_photo_consent_recorded',
        'hr.card_photo_consent_withdrawn',
        'hr.card_photo_uploaded',
      ]),
    );
  });

  it('carte de service : non émise ⇒ export refusé ; émise ⇒ PDF et PNG 300 dpi avec QR', async () => {
    code(
      await fx.get('owner', `/hr/employees/${id.A}/card/export?kind=badge&format=pdf`),
      409,
      'CARD_NOT_ISSUED',
    );
    const before = await profile('owner', id.A);
    const p = ok(
      await fx.post('hr_manager', `/hr/employees/${id.A}/card/issue`, {
        expectedRevision: before['revision'],
      }),
    );
    expect(p['verification']['issued']).toBe(true);
    expect(p['verification']['serial']).toBe(1);
    expect(p['publicStatus']).toBe('active');
    rendered.length = 0;
    const pdf = await binary(
      fx.get('owner', `/hr/employees/${id.A}/card/export?kind=badge&format=pdf`),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(String(pdf.headers['content-disposition'])).toContain('carte-de-service-');
    expect(rendered[0]).toContain('<svg');
    expect(rendered[0]).toContain(`M-${tag}`);
    const pngRes = await binary(
      fx.get('owner', `/hr/employees/${id.A}/card/export?kind=badge&format=png&face=recto`),
    );
    expect(pngRes.status).toBe(200);
    expect((pngRes.body as Buffer).readUInt32BE(16)).toBe(1011);
    expect((pngRes.body as Buffer).readUInt32BE(20)).toBe(638);
    const visite = await binary(
      fx.get(
        'owner',
        `/hr/employees/${id.A}/card/export?kind=business&format=pdf&template=visite-v-tuile`,
      ),
    );
    expect(visite.status).toBe(200);
    // Le jeton n'entre jamais dans le journal d'audit.
    const token = (await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))![
      'verification'
    ]['token'] as string;
    const audit = await db.collection('audit_events').find({ action: 'hr.card_issued' }).toArray();
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('page publique : en fonction, photo seulement avec second accord ; jeton inconnu ⇒ même réponse', async () => {
    const token = (await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))![
      'verification'
    ]['token'] as string;
    const v = ok(await pub(`/public/cards/${token}`));
    expect(v['valid']).toBe(true);
    expect(v['status']).toBe('active');
    expect(v['statusLabel']).toBe('En fonction');
    expect(v['displayName']).toContain(`Mbuyi ${tag}`);
    expect(v['jobTitle']).toBe('Chef de quai');
    expect(JSON.stringify(v)).not.toContain(`M-${tag}`); // ni matricule
    expect(v['photoUrl']).toContain(`/public/cards/${token}/photo`);
    const photo = await binary(pub(`/public/cards/${token}/photo`));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-security-policy']).toContain('sandbox');

    const unknown = await pub('/public/cards/AbCdEfGhIjKlMnOpQrStUvWx');
    const malformed = await pub('/public/cards/EX-0042');
    expect(unknown.status).toBe(200);
    expect(malformed.status).toBe(200);
    expect(unknown.body).toEqual({ valid: false });
    expect(malformed.body).toEqual({ valid: false });
    expect(unknown.headers['cache-control']).toBe('no-store');
    expect((await pub('/public/cards/AbCdEfGhIjKlMnOpQrStUvWx/photo')).status).toBe(404);

    // Retrait du second accord : plus de photo publique.
    const p = await profile('owner', id.A);
    ok(
      await fx.put('hr_manager', `/hr/employees/${id.A}/card/consent`, {
        expectedRevision: p['revision'],
        photo: true,
        photoPublic: false,
      }),
    );
    expect(ok(await pub(`/public/cards/${token}`))['photoUrl']).toBeNull();
    expect((await pub(`/public/cards/${token}/photo`)).status).toBe(404);
  });

  it('réémission : l’ancienne carte devient « non valide » ; révocation : plus aucune carte', async () => {
    const old = (await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))![
      'verification'
    ]['token'] as string;
    let p = await profile('owner', id.A);
    p = ok(
      await fx.post('hr_manager', `/hr/employees/${id.A}/card/issue`, {
        expectedRevision: p['revision'],
      }),
    );
    expect(p['verification']['serial']).toBe(2);
    expect(ok(await pub(`/public/cards/${old}`))).toEqual({ valid: false });
    const fresh = (await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))![
      'verification'
    ]['token'] as string;
    expect(fresh).not.toBe(old);
    expect(ok(await pub(`/public/cards/${fresh}`))['valid']).toBe(true);
    // Concurrence optimiste.
    code(
      await fx.post('hr_manager', `/hr/employees/${id.A}/card/issue`, { expectedRevision: 1 }),
      409,
      'STALE_CARD_REVISION',
    );

    const c0 = await profile('owner', id.C);
    const c1 = ok(
      await fx.post('owner', `/hr/employees/${id.C}/card/issue`, {
        expectedRevision: c0['revision'],
      }),
    );
    const tokenC = (await db.collection('hr_card_profiles').findOne({ employeeId: id.C }))![
      'verification'
    ]['token'] as string;
    const c2 = ok(
      await fx.post('owner', `/hr/employees/${id.C}/card/revoke`, {
        expectedRevision: c1['revision'],
      }),
    );
    expect(c2['verification']['issued']).toBe(false);
    expect(c2['verification']['revokedAt']).not.toBeNull();
    expect(ok(await pub(`/public/cards/${tokenC}`))).toEqual({ valid: false });
  });

  it('lot : PDF, planche A4 et ZIP de PNG ; badge non émis signalé', async () => {
    rendered.length = 0;
    const lot = await binary(
      fx.post('owner', '/hr/cards/batch', {
        kind: 'business',
        format: 'sheet',
        employeeIds: [id.A, id.C],
      }),
    );
    expect(lot.status).toBe(200);
    expect(rendered[0]).toContain('lx-sheet');
    const zip = await binary(
      fx.post('owner', '/hr/cards/batch', {
        kind: 'business',
        format: 'png-zip',
        employeeIds: [id.A],
      }),
    );
    expect(zip.status).toBe(200);
    expect((zip.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const refus = await fx.post('owner', '/hr/cards/batch', {
      kind: 'badge',
      format: 'pdf',
      employeeIds: [id.A, id.C],
    });
    code(refus, 409, 'CARD_NOT_ISSUED');
    expect(refus.body.details.employeeIds).toEqual([id.C]);
  });

  it('isolation : une fiche, un lot ou une carte d’une autre organisation est introuvable', async () => {
    code(await fx.get('owner', `/hr/employees/${id.X}/card`), 404, 'EMPLOYEE_NOT_FOUND');
    code(
      await fx.post('owner', `/hr/employees/${id.X}/card/issue`, { expectedRevision: 0 }),
      404,
      'EMPLOYEE_NOT_FOUND',
    );
    code(await fx.get('ownerB', `/hr/employees/${id.A}/card`), 404, 'EMPLOYEE_NOT_FOUND');
    code(
      await fx.post('ownerB', '/hr/cards/batch', {
        kind: 'business',
        format: 'pdf',
        employeeIds: [id.A],
      }),
      404,
      'EMPLOYEE_NOT_FOUND',
    );
    expect((await binary(fx.get('ownerB', `/hr/employees/${id.A}/card/photo`))).status).toBe(404);
    // La page publique ne montre que l'organisation de la fiche désignée.
    const x0 = await profile('ownerB', id.X);
    ok(
      await fx.post('ownerB', `/hr/employees/${id.X}/card/issue`, {
        expectedRevision: x0['revision'],
      }),
    );
    const tokenX = (await db.collection('hr_card_profiles').findOne({ employeeId: id.X }))![
      'verification'
    ]['token'] as string;
    const vx = ok(await pub(`/public/cards/${tokenX}`));
    expect(vx['displayName']).toContain(`Autre ${tag}`);
    const orgB = await db.collection('organizations').findOne({ _id: new ObjectId(fx.orgB) });
    expect(vx['organization']['name']).toBe(orgB!['name']);
    // Réglages par organisation.
    const s = ok(await fx.get('owner', '/hr/cards/settings'));
    ok(
      await fx.put('owner', '/hr/cards/settings', {
        expectedRevision: s['revision'],
        badge: { templateId: 'badge-v-arche', variant: 'inverse', accent: '#0f766e' },
        business: { templateId: 'visite-h-nuit', variant: 'brand', accent: null },
        showEmployeeNumber: false,
        badgeVerso: true,
        vcardQr: true,
        address: '12, avenue de l’Exemple, Gombe',
        website: 'www.exemple.cd',
        phone: null,
        slogan: null,
      }),
    );
    expect(ok(await fx.get('ownerB', '/hr/cards/settings'))['badge']['templateId']).toBe(
      'badge-h-bandeau',
    );
    const s2 = ok(await fx.get('owner', '/hr/cards/settings'));
    code(
      await fx.put('owner', '/hr/cards/settings', {
        expectedRevision: s2['revision'],
        badge: { templateId: 'visite-h-nuit', variant: 'brand', accent: null },
        business: { templateId: null, variant: 'brand', accent: null },
        showEmployeeNumber: true,
        badgeVerso: true,
        vcardQr: true,
        address: null,
        website: null,
        phone: null,
        slogan: null,
      }),
      422,
      'CARD_TEMPLATE_KIND_MISMATCH',
    );
  });

  it('sortie ⇒ « N’est plus en fonction » ; anonymisation ⇒ « Carte non valide », photo effacée', async () => {
    const token = (await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))![
      'verification'
    ]['token'] as string;
    const e = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.A) });
    const hier = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const sortie = ok(
      await fx.post('owner', `/hr/employees/${id.A}/exit`, {
        endDate: hier,
        exitCategory: 'resignation',
        expectedRevision: e!['revision'],
      }),
    );
    const v = ok(await pub(`/public/cards/${token}`));
    expect(v['status']).toBe('inactive');
    expect(v['statusLabel']).toBe('N’est plus en fonction');
    const photoKey = `rh-test/hr-card-photos/${(await db.collection('hr_card_profiles').findOne({ employeeId: id.A }))!['photo']['objectId']}`;
    expect(objects.has(photoKey)).toBe(true);
    ok(
      await fx.post('owner', `/hr/employees/${id.A}/anonymize`, {
        confirm: true,
        expectedRevision: sortie['employee']['revision'],
      }),
    );
    expect(ok(await pub(`/public/cards/${token}`))).toEqual({ valid: false });
    const after = await db.collection('hr_card_profiles').findOne({ employeeId: id.A });
    expect(after!['photo']).toBeNull();
    expect(after!['verification']).toBeNull();
    expect(objects.has(photoKey)).toBe(false);
    code(await fx.get('owner', `/hr/employees/${id.A}/card`), 404, 'EMPLOYEE_NOT_FOUND');
  });

  it('paquet sur mesure : installé, listé, utilisable à l’export ; invisible pour une autre organisation', async () => {
    const zip = zipDir(resolve(ROOT, 'docs/cartes/exemple-badge-code'));
    const inst = ok(
      await raw('hr_manager', 'post', '/hr/cards/packages', zip, 'application/zip'),
      201,
    );
    expect(inst['installed']['format']).toBe('code');
    const again = ok(
      await raw('hr_manager', 'post', '/hr/cards/packages', zip, 'application/zip'),
      201,
    );
    expect(again['created']).toBe(false);
    const ref = inst['installed']['templateRef'] as string;
    const c = await profile('owner', id.C);
    ok(
      await fx.post('owner', `/hr/employees/${id.C}/card/issue`, {
        expectedRevision: c['revision'],
      }),
    );
    rendered.length = 0;
    const pdf = await binary(
      fx.get('owner', `/hr/employees/${id.C}/card/export?kind=badge&format=pdf&template=${ref}`),
    );
    expect(pdf.status).toBe(200);
    expect(rendered[0]).toContain('lx-moteur-qr');
    expect(rendered[0]).toContain('lx-modele');
    expect(
      (
        await binary(
          fx.get('ownerB', `/hr/cards/templates/${encodeURIComponent(ref)}/preview?format=png`),
        )
      ).status,
    ).toBe(404);
    const bad = await raw(
      'hr_manager',
      'post',
      '/hr/cards/packages',
      Buffer.from('pas une archive'),
      'application/zip',
    );
    code(bad, 422, 'CARD_PACKAGE_INVALID');
    expect((await raw('viewer', 'post', '/hr/cards/packages', zip, 'application/zip')).status).toBe(
      403,
    );
  });
});
