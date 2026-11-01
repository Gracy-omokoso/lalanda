// Équipements contre la vraie application (ADR-0046 § 3, § 5.2, § 8 ; critères 1, 13,
// 14, 19, 20). ADR-0046 — S5.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Couvre : droits par rôle (Responsable RH et Magasinier en lecture seule, sans
// valeurs ; Commercial et Conseiller refusés), registre et numérotation `EQ-…`,
// affectations (clôture de la précédente, refus de chevauchement par le moteur),
// maintenance (récurrence au moteur, fin de mois), couvertures (échéance, rappel unique),
// cession déclarée puis réouverture, estimation de gestion (non estimable sans durée,
// puis estimée), lien avec une facture fournisseur, isolation entre organisations
// (identifiants forgés dans les corps compris), aucune fuite RH.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetsRemindersJob } from '../assets/reminders/assets-reminders.job.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { kinshasaDayOf } from '../sales/receipts/kinshasa-day.js';
import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Clés interdites dans tout ce qui décrit un collaborateur affecté (aucune donnée RH). */
const HR_FORBIDDEN_KEYS = [
  'workEmail',
  'workPhone',
  'notes',
  'contractType',
  'startDate',
  'employeeNumber',
  'managerEmployeeId',
  'departmentId',
  'private',
  'salary',
  'exitCategory',
];

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

