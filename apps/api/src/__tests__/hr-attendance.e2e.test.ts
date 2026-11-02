// Présences et pointage simple contre la vraie application (ADR-0051 § 2.3, § 2.7, § 3.4,
// § 4, § 6.2 ; critères 11, 16, 17). ADR-0051 — H12.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Couvre : pointage éteint par défaut, activation par `hr.manage`, pointage par
// soi (heure du serveur, aucun champ de localisation), saisie pour autrui (note, jamais
// futur), journées calculées par le moteur (548 minutes, `ATTENDANCE_UNPAIRED`),
// corrections décidées par `attendanceCorrectionDecision`, débit de 20 pointages par jour,
// portée et isolation, notifications sans heure ni motif.

import 'reflect-metadata';

import { ATTENDANCE_FORBIDDEN_FIELDS } from '@lalanda/shared/hr';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HrAttendanceRetentionJob } from '../hr/attendance/hr-attendance-retention.job.js';
import { e2eSuite } from './e2e-utils.js';
import { code, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

/** Jours passés (Kinshasa = UTC+1) : 08:02 locale = 07:02Z. */
const J1 = '2026-10-26';
const J2 = '2026-10-27';
const J3 = '2026-10-20';

e2eSuite('RH — présences et pointage (ADR-0051 H12)', () => {
  let fx: HrFixture;
  let db: Db;
  /** A (Analyste) manager de B (Lecteur) ; C (Commercial) sans lien. */
  const emp = { A: '', B: '', C: '' };

  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const settingsRev = async (account: 'hr_manager' | 'ownerB') =>
    ok(await fx.get(account, '/hr/attendance/settings'))['revision'] as number;

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-presences');
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

  describe('éteint par défaut (critères 11, 17)', () => {
    it('réglages par défaut : pointage et plannings éteints, aucun seuil, pointages gardés 5 ans (ADR-0054)', async () => {
      const s = ok(await fx.get('viewer', '/hr/attendance/settings'));
      expect(s).toMatchObject({
        attendance: { enabled: false, selfClock: true, lateToleranceMinutes: null },
        planning: { enabled: false, indicativeMaxMinutesPerWeek: null },
        retention: { attendanceMonths: 60 },
      });
    });

    it('toute route du pointage rend 409 HR_FEATURE_DISABLED', async () => {
      code(
        await fx.post('viewer', '/hr/attendance/clock', { kind: 'in' }),
        409,
        'HR_FEATURE_DISABLED',
      );
      code(
        await fx.get('viewer', `/hr/attendance/days?from=${J1}&to=${J1}`),
        409,
        'HR_FEATURE_DISABLED',
      );
      code(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: `${J1}T07:02:00Z`,
          note: 'Oubli',
        }),
        409,
        'HR_FEATURE_DISABLED',
      );
      expect(await db.collection('hr_attendance_events').countDocuments({})).toBe(0);
    });

    it('rôles externes : le Conseiller ne pointe pas (403 nommant attendance.clock)', async () => {
      const res = await fx.post('advisor', '/hr/attendance/clock', { kind: 'in' });
      code(res, 403, 'FORBIDDEN');
      expect(res.body.action).toBe('attendance.clock');
    });

    it('activer exige hr.manage ; révision attendue', async () => {
      code(
        await fx.put('viewer', '/hr/attendance/settings', {
          expectedRevision: 0,
          attendance: { enabled: true },
        }),
        403,
        'FORBIDDEN',
      );
      code(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: 7,
          attendance: { enabled: true },
        }),
        409,
        'STALE_REVISION',
      );
      code(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          attendance: { enabled: true, geolocation: true },
        }),
        400,
        'INVALID_REQUEST',
      );
      const s = ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          attendance: { enabled: true },
        }),
      );
      expect(s['attendance']).toEqual({
        enabled: true,
        selfClock: true,
        lateToleranceMinutes: null,
      });
      expect(s['planning']['enabled']).toBe(false);
      // Les réglages d'ADR-0045 partagent le document et sa révision.
      const rh = ok(await fx.get('hr_manager', '/hr/settings'));
      expect(rh['revision']).toBe(s['revision']);
    });
  });

  describe('pointer (critère 11)', () => {
    it('« J’arrive » / « Je pars » : heure du serveur, rien d’autre', async () => {
      const avant = Date.now();
      const arrivee = ok(await fx.post('viewer', '/hr/attendance/clock', { kind: 'in' }), 201);
      expect(arrivee['notice']).toMatch(/heure du serveur/);
      expect(arrivee['event']).toMatchObject({ employeeId: emp.B, kind: 'in', source: 'self' });
      expect(Date.parse(arrivee['event']['at'])).toBeGreaterThanOrEqual(avant - 1000);
      ok(await fx.post('viewer', '/hr/attendance/clock', { kind: 'out' }), 201);
      // Aucun champ d'horodatage ou de position fourni par le client n'est accepté.
      code(
        await fx.post('viewer', '/hr/attendance/clock', {
          kind: 'in',
          at: '2026-01-01T00:00:00Z',
        }),
        400,
        'INVALID_REQUEST',
      );
      code(
        await fx.post('viewer', '/hr/attendance/clock', { kind: 'in', latitude: -4.3 }),
        400,
        'INVALID_REQUEST',
      );
      const docs = await db
        .collection('hr_attendance_events')
        .find({ organizationId: fx.orgN, employeeId: emp.B })
        .toArray();
      expect(docs).toHaveLength(2);
      for (const d of docs) {
        for (const champ of ATTENDANCE_FORBIDDEN_FIELDS) expect(d).not.toHaveProperty(champ);
      }
    });

    it('sans fiche reliée : 409 EMPLOYEE_NOT_LINKED', async () => {
      code(
        await fx.post('finance_director', '/hr/attendance/clock', { kind: 'in' }),
        409,
        'EMPLOYEE_NOT_LINKED',
      );
    });
  });

  describe('saisie pour autrui et journées (moteur)', () => {
    it('le manager saisit 08:02 et 17:10 pour B : 548 minutes', async () => {
      const arrivee = ok(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: `${J1}T07:02:00Z`,
          note: 'Badge oublié',
        }),
        201,
      );
      expect(arrivee['source']).toBe('manager');
      ok(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'out',
          at: `${J1}T16:10:00Z`,
          note: 'Badge oublié',
        }),
        201,
      );
      const vue = ok(await fx.get('viewer', `/hr/attendance/days?from=${J1}&to=${J1}`));
      expect(vue['employeeId']).toBe(emp.B);
      expect(vue['days']).toHaveLength(1);
      expect(vue['days'][0]['minutes']).toBe(548);
      expect(vue['minutes']).toBe(548);
      expect(vue['days'][0]['findings']).toEqual([]);
      expect(vue['events']).toHaveLength(2);
    });

    it('note obligatoire, jamais dans le futur, jamais pour soi par ce chemin', async () => {
      code(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: `${J1}T07:00:00Z`,
        }),
        400,
        'INVALID_REQUEST',
      );
      code(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: '2099-01-01T07:00:00Z',
          note: 'Futur',
        }),
        422,
        'ATTENDANCE_IN_FUTURE',
      );
      code(
        await fx.post('analyst', '/hr/attendance/events', {
          employeeId: emp.A,
          kind: 'in',
          at: `${J1}T07:00:00Z`,
          note: 'Moi',
        }),
        403,
        'ATTENDANCE_ENTRY_NOT_YOURS',
      );
      // Un collègue sans lien : la fiche n'existe pas pour lui.
      code(
        await fx.post('sales_rep', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: `${J1}T07:00:00Z`,
          note: 'Tiers',
        }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      const rh = ok(
        await fx.post('hr_manager', '/hr/attendance/events', {
          employeeId: emp.C,
          kind: 'in',
          at: `${J1}T07:30:00Z`,
          note: 'Saisie RH',
        }),
        201,
      );
      expect(rh['source']).toBe('hr');
    });

    it('portée : soi, manager, hr.read ; un tiers reçoit 404', async () => {
      ok(await fx.get('analyst', `/hr/attendance/days?employeeId=${emp.B}&from=${J1}&to=${J1}`));
      ok(await fx.get('hr_manager', `/hr/attendance/days?employeeId=${emp.B}&from=${J1}&to=${J1}`));
      code(
        await fx.get('sales_rep', `/hr/attendance/days?employeeId=${emp.B}&from=${J1}&to=${J1}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.get('viewer', `/hr/attendance/days?from=2026-01-01&to=2026-06-30`),
        400,
        'INVALID_REQUEST',
      );
    });

    it('deux `in` consécutifs ne sont pas refusés : le moteur lève ATTENDANCE_UNPAIRED', async () => {
      for (const at of [`${J2}T07:00:00Z`, `${J2}T07:05:00Z`]) {
        ok(
          await fx.post('analyst', '/hr/attendance/events', {
            employeeId: emp.B,
            kind: 'in',
            at,
            note: 'Double arrivée',
          }),
          201,
        );
      }
      const vue = ok(await fx.get('viewer', `/hr/attendance/days?from=${J2}&to=${J2}`));
      const codes = vue['days'][0]['findings'].map((f: { code: string }) => f.code);
      expect(codes).toContain('ATTENDANCE_UNPAIRED');
    });
  });

  describe('corrections (critère 11, § 3.4)', () => {
    let demande = '';
    let doublon = '';

    it('B demande ; B ne décide pas ; un tiers ne voit rien ; A accepte', async () => {
      const jour = ok(await fx.get('viewer', `/hr/attendance/days?from=${J2}&to=${J2}`));
      doublon = jour['events'][1]['id'];
      const c = ok(
        await fx.post('viewer', '/hr/attendance/corrections', {
          date: J2,
          proposed: [{ kind: 'out', at: `${J2}T16:00:00Z` }],
          voidEventIds: [doublon],
          reason: 'Double appui sur « J’arrive »',
        }),
        201,
      );
      demande = c['id'];
      expect(c).toMatchObject({ status: 'pending', employeeId: emp.B });
      const notes = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.attendance_correction_requested' })
        .toArray();
      expect(notes.map((n) => n['recipientUserId'])).toEqual([fx.userIds['analyst']]);
      expect(String(notes[0]!['title'])).not.toMatch(/Double|16:00|17:00/);

      code(
        await fx.post('viewer', `/hr/attendance/corrections/${demande}/approve`, {}),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      code(
        await fx.post('sales_rep', `/hr/attendance/corrections/${demande}/approve`, {}),
        404,
        'ATTENDANCE_CORRECTION_NOT_FOUND',
      );
      const decidee = ok(
        await fx.post('analyst', `/hr/attendance/corrections/${demande}/approve`, {}),
      );
      expect(decidee).toMatchObject({ status: 'approved', soleApprover: false });
      expect(decidee['createdEventIds']).toHaveLength(1);
      code(
        await fx.post('hr_manager', `/hr/attendance/corrections/${demande}/approve`, {}),
        409,
        'ATTENDANCE_CORRECTION_NOT_PENDING',
      );
    });

    it('l’événement corrigé reste, marqué voidedBy ; la journée est appariée', async () => {
      const annule = await db
        .collection('hr_attendance_events')
        .findOne({ _id: new ObjectId(doublon) });
      expect(annule).not.toBeNull();
      expect(annule!['voidedBy']).toBe(demande);
      const ecrit = await db.collection('hr_attendance_events').findOne({ correctionId: demande });
      expect(ecrit).toMatchObject({ source: 'correction', kind: 'out' });
      const vue = ok(await fx.get('viewer', `/hr/attendance/days?from=${J2}&to=${J2}`));
      expect(vue['days'][0]['minutes']).toBe(540);
      expect(vue['days'][0]['findings']).toEqual([]);
      const audit = await db
        .collection('audit_events')
        .findOne({ action: 'hr.attendance.correction_approved', targetId: demande });
      expect(audit).not.toBeNull();
    });

    it('une correction saisie par le manager n’est pas décidée par lui ; les RH décident', async () => {
      const c = ok(
        await fx.post('analyst', '/hr/attendance/corrections', {
          employeeId: emp.B,
          date: J1,
          proposed: [],
          voidEventIds: [
            (await fx.get('viewer', `/hr/attendance/days?from=${J1}&to=${J1}`)).body.events[0].id,
          ],
          reason: 'Saisie en double',
        }),
        201,
      );
      code(
        await fx.post('analyst', `/hr/attendance/corrections/${c['id']}/approve`, {}),
        409,
        'CREATOR_APPROVAL_FORBIDDEN',
      );
      code(
        await fx.post('hr_manager', `/hr/attendance/corrections/${c['id']}/reject`, {}),
        400,
        'INVALID_REQUEST',
      );
      const refusee = ok(
        await fx.post('hr_manager', `/hr/attendance/corrections/${c['id']}/reject`, {
          comment: 'Le pointage est juste',
        }),
      );
      expect(refusee['status']).toBe('rejected');
    });

    it('listes : soi, équipe, RH ; un tiers ne voit rien', async () => {
      expect(ok(await fx.get('viewer', '/hr/attendance/corrections'))['items']).toHaveLength(2);
      expect(ok(await fx.get('analyst', '/hr/attendance/corrections'))['items']).toHaveLength(2);
      expect(
        ok(await fx.get('hr_manager', '/hr/attendance/corrections?status=approved'))['items'],
      ).toHaveLength(1);
      expect(ok(await fx.get('sales_rep', '/hr/attendance/corrections'))['items']).toEqual([]);
      const page = ok(await fx.get('viewer', '/hr/attendance/corrections?limit=1'));
      expect(page['items']).toHaveLength(1);
      const suite = ok(
        await fx.get('viewer', `/hr/attendance/corrections?limit=1&cursor=${page['nextCursor']}`),
      );
      expect(suite['items'][0]['id']).not.toBe(page['items'][0]['id']);
    });
  });

  describe('débit et isolation (critère 16)', () => {
    it('au plus 20 pointages par jour et par collaborateur : 429', async () => {
      for (let i = 0; i < 20; i += 1) {
        const minute = String(i).padStart(2, '0');
        ok(
          await fx.post('hr_manager', '/hr/attendance/events', {
            employeeId: emp.C,
            kind: i % 2 === 0 ? 'in' : 'out',
            at: `${J3}T08:${minute}:00Z`,
            note: 'Débit',
          }),
          201,
        );
      }
      code(
        await fx.post('hr_manager', '/hr/attendance/events', {
          employeeId: emp.C,
          kind: 'in',
          at: `${J3}T09:30:00Z`,
          note: 'Débit',
        }),
        429,
        'ATTENDANCE_RATE_LIMITED',
      );
    });

    it('une autre organisation ne voit ni fiche, ni correction, ni pointage', async () => {
      ok(
        await fx.put('ownerB', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('ownerB'),
          attendance: { enabled: true },
        }),
      );
      code(
        await fx.get('ownerB', `/hr/attendance/days?employeeId=${emp.B}&from=${J1}&to=${J1}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.post('ownerB', '/hr/attendance/events', {
          employeeId: emp.B,
          kind: 'in',
          at: `${J1}T07:00:00Z`,
          note: 'Forgé',
        }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      const c = await db
        .collection('hr_attendance_corrections')
        .findOne({ organizationId: fx.orgN });
      code(
        await fx.post('ownerB', `/hr/attendance/corrections/${String(c!['_id'])}/approve`, {}),
        404,
        'ATTENDANCE_CORRECTION_NOT_FOUND',
      );
      expect(ok(await fx.get('ownerB', '/hr/attendance/corrections'))['items']).toEqual([]);
      // Les réglages de N ne changent pas ceux de B, et inversement.
      expect(ok(await fx.get('ownerB', '/hr/attendance/settings'))['planning']['enabled']).toBe(
        false,
      );
    });
  });

  describe('conservation des pointages (ADR-0054)', () => {
    /** Pointage posé directement (ancienneté impossible à saisir par l'API). */
    const pointage = (organizationId: string, employeeId: string, at: string) => ({
      organizationId,
      employeeId,
      kind: 'in',
      at: new Date(at),
      source: 'hr',
      note: 'Ancien',
      voidedBy: null,
      correctionId: null,
      createdBy: 'e2e',
      _schemaVersion: 1,
      createdAt: new Date(at),
    });
    const correction = (organizationId: string, employeeId: string, date: string) => ({
      organizationId,
      employeeId,
      date,
      proposed: [],
      voidEventIds: [],
      reason: 'Ancienne',
      status: 'rejected',
      requestedBy: 'e2e',
      decidedBy: 'e2e',
      decidedAt: new Date(`${date}T12:00:00Z`),
      comment: null,
      soleApprover: false,
      createdAt: new Date(`${date}T12:00:00Z`),
      updatedAt: new Date(`${date}T12:00:00Z`),
    });
    const NOW = new Date('2026-11-03T08:00:00Z');

    it('purge quotidienne : au-delà de 5 ans par défaut, journalisée, idempotente ; récent gardé', async () => {
      const events = db.collection('hr_attendance_events');
      const corrections = db.collection('hr_attendance_corrections');
      const ancien = await events.insertMany([
        pointage(fx.orgN, emp.A, '2021-11-01T07:00:00Z'),
        pointage(fx.orgN, emp.A, '2019-03-04T07:00:00Z'),
      ]);
      // Limite : le 3 nov. 2021 à 00:00 Kinshasa (2 nov. 23:00Z) — gardé.
      const limite = await events.insertOne(pointage(fx.orgN, emp.A, '2021-11-02T23:00:00Z'));
      await corrections.insertMany([
        correction(fx.orgN, emp.A, '2021-11-02'),
        correction(fx.orgN, emp.A, '2021-11-03'),
      ]);
      const avant = await events.countDocuments({ organizationId: fx.orgN });

      const job = fx.app.get(HrAttendanceRetentionJob);
      const r1 = await job.run(NOW);
      expect(r1).toMatchObject({ purgedOrganizations: 1, events: 2, corrections: 1 });
      for (const id of Object.values(ancien.insertedIds)) {
        expect(await events.findOne({ _id: id })).toBeNull();
      }
      expect(await events.findOne({ _id: limite.insertedId })).not.toBeNull();
      expect(await events.countDocuments({ organizationId: fx.orgN })).toBe(avant - 2);
      const restantes = await corrections
        .find({ organizationId: fx.orgN, reason: 'Ancienne' })
        .toArray();
      expect(restantes.map((c) => c['date'])).toEqual(['2021-11-03']);
      const journal = await db
        .collection('audit_events')
        .find({ organizationId: fx.orgN, action: 'hr.attendance.purged' })
        .toArray();
      expect(journal).toHaveLength(1);
      expect(journal[0]).toMatchObject({
        actorUserId: 'system',
        metadata: { events: 2, corrections: 1, cutoffDay: '2021-11-03', retentionMonths: 60 },
      });
      // Les pointages de la suite (octobre 2026) sont intacts.
      expect(
        await events.countDocuments({
          organizationId: fx.orgN,
          at: { $gte: new Date('2026-01-01T00:00:00Z') },
        }),
      ).toBeGreaterThan(0);

      // Idempotente : une seconde passe ne trouve rien et n'écrit rien.
      const r2 = await job.run(NOW);
      expect(r2.purgedOrganizations).toBe(0);
      expect(
        await db
          .collection('audit_events')
          .countDocuments({ organizationId: fx.orgN, action: 'hr.attendance.purged' }),
      ).toBe(1);
    });

    it('durée réglée par l’organisation ; `null` = aucune purge ; jamais hors de l’organisation', async () => {
      const events = db.collection('hr_attendance_events');
      // B règle 12 mois ; N désactive la purge.
      ok(
        await fx.put('ownerB', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('ownerB'),
          retention: { attendanceMonths: 12 },
        }),
      );
      ok(
        await fx.put('hr_manager', '/hr/attendance/settings', {
          expectedRevision: await settingsRev('hr_manager'),
          retention: { attendanceMonths: null },
        }),
      );
      const b = await events.insertOne(pointage(fx.orgB, 'emp-b', '2025-06-01T07:00:00Z'));
      const bRecent = await events.insertOne(pointage(fx.orgB, 'emp-b', '2026-02-01T07:00:00Z'));
      const n = await events.insertOne(pointage(fx.orgN, emp.A, '2010-01-04T07:00:00Z'));
      const r = await fx.app.get(HrAttendanceRetentionJob).run(NOW);
      expect(r.events).toBe(1);
      expect(await events.findOne({ _id: b.insertedId })).toBeNull();
      expect(await events.findOne({ _id: bRecent.insertedId })).not.toBeNull();
      expect(await events.findOne({ _id: n.insertedId })).not.toBeNull();
      const journal = await db
        .collection('audit_events')
        .findOne({ organizationId: fx.orgB, action: 'hr.attendance.purged' });
      expect(journal?.['metadata']).toMatchObject({ events: 1, retentionMonths: 12 });
    });
  });
});
