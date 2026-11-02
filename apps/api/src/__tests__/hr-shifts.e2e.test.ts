// Plannings contre la vraie application (ADR-0051 § 2.4, § 2.7, § 3.6, § 4, § 6.2 ;
// critères 12, 16, 17). ADR-0051 — H12.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Couvre : plannings éteints par défaut, activation par `hr.manage`, brouillon
// puis publication (notification), chevauchement refusé (minuit compris), créneau pendant
// un congé approuvé accepté avec constat, besoin minimal et sous-effectif, aucun refus
// pour une durée hebdomadaire sans seuil saisi, seuil indicatif qui lève un constat,
// copie de semaine en brouillons, annulation, indisponibilité, portée et isolation.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

/** Lundis de mars 2027 (toujours dans le futur pour ces tests). */
const LUN1 = '2027-03-01';
const MAR1 = '2027-03-02';
const MER1 = '2027-03-03';
const LUN2 = '2027-03-08';
const LUN3 = '2027-03-15';
const LUN4 = '2027-03-22';

const plus = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

e2eSuite('RH — plannings (ADR-0051 H12)', () => {
  let fx: HrFixture;
  let db: Db;
  /** A (Analyste) manager de B (Lecteur) ; C (Commercial) sans lien. */
  const emp = { A: '', B: '', C: '' };
  let premier = '';

  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const settingsRev = async (account: 'hr_manager' | 'ownerB') =>
    ok(await fx.get(account, '/hr/attendance/settings'))['revision'] as number;
  const creneau = (employeeId: string, date: string, start: string, end: string, extra = {}) => ({
    employeeId,
    date,
    start,
    end,
    ...extra,
  });

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-plannings');
    db = fx.db;
    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer'], fx.userIds['sales_rep']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    emp.A = byUser(fx.userIds['analyst']);
    emp.B = byUser(fx.userIds['viewer']);
    emp.C = byUser(fx.userIds['sales_rep']);
    ok(
      await fx.put('hr_manager', `/hr/employees/${emp.B}`, {
        expectedRevision: await empRev(emp.B),
        managerEmployeeId: emp.A,
      }),
    );
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('éteints par défaut (critère 17)', () => {
    it('toute route des plannings rend 409 HR_FEATURE_DISABLED', async () => {
      code(
        await fx.get('viewer', `/hr/shifts?from=${LUN1}&to=${plus(LUN1, 6)}`),
        409,
        'HR_FEATURE_DISABLED',
      );
      code(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, LUN1, '09:00', '17:00')),
        409,
        'HR_FEATURE_DISABLED',
      );
      code(await fx.get('hr_manager', '/hr/staffing-needs'), 409, 'HR_FEATURE_DISABLED');
      code(
        await fx.get('hr_manager', `/hr/planning/gaps?from=${LUN1}&to=${LUN1}`),
        409,
        'HR_FEATURE_DISABLED',
      );
      expect(await db.collection('hr_shifts').countDocuments({})).toBe(0);
    });

    it('activation par hr.manage ; aucun seuil indicatif par défaut', async () => {
      const s = ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          planning: { enabled: true },
        }),
      );
      expect(s['planning']).toEqual({ enabled: true, indicativeMaxMinutesPerWeek: null });
      expect(s['attendance']['enabled']).toBe(false);
    });
  });

  describe('brouillon, publication, chevauchements (critère 12)', () => {
    it('le manager établit un brouillon ; le collaborateur ne le voit qu’une fois publié', async () => {
      const r = ok(
        await fx.post(
          'analyst',
          '/hr/shifts',
          creneau(emp.B, LUN1, '09:00', '17:00', { label: 'Accueil matin' }),
        ),
        201,
      );
      premier = r['shift']['id'];
      expect(r['shift']).toMatchObject({ status: 'draft', employeeId: emp.B, canPlan: true });
      expect(r['findings']).toEqual([]);
      const avant = ok(await fx.get('viewer', `/hr/shifts?from=${LUN1}&to=${plus(LUN1, 6)}`));
      expect(avant['items']).toEqual([]);
      const pub = ok(await fx.post('analyst', '/hr/shifts/publish', { ids: [premier] }));
      expect(pub['published']).toBe(1);
      const apres = ok(await fx.get('viewer', `/hr/shifts?from=${LUN1}&to=${plus(LUN1, 6)}`));
      expect(apres['items'].map((s: { id: string }) => s.id)).toEqual([premier]);
      expect(apres['items'][0]['canPlan']).toBe(false);
      const notes = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.shifts_published' })
        .toArray();
      expect(notes.map((n) => n['recipientUserId'])).toEqual([fx.userIds['viewer']]);
      // Republier : rien ne change.
      expect(
        ok(await fx.post('analyst', '/hr/shifts/publish', { ids: [premier] }))['published'],
      ).toBe(0);
    });

    it('deux créneaux qui se chevauchent : 409 SHIFT_OVERLAP, minuit compris', async () => {
      const r = await fx.post('analyst', '/hr/shifts', creneau(emp.B, LUN1, '16:00', '20:00'));
      code(r, 409, 'SHIFT_OVERLAP');
      expect(r.body.details.shiftIds).toEqual([premier]);
      ok(
        await fx.post(
          'analyst',
          '/hr/shifts',
          creneau(emp.B, LUN1, '22:00', '06:00', { crossesMidnight: true }),
        ),
        201,
      );
      code(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, MAR1, '05:00', '08:00')),
        409,
        'SHIFT_OVERLAP',
      );
      code(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, MAR1, '22:00', '21:00')),
        400,
        'INVALID_REQUEST',
      );
    });

    it('portée : un tiers 404, le collaborateur ne planifie pas pour lui-même (403)', async () => {
      code(
        await fx.post('sales_rep', '/hr/shifts', creneau(emp.B, MAR1, '09:00', '12:00')),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.post('viewer', '/hr/shifts', creneau(emp.B, MAR1, '09:00', '12:00')),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.post('sales_rep', '/hr/shifts/publish', { ids: [premier] }),
        404,
        'SHIFT_NOT_FOUND',
      );
      const tiers = ok(
        await fx.get('sales_rep', `/hr/shifts?from=${LUN1}&to=${plus(LUN1, 6)}&scope=organization`),
      );
      expect(tiers['items']).toEqual([]);
    });

    it('un créneau pendant un congé approuvé est accepté avec SHIFT_DURING_LEAVE', async () => {
      const types = ok(await fx.get('hr_manager', '/hr/leave-types'));
      const autorisee = types['items'].find((t: { key: string }) => t.key === 'authorized_absence')[
        'id'
      ];
      const demande = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: autorisee,
          start: { date: MER1, half: 'full' },
          end: { date: MER1, half: 'full' },
        }),
        201,
      );
      ok(
        await fx.post('analyst', `/hr/leave-requests/${demande['id']}/approve`, {
          expectedRevision: demande['revision'],
        }),
      );
      const r = ok(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, MER1, '09:00', '17:00')),
        201,
      );
      expect(r['findings'].map((f: { code: string }) => f.code)).toEqual(['SHIFT_DURING_LEAVE']);
      // Le constat ne nomme ni le type ni le motif de l'absence.
      expect(JSON.stringify(r['findings'])).not.toMatch(/authorized|autoris/i);
    });

    it('modifier un créneau publié prévient le collaborateur ; révision attendue', async () => {
      const lu = ok(await fx.get('analyst', `/hr/shifts?from=${LUN1}&to=${LUN1}&scope=team`));
      const s = lu['items'].find((x: { id: string }) => x.id === premier);
      code(
        await fx.put('analyst', `/hr/shifts/${premier}`, {
          ...creneau(emp.B, LUN1, '08:00', '16:00'),
          expectedRevision: s.revision + 5,
        }),
        409,
        'STALE_REVISION',
      );
      const r = ok(
        await fx.put('analyst', `/hr/shifts/${premier}`, {
          ...creneau(emp.B, LUN1, '08:00', '16:00'),
          expectedRevision: s.revision,
        }),
      );
      expect(r['shift']).toMatchObject({ status: 'published', start: '08:00' });
      const notes = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.shift_changed' })
        .toArray();
      expect(notes.map((n) => n['recipientUserId'])).toEqual([fx.userIds['viewer']]);
    });

    it('le collaborateur signale une indisponibilité ; un tiers ne le peut pas', async () => {
      const r = ok(
        await fx.post('viewer', `/hr/shifts/${premier}/unavailability`, {
          comment: 'Rendez-vous médical le matin',
        }),
      );
      expect(r['unavailability']['comment']).toMatch(/Rendez-vous/);
      code(
        await fx.post('analyst', `/hr/shifts/${premier}/unavailability`, { comment: 'Non' }),
        403,
        'SHIFT_NOT_YOURS',
      );
      const manager = ok(await fx.get('analyst', `/hr/shifts?from=${LUN1}&to=${LUN1}&scope=team`));
      expect(
        manager['items'].find((x: { id: string }) => x.id === premier)['unavailability'],
      ).not.toBeNull();
    });

    it('annuler ; un créneau annulé ne se publie ni ne se modifie', async () => {
      const r = ok(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, plus(LUN1, 4), '09:00', '12:00')),
        201,
      );
      const id = r['shift']['id'];
      const annule = ok(
        await fx.post('analyst', `/hr/shifts/${id}/cancel`, { expectedRevision: 1 }),
      );
      expect(annule['status']).toBe('cancelled');
      code(await fx.post('analyst', '/hr/shifts/publish', { ids: [id] }), 409, 'SHIFT_CANCELLED');
      // Le créneau annulé libère la plage.
      ok(
        await fx.post('analyst', '/hr/shifts', creneau(emp.B, plus(LUN1, 4), '10:00', '11:00')),
        201,
      );
    });
  });

  describe('durée hebdomadaire : aucun contrôle légal (critères 12, 17)', () => {
    it('sans seuil saisi, 6 créneaux de 14 h passent sans constat', async () => {
      for (let i = 0; i < 6; i += 1) {
        const r = ok(
          await fx.post(
            'hr_manager',
            '/hr/shifts',
            creneau(emp.C, plus(LUN3, i), '06:00', '20:00', { location: 'Dépôt' }),
          ),
          201,
        );
        expect(r['findings']).toEqual([]);
      }
    });

    it('un seuil INDICATIF saisi lève SHIFT_ABOVE_INDICATIVE_LIMIT, jamais un refus', async () => {
      ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          planning: { indicativeMaxMinutesPerWeek: 2400 },
        }),
      );
      const r = ok(
        await fx.post('hr_manager', '/hr/shifts', creneau(emp.C, plus(LUN3, 6), '08:00', '10:00')),
        201,
      );
      const constat = r['findings'].find(
        (f: { code: string }) => f.code === 'SHIFT_ABOVE_INDICATIVE_LIMIT',
      );
      expect(constat).toMatchObject({ employeeId: emp.C, week: LUN3, minutes: 6 * 14 * 60 + 120 });
      ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          planning: { indicativeMaxMinutesPerWeek: null },
        }),
      );
    });
  });

  describe('copie de semaine', () => {
    it('crée des brouillons ; une seconde copie saute les chevauchements', async () => {
      code(
        await fx.post('hr_manager', '/hr/shifts/copy-week', {
          fromWeekStart: plus(LUN3, 1),
          toWeekStart: LUN4,
        }),
        400,
        'INVALID_REQUEST',
      );
      const r = ok(
        await fx.post('hr_manager', '/hr/shifts/copy-week', {
          fromWeekStart: LUN3,
          toWeekStart: LUN4,
          employeeIds: [emp.C],
        }),
        201,
      );
      expect(r['created']).toHaveLength(7);
      for (const s of r['created']) expect(s.status).toBe('draft');
      expect(r['skipped']).toEqual([]);
      const encore = ok(
        await fx.post('hr_manager', '/hr/shifts/copy-week', {
          fromWeekStart: LUN3,
          toWeekStart: LUN4,
          employeeIds: [emp.C],
        }),
        201,
      );
      expect(encore['created']).toEqual([]);
      expect(encore['skipped']).toHaveLength(7);
      expect(encore['skipped'][0]['code']).toBe('SHIFT_OVERLAP');
      // Le manager A ne copie pas pour C, hors de son équipe.
      code(
        await fx.post('analyst', '/hr/shifts/copy-week', {
          fromWeekStart: LUN3,
          toWeekStart: LUN4,
          employeeIds: [emp.C],
        }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
    });
  });

  describe('besoins minimaux et sous-effectif (critère 12)', () => {
    let besoin = '';

    it('besoins : écriture hr.manage, lecture hr.read', async () => {
      code(
        await fx.post('analyst', '/hr/staffing-needs', {
          location: 'Accueil',
          weekday: 'mon',
          start: '09:00',
          end: '12:00',
          minStaff: 2,
        }),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.post('hr_manager', '/hr/staffing-needs', {
          weekday: 'mon',
          start: '09:00',
          end: '12:00',
          minStaff: 2,
        }),
        400,
        'INVALID_REQUEST',
      );
      const r = ok(
        await fx.post('hr_manager', '/hr/staffing-needs', {
          location: 'Accueil',
          weekday: 'mon',
          start: '09:00',
          end: '12:00',
          minStaff: 2,
          label: 'Accueil du matin',
        }),
        201,
      );
      besoin = r['id'];
      expect(ok(await fx.get('hr_manager', '/hr/staffing-needs'))['items']).toHaveLength(1);
      code(await fx.get('viewer', '/hr/staffing-needs'), 403, 'FORBIDDEN');
    });

    it('besoin de 2, 1 planifié : UNDERSTAFFED_SLOT, des nombres seulement', async () => {
      const r = ok(
        await fx.post(
          'hr_manager',
          '/hr/shifts',
          creneau(emp.A, LUN2, '08:00', '13:00', { location: 'Accueil' }),
        ),
        201,
      );
      ok(await fx.post('hr_manager', '/hr/shifts/publish', { ids: [r['shift']['id']] }));
      const gaps = ok(await fx.get('hr_manager', `/hr/planning/gaps?from=${LUN2}&to=${LUN2}`));
      expect(gaps['gaps']).toEqual([
        {
          code: 'UNDERSTAFFED_SLOT',
          needId: besoin,
          date: LUN2,
          start: '09:00',
          end: '12:00',
          minStaff: 2,
          planned: 1,
          available: 1,
          shortfall: 1,
          departmentId: null,
          location: 'Accueil',
          label: 'Accueil du matin',
        },
      ]);
      expect(JSON.stringify(gaps['gaps'])).not.toContain(emp.A);
      // Un collaborateur sans équipe ni hr.read : 403 ; le manager ne voit pas les lieux.
      code(
        await fx.get('sales_rep', `/hr/planning/gaps?from=${LUN2}&to=${LUN2}`),
        403,
        'FORBIDDEN',
      );
      expect(
        ok(await fx.get('analyst', `/hr/planning/gaps?from=${LUN2}&to=${LUN2}`))['gaps'],
      ).toEqual([]);
    });

    it('modifier et supprimer un besoin ; révision attendue', async () => {
      const corps = {
        location: 'Accueil',
        weekday: 'mon',
        start: '09:00',
        end: '12:00',
        minStaff: 1,
      };
      code(
        await fx.put('hr_manager', `/hr/staffing-needs/${besoin}`, {
          ...corps,
          expectedRevision: 9,
        }),
        409,
        'STALE_REVISION',
      );
      const r = ok(
        await fx.put('hr_manager', `/hr/staffing-needs/${besoin}`, {
          ...corps,
          expectedRevision: 1,
        }),
      );
      expect(r['minStaff']).toBe(1);
      expect(
        ok(await fx.get('hr_manager', `/hr/planning/gaps?from=${LUN2}&to=${LUN2}`))['gaps'],
      ).toEqual([]);
      const del = await request(fx.app.getHttpServer())
        .delete(`/hr/staffing-needs/${besoin}`)
        .set('Cookie', fx.as('hr_manager'));
      expect(del.status).toBe(204);
      expect(ok(await fx.get('hr_manager', '/hr/staffing-needs'))['items']).toEqual([]);
    });
  });

  describe('isolation (critère 16)', () => {
    it('une autre organisation ne voit ni ne touche aucun créneau ni collaborateur', async () => {
      ok(
        await fx.put('ownerB', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('ownerB'),
          planning: { enabled: true },
        }),
      );
      code(
        await fx.post('ownerB', '/hr/shifts', creneau(emp.B, LUN2, '09:00', '12:00')),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.put('ownerB', `/hr/shifts/${premier}`, {
          ...creneau(emp.B, LUN1, '08:00', '16:00'),
          expectedRevision: 1,
        }),
        404,
        'SHIFT_NOT_FOUND',
      );
      code(
        await fx.post('ownerB', '/hr/shifts/publish', { ids: [premier] }),
        404,
        'SHIFT_NOT_FOUND',
      );
      code(
        await fx.post('ownerB', `/hr/shifts/${premier}/cancel`, { expectedRevision: 1 }),
        404,
        'SHIFT_NOT_FOUND',
      );
      const lu = ok(
        await fx.get('ownerB', `/hr/shifts?from=${LUN1}&to=${plus(LUN1, 6)}&scope=organization`),
      );
      expect(lu['items']).toEqual([]);
      expect(
        ok(await fx.get('ownerB', `/hr/planning/gaps?from=${LUN2}&to=${LUN2}`))['gaps'],
      ).toEqual([]);
    });
  });
});
