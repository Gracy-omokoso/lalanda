// Absences et congés contre la vraie application (ADR-0045 § 2.5 à § 2.7, § 3.2,
// § 3.3, § 4.3, § 5, § 6.1 ; critères 8 à 12, 16, 19, 20, 21). ADR-0045 — H3.
//
// Chaîne complète : cookie → better-auth → AuthGuard → PermissionsGuard → contrôleurs →
// MongoDB. Couvre : types et fériés (aucun droit, aucun férié par défaut), cycle d'une
// demande, décompte par le moteur, validation par le manager, refus de valider sa
// propre demande, deux étapes deux personnes, approbateur unique, types confidentiels
// (« Absent » pour le manager, partout), soldes, grand livre, acquisitions rejouées,
// report et expiration, chevauchements, annulation, sortie qui annule les absences
// futures, `PUT /hr/settings` et circuit, isolation entre organisations, droits par
// rôle, éléments de « Mes tâches » et notifications.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HrLeaveAccrualsJob } from '../hr/accruals/hr-leave-accruals.job.js';
import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

/** Lundi 1er mars 2027 et suivants : toujours dans le futur pour ces tests. */
const LUN = '2027-03-01';
const MER = '2027-03-03';
const VEN = '2027-03-05';
const SAM = '2027-03-06';
const DIM = '2027-03-07';
const full = (date: string) => ({ date, half: 'full' as const });

