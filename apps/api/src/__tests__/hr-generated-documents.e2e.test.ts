// Documents RH générés contre la vraie application (ADR-0072).
//
// Couvre : RBAC (générer et prévisualiser `hr.manage`, registre `hr.read`, Lecteur
// refusé) ; attestation rangée dans les documents RH de la fiche, visible du
// collaborateur, téléchargeable ; numéros successifs ATT-AAAA-NNNN, regénération =
// nouvelle pièce (l'ancienne reste) ; aperçu sans tirage ni stockage ; certificat
// refusé sans date de sortie, accepté après la sortie, SANS motif ; adresse
// personnelle refusée sans `hr.sensitive.read`, pièce sensible et chiffrée sinon ;
// réglages (HTML refusé, révision) ; isolation entre organisations ; audit sans
// donnée nominative.
//
// Le rendu Chromium est remplacé par un témoin (le HTML est capturé et vérifié) ; le
// stockage objet par une table en mémoire. Personnes inventées.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';
vi.setConfig({ testTimeout: 180_000 });

const year = Number(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric' }).format(
    new Date(),
  ),
);

const signataire = { name: 'Gracy Exemple', title: 'Directrice générale' };
const attestation = (extra: Record<string, unknown> = {}) => ({
  kind: 'attestation',
  signatory: signataire,
  place: 'Kinshasa',
  issuedOn: '2026-11-08',
  ...extra,
});

