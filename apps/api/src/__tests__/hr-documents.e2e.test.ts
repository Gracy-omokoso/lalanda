// Documents RH contre la vraie application (ADR-0045 § 2.8, § 3.3 ; critères 13, 19,
// 20). ADR-0045 — H4.
//
// Couvre : PDF de contrat servi en téléchargement INERTE (`attachment`, `sandbox`,
// `nosniff`) ; type refusé (415) ; pièce d'identité SENSIBLE chiffrée côté application
// (l'objet brut ne contient ni `%PDF-` ni le contenu), téléchargement réservé à
// `hr.sensitive.read` et journalisé STRICTEMENT avant de servir (audit en échec ⇒ 503,
// rien de servi) ; l'Administrateur reçoit 403, le manager 403, un autre membre 404 ;
// le salarié voit ses documents visibles et dépose son justificatif ; objet recopié vers
// un autre document indéchiffrable ; suppression ; anonymisation qui efface les
// documents sensibles et garde les autres ; isolation entre organisations.
//
// Pièces inventées.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import { Integration, type IntegrationDocument } from '../integrations/integration.schema.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from '../integrations/organization-secret.schema.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { RewrapService } from '../integrations/rewrap.js';
import { MasterKeyring } from '../integrations/secrets-crypto.js';
import { SecretsService } from '../integrations/secrets.service.js';
import { HrDocumentsService } from '../hr/documents/hr-documents.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
const CLE_K1 = randomBytes(32);
process.env['SECRETS_MASTER_KEY'] = CLE_K1.toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 180_000 });

