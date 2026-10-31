// Bibliothèque de documents contre la vraie application (ADR-0046 § 4, § 5.3 ;
// critères 15, 16, 17, 19). ADR-0046 — S6.
//
// Couvre : droits par dossier (droit par nature « Fiscal et administratif », dossier
// restreint invisible d'un gestionnaire, sous-dossier qui n'élargit jamais) et par rôle
// (Conseiller refusé) ; lecture = dossier ET module de chaque lien ; isolation entre
// organisations (identifiants forgés compris) ; versions (ajout, restauration, plafond,
// révision) ; types refusés ; borne commune de 1 Gio ; chiffrement par enveloppe
// (objet sans clair, recopie indéchiffrable, audit strict, acteur plateforme) et
// rotation `secrets:rewrap` ; métadonnées jamais dans l'URL ni dans un en-tête (test
// qui observe les requêtes) ; recherche filtrée avant pagination ; présentation par
// entité ; échéances, rappels ; suppression et purge.
//
// Pièces inventées.

import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { Connection, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../authz/audit.service.js';
import { DocumentsJobs } from '../documents/documents-jobs.js';
import { LibraryDocumentsService } from '../documents/library-documents.service.js';
import { Integration, type IntegrationDocument } from '../integrations/integration.schema.js';
import {
  OrganizationSecret,
  type OrganizationSecretDocument,
} from '../integrations/organization-secret.schema.js';
import { PlatformAuditService } from '../integrations/platform-audit.service.js';
import { RewrapService } from '../integrations/rewrap.js';
import { MasterKeyring } from '../integrations/secrets-crypto.js';
import { SecretsService } from '../integrations/secrets.service.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin } from './e2e-utils.js';

const tag = randomBytes(4).toString('hex');
const CLE_K1 = randomBytes(32);
process.env['SECRETS_MASTER_KEY'] = CLE_K1.toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 180_000 });

const ROLES = [
  'admin',
  'accountant',
  'analyst',
  'viewer',
  'sales_rep',
  'advisor',
  'hr_manager',
  'storekeeper',
] as const;
type Account = 'owner' | (typeof ROLES)[number] | 'ownerB' | 'superAdmin';