e2eSuite('RH — documents générés (ADR-0072)', () => {
  let fx: HrFixture;
  let db: Db;
  const objects = new Map<string, Buffer>();
  const rendered: string[] = [];
  const id = { A: '', S: '', X: '' };

  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-docgen');
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
      return Buffer.from(`%PDF-1.4 témoin ${rendered.length}`);
    };

    id.A = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Mbuyi ${tag}`, {
          firstName: 'Nadia',
          jobTitle: 'Chef de quai',
          employeeNumber: `M-${tag}`,
          startDate: '2023-03-15',
        }),
      ),
      201,
    )['id'];
    id.S = ok(
      await fx.post(
        'owner',
        '/hr/employees',
        fiche(`Kasongo ${tag}`, { jobTitle: 'Magasinier', startDate: '2024-02-01' }),
      ),
      201,
    )['id'];
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

  it('RBAC : le Lecteur ne lit ni ne génère ; le Responsable RH génère', async () => {
    expect((await fx.get('viewer', `/hr/employees/${id.A}/generated-documents`)).status).toBe(403);
    expect(
      (await fx.post('viewer', `/hr/employees/${id.A}/generated-documents`, attestation())).status,
    ).toBe(403);
    expect((await fx.get('viewer', '/hr/generated-documents/settings')).status).toBe(403);
    const s = ok(await fx.get('hr_manager', '/hr/generated-documents/settings'));
    expect(s['templateId']).toBe('classique');
    expect(s['templates']).toHaveLength(3);
    expect(s['revision']).toBe(0);
  });

  it('aperçu : PDF filigrané, aucun numéro tiré, rien de stocké', async () => {
    const before = objects.size;
    const res = await binary(
      fx.post('hr_manager', `/hr/employees/${id.A}/generated-documents/preview`, attestation()),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(String(res.body).startsWith('%PDF-')).toBe(true);
    expect(rendered.at(-1)).toContain('APERÇU — SANS VALEUR');
    expect(rendered.at(-1)).toContain(`ATT-${year}-····`);
    expect(objects.size).toBe(before);
    expect(await db.collection('hr_counters').findOne({ kind: 'ATT' })).toBeNull();
  });

  it('attestation : rangée dans les documents de la fiche, numéros successifs, ancienne gardée', async () => {
    const r1 = ok(
      await fx.post('hr_manager', `/hr/employees/${id.A}/generated-documents`, attestation()),
      201,
    );
    expect(r1['generated']['number']).toBe(`ATT-${year}-0001`);
    expect(r1['document']['category']).toBe('attestation');
    expect(r1['document']['visibleToEmployee']).toBe(true);
    expect(r1['document']['sensitive']).toBe(false);
    const html = rendered.at(-1)!;
    expect(html).toContain('Nadia Mbuyi');
    expect(html).toContain('15 mars 2023');
    expect(html).toContain('Chef de quai');
    expect(html).not.toContain(`M-${tag}`); // matricule : seulement sur choix
    expect(html).not.toContain('APERÇU');

    const r2 = ok(
      await fx.post(
        'hr_manager',
        `/hr/employees/${id.A}/generated-documents`,
        attestation({ title: 'employment', includeEmployeeNumber: true, templateId: 'bandeau' }),
      ),
      201,
    );
    expect(r2['generated']['number']).toBe(`ATT-${year}-0002`);
    expect(rendered.at(-1)).toContain('Attestation d’emploi');
    expect(rendered.at(-1)).toContain(`M-${tag}`);

    const docs = ok(await fx.get('owner', `/hr/employees/${id.A}/documents`));
    const ids = (docs['items'] as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([r1['document']['id'], r2['document']['id']]));
    const file = await binary(fx.get('owner', `/hr/documents/${r1['document']['id']}/file`));
    expect(file.status).toBe(200);
    expect(String(file.body).startsWith('%PDF-')).toBe(true);

    const reg = ok(await fx.get('admin', `/hr/employees/${id.A}/generated-documents`));
    expect((reg['items'] as Array<{ number: string }>).map((g) => g.number)).toEqual([
      `ATT-${year}-0002`,
      `ATT-${year}-0001`,
    ]);

    // Registre et audit : aucune donnée nominative.
    const row = await db
      .collection('hr_generated_documents')
      .findOne({ number: `ATT-${year}-0001` });
    expect(JSON.stringify(row)).not.toContain('Mbuyi');
    const ev = await db
      .collection('audit_events')
      .findOne({ action: 'hr.generated_document.created', targetId: String(row!['_id']) });
    expect(ev).not.toBeNull();
    expect(JSON.stringify(ev)).not.toContain('Mbuyi');
    expect(JSON.stringify(ev)).not.toContain('Kinshasa');
  });

  it('adresse personnelle : refusée sans hr.sensitive.read ; pièce sensible et chiffrée sinon', async () => {
    code(
      await fx.post(
        'admin',
        `/hr/employees/${id.A}/generated-documents`,
        attestation({ includePersonalAddress: true }),
      ),
      403,
      'FORBIDDEN',
    );
    code(
      await fx.post(
        'hr_manager',
        `/hr/employees/${id.A}/generated-documents`,
        attestation({ includePersonalAddress: true }),
      ),
      422,
      'GENERATED_DOC_NO_ADDRESS',
    );
    ok(
      await fx.put('hr_manager', `/hr/employees/${id.A}/private/personalContact`, {
        expectedRevision: 0,
        data: { address: '3, rue Inventée, Kinshasa', emergencyContacts: [] },
      }),
    );
    const r = ok(
      await fx.post(
        'hr_manager',
        `/hr/employees/${id.A}/generated-documents`,
        attestation({ includePersonalAddress: true }),
      ),
      201,
    );
    expect(r['document']['sensitive']).toBe(true);
    expect(r['document']['encrypted']).toBe(true);
    expect(rendered.at(-1)).toContain('3, rue Inventée, Kinshasa');
    // L'admin (sans hr.sensitive.read) ne voit pas la pièce sensible.
    const vus = ok(await fx.get('admin', `/hr/employees/${id.A}/documents`));
    expect((vus['items'] as Array<{ id: string }>).map((d) => d.id)).not.toContain(
      r['document']['id'],
    );
    const reveal = await db
      .collection('audit_events')
      .findOne({ action: 'hr.private.revealed', targetId: id.A });
    expect(reveal).not.toBeNull();
  });

  it('certificat : refusé sans sortie ; après la sortie, mentions de l’art. 79 sans motif', async () => {
    const body = {
      kind: 'certificate',
      signatory: signataire,
      place: 'Kinshasa',
      issuedOn: '2026-11-08',
    };
    code(
      await fx.post('hr_manager', `/hr/employees/${id.S}/generated-documents`, body),
      409,
      'GENERATED_DOC_NO_END_DATE',
    );
    const e = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.S) });
    const hier = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    ok(
      await fx.post('owner', `/hr/employees/${id.S}/exit`, {
        endDate: hier,
        exitCategory: 'dismissal',
        expectedRevision: e!['revision'],
      }),
    );
    // Plus d'attestation pour un collaborateur sorti.
    code(
      await fx.post('hr_manager', `/hr/employees/${id.S}/generated-documents`, attestation()),
      409,
      'GENERATED_DOC_EMPLOYEE_NOT_ACTIVE',
    );
    // Emploi hors de la période de service : refusé.
    code(
      await fx.post('hr_manager', `/hr/employees/${id.S}/generated-documents`, {
        ...body,
        jobs: [{ title: 'Magasinier', from: '2020-01-01', to: hier }],
      }),
      422,
      'GENERATED_DOC_JOB_OUT_OF_SERVICE',
    );
    // Champ inconnu (motif) : refusé par le contrat.
    expect(
      (
        await fx.post('hr_manager', `/hr/employees/${id.S}/generated-documents`, {
          ...body,
          exitReason: 'faute',
        })
      ).status,
    ).toBe(400);
    const r = ok(
      await fx.post('hr_manager', `/hr/employees/${id.S}/generated-documents`, {
        ...body,
        socialSecurityNumber: '1234567',
      }),
      201,
    );
    expect(r['generated']['number']).toBe(`CT-${year}-0001`);
    expect(r['generated']['kind']).toBe('certificate');
    const html = rendered.at(-1)!;
    expect(html).toContain('Certificat de travail');
    expect(html).toContain('Nature des services prestés');
    expect(html).toContain('Magasinier');
    expect(html).toContain('1er février 2024');
    expect(html).toContain('Durée des services');
    expect(html).toContain('1234567');
    for (const interdit of ['licenci', 'dismissal', 'motif', 'salaire', 'Licenciement']) {
      expect(html.toLowerCase()).not.toContain(interdit.toLowerCase());
    }
  });

  it('réglages : HTML refusé, révision contrôlée, introduction personnalisée appliquée', async () => {
    const put = (body: Record<string, unknown>) =>
      fx.put('hr_manager', '/hr/generated-documents/settings', {
        templateId: 'marge',
        place: 'Lubumbashi',
        signatory: signataire,
        attestationIntro: 'Nous confirmons que {nom} occupe le poste de {poste}.',
        attestationClosing: null,
        expectedRevision: 0,
        ...body,
      });
    expect((await put({ attestationIntro: '<b>{nom}</b>' })).status).toBe(400);
    expect((await put({ attestationIntro: 'Salaire : {salaire}' })).status).toBe(400);
    expect((await fx.put('admin', '/hr/generated-documents/settings', {})).status).toBe(400);
    expect((await fx.put('viewer', '/hr/generated-documents/settings', {})).status).toBe(403);
    const s = ok(await put({}));
    expect(s['revision']).toBe(1);
    expect(s['templateId']).toBe('marge');
    code(await put({}), 409, 'STALE_REVISION');
    ok(
      await fx.post('hr_manager', `/hr/employees/${id.A}/generated-documents`, attestation()),
      201,
    );
    expect(rendered.at(-1)).toContain('Nous confirmons que Nadia Mbuyi');
    const row = await db
      .collection('hr_generated_documents')
      .find({ employeeId: id.A })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    expect(row!['templateId']).toBe('marge@1');
  });

  it('isolation : la fiche d’une autre organisation est introuvable', async () => {
    code(
      await fx.post('hr_manager', `/hr/employees/${id.X}/generated-documents`, attestation()),
      404,
      'EMPLOYEE_NOT_FOUND',
    );
    code(
      await fx.get('hr_manager', `/hr/employees/${id.X}/generated-documents`),
      404,
      'EMPLOYEE_NOT_FOUND',
    );
    code(
      await fx.post('ownerB', `/hr/employees/${id.A}/generated-documents/preview`, attestation()),
      404,
      'EMPLOYEE_NOT_FOUND',
    );
    const reg = ok(await fx.get('ownerB', `/hr/generated-documents/settings`));
    expect(reg['revision']).toBe(0);
  });
});