const MARQUE = `PASSEPORT-OP${tag}77`;
const pdf = (texte: string) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Title (${texte}) >> endobj\ntrailer\n%%EOF\n`, 'latin1');
const CONTRAT = pdf(`Contrat ${tag}`);
const PASSEPORT = pdf(MARQUE);

e2eSuite('RH — documents (ADR-0045 H4)', () => {
  let fx: HrFixture;
  let db: Db;
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  /** B : fiche du Lecteur ; A : son manager (Analyste) ; C : fiche sans compte. */
  const id = { A: '', B: '', C: '' };
  const doc = { contrat: '', passeport: '', justificatif: '', copie: '' };

  /** Envoi `multipart/form-data` : champs de formulaire (écrits ici comme une requête) et partie `file`. */
  const upload = (
    c: HrAccount,
    employeeId: string,
    fields: string,
    body: Buffer,
    fileName = 'piece.pdf',
  ) => {
    const req = request(fx.app.getHttpServer())
      .post(`/hr/employees/${employeeId}/documents`)
      .set('Cookie', fx.as(c));
    for (const [k, v] of new URLSearchParams(fields)) req.field(k, v);
    return req.attach('file', body, {
      filename: fileName,
      contentType: 'application/octet-stream',
    });
  };
  const del = (c: HrAccount, path: string) =>
    request(fx.app.getHttpServer()).delete(path).set('Cookie', fx.as(c));
  const download = (c: HrAccount, documentId: string) =>
    fx
      .get(c, `/hr/documents/${documentId}/file`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const objetDe = async (documentId: string) => {
    const d = await db.collection('hr_documents').findOne({ _id: new ObjectId(documentId) });
    return objects.get(`rh-test/hr-documents/${d!['objectId']}`);
  };

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-docs');
    db = fx.db;
    const storage = fx.app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'rh-test';
    storage.putObject = async (bucket, key, body, contentType) => {
      objects.set(`${bucket}/${key}`, { body: Buffer.from(body), contentType });
    };
    storage.getObject = async (bucket, key) => {
      const o = objects.get(`${bucket}/${key}`);
      return o ? { body: o.body, contentType: o.contentType } : null;
    };
    storage.deleteObject = async (bucket, key) => {
      objects.delete(`${bucket}/${key}`);
    };

    const res = ok(
      await fx.post('owner', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    id.A = byUser(fx.userIds['analyst']);
    id.B = byUser(fx.userIds['viewer']);
    const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
    ok(
      await fx.put('owner', `/hr/employees/${id.B}`, {
        expectedRevision: b!['revision'],
        managerEmployeeId: id.A,
        startDate: '2026-01-05',
      }),
    );
    id.C = ok(await fx.post('owner', '/hr/employees', fiche(`Chauffeur ${tag}`)), 201)['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('dépôt et téléchargement', () => {
    it('contrat PDF : stocké tel quel, servi en téléchargement inerte, visible du salarié', async () => {
      const v = ok(
        await upload(
          'hr_manager',
          id.B,
          'category=contract&label=Contrat%20CDI',
          CONTRAT,
          'contrat.pdf',
        ),
        201,
      );
      doc.contrat = v['id'];
      expect(v).toMatchObject({
        employeeId: id.B,
        category: 'contract',
        sensitive: false,
        encrypted: false,
        visibleToEmployee: true,
        fileName: 'contrat.pdf',
        contentType: 'application/pdf',
        size: CONTRAT.length,
      });
      expect(JSON.stringify(v)).not.toContain('wrappedKey');
      expect((await objetDe(doc.contrat))!.body.equals(CONTRAT)).toBe(true);
      for (const c of ['admin', 'hr_manager', 'viewer'] as const) {
        const dl = await download(c, doc.contrat);
        expect(dl.status, c).toBe(200);
        expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
        expect(dl.headers['content-security-policy']).toContain('sandbox');
        expect(dl.headers['x-content-type-options']).toBe('nosniff');
        expect(dl.headers['cache-control']).toContain('no-store');
        expect((dl.body as Buffer).equals(CONTRAT)).toBe(true);
      }
      // Journalisé, sans libellé ni nom de fichier.
      const traces = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN, action: 'hr.document.downloaded', targetId: doc.contrat })
        .toArray();
      expect(traces.length).toBe(3);
    });

    it('type refusé (415), sensibilité imposée (400), droits de dépôt', async () => {
      const html = await upload(
        'hr_manager',
        id.B,
        'category=contract&label=x',
        Buffer.from('<html><script>alert(1)</script></html>'),
      );
      code(html, 415, 'HR_DOCUMENT_TYPE');
      code(
        await upload('hr_manager', id.B, 'category=id_document&label=x&sensitive=false', PASSEPORT),
        400,
        'INVALID_REQUEST',
      );
      // L'Administrateur gère le dossier mais pas le sensible.
      expect((await upload('admin', id.B, 'category=id_document&label=x', PASSEPORT)).status).toBe(
        403,
      );
      // Le manager n'a pas `hr.manage` ; le salarié ne dépose qu'un justificatif.
      expect((await upload('analyst', id.B, 'category=contract&label=x', CONTRAT)).status).toBe(
        403,
      );
      expect((await upload('viewer', id.B, 'category=contract&label=x', CONTRAT)).status).toBe(403);
      // Hors portée, autre organisation : 404.
      expect((await upload('accountant', id.B, 'category=contract&label=x', CONTRAT)).status).toBe(
        404,
      );
      expect((await upload('ownerB', id.B, 'category=contract&label=x', CONTRAT)).status).toBe(404);
    });

    it('pièce d’identité : chiffrée au stockage, téléchargement réservé et journalisé strictement', async () => {
      const v = ok(
        await upload(
          'hr_manager',
          id.B,
          'category=id_document&label=Passeport&expiresOn=2030-01-15',
          PASSEPORT,
          'passeport.pdf',
        ),
        201,
      );
      doc.passeport = v['id'];
      expect(v).toMatchObject({ sensitive: true, encrypted: true, visibleToEmployee: false });
      // L'objet brut ne contient pas le clair.
      const brut = (await objetDe(doc.passeport))!;
      expect(brut.contentType).toBe('application/octet-stream');
      expect(brut.body.includes(Buffer.from('%PDF-'))).toBe(false);
      expect(brut.body.includes(Buffer.from(MARQUE))).toBe(false);
      // La clé de données est enveloppée sous le trousseau, jamais en clair.
      const enBase = await db
        .collection('hr_documents')
        .findOne({ _id: new ObjectId(doc.passeport) });
      expect(enBase!['wrappedKey']).toMatchObject({ alg: 'aes-256-gcm', keyId: 'k1', last4: null });
      expect(JSON.stringify(enBase)).not.toContain(MARQUE);

      // Listes : l'Administrateur (hr.read) ne la voit pas ; le salarié non plus (non visible).
      const pourAdmin = ok(await fx.get('admin', `/hr/employees/${id.B}/documents`));
      expect(pourAdmin['items'].map((d: { id: string }) => d.id)).toEqual([doc.contrat]);
      const pourRh = ok(await fx.get('hr_manager', `/hr/employees/${id.B}/documents`));
      expect(pourRh['items'].map((d: { id: string }) => d.id).sort()).toEqual(
        [doc.contrat, doc.passeport].sort(),
      );
      const pourB = ok(await fx.get('viewer', `/hr/employees/${id.B}/documents`));
      expect(pourB['items'].map((d: { id: string }) => d.id)).toEqual([doc.contrat]);
      // Manager : 403 ; autre membre : 404 ; autre organisation : 404.
      expect((await fx.get('analyst', `/hr/employees/${id.B}/documents`)).status).toBe(403);
      expect((await fx.get('accountant', `/hr/employees/${id.B}/documents`)).status).toBe(404);
      expect((await fx.get('ownerB', `/hr/employees/${id.B}/documents`)).status).toBe(404);

      // Téléchargement : Administrateur 403, salarié 404, manager 403, autre org 404.
      expect((await download('admin', doc.passeport)).status).toBe(403);
      expect((await download('viewer', doc.passeport)).status).toBe(404);
      expect((await download('analyst', doc.passeport)).status).toBe(403);
      expect((await download('ownerB', doc.passeport)).status).toBe(404);
      expect((await download('accountant', doc.passeport)).status).toBe(404);

      const avant = await db
        .collection('audit_events')
        .countDocuments({ action: 'hr.document.downloaded', targetId: doc.passeport });
      const dl = await download('hr_manager', doc.passeport);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect((dl.body as Buffer).equals(PASSEPORT)).toBe(true);
      const traces = await db
        .collection('audit_events')
        .find({ action: 'hr.document.downloaded', targetId: doc.passeport })
        .toArray();
      expect(traces.length).toBe(avant + 1);
      expect(traces.at(-1)).toMatchObject({ actorUserId: fx.userIds['hr_manager'] });
      // Rien du contenu ni du numéro au journal.
      const journal = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN })
        .toArray();
      expect(JSON.stringify(journal)).not.toContain(MARQUE);
    });

    it('audit strict en échec : 503, rien n’est servi', async () => {
      const audit = fx.app.get(AuditService);
      const spy = vi.spyOn(audit, 'recordStrict').mockRejectedValueOnce(new Error('panne'));
      try {
        const dl = await download('owner', doc.passeport);
        expect(dl.status).toBe(503);
        expect((dl.body as Buffer).includes(Buffer.from(MARQUE))).toBe(false);
        expect(JSON.parse((dl.body as Buffer).toString('utf8'))['code']).toBe(
          'HR_AUDIT_UNAVAILABLE',
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('un objet chiffré recopié vers un autre document ne se déchiffre pas', async () => {
      const autre = ok(
        await upload('owner', id.C, 'category=medical&label=Certificat', pdf('autre')),
        201,
      );
      const source = await db
        .collection('hr_documents')
        .findOne({ _id: new ObjectId(doc.passeport) });
      doc.copie = autre['id'];
      const cible = await db.collection('hr_documents').findOne({ _id: new ObjectId(autre['id']) });
      // Objet ET clé enveloppée de la pièce de B recopiés sur le document de C.
      objects.set(`rh-test/hr-documents/${cible!['objectId']}`, (await objetDe(doc.passeport))!);
      await db
        .collection('hr_documents')
        .updateOne({ _id: cible!['_id'] }, { $set: { wrappedKey: source!['wrappedKey'] } });
      const dl = await download('owner', autre['id']);
      expect(dl.status).toBe(500);
      expect(JSON.parse((dl.body as Buffer).toString('utf8'))['code']).toBe(
        'HR_DOCUMENT_UNREADABLE',
      );
      expect((dl.body as Buffer).includes(Buffer.from(MARQUE))).toBe(false);
    });

    it('le salarié dépose son justificatif (sensible, qui lui reste visible) et voit ses documents', async () => {
      const v = ok(
        await upload(
          'viewer',
          id.B,
          'category=leave_justification&label=Justificatif',
          pdf('justif'),
        ),
        201,
      );
      doc.justificatif = v['id'];
      expect(v).toMatchObject({ sensitive: true, encrypted: true, visibleToEmployee: true });
      // Pour autrui, non.
      expect(
        (await upload('viewer', id.C, 'category=leave_justification&label=x', pdf('x'))).status,
      ).toBe(404);
      const dl = await download('viewer', doc.justificatif);
      expect(dl.status).toBe(200);
      expect((dl.body as Buffer).equals(pdf('justif'))).toBe(true);
      // `/hr/me` : contrat et justificatif, jamais le passeport.
      const me = ok(await fx.get('viewer', '/hr/me'));
      expect(me['documents'].map((d: { id: string }) => d.id).sort()).toEqual(
        [doc.contrat, doc.justificatif].sort(),
      );
      // Un membre sans fiche : liste vide.
      expect(ok(await fx.get('sales_rep', '/hr/me'))['documents']).toEqual([]);
    });
  });

  describe('métadonnées hors de l’URL et des en-têtes', () => {
    it('le libellé et la catégorie voyagent dans le formulaire : ni l’URL ni les en-têtes journalisés ne les portent', async () => {
      const LIBELLE = `Passeport de Bea Mbuyi ${tag}`;
      const vus: { url: string; headers: string }[] = [];
      const server = fx.app.getHttpServer() as import('node:http').Server;
      const ecoute = (req: import('node:http').IncomingMessage) =>
        vus.push({ url: req.url ?? '', headers: JSON.stringify(req.rawHeaders) });
      server.on('request', ecoute);
      try {
        const v = ok(
          await upload(
            'hr_manager',
            id.C,
            `category=id_document&label=${encodeURIComponent(LIBELLE)}&expiresOn=2031-02-01`,
            pdf('pièce'),
            `${LIBELLE}.pdf`,
          ),
          201,
        );
        expect(v).toMatchObject({ label: LIBELLE, category: 'id_document', sensitive: true });
      } finally {
        server.off('request', ecoute);
      }
      const envoi = vus.filter((r) => r.url.includes('/documents'));
      expect(envoi).toHaveLength(1);
      // `req.url` est ce que pino-http journalise (et `req.headers` en production).
      expect(envoi[0]!.url).toBe(`/hr/employees/${id.C}/documents`);
      for (const morceau of [LIBELLE, encodeURIComponent(LIBELLE), 'id_document', 'Passeport']) {
        expect(envoi[0]!.url).not.toContain(morceau);
        expect(envoi[0]!.headers).not.toContain(morceau);
      }
      // L'ancien envoi par paramètres d'URL est refusé : le fichier manque.
      const parUrl = await request(fx.app.getHttpServer())
        .post(`/hr/employees/${id.C}/documents?category=contract&label=x`)
        .set('Cookie', fx.as('hr_manager'))
        .set('Content-Type', 'application/octet-stream')
        .send(CONTRAT);
      expect(parUrl.status).toBe(400);
      // Un champ inconnu est refusé.
      code(
        await upload('hr_manager', id.C, 'category=contract&label=x&intrus=1', CONTRAT),
        400,
        'INVALID_REQUEST',
      );
    });
  });

  describe('rotation secrets:rewrap', () => {
    it('après rotation k1 → k2, un document chiffré se relit avec la seule nouvelle clé', async () => {
      const k1 = { keyId: 'k1', key: CLE_K1 };
      const k2 = { keyId: 'k2', key: randomBytes(32) };
      const rewrap = new RewrapService(
        fx.app.get<Model<IntegrationDocument>>(getModelToken(Integration.name)),
        fx.app.get<Model<OrganizationSecretDocument>>(getModelToken(OrganizationSecret.name)),
        fx.app.get<Connection>(getConnectionToken()),
        MasterKeyring.of([k2, k1], 'k2'),
        fx.app.get(PlatformAuditService),
        fx.app.get(SecretsService),
      );
      const cles = async () =>
        (
          await db
            .collection('hr_documents')
            .find({ organizationId: fx.orgN, wrappedKey: { $type: 'object' } })
            .toArray()
        ).map((d) => [String(d['_id']), d['wrappedKey']['keyId']] as const);
      // Le document dont la clé a été recopiée (test plus haut) fait échouer la rotation
      // bruyamment, comme pour les autres collections ; on l'efface avant de rejouer.
      await expect(rewrap.run('operateur-1')).rejects.toThrow();
      await db
        .collection('hr_documents')
        .updateOne(
          { _id: new ObjectId(doc.copie) },
          { $set: { wrappedKey: null, deletedAt: new Date() } },
        );
      const avant = (await cles()).filter(([, keyId]) => keyId === 'k1');
      expect(avant.length).toBeGreaterThan(0);
      const objetAvant = (await objetDe(doc.passeport))!.body;

      const premier = await rewrap.run('operateur-1');
      expect(premier.remainingKeyIds).toEqual([]);
      expect(premier.rewrapped).toBeGreaterThanOrEqual(avant.length);
      for (const [, keyId] of await cles()) expect(keyId).toBe('k2');
      // L'objet chiffré n'est ni relu ni réécrit : seule la clé enveloppée change.
      expect((await objetDe(doc.passeport))!.body.equals(objetAvant)).toBe(true);
      const second = await rewrap.run('operateur-1');
      expect(second.rewrapped).toBe(0);
      expect(second.remainingKeyIds).toEqual([]);

      // `_PREVIOUS` retirée : l'application ne connaît plus que k2.
      const service = fx.app.get(HrDocumentsService) as unknown as { keyring: MasterKeyring };
      const ancien = service.keyring;
      service.keyring = MasterKeyring.of([k2], 'k2');
      try {
        const dl = await download('hr_manager', doc.passeport);
        expect(dl.status).toBe(200);
        expect((dl.body as Buffer).equals(PASSEPORT)).toBe(true);
      } finally {
        service.keyring = ancien;
      }
      const traces = await db
        .collection('audit_events')
        .find({ action: 'secret.rewrapped', targetType: 'hr_document' })
        .toArray();
      // Une trace par clé re-chiffrée (le premier passage, interrompu, en avait déjà écrit).
      expect(traces.length).toBe((await cles()).length);
      for (const t of traces) expect(t['metadata']).toEqual({ keyId: 'k2' });
    });
  });

  describe('suppression, anonymisation, isolation', () => {
    it('suppression : `hr.manage`, et `hr.sensitive.read` pour une pièce sensible', async () => {
      const tmp = ok(
        await upload('admin', id.C, 'category=diploma&label=Diplôme', pdf('dip')),
        201,
      );
      expect((await del('analyst', `/hr/documents/${tmp['id']}`)).status).toBe(403);
      expect((await del('ownerB', `/hr/documents/${tmp['id']}`)).status).toBe(404);
      expect((await del('admin', `/hr/documents/${tmp['id']}`)).status).toBe(204);
      expect(await objetDe(tmp['id'])).toBeUndefined();
      expect((await download('admin', tmp['id'])).status).toBe(404);
      expect((await del('admin', `/hr/documents/${doc.passeport}`)).status).toBe(403);
      expect((await del('admin', '/hr/documents/pas-un-id')).status).toBe(404);
    });

    it('anonymisation : documents sensibles effacés (clé et objet), les autres gardés', async () => {
      const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
      const hier = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      const sortie = ok(
        await fx.post('owner', `/hr/employees/${id.B}/exit`, {
          endDate: hier,
          exitCategory: 'resignation',
          expectedRevision: b!['revision'],
        }),
      );
      // La sortie propose la liste de départ, sans rien effacer.
      expect(sortie['offboardingSuggested']).toBe(true);
      expect(
        await db
          .collection('hr_documents')
          .countDocuments({ employeeId: id.B, deletedAt: null, sensitive: true }),
      ).toBe(2);
      const objetPasseport = (await db
        .collection('hr_documents')
        .findOne({ _id: new ObjectId(doc.passeport) }))!['objectId'];
      ok(
        await fx.post('owner', `/hr/employees/${id.B}/anonymize`, {
          confirm: true,
          expectedRevision: sortie['employee']['revision'],
        }),
      );
      const restants = await db.collection('hr_documents').find({ employeeId: id.B }).toArray();
      for (const d of restants.filter((x) => x['sensitive'])) {
        expect(d['deletedAt']).not.toBeNull();
        expect(d['wrappedKey']).toBeNull();
      }
      expect(restants.find((x) => String(x['_id']) === doc.contrat)!['deletedAt']).toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(objects.has(`rh-test/hr-documents/${objetPasseport}`)).toBe(false);
      expect((await download('owner', doc.passeport)).status).toBe(404);
      expect((await download('owner', doc.contrat)).status).toBe(200);
      // Plus aucun dépôt sur une fiche anonymisée.
      code(
        await upload('owner', id.B, 'category=other&label=x', pdf('x')),
        409,
        'HR_DOCUMENT_EMPLOYEE_ANONYMIZED',
      );
    });
  });
});