e2eSuite('Équipements — registre, affectations, maintenance, couvertures (ADR-0046 S5)', () => {
  let fx: HrFixture;
  let db: Db;
  let storekeeper: string[] = [];
  let storekeeperId = '';
  let categoryId = '';
  let categoryB = '';
  /** Fiches RH : E1 (actif, données marquées), E2 (sortira), EB (organisation B). */
  const emp = { E1: '', E2: '', EB: '' };
  let projectId = '';
  const supplier = { N: '', B: '' };
  const invoice = { N: '', B: '', other: '' };
  const notices: NotificationInput[] = [];

  const sk = {
    get: (path: string) => request(fx.app.getHttpServer()).get(path).set('Cookie', storekeeper),
    post: (path: string, body: unknown = {}) =>
      request(fx.app.getHttpServer())
        .post(path)
        .set('Cookie', storekeeper)
        .send(body as object),
  };

  const del = (path: string) =>
    request(fx.app.getHttpServer()).delete(path).set('Cookie', fx.as('owner'));

  const newAsset = async (name: string, extra: Record<string, unknown> = {}) =>
    ok(
      await fx.post('owner', '/assets', {
        name,
        categoryId,
        acquisition: { on: '2026-01-15', cost: '1200.00', currency: 'USD' },
        ...extra,
      }),
      201,
    );

  beforeAll(async () => {
    fx = await hrFixture(tag, 'equipements');
    db = fx.db;
    // Magasinier : invité par le Propriétaire (ADR-0046 § 8.2).
    const email = `equipements-storekeeper-${tag}@lalanda-test.local`;
    const inv = await fx.post('owner', `/organizations/${fx.orgN}/invitations`, {
      email,
      role: 'storekeeper',
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const cookies = await registerAndLogin(fx.app, {
      email,
      password: `Passw0rd!equipements`,
      name: `Magasinier ${tag}`,
    });
    const acc = await request(fx.app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', cookies)
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);
    storekeeper = [...cookies, `active_org_id=${fx.orgN}`];
    const s = await request(fx.app.getHttpServer()).get('/auth/get-session').set('Cookie', cookies);
    storekeeperId = String(s.body.user.id);

    // Fiches RH (R4), avec des données qui ne doivent JAMAIS sortir par le registre.
    emp.E1 = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche(`Mbuyi ${tag}`, {
          firstName: 'Aline',
          jobTitle: 'Technicienne',
          workEmail: `aline-secret-${tag}@exemple.cd`,
          notes: `NOTE-RH-SECRETE-${tag}`,
          employeeNumber: `MAT-${tag}`,
        }),
      ),
      201,
    )['id'];
    emp.E2 = ok(await fx.post('hr_manager', '/hr/employees', fiche(`Kasongo ${tag}`)), 201)['id'];
    emp.EB = ok(await fx.post('ownerB', '/hr/employees', fiche(`Ilunga ${tag}`)), 201)['id'];

    projectId = ok(
      await fx.post('owner', '/work/projects', { name: `Chantier ${tag}`, kind: 'internal' }),
      201,
    )['id'];

    // Fournisseurs et factures fournisseurs (R3) : posés en base, seuls leurs
    // identifiants et leur organisation comptent pour le lien (aucune écriture R5).
    const now = new Date();
    for (const org of ['N', 'B'] as const) {
      const organizationId = org === 'N' ? fx.orgN : fx.orgB;
      const sid = new ObjectId();
      await db.collection('suppliers').insertOne({
        _id: sid,
        organizationId,
        name: `Fournisseur ${org} ${tag}`,
        createdAt: now,
        updatedAt: now,
      });
      supplier[org] = sid.toHexString();
      const iid = new ObjectId();
      await db.collection('supplier_invoices').insertOne({
        _id: iid,
        organizationId,
        supplierId: supplier[org],
        internalNumber: `FF2601-00000${org === 'N' ? 1 : 2}`,
        status: 'validated',
        createdAt: now,
        updatedAt: now,
      });
      invoice[org] = iid.toHexString();
    }
    const other = new ObjectId();
    await db.collection('supplier_invoices').insertOne({
      _id: other,
      organizationId: fx.orgN,
      supplierId: new ObjectId().toHexString(),
      status: 'validated',
      createdAt: now,
      updatedAt: now,
    });
    invoice.other = other.toHexString();

    // Observer les notifications des rappels sans changer le port réel.
    const job = fx.app.get(AssetsRemindersJob);
    const real = job.port;
    job.port = {
      notify: async (n: NotificationInput) => {
        notices.push(n);
        await real.notify(n);
      },
    };
  }, E2E_HOOK_TIMEOUT_MS);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, E2E_HOOK_TIMEOUT_MS);

  describe('catégories et réglages', () => {
    it('six catégories proposées sans durée ; réglages par défaut', async () => {
      const cats = ok(await fx.get('owner', '/assets/categories'))['items'] as {
        id: string;
        name: string;
      }[];
      expect(cats.map((c) => c.name).sort()).toEqual(
        [
          'Autre',
          'Informatique',
          'Machines et outillage',
          'Mobilier',
          'Téléphonie',
          'Véhicules',
        ].sort(),
      );
      for (const c of cats) expect(Object.keys(c)).not.toContain('years');
      categoryId = cats.find((c) => c.name === 'Informatique')!.id;
      expect(ok(await fx.get('hr_manager', '/assets/settings'))).toMatchObject({
        reminderDays: 30,
        maintenanceDueSoonDays: 7,
        showDepreciationEstimate: true,
        isDefault: true,
        revision: 0,
      });
      code(
        await fx.post('owner', '/assets/categories', { name: 'informatique' }),
        409,
        'ASSET_CATEGORY_NAME_EXISTS',
      );
      ok(await fx.post('owner', '/assets/categories', { name: `Outils ${tag}` }), 201);
      categoryB = (
        ok(await fx.get('ownerB', '/assets/categories'))['items'] as { id: string }[]
      )[0]!.id;
    });
  });

  describe('droits par rôle (critère 1)', () => {
    it('lecture seule et valeurs masquées pour le Responsable RH et le Magasinier', async () => {
      const a = await newAsset(`Portable droits ${tag}`);
      expect(a['number']).toMatch(/^EQ-\d{6}$/);
      expect(a['valuesHidden']).toBe(false);
      expect(a['acquisition']['cost']).toBe('1200.00');

      for (const res of [
        await fx.get('hr_manager', `/assets/${a['id']}`),
        await sk.get(`/assets/${a['id']}`),
      ]) {
        const v = ok(res);
        expect(v['valuesHidden']).toBe(true);
        expect(v['acquisition']['cost']).toBeNull();
        expect(v['managementEstimate']).toBeNull();
        expect(v['totalCostOfOwnership']).toBeNull();
      }
      const list = ok(await sk.get('/assets'));
      expect(list['valuesHidden']).toBe(true);
      expect(
        list['items'].every((i: { acquisition: { cost: unknown } }) => i.acquisition.cost === null),
      ).toBe(true);
      const reports = ok(await fx.get('hr_manager', '/assets/reports'));
      expect(reports).toMatchObject({
        valuesHidden: true,
        acquisitionCosts: null,
        managementEstimate: null,
      });

      const body = {
        name: 'Refusé',
        categoryId,
        acquisition: { on: '2026-01-15', cost: '1.00', currency: 'USD' },
      };
      expect((await fx.post('hr_manager', '/assets', body)).status).toBe(403);
      expect((await sk.post('/assets', body)).status).toBe(403);
      expect(
        (
          await sk.post(`/assets/${a['id']}/assign`, {
            expectedRevision: a['revision'],
            assignee: { kind: 'member', userId: storekeeperId },
          })
        ).status,
      ).toBe(403);
      for (const role of ['sales_rep', 'advisor'] as const) {
        expect((await fx.get(role, '/assets')).status).toBe(403);
        expect((await fx.get(role, `/assets/${a['id']}`)).status).toBe(403);
      }
      // Gestion : Propriétaire, Administrateur, Directeur financier, Comptable.
      for (const role of ['admin', 'finance_director', 'accountant'] as const) {
        const r = ok(
          await fx.put(role, `/assets/${a['id']}`, {
            expectedRevision: ok(await fx.get(role, `/assets/${a['id']}`))['revision'],
            notes: `par ${role}`,
          }),
        );
        expect(r['notes']).toBe(`par ${role}`);
      }
      // L'Analyste et le Lecteur lisent (valeurs selon leurs droits d'achats ou de
      // trésorerie), sans gérer.
      ok(await fx.get('viewer', `/assets/${a['id']}`));
      expect((await fx.post('analyst', '/assets', body)).status).toBe(403);
    });

    it('export du registre : `report.export` en plus, audit strict', async () => {
      const res = await fx.get('owner', '/assets/export.csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Numéro;');
      const audit = await db
        .collection('audit_events')
        .findOne({ organizationId: fx.orgN, action: 'assets.register.exported' });
      expect(audit).not.toBeNull();
      expect((await sk.get('/assets/export.csv')).status).toBe(403);
    });
  });

  describe('estimation de gestion (critère 14)', () => {
    it('« non estimable » sans durée, puis estimée et étiquetée', async () => {
      const a = await newAsset(`Portable estimation ${tag}`);
      const sans = ok(await fx.get('owner', `/assets/${a['id']}?on=2026-12-31`));
      expect(sans['managementDepreciation']).toBeNull();
      expect(sans['managementEstimate']).toMatchObject({
        label: 'management_estimate',
        estimable: false,
        reason: 'NO_DURATION',
        estimatedValue: null,
      });
      expect(sans['managementEstimate']['notice']).toContain('Estimation de gestion');

      ok(
        await fx.put('owner', `/assets/${a['id']}`, {
          expectedRevision: sans['revision'],
          managementDepreciation: { years: 3, residualValue: '0', startOn: '2026-01-15' },
        }),
      );
      const avec = ok(await fx.get('owner', `/assets/${a['id']}?on=2026-12-31`));
      expect(avec['managementEstimate']).toMatchObject({
        label: 'management_estimate',
        estimable: true,
        currency: 'USD',
        estimatedValue: '800.00',
        monthsTotal: 36,
        monthsElapsed: 12,
      });
      expect(avec['managementEstimate']['notice']).toContain(
        'n’est pas un amortissement comptable ou fiscal',
      );
      // Aucune durée par défaut : `years` est obligatoire.
      expect(
        (
          await fx.put('owner', `/assets/${a['id']}`, {
            expectedRevision: avec['revision'],
            managementDepreciation: { residualValue: '0', startOn: '2026-01-15' },
          })
        ).status,
      ).toBe(400);
      const reports = ok(await fx.get('owner', '/assets/reports?on=2026-12-31'));
      expect(reports['managementEstimate']).toMatchObject({ label: 'management_estimate' });
      expect(reports['managementEstimate']['notEstimable']).toBeGreaterThan(0);
    });
  });

  describe('coût d’acquisition inconnu (ADR-0041 : gérer sans voir les valeurs)', () => {
    it('créé sans coût par un membre qui ne voit pas les valeurs : inconnu, jamais « 0 »', async () => {
      const server = fx.app.getHttpServer();
      const permissions = async (grants: string[]): Promise<void> => {
        const membres = ok(
          await request(server)
            .get(`/organizations/${fx.orgN}/members`)
            .set('Cookie', fx.as('owner')),
        );
        const rev = (membres['members'] as { userId: string; permissionsRevision: number }[]).find(
          (m) => m.userId === storekeeperId,
        )!.permissionsRevision;
        const res = await request(server)
          .patch(`/organizations/${fx.orgN}/members/${storekeeperId}/permissions`)
          .set('Cookie', fx.as('owner'))
          .send({ grants, revokes: [], expectedRevision: rev });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      };
      const interrupteur = process.env['MEMBER_PERMISSIONS_ENABLED'];
      process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
      try {
        // Magasinier + `assets.manage`, sans `purchase.read` ni `treasury.read`.
        await permissions(['assets.manage']);
        const cree = ok(
          await sk.post('/assets', {
            name: `Écran sans coût ${tag}`,
            categoryId,
            acquisition: { on: '2026-02-01', currency: 'USD' },
          }),
          201,
        );
        expect(cree['valuesHidden']).toBe(true);
        const id = cree['id'] as string;
        const stocke = await db.collection('assets').findOne({ _id: new ObjectId(id) });
        expect(stocke!['acquisition']['cost']).toBeNull();

        // Le Propriétaire voit les valeurs : coût inconnu, coût total non estimable.
        const vu = ok(await fx.get('owner', `/assets/${id}?on=2026-12-31`));
        expect(vu['valuesHidden']).toBe(false);
        expect(vu['acquisition']['cost']).toBeNull();
        expect(vu['totalCostOfOwnership']).toMatchObject({
          estimable: false,
          reason: 'UNKNOWN_COST',
          byCurrency: [],
        });
        const avecDuree = ok(
          await fx.put('owner', `/assets/${id}`, {
            expectedRevision: vu['revision'],
            managementDepreciation: { years: 3, residualValue: '0', startOn: '2026-02-01' },
          }),
        );
        const estime = ok(await fx.get('owner', `/assets/${id}?on=2026-12-31`));
        expect(estime['managementEstimate']).toMatchObject({
          estimable: false,
          reason: 'UNKNOWN_COST',
          estimatedValue: null,
        });
        const rapports = ok(await fx.get('owner', '/assets/reports?on=2026-12-31'));
        expect(rapports['unknownCostCount']).toBeGreaterThanOrEqual(1);
        expect(rapports['activeUnknownCostCount']).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(rapports['activeAcquisitionCosts'])).not.toContain('"count":0');

        // Le Propriétaire complète le coût ; le Magasinier modifie l'acquisition sans
        // coût (il ne le voit pas) : le coût enregistré est conservé, pas effacé.
        ok(
          await fx.put('owner', `/assets/${id}`, {
            expectedRevision: avecDuree['revision'],
            acquisition: { on: '2026-02-01', cost: '450.00', currency: 'USD' },
          }),
        );
        const rev = ok(await sk.get(`/assets/${id}`))['revision'];
        ok(
          await request(server)
            .put(`/assets/${id}`)
            .set('Cookie', storekeeper)
            .send({
              expectedRevision: rev,
              acquisition: { on: '2026-02-03', currency: 'USD', note: 'date corrigée' },
            }),
        );
        const complete = ok(await fx.get('owner', `/assets/${id}?on=2026-12-31`));
        expect(complete['acquisition']).toMatchObject({ on: '2026-02-03', cost: '450.00' });
        expect(complete['totalCostOfOwnership']).toMatchObject({ estimable: true, reason: null });
        expect(complete['managementEstimate']['estimable']).toBe(true);
      } finally {
        await permissions([]);
        if (interrupteur === undefined) delete process.env['MEMBER_PERMISSIONS_ENABLED'];
        else process.env['MEMBER_PERMISSIONS_ENABLED'] = interrupteur;
      }
    });

    it('compatibilité : un équipement existant garde son coût ; un document sans le champ se lit « inconnu »', async () => {
      const a = await newAsset(`Portable ancien ${tag}`);
      const lu = ok(await fx.get('owner', `/assets/${a['id']}`));
      expect(lu['acquisition']['cost']).toBe('1200.00');
      expect(lu['totalCostOfOwnership']).toMatchObject({ estimable: true });
      await db
        .collection('assets')
        .updateOne({ _id: new ObjectId(a['id']) }, { $unset: { 'acquisition.cost': '' } });
      const sansChamp = ok(await fx.get('owner', `/assets/${a['id']}`));
      expect(sansChamp['acquisition']['cost']).toBeNull();
      expect(sansChamp['totalCostOfOwnership']).toMatchObject({
        estimable: false,
        reason: 'UNKNOWN_COST',
      });
      expect((await fx.get('owner', '/assets/reports')).status).toBe(200);
      expect((await fx.get('owner', '/assets/export.csv')).status).toBe(200);
    });
  });

  describe('affectations (critère 13)', () => {
    it('réaffecter clôt l’ouverte ; chevauchement et doublon refusés ; retour', async () => {
      const a = await newAsset(`Portable affecté ${tag}`);
      const one = ok(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: a['revision'],
          assignee: { kind: 'employee', employeeId: emp.E1 },
          from: '2026-03-01',
          conditionOut: 'Neuf',
        }),
      );
      expect(one['status']).toBe('in_service');
      expect(one['currentAssignment']['assignee']).toEqual({
        kind: 'employee',
        employeeId: emp.E1,
        name: `Aline Mbuyi ${tag}`,
        jobTitle: 'Technicienne',
        exited: false,
      });
      code(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: one['revision'],
          assignee: { kind: 'project', workProjectId: projectId },
          from: '2026-02-01',
        }),
        409,
        'ASSET_ASSIGNMENT_OVERLAP',
      );
      code(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: one['revision'],
          assignee: { kind: 'employee', employeeId: emp.E1 },
          from: '2026-04-01',
        }),
        409,
        'ASSET_ALREADY_ASSIGNED',
      );
      code(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: 1,
          assignee: { kind: 'project', workProjectId: projectId },
          from: '2026-04-01',
        }),
        409,
        'STALE_REVISION',
      );
      const two = ok(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: one['revision'],
          assignee: { kind: 'project', workProjectId: projectId },
          from: '2026-04-01',
        }),
      );
      expect(two['currentAssignment']['assignee']).toMatchObject({
        kind: 'project',
        name: `Chantier ${tag}`,
      });
      const hist = ok(await fx.get('hr_manager', `/assets/${a['id']}/assignments`));
      expect(hist['valid']).toBe(true);
      expect(hist['items'].map((i: { from: string; to: string | null }) => [i.from, i.to])).toEqual(
        [
          ['2026-03-01', '2026-04-01'],
          ['2026-04-01', null],
        ],
      );
      // Une seule affectation ouverte en base.
      expect(
        await db.collection('asset_assignments').countDocuments({ assetId: a['id'], to: null }),
      ).toBe(1);

      code(
        await fx.post('owner', `/assets/${a['id']}/return`, {
          expectedRevision: two['revision'],
          on: '2026-03-15',
        }),
        409,
        'ASSET_RETURN_BEFORE_HANDOVER',
      );
      const back = ok(
        await fx.post('owner', `/assets/${a['id']}/return`, {
          expectedRevision: two['revision'],
          on: '2026-05-01',
          conditionIn: 'Bon état',
        }),
      );
      expect(back['currentAssignment']).toBeNull();
      expect(back['status']).toBe('in_storage');
      code(
        await fx.post('owner', `/assets/${a['id']}/return`, { expectedRevision: back['revision'] }),
        409,
        'ASSET_NOT_ASSIGNED',
      );
      // Filtre par collaborateur : la fiche « Matériel affecté » (§ 6.5).
      ok(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: back['revision'],
          assignee: { kind: 'employee', employeeId: emp.E1 },
          from: '2026-06-01',
        }),
      );
      const held = ok(await fx.get('hr_manager', `/assets?employeeId=${emp.E1}`));
      expect(held['items'].map((i: { id: string }) => i.id)).toEqual([a['id']]);
    });

    it('aucune fuite RH : nom d’usage et poste seulement', async () => {
      const list = await fx.get('hr_manager', `/assets?employeeId=${emp.E1}`);
      const detail = await sk.get(`/assets/${list.body.items[0].id}`);
      const hist = await sk.get(`/assets/${list.body.items[0].id}/assignments`);
      const csv = await fx.get('owner', '/assets/export.csv');
      for (const res of [list, detail, hist]) {
        expect(res.status).toBe(200);
        const keys = collectKeys(
          (res.body.items ?? [res.body]).map(
            (x: { currentAssignment?: { assignee: unknown }; assignee?: unknown }) =>
              x.currentAssignment?.assignee ?? x.assignee ?? null,
          ),
        );
        for (const k of HR_FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
      }
      for (const text of [
        JSON.stringify(list.body),
        JSON.stringify(detail.body),
        JSON.stringify(hist.body),
        csv.text,
      ]) {
        expect(text).not.toContain(`aline-secret-${tag}`);
        expect(text).not.toContain(`NOTE-RH-SECRETE-${tag}`);
        expect(text).not.toContain(`MAT-${tag}`);
      }
    });

    it('un collaborateur sorti qui garde un équipement lève le constat', async () => {
      const a = await newAsset(`Téléphone ${tag}`);
      ok(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: a['revision'],
          assignee: { kind: 'employee', employeeId: emp.E2 },
          from: '2026-02-01',
        }),
      );
      await db
        .collection('hr_employees')
        .updateOne(
          { _id: new ObjectId(emp.E2) },
          { $set: { status: 'exited', endDate: '2026-09-30' } },
        );
      const v = ok(await fx.get('owner', `/assets/${a['id']}`));
      expect(v['findings']).toContain('ASSET_HELD_BY_FORMER_EMPLOYEE');
      expect(v['currentAssignment']['assignee']['exited']).toBe(true);
      const d = ok(await fx.get('owner', '/assets/deadlines'));
      expect(
        d['items'].some(
          (x: { kind: string; assetId: string }) =>
            x.kind === 'held_by_former_employee' && x.assetId === a['id'],
        ),
      ).toBe(true);
      // Une fiche sortie ne reçoit plus de matériel.
      const b = await newAsset(`Tablette ${tag}`);
      code(
        await fx.post('owner', `/assets/${b['id']}/assign`, {
          expectedRevision: b['revision'],
          assignee: { kind: 'employee', employeeId: emp.E2 },
        }),
        409,
        'EMPLOYEE_NOT_ACTIVE',
      );
    });
  });

  describe('maintenance et échéances (critère 13)', () => {
    it('préventive tous les 6 mois faite le 31 août → suivante au 28 févr.', async () => {
      const a = await newAsset(`Groupe électrogène ${tag}`, { status: 'in_service' });
      const m = ok(
        await fx.post('owner', `/assets/${a['id']}/maintenance`, {
          kind: 'preventive',
          plannedOn: '2025-08-31',
          recurrence: { everyMonths: 6 },
        }),
        201,
      );
      const done = ok(
        await fx.post('owner', `/assets/${a['id']}/maintenance/${m['id']}/done`, {
          expectedRevision: m['revision'],
          doneOn: '2025-08-31',
          cost: '45.00',
          currency: 'USD',
        }),
      );
      expect(done['status']).toBe('done');
      expect(done['nextId']).not.toBeNull();
      // Rejeu : rien de plus.
      ok(
        await fx.post('owner', `/assets/${a['id']}/maintenance/${m['id']}/done`, {
          expectedRevision: done['revision'],
          doneOn: '2025-08-31',
        }),
      );
      const list = ok(await fx.get('owner', `/assets/${a['id']}/maintenance`));
      expect(list['items']).toHaveLength(2);
      const next = list['items'].find((i: { id: string }) => i.id === done['nextId']);
      expect(next).toMatchObject({
        status: 'planned',
        plannedOn: '2026-02-28',
        kind: 'preventive',
      });
      // Coût informatif, masqué sans valeurs ; aucune dépense créée.
      const hidden = ok(await fx.get('hr_manager', `/assets/${a['id']}/maintenance`));
      expect(hidden['valuesHidden']).toBe(true);
      expect(hidden['items'].every((i: { cost: unknown }) => i.cost === null)).toBe(true);
      expect(
        await db.collection('treasury_expenses').countDocuments({ organizationId: fx.orgN }),
      ).toBe(0);
      // L'intervention suivante (fév. 2026) est en retard aujourd'hui : échéance.
      const d = ok(await fx.get('owner', '/assets/deadlines'));
      expect(
        d['items'].some(
          (x: { kind: string; refId: string }) =>
            x.kind === 'maintenance_overdue' && x.refId === done['nextId'],
        ),
      ).toBe(true);
      // Coût total de possession au moteur, par devise.
      const detail = ok(await fx.get('owner', `/assets/${a['id']}`));
      expect(detail['totalCostOfOwnership']['byCurrency']).toEqual([
        {
          currency: 'USD',
          acquisition: '1200.00',
          maintenance: '45.00',
          coverages: '0.00',
          total: '1245.00',
        },
      ]);
      code(
        await fx.post('owner', `/assets/${a['id']}/maintenance`, {
          kind: 'corrective',
          plannedOn: '2026-11-01',
          recurrence: { everyMonths: 3 },
        }),
        400,
        'INVALID_REQUEST',
      );
    });

    it('garantie qui expire dans 20 jours (rappel 30) → une seule notification', async () => {
      const today = kinshasaDayOf(new Date());
      const a = await newAsset(`Imprimante ${tag}`);
      const c = ok(
        await fx.post('owner', `/assets/${a['id']}/coverages`, {
          kind: 'warranty',
          provider: 'Constructeur',
          reference: 'GAR-1',
          startOn: '2025-01-01',
          endOn: addDays(today, 20),
          cost: '30.00',
          currency: 'USD',
        }),
        201,
      );
      expect(c['expiry']).toBe('due_soon');
      const d = ok(await fx.get('hr_manager', '/assets/deadlines'));
      expect(
        d['items'].some(
          (x: { kind: string; refId: string }) =>
            x.kind === 'coverage_due_soon' && x.refId === c['id'],
        ),
      ).toBe(true);

      const job = fx.app.get(AssetsRemindersJob);
      const at = new Date(`${today}T09:00:00Z`); // 10 h à Kinshasa
      notices.length = 0;
      await job.run(at);
      const mine = () =>
        notices.filter(
          (n) => n.kind === 'assets.coverage_expiring' && n.source.entityId === a['id'],
        );
      const first = mine();
      // Destinataires : détenteurs EFFECTIFS de `assets.manage` (P, ADM, DIR, CPT).
      expect(new Set(first.map((n) => n.recipientUserId))).toEqual(
        new Set(
          (['owner', 'admin', 'finance_director', 'accountant'] as const).map((r) => fx.userIds[r]),
        ),
      );
      expect(new Set(first.map((n) => n.dedupeKey)).size).toBe(1);
      for (const n of first) {
        expect(n.requiredAction).toBe('assets.read');
        expect(n.title).not.toContain('30.00');
      }
      await job.run(at);
      expect(mine()).toHaveLength(first.length);

      // Modifier, puis supprimer la couverture.
      const up = ok(
        await fx.put('owner', `/assets/${a['id']}/coverages/${c['id']}`, {
          expectedRevision: c['revision'],
          endOn: addDays(today, 400),
        }),
      );
      expect(up['expiry']).toBe('ok');
      expect(ok(await sk.get(`/assets/${a['id']}/coverages`))['items'][0]['cost']).toBeNull();
      ok(await del(`/assets/${a['id']}/coverages/${c['id']}`));
      expect(ok(await fx.get('owner', `/assets/${a['id']}/coverages`))['items']).toHaveLength(0);
    });
  });

  describe('cession déclarée', () => {
    it('clôt l’affectation, verrouille la fiche, ne crée ni facture ni encaissement ; réouverture', async () => {
      const salesBefore = await db.collection('sales_invoices').countDocuments({});
      const expensesBefore = await db.collection('treasury_expenses').countDocuments({});
      const a = await newAsset(`Véhicule ${tag}`);
      const assigned = ok(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: a['revision'],
          assignee: { kind: 'member', userId: storekeeperId },
          from: '2026-02-01',
        }),
      );
      expect(assigned['currentAssignment']['assignee']).toMatchObject({
        kind: 'member',
        name: `Magasinier ${tag}`,
      });
      code(
        await fx.post('owner', `/assets/${a['id']}/dispose`, {
          expectedRevision: assigned['revision'],
          on: '2026-09-01',
          kind: 'sold',
          proceeds: '500.00',
          reason: 'Vendu',
        }),
        400,
        'INVALID_REQUEST',
      );
      const sold = ok(
        await fx.post('owner', `/assets/${a['id']}/dispose`, {
          expectedRevision: assigned['revision'],
          on: '2026-09-01',
          kind: 'sold',
          proceeds: '500.00',
          currency: 'USD',
          buyer: 'Garage du centre',
          reason: 'Vendu',
        }),
      );
      expect(sold).toMatchObject({ status: 'disposed', currentAssignment: null });
      expect(sold['disposal']).toMatchObject({
        on: '2026-09-01',
        kind: 'sold',
        proceeds: '500.00',
      });
      expect(
        ok(await fx.get('hr_manager', `/assets/${a['id']}`))['disposal']['proceeds'],
      ).toBeNull();
      const hist = ok(await fx.get('owner', `/assets/${a['id']}/assignments`));
      expect(hist['items'][0]['to']).toBe('2026-09-01');
      expect(await db.collection('sales_invoices').countDocuments({})).toBe(salesBefore);
      expect(await db.collection('treasury_expenses').countDocuments({})).toBe(expensesBefore);
      expect(
        await db.collection('audit_events').countDocuments({
          organizationId: fx.orgN,
          action: 'assets.disposed',
          targetId: a['id'],
        }),
      ).toBe(1);

      code(
        await fx.put('owner', `/assets/${a['id']}`, {
          expectedRevision: sold['revision'],
          name: 'X',
        }),
        409,
        'ASSET_DISPOSED',
      );
      code(
        await fx.post('owner', `/assets/${a['id']}/assign`, {
          expectedRevision: sold['revision'],
          assignee: { kind: 'project', workProjectId: projectId },
        }),
        409,
        'ASSET_DISPOSED',
      );
      code(
        await fx.post('owner', `/assets/${a['id']}/dispose`, {
          expectedRevision: sold['revision'],
          on: '2026-09-02',
          kind: 'scrapped',
          reason: 'Encore',
        }),
        409,
        'ASSET_DISPOSED',
      );
      // Liste par défaut : hors cédés.
      const active = ok(await fx.get('owner', '/assets'));
      expect(active['items'].some((i: { id: string }) => i.id === a['id'])).toBe(false);
      const all = ok(await fx.get('owner', '/assets?status=disposed'));
      expect(all['items'].some((i: { id: string }) => i.id === a['id'])).toBe(true);

      const back = ok(
        await fx.post('owner', `/assets/${a['id']}/reinstate`, {
          expectedRevision: sold['revision'],
          reason: 'Vente annulée',
        }),
      );
      expect(back).toMatchObject({ status: 'in_storage', disposal: null });
      code(
        await fx.post('owner', `/assets/${a['id']}/reinstate`, {
          expectedRevision: back['revision'],
          reason: 'Encore',
        }),
        409,
        'ASSET_NOT_DISPOSED',
      );
    });
  });

  describe('lien avec une facture fournisseur (R3)', () => {
    it('vérifié dans l’organisation ; le fournisseur est repris ; rien n’est créé', async () => {
      const a = await newAsset(`Serveur ${tag}`, {
        acquisition: {
          on: '2026-02-10',
          cost: '3000.00',
          currency: 'USD',
          supplierInvoiceId: invoice.N,
        },
      });
      expect(a['acquisition']).toMatchObject({
        supplierInvoiceId: invoice.N,
        supplierId: supplier.N,
      });
      const bySupplier = ok(await fx.get('owner', `/assets?supplierId=${supplier.N}`));
      expect(bySupplier['items'].map((i: { id: string }) => i.id)).toEqual([a['id']]);
      code(
        await fx.post('owner', '/assets', {
          name: 'Mauvais lien',
          categoryId,
          acquisition: {
            on: '2026-02-10',
            cost: '1.00',
            currency: 'USD',
            supplierId: supplier.N,
            supplierInvoiceId: invoice.other,
          },
        }),
        409,
        'SUPPLIER_INVOICE_MISMATCH',
      );
      // Facture d'une autre organisation : 404.
      code(
        await fx.post('owner', '/assets', {
          name: 'Facture forgée',
          categoryId,
          acquisition: {
            on: '2026-02-10',
            cost: '1.00',
            currency: 'USD',
            supplierInvoiceId: invoice.B,
          },
        }),
        404,
        'SUPPLIER_INVOICE_NOT_FOUND',
      );
      // Intervention reliée à la même facture.
      const m = ok(
        await fx.post('owner', `/assets/${a['id']}/maintenance`, {
          kind: 'corrective',
          status: 'done',
          doneOn: '2026-03-01',
          supplierInvoiceId: invoice.N,
        }),
        201,
      );
      expect(m).toMatchObject({ supplierInvoiceId: invoice.N, supplierId: supplier.N });
      // Aucune écriture dans les factures fournisseurs.
      expect(
        await db.collection('supplier_invoices').countDocuments({ organizationId: fx.orgN }),
      ).toBe(2);
    });
  });

  describe('isolation entre organisations (critère 19)', () => {
    it('404 sur toute ressource d’une autre organisation, y compris forgée dans un corps', async () => {
      const a = await newAsset(`Projecteur ${tag}`);
      for (const path of [
        `/assets/${a['id']}`,
        `/assets/${a['id']}/assignments`,
        `/assets/${a['id']}/maintenance`,
        `/assets/${a['id']}/coverages`,
      ]) {
        code(await fx.get('ownerB', path), 404, 'ASSET_NOT_FOUND');
      }
      code(
        await fx.put('ownerB', `/assets/${a['id']}`, { expectedRevision: 1, name: 'Volé' }),
        404,
        'ASSET_NOT_FOUND',
      );
      code(
        await fx.post('ownerB', `/assets/${a['id']}/dispose`, {
          expectedRevision: 1,
          on: '2026-09-01',
          kind: 'stolen',
          reason: 'x',
        }),
        404,
        'ASSET_NOT_FOUND',
      );
      expect(ok(await fx.get('ownerB', '/assets'))['items']).toHaveLength(0);
      code(
        await fx.post('ownerB', '/assets', {
          name: 'Catégorie forgée',
          categoryId,
          acquisition: { on: '2026-02-10', cost: '1.00', currency: 'USD' },
        }),
        404,
        'ASSET_CATEGORY_NOT_FOUND',
      );
      code(
        await fx.put('owner', `/assets/categories/${categoryB}`, {
          expectedRevision: 1,
          name: 'x',
        }),
        404,
        'ASSET_CATEGORY_NOT_FOUND',
      );
      const forged: [Record<string, unknown>, string][] = [
        [{ kind: 'employee', employeeId: emp.EB }, 'EMPLOYEE_NOT_FOUND'],
        [
          { kind: 'project', workProjectId: new ObjectId().toHexString() },
          'WORK_PROJECT_NOT_FOUND',
        ],
        [
          { kind: 'location', locationId: new ObjectId().toHexString() },
          'STOCK_LOCATION_NOT_FOUND',
        ],
        [{ kind: 'member', userId: fx.userIds.ownerB }, 'MEMBER_NOT_FOUND'],
      ];
      for (const [assignee, expected] of forged) {
        code(
          await fx.post('owner', `/assets/${a['id']}/assign`, {
            expectedRevision: a['revision'],
            assignee,
          }),
          404,
          expected,
        );
      }
      code(
        await fx.post('owner', '/assets', {
          name: 'Dépense forgée',
          categoryId,
          acquisition: {
            on: '2026-02-10',
            cost: '1.00',
            currency: 'USD',
            expenseId: new ObjectId().toHexString(),
          },
        }),
        404,
        'EXPENSE_NOT_FOUND',
      );
      code(
        await fx.post('owner', '/assets', {
          name: 'Fournisseur forgé',
          categoryId,
          acquisition: { on: '2026-02-10', cost: '1.00', currency: 'USD', supplierId: supplier.B },
        }),
        404,
        'SUPPLIER_NOT_FOUND',
      );
      code(
        await fx.post('owner', `/assets/${a['id']}/coverages`, {
          kind: 'insurance',
          provider: 'Assureur',
          startOn: '2026-01-01',
          endOn: '2026-12-31',
          documentId: new ObjectId().toHexString(),
        }),
        404,
        'DOCUMENT_NOT_FOUND',
      );
      // Numérotation par organisation : B commence à EQ-000001.
      const b = ok(
        await fx.post('ownerB', '/assets', {
          name: `Poste B ${tag}`,
          categoryId: categoryB,
          acquisition: { on: '2026-02-10', cost: '1.00', currency: 'CDF' },
        }),
        201,
      );
      expect(b['number']).toBe('EQ-000001');
      code(await fx.get('owner', `/assets/${b['id']}`), 404, 'ASSET_NOT_FOUND');
    });
  });
});