const pdf = (texte: string) =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Title (${texte}) >> endobj\ntrailer\n%%EOF\n`, 'latin1');
const MARQUE = `NIF-CONFIDENTIEL-${tag}`;
const ATTESTATION = pdf(MARQUE);

function ok(res: request.Response, status = 200): Record<string, any> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Record<string, any>;
}
function code(res: request.Response, status: number, expected: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(expected);
}

e2eSuite('Bibliothèque de documents (ADR-0046 S6)', () => {
  let app: INestApplication;
  let db: Db;
  let orgN = '';
  let orgB = '';
  const cookies = {} as Record<Account, string[]>;
  const userIds = {} as Record<Account, string>;
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const folder = { fiscal: '', divers: '', contrats: '', restreint: '', sousFiscal: '' };
  const doc = { divers: '', fournisseur: '', sensible: '', restreint: '', fiscal: '' };
  const entity = { supplier: '', supplierB: '' };

  const server = () => app.getHttpServer();
  const as = (c: Account) => [...cookies[c], `active_org_id=${c === 'ownerB' ? orgB : orgN}`];
  const get = (c: Account, path: string) => request(server()).get(path).set('Cookie', as(c));
  const post = (c: Account, path: string, body?: unknown) =>
    request(server())
      .post(path)
      .set('Cookie', as(c))
      .send((body ?? {}) as object);
  const put = (c: Account, path: string, body: unknown) =>
    request(server())
      .put(path)
      .set('Cookie', as(c))
      .send(body as object);
  const del = (c: Account, path: string) => request(server()).delete(path).set('Cookie', as(c));

  /** Envoi `multipart/form-data` : champs texte et partie `file`. */
  const upload = (
    c: Account,
    fields: Record<string, string>,
    body: Buffer | null,
    fileName = 'piece.pdf',
    path = '/documents',
  ) => {
    const req = request(server()).post(path).set('Cookie', as(c));
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    if (body === null) return req;
    return req.attach('file', body, {
      filename: fileName,
      contentType: 'application/octet-stream',
    });
  };
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const download = (c: Account, documentId: string, versionId: string) =>
    binary(get(c, `/documents/${documentId}/versions/${versionId}/file`));
  const current = async (documentId: string) =>
    (await db.collection('library_documents').findOne({ _id: new ObjectId(documentId) }))!;
  const versionRow = async (versionId: string) =>
    (await db.collection('library_document_versions').findOne({ _id: new ObjectId(versionId) }))!;
  const objectOf = async (versionId: string) =>
    objects.get(`docs-test/documents/${(await versionRow(versionId))['objectId']}`);
  const clearThrottle = () => {
    const store = app.get(ThrottlerStorage) as unknown as {
      storage: Map<string, unknown>;
      timeoutIds: Map<string, NodeJS.Timeout[]>;
    };
    for (const ids of store.timeoutIds.values()) ids.forEach(clearTimeout);
    store.timeoutIds.clear();
    store.storage.clear();
  };

  beforeAll(async () => {
    app = await makeE2EApp();
    db = await dbOf(app);
    const compte = (c: Account) => ({
      email: `docs-${c}-${tag}@lalanda-test.local`,
      password: 'Passw0rd!docs',
      name: `Membre ${c} ${tag}`,
    });
    const orgDe = async (c: Account) => {
      cookies[c] = await registerAndLogin(app, compte(c));
      const orgs = await request(server()).get('/organizations').set('Cookie', cookies[c]);
      return (orgs.body.organizations as { id: string }[])[0]!.id;
    };
    const sessionUserId = async (c: Account) => {
      const s = await request(server()).get('/auth/get-session').set('Cookie', cookies[c]);
      return String(s.body?.user?.id ?? '');
    };
    orgN = await orgDe('owner');
    userIds['owner'] = await sessionUserId('owner');
    for (const role of ROLES) {
      const inv = await request(server())
        .post(`/organizations/${orgN}/invitations`)
        .set('Cookie', cookies['owner'])
        .send({ email: compte(role).email, role });
      expect(inv.status, `invitation ${role} ${JSON.stringify(inv.body)}`).toBe(201);
      cookies[role] = await registerAndLogin(app, compte(role));
      const acc = await request(server())
        .post('/invitations/accept')
        .set('Cookie', cookies[role])
        .send({ token: inv.body.token });
      expect(acc.status).toBe(201);
      userIds[role] = await sessionUserId(role);
    }
    orgB = await orgDe('ownerB');
    userIds['ownerB'] = await sessionUserId('ownerB');
    await orgDe('superAdmin');
    userIds['superAdmin'] = await sessionUserId('superAdmin');
    await db.collection('platform_roles').insertOne({
      userId: userIds['superAdmin'],
      role: 'platform_super_admin',
      grantedBy: null,
      reason: 'e2e documents',
      expiresAt: null,
      revokedAt: null,
      _schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const storage = app.get(ObjectStorageService);
    storage.uploadsBucket = () => 'docs-test';
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

    // Entités liées : un fournisseur dans N, un dans B (identifiant forgé).
    const now = new Date();
    entity.supplier = String(
      (
        await db
          .collection('suppliers')
          .insertOne({ organizationId: orgN, name: `Fournisseur ${tag}`, createdAt: now })
      ).insertedId,
    );
    entity.supplierB = String(
      (
        await db
          .collection('suppliers')
          .insertOne({ organizationId: orgB, name: `Fournisseur B ${tag}`, createdAt: now })
      ).insertedId,
    );
  }, 300_000);

  beforeEach(() => clearThrottle());

  afterAll(async () => {
    try {
      if (db) await db.dropDatabase();
    } finally {
      await app?.close();
    }
  }, 60_000);

  describe('dossiers et droits', () => {
    it('le Conseiller n’a aucun accès ; le Chef de projet non plus (rôle) — `docs.read` au guard', async () => {
      for (const [path, send] of [
        ['/documents/folders', () => get('advisor', '/documents/folders')],
        ['/documents', () => get('advisor', '/documents')],
        ['/documents/search', () => post('advisor', '/documents/search', {})],
        ['/documents/deadlines', () => get('advisor', '/documents/deadlines')],
      ] as const) {
        const res = await send();
        expect(res.status, path).toBe(403);
        expect(res.body).toMatchObject({ code: 'FORBIDDEN', action: 'docs.read', role: 'advisor' });
      }
      const envoi = await upload('advisor', { title: 'x' }, pdf('x'));
      expect(envoi.status).toBe(403);
      // Lecteurs sans `docs.manage` : pas de dossier.
      expect((await post('viewer', '/documents/folders', { name: 'X' })).body).toMatchObject({
        code: 'FORBIDDEN',
        action: 'docs.manage',
      });
    });

    it('dossiers proposés ; « Fiscal et administratif » invisible du Magasinier (`treasury.read`)', async () => {
      const liste = ok(await post('owner', '/documents/folders/defaults'));
      const parNom = (n: string) =>
        liste['items'].find((f: { name: string }) => f.name === n)!['id'] as string;
      folder.fiscal = parNom('Fiscal et administratif');
      folder.divers = parNom('Divers');
      folder.contrats = parNom('Contrats');
      expect(liste['items']).toHaveLength(5);
      // Idempotent.
      expect(ok(await post('owner', '/documents/folders/defaults'))['items']).toHaveLength(5);
      const mag = ok(await get('storekeeper', '/documents/folders'))['items'].map(
        (f: { name: string }) => f.name,
      );
      expect(mag).not.toContain('Fiscal et administratif');
      expect(mag).toContain('Divers');
      expect(
        ok(await get('accountant', '/documents/folders'))['items'].map(
          (f: { name: string }) => f.name,
        ),
      ).toContain('Fiscal et administratif');
      // Un sous-dossier ouvert à tous sans héritage n'élargit pas la lecture du parent.
      folder.sousFiscal = ok(
        await post('owner', '/documents/folders', {
          name: 'Attestations',
          parentId: folder.fiscal,
          access: { read: 'all', write: 'managers', inherit: false },
        }),
        201,
      )['id'];
      expect(
        ok(await get('storekeeper', '/documents/folders'))['items'].map(
          (f: { id: string }) => f.id,
        ),
      ).not.toContain(folder.sousFiscal);
      // Le dépôt dans le sous-dossier est donc invisible du Magasinier.
      doc.fiscal = ok(
        await upload(
          'accountant',
          {
            title: `Attestation fiscale ${tag}`,
            folderId: folder.sousFiscal,
            nature: 'certificate',
            expiresOn: futur(10),
          },
          pdf('fiscal'),
        ),
        201,
      )['id'];
      code(await get('storekeeper', `/documents/${doc.fiscal}`), 404, 'DOCUMENT_NOT_FOUND');
      ok(await get('viewer', `/documents/${doc.fiscal}`));
    });

    it('dossier restreint à deux personnes : invisible de l’Administrateur (`docs.manage`), nom compris', async () => {
      folder.restreint = ok(
        await post('owner', '/documents/folders', {
          name: `Contentieux ${tag}`,
          access: {
            read: { userIds: [userIds['analyst'], userIds['viewer']] },
            write: { userIds: [userIds['analyst']] },
          },
        }),
        201,
      )['id'];
      const pourAdmin = ok(await get('admin', '/documents/folders'));
      expect(JSON.stringify(pourAdmin)).not.toContain(`Contentieux ${tag}`);
      code(
        await put('admin', `/documents/folders/${folder.restreint}`, {
          expectedRevision: 1,
          name: 'Ouvert',
        }),
        404,
        'FOLDER_NOT_FOUND',
      );
      // Le Propriétaire le voit toujours ; les deux membres aussi.
      for (const c of ['owner', 'analyst', 'viewer'] as const) {
        expect(
          ok(await get(c, '/documents/folders'))['items'].map((f: { id: string }) => f.id),
          c,
        ).toContain(folder.restreint);
      }
      // L'Analyste (sans `docs.manage`) y écrit parce que le dossier le désigne ; le
      // Lecteur, désigné en lecture seulement, non.
      doc.restreint = ok(
        await upload(
          'analyst',
          { title: `Mémoire contentieux ${tag}`, folderId: folder.restreint, tags: '["litige"]' },
          pdf('memoire'),
        ),
        201,
      )['id'];
      expect(
        (await upload('viewer', { title: 'x', folderId: folder.restreint }, pdf('x'))).body,
      ).toMatchObject({ code: 'FORBIDDEN', action: 'docs.manage' });
      // Invisible de l'Administrateur : 404, et la recherche ne le compte pas.
      code(await get('admin', `/documents/${doc.restreint}`), 404, 'DOCUMENT_NOT_FOUND');
      const recherche = ok(await post('admin', '/documents/search', { tags: ['litige'] }));
      expect(recherche).toMatchObject({ items: [], total: 0 });
      expect(ok(await post('viewer', '/documents/search', { tags: ['litige'] }))['total']).toBe(1);
      // Un gestionnaire ne peut pas non plus y déposer (404, pas 403 : on ne confirme rien).
      code(
        await upload('admin', { title: 'x', folderId: folder.restreint }, pdf('x')),
        404,
        'FOLDER_NOT_FOUND',
      );
    });

    it('arborescence : cycle refusé, profondeur bornée à 5, archivage d’un dossier vide seulement', async () => {
      let parent = folder.contrats;
      const chaine = [parent];
      for (let i = 2; i <= 5; i++) {
        parent = ok(
          await post('owner', '/documents/folders', { name: `N${i}`, parentId: parent }),
          201,
        )['id'];
        chaine.push(parent);
      }
      code(
        await post('owner', '/documents/folders', { name: 'N6', parentId: parent }),
        409,
        'FOLDER_TOO_DEEP',
      );
      const racine = ok(await get('owner', '/documents/folders'))['items'].find(
        (f: { id: string }) => f.id === folder.contrats,
      );
      code(
        await put('owner', `/documents/folders/${folder.contrats}`, {
          expectedRevision: racine['revision'],
          parentId: chaine[3],
        }),
        409,
        'FOLDER_CYCLE',
      );
      code(
        await post('owner', `/documents/folders/${chaine[3]}/archive`, { expectedRevision: 1 }),
        409,
        'FOLDER_NOT_EMPTY',
      );
      const feuille = ok(
        await post('owner', `/documents/folders/${chaine[4]}/archive`, { expectedRevision: 1 }),
      );
      expect(feuille['status']).toBe('archived');
      code(
        await upload('owner', { title: 'x', folderId: chaine[4]! }, pdf('x')),
        409,
        'FOLDER_ARCHIVED',
      );
      // Une autorisation inconnue est refusée.
      code(
        await post('owner', '/documents/folders', {
          name: 'X',
          access: { read: { action: 'tresor.lire' }, write: 'managers' },
        }),
        400,
        'INVALID_REQUEST',
      );
      // Le changement de droits est journalisé, sans le nom du dossier.
      const traces = await db
        .collection('audit_events')
        .find({ organizationId: orgN, action: 'documents.folder_access_changed' })
        .toArray();
      expect(traces.length).toBeGreaterThan(0);
      expect(JSON.stringify(traces)).not.toContain(`Contentieux ${tag}`);
    });
  });

  describe('liens et présentation', () => {
    it('un document lié à un fournisseur n’est pas lu sans `purchase.read`, même dossier ouvert', async () => {
      const v = ok(
        await upload(
          'accountant',
          {
            title: `Contrat cadre ${tag}`,
            folderId: folder.divers,
            nature: 'contract',
            links: JSON.stringify([{ entityType: 'supplier', entityId: entity.supplier }]),
          },
          pdf('contrat'),
          'contrat.pdf',
        ),
        201,
      );
      doc.fournisseur = v['id'];
      expect(v['links']).toEqual([{ entityType: 'supplier', entityId: entity.supplier }]);
      for (const c of ['storekeeper', 'sales_rep', 'hr_manager'] as const) {
        code(await get(c, `/documents/${doc.fournisseur}`), 404, 'DOCUMENT_NOT_FOUND');
        expect(
          ok(await get(c, `/documents?folderId=${folder.divers}`))['items'].map(
            (d: { id: string }) => d.id,
          ),
          c,
        ).not.toContain(doc.fournisseur);
      }
      ok(await get('viewer', `/documents/${doc.fournisseur}`));
      // Lier exige la lecture du module : le Responsable RH (docs.manage) ne lie pas un
      // fournisseur.
      const refus = await upload(
        'hr_manager',
        {
          title: 'x',
          folderId: folder.divers,
          links: JSON.stringify([{ entityType: 'supplier', entityId: entity.supplier }]),
        },
        pdf('x'),
      );
      expect(refus.status).toBe(403);
      expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'purchase.read' });
      // Un document sans dossier n'est lu que par ses liens ; sans lien, refusé.
      code(await upload('owner', { title: 'x' }, pdf('x')), 400, 'DOCUMENT_UNFILED');
    });

    it('présentation par entité : documents liés et pièces des factures fournisseurs, jamais une pièce RH', async () => {
      const facture = await db.collection('supplier_invoices').insertOne({
        organizationId: orgN,
        internalNumber: 'FF2610-000001',
        supplierId: entity.supplier,
        attachment: {
          objectId: 'a'.repeat(32),
          fileName: 'facture.pdf',
          contentType: 'application/pdf',
          size: 1234,
          sha256: 'x',
          uploadedBy: userIds['accountant'],
          uploadedAt: new Date(),
        },
      });
      await db.collection('hr_documents').insertOne({
        organizationId: orgN,
        employeeId: entity.supplier,
        label: `Pièce RH ${tag}`,
        storedSize: 10,
        deletedAt: null,
      });
      const vue = ok(
        await get(
          'accountant',
          `/documents/entity-pieces?entityType=supplier&entityId=${entity.supplier}`,
        ),
      );
      expect(vue['library'].map((d: { id: string }) => d.id)).toEqual([doc.fournisseur]);
      expect(vue['pieces']).toEqual([
        expect.objectContaining({
          module: 'purchases',
          ownerType: 'supplier_invoice',
          ownerId: String(facture.insertedId),
          ownerReference: 'FF2610-000001',
          href: `/purchases/invoices/${String(facture.insertedId)}/attachment`,
        }),
      ]);
      expect(JSON.stringify(vue)).not.toContain(`Pièce RH ${tag}`);
      // Sans la lecture du module : 403 ; entité `employee` : refusée par le contrat.
      expect(
        (
          await get(
            'storekeeper',
            `/documents/entity-pieces?entityType=supplier&entityId=${entity.supplier}`,
          )
        ).body,
      ).toMatchObject({ code: 'FORBIDDEN', action: 'purchase.read' });
      code(
        await get(
          'owner',
          `/documents/entity-pieces?entityType=employee&entityId=${entity.supplier}`,
        ),
        400,
        'INVALID_REQUEST',
      );
      // Aucune collection existante n'est modifiée par la présentation.
      expect(
        await db.collection('supplier_invoices').countDocuments({ organizationId: orgN }),
      ).toBe(1);
    });
  });

  describe('isolation entre organisations', () => {
    it('identifiants forgés et ressources de N : 404 pour B ; rien de N dans les listes de B', async () => {
      // Lien vers un fournisseur de B, dossier de B : 404.
      code(
        await upload(
          'owner',
          {
            title: 'x',
            folderId: folder.divers,
            links: JSON.stringify([{ entityType: 'supplier', entityId: entity.supplierB }]),
          },
          pdf('x'),
        ),
        404,
        'DOCUMENT_ENTITY_NOT_FOUND',
      );
      const dossierB = ok(await post('ownerB', '/documents/folders', { name: 'B' }), 201)['id'];
      code(
        await upload('owner', { title: 'x', folderId: dossierB }, pdf('x')),
        404,
        'FOLDER_NOT_FOUND',
      );
      code(
        await upload('ownerB', { title: 'x', folderId: folder.divers }, pdf('x')),
        404,
        'FOLDER_NOT_FOUND',
      );
      const d = await current(doc.fournisseur);
      code(await get('ownerB', `/documents/${doc.fournisseur}`), 404, 'DOCUMENT_NOT_FOUND');
      expect((await download('ownerB', doc.fournisseur, d['currentVersionId'])).status).toBe(404);
      code(
        await put('ownerB', `/documents/${doc.fournisseur}`, { expectedRevision: 1, title: 'x' }),
        404,
        'DOCUMENT_NOT_FOUND',
      );
      expect((await del('ownerB', `/documents/${doc.fournisseur}`)).status).toBe(404);
      code(
        await put('ownerB', `/documents/folders/${folder.divers}`, {
          expectedRevision: 1,
          name: 'x',
        }),
        404,
        'FOLDER_NOT_FOUND',
      );
      expect(ok(await post('ownerB', '/documents/search', {}))).toMatchObject({ total: 0 });
      expect(
        ok(await get('ownerB', '/documents/folders'))['items'].map((f: { id: string }) => f.id),
      ).toEqual([dossierB]);
      code(
        await get(
          'ownerB',
          `/documents/entity-pieces?entityType=supplier&entityId=${entity.supplier}`,
        ),
        404,
        'DOCUMENT_ENTITY_NOT_FOUND',
      );
      code(await get('owner', '/documents/pas-un-id'), 404, 'DOCUMENT_NOT_FOUND');
    });
  });

  describe('fichiers : types, versions, borne commune', () => {
    it('types refusés (415), fichier absent (400), PDF trop lourd (413)', async () => {
      code(
        await upload(
          'owner',
          { title: 'x', folderId: folder.divers },
          Buffer.from('<html><script>alert(1)</script></html>'),
          'page.html',
        ),
        415,
        'DOCUMENT_TYPE',
      );
      code(
        await upload(
          'owner',
          { title: 'x', folderId: folder.divers },
          Buffer.from('PK\u0003\u0004 bureautique'),
          'tableau.xlsx',
        ),
        415,
        'DOCUMENT_TYPE',
      );
      code(
        await upload('owner', { title: 'x', folderId: folder.divers }, null),
        400,
        'DOCUMENT_FILE_MISSING',
      );
      const lourd = Buffer.concat([pdf('lourd'), Buffer.alloc(10 * 1024 * 1024 + 1)]);
      expect((await upload('owner', { title: 'x', folderId: folder.divers }, lourd)).status).toBe(
        413,
      );
    });

    it('versions : ajout, téléchargement de l’ancienne, restauration par recopie, plafond, révision', async () => {
      const v1 = pdf('version-1');
      const cree = ok(
        await upload(
          'admin',
          { title: `Bail Gombe ${tag}`, folderId: folder.divers, nature: 'contract' },
          v1,
          'bail.pdf',
        ),
        201,
      );
      doc.divers = cree['id'];
      const id1 = cree['currentVersion']['id'];
      expect(cree).toMatchObject({ versionCount: 1, sensitive: false, canWrite: true });
      const v2 = pdf('version-2');
      const apres = ok(
        await upload(
          'admin',
          { note: 'Avenant' },
          v2,
          'bail-v2.pdf',
          `/documents/${doc.divers}/versions`,
        ),
        201,
      );
      expect(apres['versionCount']).toBe(2);
      expect(apres['versions'].map((v: { number: number }) => v.number)).toEqual([2, 1]);
      expect(apres['currentVersion']).toMatchObject({
        number: 2,
        note: 'Avenant',
        fileName: 'bail-v2.pdf',
      });
      const dl1 = await download('viewer', doc.divers, id1);
      expect(dl1.status).toBe(200);
      expect(dl1.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl1.headers['content-security-policy']).toContain('sandbox');
      expect(dl1.headers['x-content-type-options']).toBe('nosniff');
      expect((dl1.body as Buffer).equals(v1)).toBe(true);
      // Un lecteur sans droit d'écriture n'ajoute pas de version.
      expect(
        (await upload('viewer', {}, pdf('x'), 'x.pdf', `/documents/${doc.divers}/versions`)).body,
      ).toMatchObject({ code: 'FORBIDDEN', action: 'docs.manage' });
      const restaure = ok(
        await post('admin', `/documents/${doc.divers}/versions/${id1}/restore`),
        201,
      );
      expect(restaure['currentVersion']).toMatchObject({
        number: 3,
        sha256: cree['currentVersion']['sha256'],
        note: 'Restauration de la version 1',
      });
      const dl3 = await download('admin', doc.divers, restaure['currentVersion']['id']);
      expect((dl3.body as Buffer).equals(v1)).toBe(true);
      // Les anciennes versions restent.
      expect(
        await db.collection('library_document_versions').countDocuments({ documentId: doc.divers }),
      ).toBe(3);
      // Révision périmée.
      code(
        await put('admin', `/documents/${doc.divers}`, { expectedRevision: 1, title: 'x' }),
        409,
        'STALE_REVISION',
      );
      // Plafond de 50 versions.
      await db
        .collection('library_documents')
        .updateOne({ _id: new ObjectId(doc.divers) }, { $set: { versionCount: 50 } });
      code(
        await upload('admin', {}, pdf('x'), 'x.pdf', `/documents/${doc.divers}/versions`),
        409,
        'DOCUMENT_VERSIONS_FULL',
      );
      await db
        .collection('library_documents')
        .updateOne({ _id: new ObjectId(doc.divers) }, { $set: { versionCount: 3 } });
    });

    it('borne commune de 1 Gio : les pièces des autres modules comptent', async () => {
      const gros = await db.collection('work_attachments').insertOne({
        organizationId: orgN,
        projectId: 'p',
        taskId: 't',
        size: 1024 ** 3 - 100,
        deletedAt: null,
      });
      try {
        code(
          await upload('owner', { title: 'x', folderId: folder.divers }, pdf('quota')),
          409,
          'DOCUMENT_STORAGE_FULL',
        );
        // B n'est pas touchée par la borne de N.
        const dossierB = ok(await get('ownerB', '/documents/folders'))['items'][0]['id'];
        ok(await upload('ownerB', { title: 'B', folderId: dossierB }, pdf('b')), 201);
      } finally {
        await db.collection('work_attachments').deleteOne({ _id: gros.insertedId });
      }
    });
  });

  describe('documents sensibles : chiffrement, audit, plateforme, rotation', () => {
    it('chiffré au stockage, réservé à `docs.manage` au dépôt, téléchargement journalisé strictement', async () => {
      const refus = await upload(
        'analyst',
        { title: 'x', folderId: folder.restreint, sensitive: 'true' },
        ATTESTATION,
      );
      expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'docs.manage' });
      const v = ok(
        await upload(
          'accountant',
          {
            title: `Attestation sensible ${tag}`,
            folderId: folder.divers,
            nature: 'certificate',
            sensitive: 'true',
            tags: '["secret-tag"]',
          },
          ATTESTATION,
          'attestation.pdf',
        ),
        201,
      );
      doc.sensible = v['id'];
      const vid = v['currentVersion']['id'];
      expect(v).toMatchObject({ sensitive: true });
      expect(v['currentVersion']).toMatchObject({ encrypted: true, size: ATTESTATION.length });
      expect(JSON.stringify(v)).not.toContain('wrappedKey');
      const brut = (await objectOf(vid))!;
      expect(brut.contentType).toBe('application/octet-stream');
      expect(brut.body.subarray(0, 4).toString('latin1')).toBe('LLD1');
      expect(brut.body.includes(Buffer.from('%PDF-'))).toBe(false);
      expect(brut.body.includes(Buffer.from(MARQUE))).toBe(false);
      expect((await versionRow(vid))['wrappedKey']).toMatchObject({
        alg: 'aes-256-gcm',
        keyId: 'k1',
        last4: null,
      });

      const avant = await db
        .collection('audit_events')
        .countDocuments({ action: 'documents.sensitive_downloaded', targetId: doc.sensible });
      const dl = await download('viewer', doc.sensible, vid);
      expect(dl.status).toBe(200);
      expect((dl.body as Buffer).equals(ATTESTATION)).toBe(true);
      const traces = await db
        .collection('audit_events')
        .find({ action: 'documents.sensitive_downloaded', targetId: doc.sensible })
        .toArray();
      expect(traces.length).toBe(avant + 1);
      expect(traces.at(-1)).toMatchObject({ actorUserId: userIds['viewer'] });
      const journal = await db.collection('audit_events').find({ organizationId: orgN }).toArray();
      for (const morceau of [
        MARQUE,
        `Attestation sensible ${tag}`,
        'secret-tag',
        'attestation.pdf',
      ]) {
        expect(JSON.stringify(journal)).not.toContain(morceau);
      }
      // Un non-sensible est journalisé aussi (non strict).
      const d = await current(doc.divers);
      ok(await download('viewer', doc.divers, d['currentVersionId']));
      expect(
        await db
          .collection('audit_events')
          .countDocuments({
            action: 'documents.downloaded',
            targetId: doc.divers,
            actorUserId: userIds['viewer'],
          }),
      ).toBeGreaterThan(0);
      // Le Lecteur ne modifie pas un document sensible.
      expect(
        (await put('viewer', `/documents/${doc.sensible}`, { expectedRevision: 1, title: 'x' }))
          .status,
      ).toBe(403);
    });

    it('audit strict en échec : 503, rien n’est servi', async () => {
      const vid = (await current(doc.sensible))['currentVersionId'];
      const audit = app.get(AuditService);
      const spy = vi.spyOn(audit, 'recordStrict').mockRejectedValueOnce(new Error('panne'));
      try {
        const dl = await download('owner', doc.sensible, vid);
        expect(dl.status).toBe(503);
        expect((dl.body as Buffer).includes(Buffer.from(MARQUE))).toBe(false);
        expect(JSON.parse((dl.body as Buffer).toString('utf8'))['code']).toBe(
          'DOCUMENTS_AUDIT_UNAVAILABLE',
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('acteur plateforme : 404 sur le fichier sensible, sur la fiche et sur la liste', async () => {
      const vid = (await current(doc.sensible))['currentVersionId'];
      const res = await request(server())
        .get(`/documents/${doc.sensible}/versions/${vid}/file`)
        .set('Cookie', [...cookies['superAdmin'], `active_org_id=${orgN}`]);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(MARQUE);
      const fiche = await request(server())
        .get(`/documents/${doc.sensible}`)
        .set('Cookie', [...cookies['superAdmin'], `active_org_id=${orgN}`]);
      expect(fiche.status).toBe(404);
    });

    it('un objet chiffré recopié vers un autre document ne se déchiffre pas', async () => {
      const autre = ok(
        await upload(
          'accountant',
          { title: `Copie ${tag}`, folderId: folder.divers, sensitive: 'true' },
          pdf('autre'),
        ),
        201,
      );
      const source = await versionRow((await current(doc.sensible))['currentVersionId']);
      const cibleId = autre['currentVersion']['id'];
      const cible = await versionRow(cibleId);
      objects.set(
        `docs-test/documents/${cible['objectId']}`,
        (await objectOf(String(source._id)))!,
      );
      await db
        .collection('library_document_versions')
        .updateOne({ _id: cible._id }, { $set: { wrappedKey: source['wrappedKey'] } });
      const dl = await download('accountant', autre['id'], cibleId);
      expect(dl.status).toBe(500);
      expect(JSON.parse((dl.body as Buffer).toString('utf8'))['code']).toBe('DOCUMENT_UNREADABLE');
      expect((dl.body as Buffer).includes(Buffer.from(MARQUE))).toBe(false);
      // Hors du jeu de la rotation (clé volontairement fausse).
      await db
        .collection('library_document_versions')
        .updateOne({ _id: cible._id }, { $set: { wrappedKey: null } });
    });

    it('rotation k1 → k2 : la clé enveloppée seule change ; relu avec k2 seule ; rejouable', async () => {
      const k1 = { keyId: 'k1', key: CLE_K1 };
      const k2 = { keyId: 'k2', key: randomBytes(32) };
      const rewrap = new RewrapService(
        app.get<Model<IntegrationDocument>>(getModelToken(Integration.name)),
        app.get<Model<OrganizationSecretDocument>>(getModelToken(OrganizationSecret.name)),
        app.get<Connection>(getConnectionToken()),
        MasterKeyring.of([k2, k1], 'k2'),
        app.get(PlatformAuditService),
        app.get(SecretsService),
      );
      const vid = (await current(doc.sensible))['currentVersionId'];
      const objetAvant = (await objectOf(vid))!.body;
      const premier = await rewrap.run('operateur-1');
      expect(premier.remainingKeyIds).toEqual([]);
      expect(premier.rewrapped).toBeGreaterThanOrEqual(1);
      expect((await versionRow(vid))['wrappedKey']['keyId']).toBe('k2');
      expect((await objectOf(vid))!.body.equals(objetAvant)).toBe(true);
      const second = await rewrap.run('operateur-1');
      expect(second.rewrapped).toBe(0);

      const service = app.get(LibraryDocumentsService) as unknown as { keyring: MasterKeyring };
      const ancien = service.keyring;
      service.keyring = MasterKeyring.of([k2], 'k2');
      try {
        const dl = await download('owner', doc.sensible, vid);
        expect(dl.status).toBe(200);
        expect((dl.body as Buffer).equals(ATTESTATION)).toBe(true);
      } finally {
        service.keyring = ancien;
      }
      const traces = await db
        .collection('audit_events')
        .find({ action: 'secret.rewrapped', targetType: 'library_document_version' })
        .toArray();
      expect(traces.map((t) => t['targetId'])).toContain(vid);
      for (const t of traces) expect(t['metadata']).toEqual({ keyId: 'k2' });
      // Sans trousseau, un envoi sensible est refusé.
      service.keyring = null as unknown as MasterKeyring;
      try {
        code(
          await upload(
            'owner',
            { title: 'x', folderId: folder.divers, sensitive: 'true' },
            pdf('x'),
          ),
          503,
          'SECRETS_NOT_CONFIGURED',
        );
      } finally {
        service.keyring = ancien;
      }
    });
  });

  describe('métadonnées hors de l’URL et des en-têtes', () => {
    it('titre et étiquettes voyagent dans le formulaire ou le corps : jamais dans `req.url` ni les en-têtes', async () => {
      const TITRE = `Statuts de la société Kivu ${tag}`;
      const ETIQUETTE = `etiquette-${tag}`;
      const vus: { url: string; headers: string }[] = [];
      const http = server() as import('node:http').Server;
      const ecoute = (req: import('node:http').IncomingMessage) =>
        vus.push({ url: req.url ?? '', headers: JSON.stringify(req.rawHeaders) });
      http.on('request', ecoute);
      let id = '';
      try {
        const v = ok(
          await upload(
            'owner',
            {
              title: TITRE,
              folderId: folder.divers,
              nature: 'legal',
              tags: JSON.stringify([ETIQUETTE]),
            },
            pdf('statuts'),
            `${TITRE}.pdf`,
          ),
          201,
        );
        id = v['id'];
        expect(v).toMatchObject({ title: TITRE, tags: [ETIQUETTE] });
        const trouve = ok(
          await post('owner', '/documents/search', { text: 'société kivu', tags: [ETIQUETTE] }),
        );
        expect(trouve['items'].map((d: { id: string }) => d.id)).toEqual([id]);
        ok(
          await put('owner', `/documents/${id}`, {
            expectedRevision: 1,
            title: `${TITRE} (révisés)`,
            tags: [ETIQUETTE, 'statuts'],
          }),
        );
        ok(
          await upload(
            'owner',
            { note: TITRE },
            pdf('v2'),
            `${TITRE}-v2.pdf`,
            `/documents/${id}/versions`,
          ),
          201,
        );
      } finally {
        http.off('request', ecoute);
      }
      const docs = vus.filter((r) => r.url.startsWith('/documents'));
      expect(docs.length).toBe(4);
      for (const r of docs) {
        for (const morceau of [TITRE, encodeURIComponent(TITRE), 'Kivu', ETIQUETTE, 'kivu']) {
          expect(r.url).not.toContain(morceau);
          expect(r.headers).not.toContain(morceau);
        }
      }
      // Une recherche par l'URL est refusée, jamais ignorée en silence.
      code(await get('owner', `/documents?title=Statuts`), 400, 'INVALID_REQUEST');
      code(await get('owner', `/documents?q=Statuts`), 400, 'INVALID_REQUEST');
      code(await get('owner', `/documents?tags=${ETIQUETTE}`), 400, 'INVALID_REQUEST');
      // Un champ de formulaire inconnu est refusé.
      code(
        await upload('owner', { title: 'x', folderId: folder.divers, intrus: '1' }, pdf('x')),
        400,
        'INVALID_REQUEST',
      );
    });
  });

  describe('recherche, échéances, rappels', () => {
    it('recherche par titre sans accents, étiquettes, nature, entité, dossier ; filtrée avant pagination', async () => {
      const titre = ok(await post('viewer', '/documents/search', { text: 'BAIL gombe' }));
      expect(titre['items'].map((d: { id: string }) => d.id)).toEqual([doc.divers]);
      const nature = ok(await post('owner', '/documents/search', { nature: 'certificate' }));
      expect(nature['items'].map((d: { id: string }) => d.id)).toContain(doc.fiscal);
      // Le Magasinier ne voit ni le fiscal ni le document lié au fournisseur.
      const mag = ok(await post('storekeeper', '/documents/search', { limit: 100 }));
      const vus = mag['items'].map((d: { id: string }) => d.id);
      expect(vus).not.toContain(doc.fiscal);
      expect(vus).not.toContain(doc.fournisseur);
      expect(vus).not.toContain(doc.restreint);
      expect(mag['total']).toBe(vus.length);
      const entite = ok(
        await post('viewer', '/documents/search', {
          entity: { entityType: 'supplier', entityId: entity.supplier },
        }),
      );
      expect(entite['items'].map((d: { id: string }) => d.id)).toEqual([doc.fournisseur]);
      // Pagination par curseur sur les seuls lisibles.
      const p1 = ok(await post('owner', '/documents/search', { limit: 2 }));
      expect(p1['items']).toHaveLength(2);
      expect(p1['nextCursor']).not.toBeNull();
      const p2 = ok(
        await post('owner', '/documents/search', { limit: 2, cursor: p1['nextCursor'] }),
      );
      expect(p2['items'][0]['id']).not.toBe(p1['items'][0]['id']);
      expect(p2['total']).toBe(p1['total']);
      code(await post('owner', '/documents/search', { cursor: '!!' }), 400, 'INVALID_CURSOR');
      // Jamais dans le contenu : le texte du PDF n'est pas trouvé.
      expect(ok(await post('owner', '/documents/search', { text: MARQUE }))['total']).toBe(0);
    });

    it('échéances filtrées par les droits ; rappel unique à l’auteur et aux gestionnaires qui peuvent lire', async () => {
      const pourCompta = ok(await get('accountant', '/documents/deadlines'));
      expect(pourCompta['items'].map((i: { document: { id: string } }) => i.document.id)).toContain(
        doc.fiscal,
      );
      expect(pourCompta['items'][0]).toMatchObject({ status: 'due_soon' });
      expect(
        ok(await get('storekeeper', '/documents/deadlines'))['items'].map(
          (i: { document: { id: string } }) => i.document.id,
        ),
      ).not.toContain(doc.fiscal);
      // Un document du dossier restreint qui expire : l'Administrateur n'en sait rien.
      ok(
        await put('analyst', `/documents/${doc.restreint}`, {
          expectedRevision: 1,
          expiresOn: futur(5),
        }),
      );

      const jobs = app.get(DocumentsJobs);
      const envoyees: NotificationInput[] = [];
      const ancien = jobs.port;
      jobs.port = { notify: async (n) => void envoyees.push(n) };
      try {
        const huitHeures = new Date(`${aujourdhui()}T07:30:00Z`);
        const rapport = await jobs.reminders(huitHeures);
        expect(rapport.claimed).toBeGreaterThanOrEqual(2);
        const pour = (documentId: string) =>
          envoyees
            .filter((n) => n.source.entityId === documentId)
            .map((n) => n.recipientUserId)
            .sort();
        // Fiscal : auteur (Comptable) et gestionnaires qui lisent `treasury.read` — pas le
        // Responsable RH (gestionnaire sans `treasury.read`).
        expect(pour(doc.fiscal)).toEqual(
          [userIds['owner'], userIds['admin'], userIds['accountant']].sort(),
        );
        // Restreint : auteur (Analyste) et le seul Propriétaire parmi les gestionnaires.
        expect(pour(doc.restreint)).toEqual([userIds['owner'], userIds['analyst']].sort());
        for (const n of envoyees) {
          expect(n).toMatchObject({ kind: 'documents.expiring', requiredAction: 'docs.read' });
          expect(n.title).not.toContain(tag);
        }
        const rejoue = await jobs.reminders(huitHeures);
        expect(rejoue.claimed).toBe(0);
        // Avant 7 h à Kinshasa : rien.
        expect((await jobs.reminders(new Date(`${aujourdhui()}T04:00:00Z`))).claimed).toBe(0);
      } finally {
        jobs.port = ancien;
      }
    });
  });

  describe('archivage, suppression, purge', () => {
    it('archiver puis restaurer ; supprimer (404) ; purge après 30 jours : objets et clés effacés', async () => {
      const d = await current(doc.sensible);
      const archive = ok(
        await post('accountant', `/documents/${doc.sensible}/archive`, {
          expectedRevision: d['revision'],
        }),
      );
      expect(archive['status']).toBe('archived');
      expect(
        ok(await get('accountant', `/documents?folderId=${folder.divers}`))['items'].map(
          (x: { id: string }) => x.id,
        ),
      ).not.toContain(doc.sensible);
      expect(
        ok(
          await post('accountant', '/documents/search', {
            includeArchived: true,
            nature: 'certificate',
          }),
        )['items'].map((x: { id: string }) => x.id),
      ).toContain(doc.sensible);
      ok(
        await post('accountant', `/documents/${doc.sensible}/restore`, {
          expectedRevision: archive['revision'],
        }),
      );
      expect((await del('viewer', `/documents/${doc.sensible}`)).status).toBe(403);
      expect((await del('accountant', `/documents/${doc.sensible}`)).status).toBe(204);
      code(await get('accountant', `/documents/${doc.sensible}`), 404, 'DOCUMENT_NOT_FOUND');
      const versions = await db
        .collection('library_document_versions')
        .find({ documentId: doc.sensible })
        .toArray();
      // Rien n'est effacé avant 30 jours.
      const service = app.get(LibraryDocumentsService);
      expect((await service.purge(new Date())).documents).toBe(0);
      const rapport = await service.purge(new Date(Date.now() + 31 * 86_400_000));
      expect(rapport.documents).toBeGreaterThanOrEqual(1);
      for (const v of versions) {
        expect(objects.has(`docs-test/documents/${v['objectId']}`)).toBe(false);
        const apres = await versionRow(String(v._id));
        expect(apres['wrappedKey']).toBeNull();
        expect(apres['purgedAt']).not.toBeNull();
      }
      const trace = await db
        .collection('audit_events')
        .findOne({ action: 'documents.deleted', targetId: doc.sensible });
      expect(trace).not.toBeNull();
    });
  });
});

function aujourdhui(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function futur(jours: number): string {
  const d = new Date(`${aujourdhui()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