e2eSuite('RH — absences et congés (ADR-0045 H3)', () => {
  let fx: HrFixture;
  let db: Db;
  /** A (Analyste) manager de B (Lecteur) ; C (Commercial) sans lien ; O (Propriétaire). */
  const emp = { A: '', B: '', C: '', O: '', E: '' };
  const type = { conges: '', maladie: '', autorisee: '', injustifiee: '' };

  const typeRev = async (id: string) =>
    (await db.collection('hr_leave_types').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;
  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-absences');
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
    const owner = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Proprio', { userId: fx.userIds['owner'] }),
      ),
      201,
    );
    emp.O = owner['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('types et fériés', () => {
    it('quatre types créés à l’activation, aucun droit ; politique servie avec hr.read seulement', async () => {
      const lu = ok(await fx.get('viewer', '/hr/leave-types'));
      expect(lu['items']).toHaveLength(4);
      for (const t of lu['items']) expect(t.policy).toBeNull();
      const rh = ok(await fx.get('hr_manager', '/hr/leave-types'));
      for (const t of rh['items']) expect(t.policy.accrual).toEqual({ kind: 'none' });
      const byKey = (k: string) => rh['items'].find((t: { key: string }) => t.key === k);
      type.conges = byKey('paid_leave').id;
      type.maladie = byKey('sick_leave').id;
      type.autorisee = byKey('authorized_absence').id;
      type.injustifiee = byKey('unjustified_absence').id;
      expect(byKey('sick_leave')).toMatchObject({ confidential: true, deductsFromBalance: false });
      expect(byKey('unjustified_absence')).toMatchObject({ hrOnly: true });
      expect(byKey('paid_leave')).toMatchObject({ deductsFromBalance: true });
      // Rejouer la lecture ne crée rien de plus.
      expect(
        await db.collection('hr_leave_types').countDocuments({ organizationId: fx.orgN }),
      ).toBe(4);
      code(await fx.post('viewer', '/hr/leave-types', { label: 'Formation' }), 403, 'FORBIDDEN');
      const formation = ok(
        await fx.post('hr_manager', '/hr/leave-types', { label: 'Formation', unit: 'day' }),
        201,
      );
      expect(formation['policy']['accrual']).toEqual({ kind: 'none' });
      code(
        await fx.post('hr_manager', '/hr/leave-types', { label: 'formation' }),
        409,
        'LEAVE_TYPE_LABEL_EXISTS',
      );
      ok(
        await fx.post('hr_manager', `/hr/leave-types/${formation['id']}/archive`, {
          expectedRevision: 1,
        }),
      );
      expect((await fx.get('viewer', '/hr/leave-types')).body.items).toHaveLength(4);
    });

    it('aucun férié par défaut ; un férié par date ; écriture réservée à hr.manage', async () => {
      expect(ok(await fx.get('viewer', '/hr/holidays?year=2027'))['items']).toEqual([]);
      const f = ok(
        await fx.post('hr_manager', '/hr/holidays', { date: MER, label: 'Fermeture' }),
        201,
      );
      code(
        await fx.post('hr_manager', '/hr/holidays', { date: MER, label: 'Doublon' }),
        409,
        'HOLIDAY_EXISTS',
      );
      code(await fx.post('viewer', '/hr/holidays', { date: VEN, label: 'X' }), 403, 'FORBIDDEN');
      expect(ok(await fx.get('viewer', '/hr/holidays?year=2027'))['items']).toHaveLength(1);
      // Isolation : l'autre organisation ne voit ni n'efface ce férié.
      expect(ok(await fx.get('ownerB', '/hr/holidays'))['items']).toEqual([]);
      const del = await request(fx.app.getHttpServer())
        .delete(`/hr/holidays/${f['id']}`)
        .set('Cookie', fx.as('ownerB'));
      expect(del.status).toBe(404);
    });
  });

  describe('cycle d’une demande et validation par le manager', () => {
    let demande = '';

    it('décompte du moteur : lundi matin au vendredi midi, férié le mercredi → 3,5 jours', async () => {
      const d = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full(LUN),
          end: { date: VEN, half: 'am' },
          reason: 'Déménagement',
        }),
        201,
      );
      expect(d).toMatchObject({
        employeeId: emp.B,
        days: '3.5',
        status: 'pending',
        steps: ['manager'],
        currentStep: 'manager',
        typeLabel: 'Absence autorisée',
        masked: false,
      });
      demande = d['id'];
      const weekend = await fx.post('viewer', '/hr/leave-requests', {
        typeId: type.autorisee,
        start: full(SAM),
        end: full(DIM),
      });
      code(weekend, 422, 'LEAVE_NO_WORKING_DAY');
    });

    it('chevauchement d’une demi-journée : 409 LEAVE_OVERLAP', async () => {
      code(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: { date: VEN, half: 'am' },
          end: { date: VEN, half: 'am' },
        }),
        409,
        'LEAVE_OVERLAP',
      );
      // L'après-midi du vendredi est libre.
      const pm = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: { date: VEN, half: 'pm' },
          end: { date: VEN, half: 'pm' },
        }),
        201,
      );
      ok(await fx.post('viewer', `/hr/leave-requests/${pm['id']}/cancel`, {}));
    });

    it('« Mes tâches » : l’élément est chez le manager, absent chez le demandeur', async () => {
      const chezA = ok(await fx.get('analyst', '/work/my-tasks'));
      const items = [
        ...chezA['overdue'],
        ...chezA['today'],
        ...chezA['next7Days'],
        ...chezA['later'],
        ...chezA['noDate'],
      ].filter((e: { source: string }) => e.source === 'hr');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: 'leave_approval',
        id: `hr:leave:${demande}`,
        requestId: demande,
        typeLabel: 'Absence autorisée',
        days: '3.5',
        dueDate: LUN,
        done: false,
        kindLabel: 'Validation d’absence',
        href: '/rh/absences?vue=a-valider',
      });
      const chezB = ok(await fx.get('viewer', '/work/my-tasks'));
      const tous = [
        ...chezB['overdue'],
        ...chezB['today'],
        ...chezB['next7Days'],
        ...chezB['later'],
        ...chezB['noDate'],
      ];
      expect(tous.filter((e: { source: string }) => e.source === 'hr')).toEqual([]);
      const pending = ok(await fx.get('analyst', '/hr/leave-approvals/pending'));
      expect(pending['items'].map((r: { id: string }) => r.id)).toEqual([demande]);
      expect(ok(await fx.get('viewer', '/hr/leave-approvals/pending'))['items']).toEqual([]);
    });

    it('le demandeur ne valide pas ; un tiers sans lien non plus ; le manager valide', async () => {
      code(
        await fx.post('viewer', `/hr/leave-requests/${demande}/approve`, { expectedRevision: 1 }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      code(
        await fx.post('sales_rep', `/hr/leave-requests/${demande}/approve`, {
          expectedRevision: 1,
        }),
        403,
        'LEAVE_NOT_YOUR_STEP',
      );
      code(
        await fx.post('admin', `/hr/leave-requests/${demande}/approve`, { expectedRevision: 1 }),
        403,
        'LEAVE_NOT_YOUR_STEP',
      );
      code(
        await fx.post('analyst', `/hr/leave-requests/${demande}/approve`, {
          expectedRevision: 9,
        }),
        409,
        'STALE_REVISION',
      );
      const v = ok(
        await fx.post('analyst', `/hr/leave-requests/${demande}/approve`, {
          expectedRevision: 1,
          comment: 'Bon déménagement',
        }),
      );
      expect(v).toMatchObject({ status: 'approved', currentStep: null });
      expect(v['approvals'][0]).toMatchObject({
        step: 'manager',
        userId: fx.userIds['analyst'],
        decision: 'approved',
        soleApprover: false,
        onBehalfOfManager: false,
      });
      // Type sans solde : rien au grand livre.
      expect(await db.collection('hr_leave_ledger').countDocuments({ requestId: demande })).toBe(0);
      // Notification au bénéficiaire, sans type ni motif.
      const notes = await db
        .collection('notifications')
        .find({ recipientUserId: fx.userIds['viewer'], kind: 'hr.leave_approved' })
        .toArray();
      expect(notes).toHaveLength(1);
      expect(String(notes[0]!['title'])).not.toMatch(/Absence autorisée|Déménagement/);
      code(
        await fx.post('analyst', `/hr/leave-requests/${demande}/approve`, { expectedRevision: 2 }),
        409,
        'LEAVE_NOT_PENDING',
      );
      expect(
        await db.collection('audit_events').countDocuments({
          action: 'hr.leave.approved',
          targetId: demande,
        }),
      ).toBe(1);
    });

    it('portée : le demandeur voit les siennes, le manager son équipe, un tiers rien', async () => {
      const b = ok(await fx.get('viewer', '/hr/leave-requests'));
      expect(b['items'].every((r: { employeeId: string }) => r.employeeId === emp.B)).toBe(true);
      expect(
        ok(await fx.get('analyst', `/hr/leave-requests?employeeId=${emp.B}`))['items'].length,
      ).toBeGreaterThan(0);
      code(
        await fx.get('sales_rep', `/hr/leave-requests?employeeId=${emp.B}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.get('sales_rep', `/hr/leave-balances?employeeId=${emp.B}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      // Calendrier d'équipe du manager.
      const cal = ok(await fx.get('analyst', `/hr/calendar?from=${LUN}&to=${VEN}&scope=team`));
      expect(cal['entries'].map((e: { employeeId: string }) => e.employeeId)).toContain(emp.B);
      expect(cal['holidays']).toEqual([{ date: MER, halfDay: null, label: 'Fermeture' }]);
      // Moi et mon équipe : demandes et absences servies avec la fiche.
      const me = ok(await fx.get('viewer', '/hr/me'));
      expect(me['requests'].some((r: { days: string }) => r.days === '3.5')).toBe(true);
      const team = ok(await fx.get('analyst', '/hr/team'));
      expect(team['items'][0]).toMatchObject({ id: emp.B, managerName: expect.any(String) });
      expect(team['items'][0]['absences']).toHaveLength(1);
    });
  });

  describe('soldes, grand livre, annulation', () => {
    const AVR = (j: number) => `2027-04-${String(j).padStart(2, '0')}`;
    let conges = '';

    it('sans attribution, aucun droit : 409 LEAVE_BALANCE_INSUFFICIENT', async () => {
      code(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.conges,
          start: full(AVR(5)),
          end: full(AVR(7)),
        }),
        409,
        'LEAVE_BALANCE_INSUFFICIENT',
      );
    });

    it('attribution (hr.manage, note, audit) ; 3 jours avec 2,5 disponibles : 409 ; 2 jours réservés', async () => {
      code(
        await fx.post('viewer', '/hr/leave-ledger', {
          employeeId: emp.B,
          typeId: type.conges,
          kind: 'allocation',
          days: '2.50',
          effectiveOn: '2027-01-01',
          note: 'Reprise du solde',
        }),
        403,
        'FORBIDDEN',
      );
      const sansNote = await fx.post('hr_manager', '/hr/leave-ledger', {
        employeeId: emp.B,
        typeId: type.conges,
        kind: 'allocation',
        days: '2.50',
        effectiveOn: '2027-01-01',
      });
      expect(sansNote.status).toBe(400);
      const m = ok(
        await fx.post('hr_manager', '/hr/leave-ledger', {
          employeeId: emp.B,
          typeId: type.conges,
          kind: 'allocation',
          days: '2.50',
          effectiveOn: '2027-01-01',
          note: 'Reprise du solde',
        }),
        201,
      );
      expect(m).toMatchObject({ kind: 'allocation', days: '2.50', leaveYear: 2027 });
      expect(
        await db.collection('audit_events').countDocuments({
          action: 'hr.leave_balance.adjusted',
          targetId: emp.B,
        }),
      ).toBe(1);
      const trop = await fx.post('viewer', '/hr/leave-requests', {
        typeId: type.conges,
        start: full(AVR(5)),
        end: full(AVR(7)),
      });
      code(trop, 409, 'LEAVE_BALANCE_INSUFFICIENT');
      expect(trop.body.details).toMatchObject({
        available: '2.5',
        requested: '3',
        shortfall: '0.5',
      });
      const d = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.conges,
          start: full(AVR(5)),
          end: full(AVR(6)),
        }),
        201,
      );
      conges = d['id'];
      const solde = ok(await fx.get('viewer', `/hr/leave-balances?asOf=${AVR(1)}`));
      expect(solde['balances']).toEqual([
        expect.objectContaining({
          typeId: type.conges,
          typeLabel: 'Congés',
          allocated: '2.5',
          pending: '2',
          available: '0.5',
        }),
      ]);
    });

    it('la validation écrit `taken` ; l’annulation d’une absence future écrit `taken_reversal`', async () => {
      ok(await fx.post('analyst', `/hr/leave-requests/${conges}/approve`, { expectedRevision: 1 }));
      const ledger = ok(await fx.get('viewer', `/hr/leave-ledger?typeId=${type.conges}`));
      expect(ledger['items'].map((e: { kind: string; days: string }) => [e.kind, e.days])).toEqual([
        ['allocation', '2.50'],
        ['taken', '-2'],
      ]);
      const apres = ok(await fx.get('viewer', `/hr/leave-balances?asOf=${AVR(1)}`));
      expect(apres['balances'][0]).toMatchObject({ upcoming: '2', pending: '0', available: '0.5' });
      // Un tiers ne lit pas le grand livre d'autrui ; le manager non plus.
      code(
        await fx.get('analyst', `/hr/leave-ledger?employeeId=${emp.B}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      ok(await fx.post('viewer', `/hr/leave-requests/${conges}/cancel`, {}));
      const rendu = ok(await fx.get('viewer', `/hr/leave-balances?asOf=${AVR(1)}`));
      expect(rendu['balances'][0]).toMatchObject({ upcoming: '0', available: '2.5' });
      const kinds = (await db.collection('hr_leave_ledger').find({ requestId: conges }).toArray())
        .map((e) => e['kind'])
        .sort();
      expect(kinds).toEqual(['taken', 'taken_reversal']);
      code(
        await fx.post('viewer', `/hr/leave-requests/${conges}/cancel`, {}),
        409,
        'LEAVE_NOT_CANCELLABLE',
      );
      // Grand livre en ajout seul : aucun mouvement modifié.
      expect(await db.collection('hr_leave_ledger').countDocuments({ employeeId: emp.B })).toBe(3);
    });

    it('un tiers n’annule pas ; les RH annulent avec un motif', async () => {
      const d = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-05-03'),
          end: full('2027-05-03'),
        }),
        201,
      );
      code(
        await fx.post('sales_rep', `/hr/leave-requests/${d['id']}/cancel`, {}),
        404,
        'LEAVE_REQUEST_NOT_FOUND',
      );
      expect((await fx.post('hr_manager', `/hr/leave-requests/${d['id']}/cancel`, {})).status).toBe(
        400,
      );
      const c = ok(
        await fx.post('hr_manager', `/hr/leave-requests/${d['id']}/cancel`, {
          reason: 'Saisie en double',
        }),
      );
      expect(c['status']).toBe('cancelled');
      expect(c['cancellation']).toMatchObject({ reason: 'Saisie en double' });
    });
  });

  describe('acquisitions, report, expiration (tâche `hr.leave-accruals`)', () => {
    it('2,00 jours par mois, entrée le 16 janvier → 1,03 ; rejouée, rien de plus ; report plafonné puis expiré', async () => {
      const e = ok(
        await fx.post(
          'hr_manager',
          '/hr/employees',
          fiche('Acquéreur', { startDate: '2026-01-16' }),
        ),
        201,
      );
      emp.E = e['id'];
      ok(
        await fx.put('hr_manager', `/hr/leave-types/${type.conges}`, {
          expectedRevision: await typeRev(type.conges),
          accrual: { kind: 'monthly', days: '2.00' },
          carryOver: { maxDays: '5', expiresAfterMonths: 1 },
        }),
      );
      const job = fx.app.get(HrLeaveAccrualsJob);
      const premier = await job.run(new Date('2026-02-15T12:00:00Z'));
      expect(premier.accruals).toBeGreaterThanOrEqual(1);
      const jan = await db
        .collection('hr_leave_ledger')
        .find({ employeeId: emp.E, kind: 'accrual' })
        .toArray();
      expect(jan.map((x) => [x['period'], x['days'], x['effectiveOn']])).toEqual([
        ['2026-01', '1.03', '2026-01-31'],
      ]);
      const rejeu = await job.run(new Date('2026-02-15T18:00:00Z'));
      expect(rejeu.accruals).toBe(0);
      expect(
        await db
          .collection('hr_leave_ledger')
          .countDocuments({ employeeId: emp.E, kind: 'accrual' }),
      ).toBe(1);

      // Changement d'année : février à décembre acquis, report plafonné à 5.
      await job.run(new Date('2027-01-05T12:00:00Z'));
      const acquis = await db
        .collection('hr_leave_ledger')
        .countDocuments({ employeeId: emp.E, kind: 'accrual', leaveYear: 2026 });
      expect(acquis).toBe(12);
      const report = await db
        .collection('hr_leave_ledger')
        .findOne({ employeeId: emp.E, kind: 'carry_over', leaveYear: 2027 });
      expect(report).toMatchObject({ days: '5', effectiveOn: '2027-01-01' });
      // Expiration du reporté non pris un mois après le début de l'année.
      await job.run(new Date('2027-02-02T12:00:00Z'));
      await job.run(new Date('2027-02-03T12:00:00Z'));
      const exp = await db
        .collection('hr_leave_ledger')
        .find({ employeeId: emp.E, kind: 'expiry' })
        .toArray();
      expect(exp.map((x) => [x['days'], x['leaveYear']])).toEqual([['-5', 2027]]);
      // Remise à zéro de la politique pour la suite.
      ok(
        await fx.put('hr_manager', `/hr/leave-types/${type.conges}`, {
          expectedRevision: await typeRev(type.conges),
          accrual: { kind: 'none' },
          carryOver: { maxDays: null, expiresAfterMonths: null },
        }),
      );
    });
  });

  describe('circuit, séparation des tâches, réglages', () => {
    it('`PUT /hr/settings` : hr.manage, révision attendue, type de contrat porté, audit', async () => {
      code(
        await fx.put('viewer', '/hr/settings', { expectedRevision: 0, leaveYearStart: '01-01' }),
        403,
        'FORBIDDEN',
      );
      const s = ok(
        await fx.put('admin', '/hr/settings', {
          expectedRevision: 0,
          reminders: { probationEnd: 10, contractEnd: 20, documentExpiry: 30 },
          teamCalendarVisibility: 'department',
        }),
      );
      expect(s).toMatchObject({ revision: 1, isDefault: false, approvalFlow: 'manager_only' });
      expect(s['reminders']).toEqual({ probationEnd: 10, contractEnd: 20, documentExpiry: 30 });
      code(
        await fx.put('admin', '/hr/settings', { expectedRevision: 0, leaveYearStart: '01-01' }),
        409,
        'STALE_REVISION',
      );
      // Le circuit n'est pas dans ce corps.
      expect(
        (await fx.put('admin', '/hr/settings', { expectedRevision: 1, approvalFlow: 'hr_only' }))
          .status,
      ).toBe(400);
      code(
        await fx.put('admin', '/hr/settings', {
          expectedRevision: 1,
          contractTypes: [{ key: 'other', label: 'Autre', hasEndDate: false, active: true }],
        }),
        409,
        'CONTRACT_TYPE_IN_USE',
      );
      expect(
        await db.collection('audit_events').countDocuments({
          action: 'hr.settings.updated',
          organizationId: fx.orgN,
        }),
      ).toBe(1);
    });

    it('le circuit exige d’être soi-même validateur (`leave.approve`)', async () => {
      const refus = await fx.put('admin', '/hr/settings/approval', {
        expectedRevision: 1,
        approvalFlow: 'manager_then_hr',
      });
      code(refus, 403, 'FORBIDDEN');
      expect(refus.body.action).toBe('leave.approve');
      const s = ok(
        await fx.put('hr_manager', '/hr/settings/approval', {
          expectedRevision: 1,
          approvalFlow: 'manager_then_hr',
        }),
      );
      expect(s).toMatchObject({ approvalFlow: 'manager_then_hr', revision: 2 });
    });

    it('deux étapes, deux personnes ; suppléance du manager marquée', async () => {
      const d1 = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-06-07'),
          end: full('2027-06-07'),
        }),
        201,
      );
      expect(d1['steps']).toEqual(['manager', 'hr']);
      const m = ok(
        await fx.post('analyst', `/hr/leave-requests/${d1['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
      expect(m).toMatchObject({ status: 'pending', currentStep: 'hr' });
      // Le manager n'a pas `leave.approve` : l'étape RH ne lui revient pas.
      code(
        await fx.post('analyst', `/hr/leave-requests/${d1['id']}/approve`, {
          expectedRevision: 2,
        }),
        403,
        'LEAVE_NOT_YOUR_STEP',
      );
      const rh = ok(
        await fx.post('hr_manager', `/hr/leave-requests/${d1['id']}/approve`, {
          expectedRevision: 2,
        }),
      );
      expect(rh).toMatchObject({ status: 'approved' });

      // Suppléance : la Responsable RH tient l'étape manager, puis ne peut tenir l'étape RH.
      const d2 = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-06-08'),
          end: full('2027-06-08'),
        }),
        201,
      );
      const sup = ok(
        await fx.post('hr_manager', `/hr/leave-requests/${d2['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
      expect(sup['approvals'][0]).toMatchObject({ step: 'manager', onBehalfOfManager: true });
      code(
        await fx.post('hr_manager', `/hr/leave-requests/${d2['id']}/approve`, {
          expectedRevision: 2,
        }),
        409,
        'APPROVER_ALREADY_APPROVED',
      );
      const fin = ok(
        await fx.post('finance_director', `/hr/leave-requests/${d2['id']}/approve`, {
          expectedRevision: 2,
        }),
      );
      expect(fin['status']).toBe('approved');

      // Refus : commentaire obligatoire ; il clôt la demande.
      const d3 = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-06-09'),
          end: full('2027-06-09'),
        }),
        201,
      );
      expect((await fx.post('analyst', `/hr/leave-requests/${d3['id']}/reject`, {})).status).toBe(
        400,
      );
      const r = ok(
        await fx.post('analyst', `/hr/leave-requests/${d3['id']}/reject`, {
          comment: 'Période chargée',
        }),
      );
      expect(r['status']).toBe('rejected');
      ok(
        await fx.put('hr_manager', '/hr/settings/approval', {
          expectedRevision: 2,
          approvalFlow: 'manager_only',
        }),
      );
    });

    it('le Propriétaire ne valide pas sa propre absence quand d’autres validateurs existent', async () => {
      const d = ok(
        await fx.post('owner', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-06-14'),
          end: full('2027-06-14'),
        }),
        201,
      );
      expect(d['steps']).toEqual(['hr']);
      code(
        await fx.post('owner', `/hr/leave-requests/${d['id']}/approve`, { expectedRevision: 1 }),
        409,
        'SELF_APPROVAL_FORBIDDEN',
      );
      const pending = ok(await fx.get('owner', '/hr/leave-approvals/pending'));
      expect(pending['items'].map((r: { id: string }) => r.id)).not.toContain(d['id']);
      ok(
        await fx.post('finance_director', `/hr/leave-requests/${d['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
    });

    it('approbateur unique : la dirigeante seule de sa PME valide sa propre absence, marquée et auditée', async () => {
      const e = ok(
        await fx.post(
          'ownerB',
          '/hr/employees',
          fiche('Dirigeante', { userId: fx.userIds['ownerB'] }),
        ),
        201,
      );
      const types = ok(await fx.get('ownerB', '/hr/leave-types'));
      const autorisee = types['items'].find(
        (t: { key: string }) => t.key === 'authorized_absence',
      ).id;
      const d = ok(
        await fx.post('ownerB', '/hr/leave-requests', {
          typeId: autorisee,
          start: full('2027-06-14'),
          end: full('2027-06-15'),
        }),
        201,
      );
      expect(d).toMatchObject({ employeeId: e['id'], steps: ['hr'] });
      const v = ok(
        await fx.post('ownerB', `/hr/leave-requests/${d['id']}/approve`, { expectedRevision: 1 }),
      );
      expect(v['status']).toBe('approved');
      expect(v['approvals'][0]).toMatchObject({ soleApprover: true });
      const audit = await db
        .collection('audit_events')
        .findOne({ action: 'hr.leave.approved', targetId: d['id'] });
      expect(audit!['metadata']).toMatchObject({ soleApprover: true });
    });
  });

  describe('types confidentiels', () => {
    it('validée par les RH seules ; « Absent » pour le manager partout ; aucune notification ne dit « Maladie »', async () => {
      const d = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.maladie,
          start: full('2027-07-05'),
          end: full('2027-07-06'),
          reason: 'Grippe',
        }),
        201,
      );
      expect(d).toMatchObject({
        steps: ['hr'],
        typeLabel: 'Maladie',
        masked: false,
        reason: 'Grippe',
      });
      // Le manager ne la voit pas à valider ; il la voit « Absent », sans motif.
      expect(ok(await fx.get('analyst', '/hr/leave-approvals/pending'))['items']).toEqual([]);
      const vueA = ok(
        await fx.get('analyst', `/hr/leave-requests?employeeId=${emp.B}&from=2027-07-01`),
      );
      const r = vueA['items'].find((x: { id: string }) => x.id === d['id']);
      expect(r).toMatchObject({ typeId: null, typeLabel: 'Absent', masked: true, reason: null });
      code(
        await fx.post('analyst', `/hr/leave-requests/${d['id']}/approve`, { expectedRevision: 1 }),
        403,
        'LEAVE_NOT_YOUR_STEP',
      );
      // `hr.read` seul (Administrateur) : « Absent » aussi.
      const vueAdmin = ok(
        await fx.get('admin', `/hr/leave-requests?employeeId=${emp.B}&from=2027-07-01`),
      );
      expect(vueAdmin['items'].find((x: { id: string }) => x.id === d['id'])).toMatchObject({
        typeLabel: 'Absent',
        masked: true,
      });
      // Les RH la voient et la valident ; elle apparaît dans leur « Mes tâches ».
      const tachesRh = ok(await fx.get('hr_manager', '/work/my-tasks'));
      const elements = [
        ...tachesRh['overdue'],
        ...tachesRh['today'],
        ...tachesRh['next7Days'],
        ...tachesRh['later'],
        ...tachesRh['noDate'],
      ].filter((x: { source: string }) => x.source === 'hr');
      expect(elements.find((x: { requestId: string }) => x.requestId === d['id'])).toMatchObject({
        typeLabel: 'Maladie',
      });
      ok(
        await fx.post('hr_manager', `/hr/leave-requests/${d['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
      const cal = ok(
        await fx.get('analyst', '/hr/calendar?from=2027-07-01&to=2027-07-31&scope=team'),
      );
      const entree = cal['entries'].find((x: { requestId: string }) => x.requestId === d['id']);
      expect(entree).toMatchObject({ label: 'Absent', masked: true, typeId: null });
      const team = ok(await fx.get('analyst', '/hr/team'));
      const absence = team['items'][0]['absences'].find((x: { id: string }) => x.id === d['id']);
      expect(absence).toMatchObject({ typeLabel: 'Absent', masked: true });
      // Le manager est informé, sans le type.
      const notes = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN })
        .toArray();
      expect(
        notes.some(
          (n) =>
            n['recipientUserId'] === fx.userIds['analyst'] && n['kind'] === 'hr.leave_approved',
        ),
      ).toBe(true);
      for (const n of notes) expect(String(n['title'])).not.toMatch(/Maladie|Grippe/);
      // Le demandeur voit son propre type.
      const moi = ok(await fx.get('viewer', '/hr/me'));
      expect(moi['requests'].find((x: { id: string }) => x.id === d['id'])).toMatchObject({
        typeLabel: 'Maladie',
        reason: 'Grippe',
      });
    });

    it('un type saisi par les RH seulement ne se demande pas soi-même', async () => {
      code(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.injustifiee,
          start: full('2027-07-12'),
          end: full('2027-07-12'),
        }),
        403,
        'LEAVE_TYPE_HR_ONLY',
      );
      const saisie = ok(
        await fx.post('hr_manager', '/hr/leave-requests', {
          employeeId: emp.B,
          typeId: type.injustifiee,
          start: full('2027-07-12'),
          end: full('2027-07-12'),
        }),
        201,
      );
      expect(saisie['createdBy']).toBe(fx.userIds['hr_manager']);
      // Le créateur d'une saisie pour autrui peut la valider (il n'en est pas bénéficiaire).
      ok(
        await fx.post('analyst', `/hr/leave-requests/${saisie['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
    });
  });

  describe('sortie, droits par rôle, isolation', () => {
    it('la sortie annule les absences futures (en attente et approuvées) et le journalise', async () => {
      ok(
        await fx.post('hr_manager', '/hr/leave-ledger', {
          employeeId: emp.C,
          typeId: type.conges,
          kind: 'allocation',
          days: '10',
          effectiveOn: '2027-01-01',
          note: 'Reprise',
        }),
        201,
      );
      const approuvee = ok(
        await fx.post('sales_rep', '/hr/leave-requests', {
          typeId: type.conges,
          start: full('2027-08-02'),
          end: full('2027-08-03'),
        }),
        201,
      );
      // C n'a pas de manager : l'étape devient RH.
      expect(approuvee['steps']).toEqual(['hr']);
      ok(
        await fx.post('hr_manager', `/hr/leave-requests/${approuvee['id']}/approve`, {
          expectedRevision: 1,
        }),
      );
      const attente = ok(
        await fx.post('sales_rep', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-08-09'),
          end: full('2027-08-09'),
        }),
        201,
      );
      const avant = ok(
        await fx.post('sales_rep', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-07-19'),
          end: full('2027-07-19'),
        }),
        201,
      );
      const sortie = ok(
        await fx.post('hr_manager', `/hr/employees/${emp.C}/exit`, {
          endDate: '2027-07-31',
          exitCategory: 'resignation',
          expectedRevision: await empRev(emp.C),
        }),
      );
      expect(sortie['offboardingSuggested']).toBe(true);
      const statut = async (id: string) =>
        (await db.collection('hr_leave_requests').findOne({ _id: new ObjectId(id) }))!['status'];
      expect(await statut(approuvee['id'])).toBe('cancelled');
      expect(await statut(attente['id'])).toBe('cancelled');
      expect(await statut(avant['id'])).toBe('pending');
      expect(
        await db.collection('hr_leave_ledger').countDocuments({
          requestId: approuvee['id'],
          kind: 'taken_reversal',
        }),
      ).toBe(1);
      const traces = await db
        .collection('audit_events')
        .find({ action: 'hr.leave.cancelled', 'metadata.cause': 'employee_exit' })
        .toArray();
      expect(traces.map((t) => t['targetId']).sort()).toEqual(
        [approuvee['id'], attente['id']].sort(),
      );
      // L'accès à Lalanda n'est pas retiré (décision ouverte n° 13).
      expect((await fx.get('sales_rep', '/hr/me')).status).toBe(200);
    });

    it('droits par rôle : Comptable sans fiche 409, Conseiller 403, saisie pour autrui réservée', async () => {
      const corps = {
        typeId: type.autorisee,
        start: full('2027-09-06'),
        end: full('2027-09-06'),
      };
      code(await fx.post('accountant', '/hr/leave-requests', corps), 409, 'EMPLOYEE_NOT_LINKED');
      const conseiller = await fx.post('advisor', '/hr/leave-requests', corps);
      code(conseiller, 403, 'FORBIDDEN');
      expect(conseiller.body.action).toBe('leave.request');
      const autrui = await fx.post('viewer', '/hr/leave-requests', { ...corps, employeeId: emp.A });
      code(autrui, 403, 'FORBIDDEN');
      expect(autrui.body.action).toBe('hr.manage');
      code(await fx.get('accountant', '/hr/leave-balances'), 409, 'EMPLOYEE_NOT_LINKED');
      expect(ok(await fx.get('accountant', '/hr/leave-requests'))['items']).toEqual([]);
      expect(ok(await fx.get('accountant', '/hr/leave-approvals/pending'))['items']).toEqual([]);
      code(
        await fx.post('accountant', '/hr/leave-ledger', {
          employeeId: emp.B,
          typeId: type.conges,
          kind: 'adjustment',
          days: '-1',
          effectiveOn: '2027-01-01',
          note: 'X',
        }),
        403,
        'FORBIDDEN',
      );
    });

    it('isolation : toute ressource d’une autre organisation rend 404', async () => {
      const d = ok(
        await fx.post('viewer', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-09-13'),
          end: full('2027-09-13'),
        }),
        201,
      );
      const corps = {
        approve: { expectedRevision: 1 },
        reject: { comment: 'x' },
        cancel: {},
      };
      for (const [path, body] of Object.entries(corps)) {
        code(
          await fx.post('ownerB', `/hr/leave-requests/${d['id']}/${path}`, body),
          404,
          'LEAVE_REQUEST_NOT_FOUND',
        );
      }
      // Type d'une autre organisation forgé dans le corps.
      code(
        await fx.post('ownerB', '/hr/leave-requests', {
          typeId: type.autorisee,
          start: full('2027-09-13'),
          end: full('2027-09-13'),
        }),
        404,
        'LEAVE_TYPE_NOT_FOUND',
      );
      // Collaborateur d'une autre organisation forgé dans le corps.
      code(
        await fx.post('ownerB', '/hr/leave-ledger', {
          employeeId: emp.B,
          typeId: type.conges,
          kind: 'allocation',
          days: '1',
          effectiveOn: '2027-01-01',
          note: 'X',
        }),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.get('ownerB', `/hr/leave-balances?employeeId=${emp.B}`),
        404,
        'EMPLOYEE_NOT_FOUND',
      );
      code(
        await fx.put('ownerB', `/hr/leave-types/${type.conges}`, {
          expectedRevision: 1,
          label: 'X',
        }),
        404,
        'LEAVE_TYPE_NOT_FOUND',
      );
      const cal = ok(
        await fx.get('ownerB', '/hr/calendar?from=2027-01-01&to=2027-12-31&scope=organization'),
      );
      expect(cal['entries'].every((e: { employeeId: string }) => e.employeeId !== emp.B)).toBe(
        true,
      );
      // Exception d'acquisition visant un type d'une autre organisation : 404.
      const typesB = ok(await fx.get('ownerB', '/hr/leave-types'));
      code(
        await fx.put('hr_manager', `/hr/employees/${emp.A}`, {
          expectedRevision: await empRev(emp.A),
          leavePolicyOverrides: { [typesB['items'][0].id]: { accrual: { kind: 'none' } } },
        }),
        404,
        'LEAVE_TYPE_NOT_FOUND',
      );
      const ok2 = ok(
        await fx.put('hr_manager', `/hr/employees/${emp.A}`, {
          expectedRevision: await empRev(emp.A),
          leavePolicyOverrides: { [type.conges]: { accrual: { kind: 'monthly', days: '1.25' } } },
        }),
      );
      expect(ok2['leavePolicyOverrides']).toEqual({
        [type.conges]: { accrual: { kind: 'monthly', days: '1.25' } },
      });
    });

    it('vues des fiches : noms du service, du manager et du type de contrat', async () => {
      const dep = ok(
        await fx.post('hr_manager', '/hr/departments', {
          name: 'Logistique',
          headEmployeeId: emp.A,
        }),
        201,
      );
      expect(dep['headName']).toEqual(expect.any(String));
      ok(
        await fx.put('hr_manager', `/hr/employees/${emp.B}`, {
          expectedRevision: await empRev(emp.B),
          departmentId: dep['id'],
        }),
      );
      const ficheB = ok(await fx.get('hr_manager', `/hr/employees/${emp.B}`));
      expect(ficheB['employee']).toMatchObject({
        departmentName: 'Logistique',
        managerName: expect.any(String),
        contractTypeLabel: 'CDI',
      });
      const liste = ok(await fx.get('hr_manager', '/hr/employees'));
      const b = liste['items'].find((x: { id: string }) => x.id === emp.B);
      expect(b).toMatchObject({ departmentName: 'Logistique', contractTypeLabel: 'CDI' });
    });
  });
});
