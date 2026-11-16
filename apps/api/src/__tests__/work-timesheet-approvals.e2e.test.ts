// Validation hebdomadaire des feuilles de temps — ADR-0077 § 4.
//
// A (analyst) manage C (accountant) ; S (sales_rep) n'a pas de manager. Couvre : soumission
// par le membre, renvoi motivé, nouvelle soumission, approbation par le manager, verrou des
// saisies (création, modification, suppression, même par `work.manage`), réouverture
// motivée et tracée, s'approuver soi-même (403), non-manager sans `work.manage` (404),
// autre organisation (404), « Mes tâches » et brief du manager, membre sans manager vers
// les détenteurs de `work.manage`, part du temps validé dans la marge (informative).
// Rien n'est relié à la paie.
//
// BASE DÉDIÉE, supprimée à la fin.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');
vi.setConfig({ testTimeout: 120_000 });

const TODAY = kinshasaDayOf(new Date());

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}
const WEEK = mondayOf(TODAY);

e2eSuite('feuilles de temps : soumission, validation, verrou (ADR-0077 § 4)', () => {
  let fx: HrFixture;
  let projectId = '';
  let taskId = '';
  let entryId = '';
  let entryRevision = 0;

  const srv = () => request(fx.app.getHttpServer());
  const del = (who: HrAccount, path: string) => srv().delete(path).set('Cookie', fx.as(who));
  const sheet = (who: HrAccount, userId?: string) =>
    fx.get(who, `/work/timesheets?week=${WEEK}${userId ? `&userId=${userId}` : ''}`);
  const decide = (who: HrAccount, path: string, body: Record<string, unknown>) =>
    fx.post(who, `/work/timesheets/${path}`, { week: WEEK, ...body });

  beforeAll(async () => {
    fx = await hrFixture(tag, 'wts');
    const u = fx.userIds;
    const res = ok(
      await fx.post('hr_manager', '/hr/employees/from-members', {
        userIds: [u['analyst'], u['accountant'], u['sales_rep']],
      }),
      201,
    );
    const byUser = (id: string) =>
      res['items'].find((e: { userId: string }) => e.userId === id)['id'] as string;
    const c = byUser(u['accountant']);
    const rev = (await fx.db.collection('hr_employees').findOne({ _id: new ObjectId(c) }))![
      'revision'
    ] as number;
    ok(
      await fx.put('hr_manager', `/hr/employees/${c}`, {
        expectedRevision: rev,
        managerEmployeeId: byUser(u['analyst']),
      }),
    );
    projectId = ok(
      await fx.post('owner', '/work/projects', { name: 'Chantier temps', kind: 'internal' }),
      201,
    )['id'];
    taskId = ok(
      await fx.post('owner', `/work/projects/${projectId}/tasks`, { title: 'Pose' }),
      201,
    )['task']['id'];
    const e = ok(
      await fx.post('accountant', `/work/tasks/${taskId}/time-entries`, {
        workedOn: TODAY,
        minutes: 120,
      }),
      201,
    );
    entryId = e['id'];
    entryRevision = e['revision'];
  }, 180_000);

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  it('semaine en cours : rien n’est verrouillé, le membre peut soumettre', async () => {
    const t = ok(await sheet('accountant'));
    expect(t['approval']).toMatchObject({
      status: 'open',
      revision: 0,
      locked: false,
      canSubmit: true,
      canDecide: false,
    });
  });

  it('soumission, puis 409 si on soumet encore ; semaine future : 400', async () => {
    const s = ok(await decide('accountant', 'submit', { expectedRevision: 0 }));
    expect(s).toMatchObject({ status: 'submitted', revision: 1, canSubmit: false });
    code(
      await decide('accountant', 'submit', { expectedRevision: 1 }),
      409,
      'WORK_TIMESHEET_STATE',
    );
    const future = await fx.post('accountant', '/work/timesheets/submit', {
      week: addDays(WEEK, 7),
      expectedRevision: 0,
    });
    expect(future.status).toBe(400);
  });

  it('soi-même : 403 ; non-manager sans work.manage : 404 ; autre organisation : 404', async () => {
    const userId = fx.userIds['accountant'];
    code(
      await decide('accountant', 'approve', { userId, expectedRevision: 1 }),
      403,
      'WORK_TIMESHEET_SELF_APPROVAL',
    );
    code(
      await decide('viewer', 'approve', { userId, expectedRevision: 1 }),
      404,
      'WORK_MEMBER_NOT_FOUND',
    );
    code(
      await decide('ownerB', 'approve', { userId, expectedRevision: 1 }),
      404,
      'WORK_MEMBER_NOT_FOUND',
    );
  });

  it('« Mes tâches » et brief du manager ; le pendant work.manage voit la liste complète', async () => {
    const mine = ok(await fx.get('analyst', '/work/my-tasks'));
    const all = ['overdue', 'today', 'next7Days', 'later', 'noDate'].flatMap(
      (g) => mine[g] as Record<string, any>[],
    );
    const item = all.find((x) => x.source === 'work_timesheet');
    expect(item).toMatchObject({
      kind: 'timesheet_approval',
      userId: fx.userIds['accountant'],
      week: WEEK,
      totalMinutes: 120,
      dueDate: addDays(WEEK, 6),
    });
    // C a un manager : pas dans « Mes tâches » du Propriétaire, mais dans sa liste à valider.
    const owner = ok(await fx.get('owner', '/work/my-tasks'));
    const ownerItems = ['overdue', 'today', 'next7Days', 'later', 'noDate'].flatMap(
      (g) => owner[g] as Record<string, any>[],
    );
    expect(ownerItems.some((x) => x.source === 'work_timesheet')).toBe(false);
    const pending = ok(await fx.get('owner', '/work/timesheets/pending'))['items'] as Record<
      string,
      any
    >[];
    expect(pending.map((p) => p.user.userId)).toContain(fx.userIds['accountant']);
    const brief = ok(await fx.get('analyst', '/morning-brief'))['brief'];
    const fact = (brief.facts as { id: string; status: string; value: string | null }[]).find(
      (f) => f.id === 'mes_validations_temps.en_attente',
    );
    expect(fact).toMatchObject({ status: 'known', value: '1' });
    expect(brief.version).toBe('1.7.0');
    // La feuille vue par le manager : il peut décider.
    expect(ok(await sheet('analyst', fx.userIds['accountant']))['approval']).toMatchObject({
      status: 'submitted',
      canDecide: true,
      canSubmit: false,
    });
  });

  it('renvoi motivé, puis nouvelle soumission ; motif obligatoire', async () => {
    const userId = fx.userIds['accountant'];
    expect(
      (await decide('analyst', 'return', { userId, expectedRevision: 1, reason: ' ' })).status,
    ).toBe(400);
    const r = ok(
      await decide('analyst', 'return', { userId, expectedRevision: 1, reason: 'Mardi manquant' }),
    );
    expect(r).toMatchObject({ status: 'returned', reason: 'Mardi manquant', revision: 2 });
    const s = ok(await decide('accountant', 'submit', { expectedRevision: 2 }));
    expect(s).toMatchObject({ status: 'submitted', revision: 3 });
  });

  it('approbation : verrou des saisies, même pour work.manage', async () => {
    const userId = fx.userIds['accountant'];
    code(
      await decide('analyst', 'approve', { userId, expectedRevision: 1 }),
      409,
      'STALE_REVISION',
    );
    const a = ok(await decide('analyst', 'approve', { userId, expectedRevision: 3 }));
    expect(a).toMatchObject({
      status: 'approved',
      locked: true,
      approvedMinutes: 120,
      canReopen: true,
    });

    code(
      await fx.post('accountant', `/work/tasks/${taskId}/time-entries`, {
        workedOn: TODAY,
        minutes: 15,
      }),
      409,
      'WORK_TIMESHEET_LOCKED',
    );
    code(
      await fx.put('accountant', `/work/time-entries/${entryId}`, {
        expectedRevision: entryRevision,
        minutes: 60,
      }),
      409,
      'WORK_TIMESHEET_LOCKED',
    );
    code(await del('owner', `/work/time-entries/${entryId}`), 409, 'WORK_TIMESHEET_LOCKED');
    code(
      await fx.post('owner', `/work/tasks/${taskId}/time-entries`, {
        userId,
        workedOn: TODAY,
        minutes: 15,
      }),
      409,
      'WORK_TIMESHEET_LOCKED',
    );
    // Rien de changé ; la marge garde tout le temps et dit la part validée.
    const m = ok(await fx.get('owner', `/work/projects/${projectId}/margin`));
    expect(m['timeApproval']).toEqual({ totalMinutes: 120, approvedMinutes: 120 });
  });

  it('réouverture motivée et tracée : le verrou est levé', async () => {
    const userId = fx.userIds['accountant'];
    code(
      await decide('accountant', 'reopen', { userId, expectedRevision: 4, reason: 'Erreur' }),
      403,
      'WORK_TIMESHEET_SELF_APPROVAL',
    );
    const r = ok(
      await decide('analyst', 'reopen', {
        userId,
        expectedRevision: 4,
        reason: 'Correction du chantier',
      }),
    );
    expect(r).toMatchObject({
      status: 'reopened',
      locked: false,
      reason: 'Correction du chantier',
    });
    expect((r['history'] as { action: string }[]).map((h) => h.action)).toEqual([
      'submitted',
      'returned',
      'submitted',
      'approved',
      'reopened',
    ]);
    const audit = await fx.db
      .collection('audit_events')
      .find({ action: 'work.timesheet.reopened' })
      .toArray();
    expect(audit).toHaveLength(1);
    expect(audit[0]!['metadata']).toMatchObject({
      userId,
      week: WEEK,
      reason: 'Correction du chantier',
    });
    const upd = ok(
      await fx.put('accountant', `/work/time-entries/${entryId}`, {
        expectedRevision: entryRevision,
        minutes: 90,
      }),
    );
    expect(upd['minutes']).toBe(90);
    const m = ok(await fx.get('owner', `/work/projects/${projectId}/margin`));
    expect(m['timeApproval']).toEqual({ totalMinutes: 90, approvedMinutes: 0 });
  });

  it('membre sans manager : sa semaine va aux détenteurs de work.manage, pas au manager d’un autre', async () => {
    ok(
      await fx.post('sales_rep', `/work/tasks/${taskId}/time-entries`, {
        workedOn: TODAY,
        minutes: 30,
      }),
      201,
    );
    ok(await decide('sales_rep', 'submit', { expectedRevision: 0 }));
    const groups = (b: Record<string, any>) =>
      ['overdue', 'today', 'next7Days', 'later', 'noDate'].flatMap(
        (g) => b[g] as Record<string, any>[],
      );
    const owner = groups(ok(await fx.get('owner', '/work/my-tasks')));
    expect(
      owner.some((x) => x.source === 'work_timesheet' && x.userId === fx.userIds['sales_rep']),
    ).toBe(true);
    const analyst = groups(ok(await fx.get('analyst', '/work/my-tasks')));
    expect(
      analyst.some((x) => x.source === 'work_timesheet' && x.userId === fx.userIds['sales_rep']),
    ).toBe(false);
    // Le Propriétaire supplée (work.manage).
    ok(await decide('owner', 'approve', { userId: fx.userIds['sales_rep'], expectedRevision: 1 }));
  });
});
