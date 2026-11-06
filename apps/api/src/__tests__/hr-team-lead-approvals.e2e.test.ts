// Responsable d'équipe RH et validation de son équipe — ADR-0066 § 1 (tranche la
// décision ouverte n° 4 d'ADR-0059), contre la vraie application.
//
// L (Analyste, sans `leave.approve` ni `expenses.approve`) est responsable de l'équipe
// « Terrain » dont B (Lecteur) est membre. C (Commercial) n'en est pas. Le manager
// DÉSIGNÉ de B, C et L est le Propriétaire : l'étape « manager » existe, et L la tient
// pour B seulement. Couvre : validation d'un membre (absence, note de frais), étape
// suivante toujours requise, refus hors équipe, jamais sa propre demande, retrait de
// l'équipe → plus de droit, notification « à valider » au responsable, `GET /hr/me`.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 120_000 });

const full = (date: string) => ({ date, half: 'full' as const });

function kinshasaToday(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

e2eSuite('RH — le responsable d’équipe valide son équipe (ADR-0066 § 1)', () => {
  let fx: HrFixture;
  let db: Db;
  const emp = { L: '', B: '', C: '', O: '' };
  let teamId = '';
  let typeAutorisee = '';
  /** Lundis successifs (2028), un par demande : aucun chevauchement. */
  let semaine = 0;
  const lundi = () => addDays('2028-01-03', 7 * semaine++);

  const empRev = async (id: string) =>
    (await db.collection('hr_employees').findOne({ _id: new ObjectId(id) }))!['revision'] as number;
  const leaveRev = async (id: string) =>
    (await db.collection('hr_leave_requests').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;
  const noteRev = async (id: string) =>
    (await db.collection('hr_expense_reports').findOne({ _id: new ObjectId(id) }))![
      'revision'
    ] as number;

  const demander = async (c: HrAccount) => {
    const d = lundi();
    return ok(
      await fx.post(c, '/hr/leave-requests', {
        typeId: typeAutorisee,
        start: full(d),
        end: full(d),
      }),
      201,
    );
  };
  const approuverAbsence = async (c: HrAccount, id: string) =>
    fx.post(c, `/hr/leave-requests/${id}/approve`, { expectedRevision: await leaveRev(id) });
  const enAttente = async (c: HrAccount) =>
    (ok(await fx.get(c, '/hr/leave-approvals/pending'))['items'] as { id: string }[]).map(
      (r) => r.id,
    );

  const noteSoumise = async (c: HrAccount) => {
    const n = ok(
      await fx.post(c, '/hr/expense-reports', {
        title: 'Déplacement chantier',
        currency: 'USD',
        lines: [
          {
            spentOn: addDays(kinshasaToday(), -2),
            category: 'charges_diverses',
            label: 'Photocopies',
            amount: '7.50',
            missingReceiptReason: 'Ticket perdu',
          },
        ],
      }),
      201,
    );
    return ok(
      await fx.post(c, `/hr/expense-reports/${n['id']}/submit`, {
        expectedRevision: n['revision'],
      }),
    );
  };
  const notesAValider = async (c: HrAccount) =>
    (
      ok(await fx.get(c, '/hr/expense-reports?view=a-valider&limit=100'))['items'] as {
        id: string;
      }[]
    ).map((r) => r.id);

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-resp');
    db = fx.db;
    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer'], fx.userIds['sales_rep']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    emp.L = byUser(fx.userIds['analyst']);
    emp.B = byUser(fx.userIds['viewer']);
    emp.C = byUser(fx.userIds['sales_rep']);
    emp.O = ok(
      await fx.post(
        'hr_manager',
        '/hr/employees',
        fiche('Proprio', { userId: fx.userIds['owner'] }),
      ),
      201,
    )['id'];
    for (const id of [emp.L, emp.B, emp.C]) {
      ok(
        await fx.put('hr_manager', `/hr/employees/${id}`, {
          expectedRevision: await empRev(id),
          managerEmployeeId: emp.O,
        }),
      );
    }
    const types = ok(await fx.get('hr_manager', '/hr/leave-types'))['items'] as {
      id: string;
      key: string;
    }[];
    typeAutorisee = types.find((t) => t.key === 'authorized_absence')!.id;
    const team = ok(
      await fx.post('hr_manager', '/hr/teams', {
        name: 'Terrain',
        leadUserId: fx.userIds['analyst'],
        memberUserIds: [fx.userIds['viewer']],
      }),
      201,
    );
    teamId = team['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  it('GET /hr/me : responsable d’équipe, ses membres (lui exclu), peut valider', async () => {
    const me = ok(await fx.get('analyst', '/hr/me'));
    expect(me).toMatchObject({
      isManager: false,
      isTeamLead: true,
      ledEmployeeIds: [emp.B],
      canApprove: true,
    });
    // Aucune porte vers le dossier : la fiche de B reste hors de portée.
    expect((await fx.get('analyst', `/hr/employees/${emp.B}`)).status).toBe(404);
    const autre = ok(await fx.get('sales_rep', '/hr/me'));
    expect(autre).toMatchObject({ isTeamLead: false, ledEmployeeIds: [] });
  });

  it('absence d’un membre : « À valider », notification, validation sans suppléance', async () => {
    const d = await demander('viewer');
    expect(d).toMatchObject({ currentStep: 'manager' });
    expect(await enAttente('analyst')).toContain(d['id']);
    const notice = await db.collection('notifications').findOne({
      organizationId: fx.orgN,
      recipientUserId: fx.userIds['analyst'],
      kind: 'hr.leave_requested',
    });
    expect(notice).not.toBeNull();
    const v = ok(await approuverAbsence('analyst', d['id']));
    expect(v['approvals'][0]).toMatchObject({
      step: 'manager',
      userId: fx.userIds['analyst'],
      decision: 'approved',
      onBehalfOfManager: false,
    });
    // Circuit par défaut : l'étape manager seule ; l'audit trace le geste.
    expect(v['status']).toBe(v['steps'].length === 1 ? 'approved' : 'pending');
  });

  it('circuit « manager puis RH » : l’étape RH reste requise et ne lui revient pas', async () => {
    const s = ok(await fx.get('hr_manager', '/hr/settings'));
    ok(
      await fx.put('hr_manager', '/hr/settings/approval', {
        expectedRevision: s['revision'],
        approvalFlow: 'manager_then_hr',
      }),
    );
    const d = await demander('viewer');
    expect(d['steps']).toEqual(['manager', 'hr']);
    const v = ok(await approuverAbsence('analyst', d['id']));
    expect(v).toMatchObject({ status: 'pending', currentStep: 'hr' });
    expect(await enAttente('analyst')).not.toContain(d['id']);
    code(await approuverAbsence('analyst', d['id']), 403, 'LEAVE_NOT_YOUR_STEP');
    expect(ok(await approuverAbsence('hr_manager', d['id']))['status']).toBe('approved');
  });

  it('hors de son équipe : rien à valider, 403 LEAVE_NOT_YOUR_STEP', async () => {
    const d = await demander('sales_rep');
    expect(await enAttente('analyst')).not.toContain(d['id']);
    code(await approuverAbsence('analyst', d['id']), 403, 'LEAVE_NOT_YOUR_STEP');
  });

  it('jamais sa propre demande, même responsable de l’équipe', async () => {
    const d = await demander('analyst');
    expect(await enAttente('analyst')).not.toContain(d['id']);
    code(await approuverAbsence('analyst', d['id']), 409, 'SELF_APPROVAL_FORBIDDEN');
  });

  it('note de frais d’un membre : validée à l’étape manager, la finance reste requise', async () => {
    const n = await noteSoumise('viewer');
    expect(n['steps']).toEqual(['manager', 'finance']);
    expect(await notesAValider('analyst')).toContain(n['id']);
    const v = ok(
      await fx.post('analyst', `/hr/expense-reports/${n['id']}/approve`, {
        expectedRevision: await noteRev(n['id']),
      }),
    );
    expect(v).toMatchObject({ status: 'submitted', currentStep: 'finance' });
    expect(await notesAValider('analyst')).not.toContain(n['id']);
    code(
      await fx.post('analyst', `/hr/expense-reports/${n['id']}/approve`, {
        expectedRevision: await noteRev(n['id']),
      }),
      403,
      'EXPENSE_NOT_YOUR_STEP',
    );
    // Hors équipe : la note de C n'existe pas pour lui.
    const c = await noteSoumise('sales_rep');
    expect(await notesAValider('analyst')).not.toContain(c['id']);
    expect((await fx.get('analyst', `/hr/expense-reports/${c['id']}`)).status).toBe(404);
  });

  it('retiré de l’équipe : plus rien à valider, plus de droit', async () => {
    const d = await demander('viewer');
    const n = await noteSoumise('viewer');
    expect(await enAttente('analyst')).toContain(d['id']);
    const del = await request(fx.app.getHttpServer())
      .delete(`/hr/teams/${teamId}/members/${fx.userIds['viewer']}`)
      .set('Cookie', fx.as('hr_manager'));
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(await enAttente('analyst')).not.toContain(d['id']);
    code(await approuverAbsence('analyst', d['id']), 403, 'LEAVE_NOT_YOUR_STEP');
    expect(await notesAValider('analyst')).not.toContain(n['id']);
    expect((await fx.get('analyst', `/hr/expense-reports/${n['id']}`)).status).toBe(404);
    expect(ok(await fx.get('analyst', '/hr/me'))).toMatchObject({ isTeamLead: false });
  });
});
