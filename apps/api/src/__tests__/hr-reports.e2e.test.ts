// Rapports RH et registre exporté, contre la vraie application (ADR-0045 § 3.3, § 7 ;
// critères 18, 20). ADR-0045 — H5.
//
// Effectif, entrées et sorties (taux de sortie), absentéisme PAR SERVICE, ancienneté :
// chiffres du moteur RH. Anti-fuite : ni salaire, ni coordonnées, ni type d'absence
// nommé, ni motif, dans la réponse ni dans le CSV. Registre : `hr.read` +
// `report.export`, formules neutralisées, audit strict `hr.register.exported`.
// Isolation : un service d'une autre organisation rend 404.

import 'reflect-metadata';

import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
// Trousseau d'essai : la section salaire est réellement chiffrée (ADR-0045 § 2.4).
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 120_000 });

const SALAIRE = '4567890.00';
const MOTIF = 'Motif médical très confidentiel';
const full = (date: string) => ({ date, half: 'full' as const });

e2eSuite('RH — rapports et registre exporté (ADR-0045 H5)', () => {
  let fx: HrFixture;
  const dep = { ops: '', admin: '' };
  const emp = { ancien: '', recent: '', sorti: '', formule: '' };

  const rev = async (id: string) =>
    (await fx.db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-rapports');
    dep.ops = ok(await fx.post('hr_manager', '/hr/departments', { name: 'Opérations' }), 201)['id'];
    dep.admin = ok(await fx.post('hr_manager', '/hr/departments', { name: 'Administration' }), 201)[
      'id'
    ];
    emp.ancien = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Ancien', { startDate: '2015-03-02', departmentId: dep.ops }),
      ),
      201,
    )['id'];
    emp.recent = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Recent', {
          startDate: '2026-02-02',
          departmentId: dep.ops,
          userId: fx.userIds['viewer'],
          contractType: 'fixed_term',
          contractEndDate: '2027-02-01',
        }),
      ),
      201,
    )['id'];
    emp.sorti = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Sorti', { startDate: '2020-01-06', departmentId: dep.admin }),
      ),
      201,
    )['id'];
    ok(
      await fx.post('hr_manager', `/hr/employees/${emp.sorti}/exit`, {
        endDate: '2026-03-31',
        exitCategory: 'resignation',
        expectedRevision: await rev(emp.sorti),
      }),
    );
    // Une cellule qui ressemble à une formule : neutralisée dans le CSV.
    emp.formule = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('=HYPERLINK("x")', { startDate: '2026-01-05', jobTitle: '+33 Agent' }),
      ),
      201,
    )['id'];
    // Données sensibles : un salaire chiffré, qui ne doit apparaître nulle part.
    ok(
      await fx.put('hr_manager', `/hr/employees/${emp.ancien}/private/compensation`, {
        expectedRevision: 0,
        data: {
          history: [
            { effectiveFrom: '2026-01-01', amount: SALAIRE, currency: 'CDF', period: 'month' },
          ],
        },
      }),
    );
    // Une absence « Maladie » (confidentielle) de « Recent », lundi 2 et mardi 3 mars 2026,
    // posée par les RH pour lui puis validée à l'étape RH.
    const types = ok(await fx.get('hr_manager', '/hr/leave-types'))['items'] as {
      id: string;
      key: string;
    }[];
    const maladie = types.find((t) => t.key === 'sick_leave')!.id;
    const d = ok(
      await fx.post('hr_manager', '/hr/leave-requests', {
        employeeId: emp.recent,
        typeId: maladie,
        start: full('2026-03-02'),
        end: full('2026-03-03'),
        reason: MOTIF,
      }),
      201,
    );
    if (d['status'] === 'pending') {
      ok(await fx.post('owner', `/hr/leave-requests/${d['id']}/approve`, { expectedRevision: 1 }));
    }
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  const Q = '/hr/reports?from=2026-01-01&to=2026-03-31';

  it('effectif, mouvements, absentéisme par service et ancienneté, par le moteur', async () => {
    const res = await fx.get('hr_manager', Q);
    const r = ok(res);
    expect(r['version']).toBe('1.0.0');
    // Au 31 mars : Ancien, Recent, Formule ; Sorti sort ce jour-là (inclus).
    expect(r['headcount']['total']).toBe(4);
    expect(r['headcount']['byDepartment']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: dep.ops, label: 'Opérations', count: 2 }),
        expect.objectContaining({ key: dep.admin, label: 'Administration', count: 1 }),
        expect.objectContaining({ key: null, label: 'Sans service', count: 1 }),
      ]),
    );
    expect(r['headcount']['byContractType']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'fixed_term', label: 'CDD', count: 1 }),
      ]),
    );
    expect(r['movements']).toMatchObject({
      entries: 2,
      exits: 1,
      exitsByCategory: [{ category: 'resignation', count: 1 }],
    });
    expect(r['movements']['exitRatePercent']).toEqual(expect.any(String));
    // Absentéisme par service, jamais par personne : deux jours de « Recent » aux Opérations.
    const ops = (r['absenteeism']['groups'] as Record<string, unknown>[]).find(
      (g) => g['departmentId'] === dep.ops,
    );
    expect(ops).toMatchObject({ label: 'Opérations', employees: 2, absenceDays: '2.00' });
    expect(r['seniority']['buckets']).toEqual(
      expect.arrayContaining([
        { bucket: 'gte10', count: 1 },
        { bucket: 'lt1', count: 2 },
      ]),
    );
    // Anti-fuite : ni salaire, ni type confidentiel, ni motif, ni identifiant de personne.
    expect(res.text).not.toContain(SALAIRE);
    expect(res.text).not.toContain('4567890');
    expect(res.text).not.toContain('Maladie');
    expect(res.text).not.toContain(MOTIF);
    for (const id of Object.values(emp)) expect(res.text).not.toContain(id);
  });

  it('filtre par service ; service d’une autre organisation : 404 ; période invalide : 400', async () => {
    const r = ok(await fx.get('owner', `${Q}&departmentId=${dep.ops}`));
    expect(r['headcount']['total']).toBe(2);
    expect(r['departmentId']).toBe(dep.ops);
    code(await fx.get('ownerB', `${Q}&departmentId=${dep.ops}`), 404, 'DEPARTMENT_NOT_FOUND');
    expect(ok(await fx.get('ownerB', Q))['headcount']['total']).toBe(0);
    expect((await fx.get('owner', '/hr/reports?from=2026-04-01&to=2026-01-01')).status).toBe(400);
    expect((await fx.get('owner', '/hr/reports?from=2026-01-01')).status).toBe(400);
  });

  it('droits : hr.read seulement (Administrateur oui ; Comptable, Lecteur, Conseiller non)', async () => {
    expect((await fx.get('admin', Q)).status).toBe(200);
    for (const who of ['accountant', 'viewer', 'analyst', 'advisor', 'sales_rep'] as const) {
      code(await fx.get(who, Q), 403, 'FORBIDDEN');
    }
  });

  it('registre CSV : non sensible, formules neutralisées, audit strict', async () => {
    const avant = await fx.db
      .collection('audit_events')
      .countDocuments({ organizationId: fx.orgN, action: 'hr.register.exported' });
    const res = await fx.get('owner', '/hr/reports/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="registre-personnel-/);
    const csv = res.text;
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Matricule;Nom;Prénom');
    expect(csv).toContain('Ancien');
    expect(csv).toContain('Opérations');
    expect(csv).toContain('Démission');
    // Formules neutralisées par une apostrophe.
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`'+33 Agent`);
    // Aucune donnée sensible, aucune absence.
    expect(csv).not.toContain(SALAIRE);
    expect(csv).not.toContain('Maladie');
    expect(csv).not.toContain(MOTIF);
    expect(
      await fx.db
        .collection('audit_events')
        .countDocuments({ organizationId: fx.orgN, action: 'hr.register.exported' }),
    ).toBe(avant + 1);
  });

  it('registre : hr.read ET report.export (Responsable RH sans report.export : 403)', async () => {
    code(await fx.get('hr_manager', '/hr/reports/export.csv'), 403, 'FORBIDDEN');
    code(await fx.get('accountant', '/hr/reports/export.csv'), 403, 'FORBIDDEN');
    expect((await fx.get('admin', '/hr/reports/export.csv')).status).toBe(200);
    const b = await fx.get('ownerB', '/hr/reports/export.csv');
    expect(b.status).toBe(200);
    expect(b.text).not.toContain('Ancien');
  });
});
