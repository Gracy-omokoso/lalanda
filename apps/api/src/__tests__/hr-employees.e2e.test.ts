// Dossiers collaborateurs, services, organigramme, portée contre la vraie application
// (ADR-0045 § 2.1 à § 2.3, § 3.1, § 4 ; critères 1, 3, 4, 5, 19, 20). ADR-0045 — H2.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Couvre : fiche (cohérence, matricule unique), lien membre (`userId` unique,
// compte d'une autre organisation), hiérarchie (cycles refusés, équipe, hors portée
// 404, organigramme ouvert aux membres reliés), droits par rôle (Responsable RH,
// Propriétaire, Administrateur, Comptable, Conseiller, salarié, manager), services,
// sortie, réintégration, anonymisation, isolation entre organisations et refus de la
// plateforme.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { canAnyPlatform } from '../authz/permissions.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k1';

vi.setConfig({ testTimeout: 120_000 });

e2eSuite('RH — dossiers, services, organigramme (ADR-0045 H2)', () => {
  let fx: HrFixture;
  let db: Db;
  /** Fiches reliées : A (Analyste), B (Lecteur), C (Commercial). */
  const id = { A: '', B: '', C: '' };
  const rev = async (employeeId: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(employeeId) }))![
      'revision'
    ] as number;

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-dossiers');
    db = fx.db;
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('fiche', () => {
    it('réglages par défaut ; fiche minimale ; cohérence des dates et du contrat', async () => {
      const settings = ok(await fx.get('hr_manager', '/hr/settings'));
      expect(settings).toMatchObject({
        approvalFlow: 'manager_only',
        orgChartVisibility: 'members',
        teamCalendarVisibility: 'department',
        isDefault: true,
        revision: 0,
        retention: { privateDataMonthsAfterExit: null, anonymizeYearsAfterExit: null },
      });
      expect(settings['contractTypes'].map((t: { key: string }) => t.key)).toContain('fixed_term');

      const chauffeur = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Chauffeur', { employeeNumber: 'ab-01' }),
        ),
        201,
      );
      expect(chauffeur).toMatchObject({
        userId: null,
        employeeNumber: 'ab-01',
        status: 'active',
        derivedStatus: 'active',
        revision: 1,
      });
      code(
        await fx.post('hr_manager', '/hr/employees', fiche('Autre', { employeeNumber: 'AB 01' })),
        409,
        'EMPLOYEE_NUMBER_EXISTS',
      );
      const cdd = await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Cdd', { contractType: 'fixed_term', probationEndDate: '2025-12-01' }),
      );
      expect(cdd.status).toBe(400);
      expect(cdd.body.details.issues.map((i: { code: string }) => i.code).sort()).toEqual([
        'CONTRACT_END_DATE_REQUIRED',
        'DATE_BEFORE_START',
      ]);
      const inconnu = await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('X', { contractType: 'cdi' }),
      );
      expect(inconnu.body.details.issues[0].code).toBe('CONTRACT_TYPE_UNKNOWN');
      // Aucune donnée sensible acceptée dans la fiche.
      expect(
        (await fx.post('hr_manager', '/hr/employees', fiche('Y', { salary: '100.00' }))).status,
      ).toBe(400);
      // Recherche et liste.
      const liste = ok(await fx.get('owner', '/hr/employees?q=chauffeur'));
      expect(liste['items'].map((e: { id: string }) => e.id)).toEqual([chauffeur['id']]);
    });
  });

  describe('lien membre', () => {
    it('from-members relie des comptes ; un compte une seule fiche ; compte étranger 404', async () => {
      const res = ok(
        await fx.post('hr_manager', '/hr/employees/from-members', {
          userIds: [fx.userIds['analyst'], fx.userIds['viewer'], fx.userIds['sales_rep']],
        }),
        201,
      );
      expect(res['items']).toHaveLength(3);
      for (const e of res['items']) {
        expect(e).toMatchObject({ jobTitle: 'À compléter', contractType: 'permanent' });
      }
      const byUser = (u: string) =>
        res['items'].find((e: { userId: string }) => e.userId === u)['id'];
      id.A = byUser(fx.userIds['analyst']);
      id.B = byUser(fx.userIds['viewer']);
      id.C = byUser(fx.userIds['sales_rep']);

      code(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Doublon', { userId: fx.userIds['viewer'] }),
        ),
        409,
        'EMPLOYEE_USER_ALREADY_LINKED',
      );
      code(
        await fx.post('hr_manager', '/hr/employees/from-members', {
          userIds: [fx.userIds['viewer']],
        }),
        409,
        'EMPLOYEE_USER_ALREADY_LINKED',
      );
      // Compte d'une autre organisation : 404, jamais confirmé.
      code(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Étranger', { userId: fx.userIds['ownerB'] }),
        ),
        404,
        'EMPLOYEE_USER_NOT_MEMBER',
      );
      // Relier par mise à jour un compte déjà relié : 409.
      const libre = ok(await fx.post('hr_manager', '/hr/employees', fiche('Libre')), 201);
      code(
        await fx.put('hr_manager', `/hr/employees/${libre['id']}`, {
          expectedRevision: 1,
          userId: fx.userIds['analyst'],
        }),
        409,
        'EMPLOYEE_USER_ALREADY_LINKED',
      );
    });
  });

  describe('hiérarchie et portée', () => {
    it('A manager de B, B manager de C ; C manager de A refusé ; A et soi-même aussi', async () => {
      ok(
        await fx.put('hr_manager', `/hr/employees/${id.B}`, {
          expectedRevision: await rev(id.B),
          managerEmployeeId: id.A,
          jobTitle: 'Assistante',
          startDate: '2025-01-06',
          notes: 'Note RH interne',
        }),
      );
      ok(
        await fx.put('hr_manager', `/hr/employees/${id.C}`, {
          expectedRevision: await rev(id.C),
          managerEmployeeId: id.B,
          jobTitle: 'Commercial terrain',
        }),
      );
      ok(
        await fx.put('hr_manager', `/hr/employees/${id.A}`, {
          expectedRevision: await rev(id.A),
          jobTitle: 'Responsable des opérations',
        }),
      );
      code(
        await fx.put('hr_manager', `/hr/employees/${id.A}`, {
          expectedRevision: await rev(id.A),
          managerEmployeeId: id.C,
        }),
        409,
        'MANAGER_CYCLE',
      );
      code(
        await fx.put('hr_manager', `/hr/employees/${id.A}`, {
          expectedRevision: await rev(id.A),
          managerEmployeeId: id.A,
        }),
        409,
        'MANAGER_CYCLE',
      );
      code(
        await fx.put('hr_manager', `/hr/employees/${id.A}`, {
          expectedRevision: 1,
          jobTitle: 'Périmé',
        }),
        409,
        'STALE_REVISION',
      );
    });

    it('A voit B et C dans son équipe ; C ne voit ni A ni B en fiche, mais dans l’organigramme', async () => {
      const team = ok(await fx.get('analyst', '/hr/team'));
      expect(team['items'].map((m: { id: string }) => m.id).sort()).toEqual([id.B, id.C].sort());
      expect(team['items'].find((m: { id: string }) => m.id === id.B).isDirect).toBe(true);
      expect(team['items'].find((m: { id: string }) => m.id === id.C).isDirect).toBe(false);
      expect(JSON.stringify(team)).not.toContain('Note RH interne');

      const me = ok(await fx.get('analyst', '/hr/me'));
      expect(me).toMatchObject({ isManager: true, canApprove: true });
      expect(me['employee']['id']).toBe(id.A);

      // Manager : fiche de B en lecture, sans note ni donnée sensible.
      const vueB = ok(await fx.get('analyst', `/hr/employees/${id.B}`));
      expect(vueB['viewer']).toMatchObject({ relation: 'manager', canSeeSensitive: false });
      expect(vueB['employee']['notes']).toBeNull();
      expect(vueB['private']).toBeNull();

      // C : hors portée pour A et B (404) ; soi-même lisible.
      code(await fx.get('sales_rep', `/hr/employees/${id.A}`), 404, 'EMPLOYEE_NOT_FOUND');
      code(await fx.get('sales_rep', `/hr/employees/${id.B}`), 404, 'EMPLOYEE_NOT_FOUND');
      const soi = ok(await fx.get('sales_rep', `/hr/employees/${id.C}`));
      expect(soi['viewer']).toMatchObject({ relation: 'self', canSeeSensitive: true });
      expect(ok(await fx.get('sales_rep', '/hr/team'))['items']).toEqual([]);

      // Organigramme : nom, poste, service, manager — rien d'autre.
      const chart = ok(await fx.get('sales_rep', '/hr/org-chart?view=reporting'));
      expect(chart['view']).toBe('reporting');
      expect(chart['people'][id.A]).toEqual({
        displayName: expect.any(String),
        jobTitle: 'Responsable des opérations',
        departmentId: null,
        managerEmployeeId: null,
      });
      expect(chart['people'][id.B]['managerEmployeeId']).toBe(id.A);
      const racineA = chart['roots'].find((r: { employeeId: string }) => r.employeeId === id.A);
      expect(racineA.totalReports).toBe(2);
      expect(JSON.stringify(chart)).not.toContain('Note RH interne');
      // Membre non relié à une fiche, sans `hr.read` : organigramme fermé.
      code(await fx.get('accountant', '/hr/org-chart'), 403, 'HR_ORG_CHART_HIDDEN');
    });
  });

  describe('droits par rôle', () => {
    it('Responsable RH, Propriétaire, Administrateur, Comptable, Conseiller, salarié', async () => {
      // Responsable RH : dossiers, mais ni trésorerie, ni achats, ni ventes.
      ok(await fx.get('hr_manager', '/hr/employees'));
      for (const path of ['/treasury/expenses', '/purchases/orders', '/sales/invoices']) {
        expect((await fx.get('hr_manager', path)).status, path).toBe(403);
      }
      // Propriétaire et Administrateur : registre.
      ok(await fx.get('owner', '/hr/employees'));
      ok(await fx.post('admin', '/hr/employees', fiche(`Admin ${tag}`)), 201);
      // L'Administrateur ne lit pas les données sensibles.
      const vue = ok(await fx.get('admin', `/hr/employees/${id.B}`));
      expect(vue['viewer']).toMatchObject({ relation: 'hr', canSeeSensitive: false });
      expect(vue['private']).toBeNull();
      expect(vue['employee']['notes']).toBe('Note RH interne');
      // Comptable et Conseiller : rien des RH, sauf « moi » (vide : pas de fiche).
      for (const role of ['accountant', 'advisor'] as const) {
        const refus = await fx.get(role, '/hr/employees');
        expect(refus.status, role).toBe(403);
        expect(refus.body).toMatchObject({ code: 'FORBIDDEN', action: 'hr.read', role });
        expect((await fx.post(role, '/hr/employees', fiche('Refus'))).status, role).toBe(403);
        code(await fx.get(role, `/hr/employees/${id.B}`), 404, 'EMPLOYEE_NOT_FOUND');
        const me = ok(await fx.get(role, '/hr/me'));
        expect(me).toMatchObject({ employee: null, private: null, isManager: false });
      }
      // Salarié (Lecteur relié) : sa fiche, sans note ; pas le registre.
      expect((await fx.get('viewer', '/hr/employees')).status).toBe(403);
      expect((await fx.get('viewer', '/hr/settings')).status).toBe(403);
      const me = ok(await fx.get('viewer', '/hr/me'));
      expect(me['employee']).toMatchObject({ id: id.B, notes: null });
      expect(me['private']).toMatchObject({ employeeId: id.B, revision: 0 });
    });
  });

  describe('services', () => {
    it('nom unique, cycles et profondeur refusés, archivage tant qu’il sert refusé', async () => {
      const dir = ok(await fx.post('hr_manager', '/hr/departments', { name: 'Direction' }), 201);
      const ops = ok(
        await fx.post('hr_manager', '/hr/departments', { name: 'Opérations', parentId: dir['id'] }),
        201,
      );
      code(
        await fx.post('hr_manager', '/hr/departments', { name: ' direction ' }),
        409,
        'DEPARTMENT_NAME_EXISTS',
      );
      code(
        await fx.put('hr_manager', `/hr/departments/${dir['id']}`, {
          expectedRevision: 1,
          parentId: ops['id'],
        }),
        409,
        'DEPARTMENT_CYCLE',
      );
      // Profondeur : sept niveaux sous « Direction » refusent le neuvième.
      let parent = ops['id'] as string;
      for (let i = 3; i <= 8; i += 1) {
        parent = ok(
          await fx.post('hr_manager', '/hr/departments', { name: `Niveau ${i}`, parentId: parent }),
          201,
        )['id'];
      }
      code(
        await fx.post('hr_manager', '/hr/departments', { name: 'Niveau 9', parentId: parent }),
        409,
        'DEPARTMENT_TOO_DEEP',
      );
      ok(
        await fx.put('hr_manager', `/hr/employees/${id.C}`, {
          expectedRevision: await rev(id.C),
          departmentId: ops['id'],
        }),
      );
      code(
        await fx.post('hr_manager', `/hr/departments/${dir['id']}/archive`, {
          expectedRevision: 1,
        }),
        409,
        'DEPARTMENT_IN_USE',
      );
      const vide = ok(await fx.post('hr_manager', '/hr/departments', { name: 'Archivable' }), 201);
      expect(
        ok(
          await fx.post('hr_manager', `/hr/departments/${vide['id']}/archive`, {
            expectedRevision: 1,
          }),
        )['active'],
      ).toBe(false);
      code(
        await fx.put('hr_manager', `/hr/employees/${id.C}`, {
          expectedRevision: await rev(id.C),
          departmentId: vide['id'],
        }),
        409,
        'DEPARTMENT_ARCHIVED',
      );
      const liste = ok(await fx.get('admin', '/hr/departments'));
      expect(liste['items'].find((d: { id: string }) => d.id === ops['id']).activeEmployees).toBe(
        1,
      );
      const chart = ok(await fx.get('hr_manager', '/hr/org-chart?view=departments'));
      expect(chart['departments'][ops['id']]).toEqual({ name: 'Opérations' });
    });
  });

  describe('sortie, réintégration, anonymisation', () => {
    it('sortie future : annulable, pas anonymisable ; sortie passée : anonymisée par qui lit le sensible', async () => {
      const e = ok(await fx.post('hr_manager', '/hr/employees', fiche(`Sortant ${tag}`)), 201);
      const sortie = ok(
        await fx.post('hr_manager', `/hr/employees/${e['id']}/exit`, {
          endDate: '2099-12-31',
          exitCategory: 'resignation',
          expectedRevision: 1,
        }),
      );
      expect(sortie).toMatchObject({
        offboardingSuggested: true,
        employee: { status: 'exited', endDate: '2099-12-31', derivedStatus: 'active' },
      });
      code(
        await fx.post('owner', `/hr/employees/${e['id']}/anonymize`, {
          confirm: true,
          expectedRevision: 2,
        }),
        409,
        'EMPLOYEE_NOT_EXITED',
      );
      expect(
        ok(
          await fx.post('hr_manager', `/hr/employees/${e['id']}/reinstate`, {
            expectedRevision: 2,
          }),
        )['status'],
      ).toBe('active');

      // B sort dans le passé : son accès n'est pas retiré, il reste membre.
      ok(
        await fx.post('hr_manager', `/hr/employees/${id.B}/exit`, {
          endDate: '2026-02-01',
          exitCategory: 'end_of_contract',
          expectedRevision: await rev(id.B),
        }),
      );
      expect((await fx.get('viewer', '/hr/me')).status).toBe(200);
      code(
        await fx.post('hr_manager', `/hr/employees/${id.B}/reinstate`, {
          expectedRevision: await rev(id.B),
        }),
        409,
        'EMPLOYEE_EXIT_PAST',
      );
      // L'Administrateur n'anonymise pas (il ne lit pas le sensible).
      const refus = await fx.post('admin', `/hr/employees/${id.B}/anonymize`, {
        confirm: true,
        expectedRevision: await rev(id.B),
      });
      expect(refus.status).toBe(403);
      expect(refus.body.action).toBe('hr.sensitive.read');
      const anon = ok(
        await fx.post('hr_manager', `/hr/employees/${id.B}/anonymize`, {
          confirm: true,
          expectedRevision: await rev(id.B),
        }),
      );
      expect(anon).toMatchObject({
        status: 'anonymized',
        userId: null,
        notes: null,
        workEmail: null,
        endDate: '2026-02-01',
        exitCategory: 'end_of_contract',
      });
      expect(anon['displayName']).toMatch(/^Ancien collaborateur n° \d+$/);
      expect(
        await db.collection('audit_events').countDocuments({
          organizationId: fx.orgN,
          action: 'hr.employee.anonymized',
          targetId: id.B,
        }),
      ).toBe(1);
      // Plus de « moi » pour l'ancien compte, et le lien est libre.
      expect(ok(await fx.get('viewer', '/hr/me'))['employee']).toBeNull();
      code(
        await fx.post('hr_manager', `/hr/employees/${id.A}/anonymize`, {
          confirm: true,
          expectedRevision: await rev(id.A),
        }),
        409,
        'EMPLOYEE_NOT_EXITED',
      );
    });
  });

  describe('isolation entre organisations', () => {
    it('toute fiche, tout service et toute référence forgée d’une autre organisation : 404', async () => {
      const deptN = ok(
        await fx.post('hr_manager', '/hr/departments', { name: `Isolé ${tag}` }),
        201,
      );
      const r = 1;
      const tentatives: (() => PromiseLike<Response>)[] = [
        () => fx.get('ownerB', `/hr/employees/${id.A}`),
        () =>
          fx.put('ownerB', `/hr/employees/${id.A}`, { expectedRevision: r, jobTitle: 'Piraté' }),
        () =>
          fx.post('ownerB', `/hr/employees/${id.A}/exit`, {
            endDate: '2026-03-01',
            exitCategory: 'other',
            expectedRevision: r,
          }),
        () => fx.post('ownerB', `/hr/employees/${id.A}/reinstate`, { expectedRevision: r }),
        () =>
          fx.post('ownerB', `/hr/employees/${id.A}/anonymize`, {
            confirm: true,
            expectedRevision: r,
          }),
        () => fx.get('ownerB', `/hr/employees/${id.A}/private`),
        () => fx.post('ownerB', `/hr/employees/${id.A}/private/reveal`, { sections: ['identity'] }),
        () =>
          fx.put('ownerB', `/hr/employees/${id.A}/private/identity`, {
            expectedRevision: 0,
            data: null,
          }),
        () =>
          fx.put('ownerB', `/hr/departments/${deptN['id']}`, { expectedRevision: 1, name: 'X' }),
        () => fx.post('ownerB', `/hr/departments/${deptN['id']}/archive`, { expectedRevision: 1 }),
        // Références forgées dans un corps.
        () => fx.post('ownerB', '/hr/employees', fiche('Forgé', { managerEmployeeId: id.A })),
        () => fx.post('ownerB', '/hr/employees', fiche('Forgé', { departmentId: deptN['id'] })),
        () => fx.post('ownerB', '/hr/employees', fiche('Forgé', { userId: fx.userIds['analyst'] })),
        () => fx.post('ownerB', '/hr/departments', { name: 'Forgé', parentId: deptN['id'] }),
        () => fx.post('ownerB', '/hr/departments', { name: 'Forgé 2', headEmployeeId: id.A }),
        () => fx.post('ownerB', '/hr/employees/from-members', { userIds: [fx.userIds['analyst']] }),
      ];
      for (const pending of tentatives) {
        const res = await pending();
        expect(res.status, `${res.req.method} ${res.req.path} ${JSON.stringify(res.body)}`).toBe(
          404,
        );
      }
      const listeB = ok(await fx.get('ownerB', '/hr/employees?status=all'));
      expect(listeB['items']).toEqual([]);
      expect(ok(await fx.get('ownerB', '/hr/departments?active=all'))['items']).toEqual([]);
      expect(ok(await fx.get('ownerB', '/hr/me'))['employee']).toBeNull();
      // Rien n'a bougé côté N.
      expect(ok(await fx.get('owner', `/hr/employees/${id.A}`))['employee']['jobTitle']).toBe(
        'Responsable des opérations',
      );
      // Identifiant mal formé : 404, pas 500.
      code(await fx.get('owner', '/hr/employees/pas-un-id'), 404, 'EMPLOYEE_NOT_FOUND');
    });
  });

  describe('plateforme', () => {
    it('super-administrateur sans appartenance : aucun accès ; `hr.sensitive.read` interdit même délégué', async () => {
      // Hors appartenance, l'organisation active retombe sur la sienne : rien de N ne sort.
      const liste = await fx.get('superAdmin', '/hr/employees?status=all');
      expect(liste.status).toBe(200);
      expect(liste.body.items).toEqual([]);
      code(await fx.get('superAdmin', `/hr/employees/${id.A}`), 404, 'EMPLOYEE_NOT_FOUND');
      expect((await fx.get('superAdmin', '/hr/me')).body.employee).toBeNull();
      const reveal = await fx.post('superAdmin', `/hr/employees/${id.A}/private/reveal`, {
        sections: ['identity'],
      });
      expect(reveal.status).toBe(404);
      // Décision de la matrice plateforme : registre sous accès délégué (super-admin
      // seulement), données sensibles jamais, absences jamais.
      expect(canAnyPlatform(['platform_super_admin'], 'hr.read', { hasActiveGrant: true })).toBe(
        true,
      );
      expect(canAnyPlatform(['platform_support'], 'hr.read', { hasActiveGrant: true })).toBe(false);
      for (const action of ['hr.sensitive.read', 'leave.request', 'leave.approve'] as const) {
        expect(
          canAnyPlatform(['platform_super_admin', 'platform_support'], action, {
            hasActiveGrant: true,
          }),
          action,
        ).toBe(false);
      }
    });
  });
});
