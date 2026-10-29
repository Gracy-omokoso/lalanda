// Tâches, Kanban, sous-tâches, jalons, dépendances, « Mes tâches », rappels —
// ADR-0039 (lot L1).
//
// Critères d'acceptation couverts : 1 (l'Analyste crée et déplace), 2
// (`parentTaskId`, `predecessorTaskId` forgés), 3 (cycle 409, conflit de dates
// en avertissement), 4 (colonne terminée, révision concurrente), 5 (profondeur,
// jalon sans échéance), 6 (« Mes tâches », jour de Kinshasa à 23 h 30 UTC),
// 8 (rappels dédupliqués, échéance changée, ancien membre).

import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { WorkDueRemindersJob } from '../work/work-reminders.job.js';
import { WorkTasksService } from '../work/work-tasks.service.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

interface Task {
  id: string;
  number: number;
  columnKey: string;
  rank: string;
  done: boolean;
  completedAt: string | null;
  revision: number;
  blocked: boolean;
}

e2eSuite('tâches du RUN — Kanban, dépendances, Mes tâches, rappels (ADR-0039)', () => {
  const f = useWorkFixture('wtask');
  let projectId = '';
  let clientProject = '';

  async function task(body: Record<string, unknown>, who: 'owner' | 'analyst' = 'owner') {
    const res = await f.post(who, `/work/projects/${projectId}/tasks`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.task as Task;
  }

  it('prépare deux projets (interne, client avec responsable)', async () => {
    const p = await f.post('owner', '/work/projects', { name: 'Interne', kind: 'internal' });
    expect(p.status).toBe(201);
    projectId = p.body.id;
    const c = await f.post('owner', '/sales/customers', { type: 'PP', name: 'Client RUN' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const cp = await f.post('owner', '/work/projects', {
      name: 'Client',
      kind: 'client',
      ownerUserId: f.userId('admin'),
      links: { customerId: c.body.id },
    });
    expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    clientProject = cp.body.id;
  });

  describe('Kanban', () => {
    it('critère 1 : l’Analyste crée et déplace ; le Lecteur reçoit 403', async () => {
      const a = await task({ title: 'A' }, 'analyst');
      expect(a.number).toBe(1);
      expect(a.columnKey).toBe('todo');
      const viewer = await f.post('viewer', `/work/projects/${projectId}/tasks`, { title: 'V' });
      expect(viewer.status).toBe(403);
      expect(viewer.body.action).toBe('work.update');
      const moved = await f.post('analyst', `/work/tasks/${a.id}/move`, {
        columnKey: 'doing',
        expectedRevision: a.revision,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body.task.columnKey).toBe('doing');
      expect(moved.body.warnings).toEqual([]);
    });

    it('rangs : insertion après une tâche, puis entre deux voisines', async () => {
      const b = await task({ title: 'B' });
      const c = await task({ title: 'C' });
      const between = await task({ title: 'B½', afterTaskId: b.id });
      expect(between.rank > b.rank && between.rank < c.rank).toBe(true);
      const list = await f.get('viewer', `/work/projects/${projectId}/tasks?done=false`);
      const todo = (list.body.items as (Task & { title: string })[])
        .filter((t) => t.columnKey === 'todo')
        .map((t) => t.title);
      expect(todo).toEqual(['B', 'B½', 'C']);
      // Déplacer C entre B et B½ (menu clavier « monter »).
      const moved = await f.post('owner', `/work/tasks/${c.id}/move`, {
        columnKey: 'todo',
        afterTaskId: b.id,
        beforeTaskId: between.id,
        expectedRevision: c.revision,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body.task.rank > b.rank && moved.body.task.rank < between.rank).toBe(true);
    });

    it('critère 4 : colonne terminée → done, completedAt ; rouvrir les efface ; course → 409', async () => {
      const t = await task({ title: 'À terminer' });
      const done = await f.post('analyst', `/work/tasks/${t.id}/move`, {
        columnKey: 'done',
        expectedRevision: t.revision,
      });
      expect(done.status).toBe(200);
      expect(done.body.task.done).toBe(true);
      expect(done.body.task.completedAt).toEqual(expect.any(String));
      const detail = await f.get('viewer', `/work/tasks/${t.id}`);
      expect(detail.body.completedBy).toBe(f.userId('analyst'));

      const reopened = await f.post('owner', `/work/tasks/${t.id}/reopen`, {
        expectedRevision: done.body.task.revision,
      });
      expect(reopened.status).toBe(200);
      expect(reopened.body.task.done).toBe(false);
      expect(reopened.body.task.completedAt).toBeNull();
      expect(reopened.body.task.columnKey).toBe('todo');

      // Deux déplacements avec la même révision : le second perd.
      const rev = reopened.body.task.revision;
      const first = await f.post('owner', `/work/tasks/${t.id}/move`, {
        columnKey: 'doing',
        expectedRevision: rev,
      });
      const second = await f.post('analyst', `/work/tasks/${t.id}/move`, {
        columnKey: 'review',
        expectedRevision: rev,
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('STALE_REVISION');
    });

    it('colonne inconnue refusée ; tâche d’une autre organisation : 404', async () => {
      const t = await task({ title: 'Colonne' });
      const bad = await f.post('owner', `/work/tasks/${t.id}/move`, {
        columnKey: 'nulle',
        expectedRevision: t.revision,
      });
      expect(bad.status).toBe(400);
      expect(f.issueCodes(bad)).toContain('WORK_COLUMN_UNKNOWN');
      expect((await f.get('ownerB', `/work/tasks/${t.id}`)).status).toBe(404);
      const patch = await f.patch('ownerB', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        title: 'Piraté',
      });
      expect(patch.status).toBe(404);
    });
  });

  describe('sous-tâches et jalons', () => {
    it('critère 5 : une sous-tâche de sous-tâche est refusée ; un jalon sans échéance aussi', async () => {
      const parent = await task({ title: 'Parent' });
      const child = await task({ title: 'Enfant', parentTaskId: parent.id });
      const grand = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Petit-enfant',
        parentTaskId: child.id,
      });
      expect(grand.status).toBe(400);
      expect(f.issueCodes(grand)).toContain('WORK_SUBTASK_DEPTH');

      const milestone = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Jalon',
        isMilestone: true,
      });
      expect(milestone.status).toBe(400);
      expect(f.issueCodes(milestone)).toContain('WORK_MILESTONE_NEEDS_DATE');

      const detail = await f.get('viewer', `/work/tasks/${parent.id}`);
      expect(detail.body.subtasks.map((s: { id: string }) => s.id)).toEqual([child.id]);
      const list = await f.get('viewer', `/work/projects/${projectId}/tasks`);
      const row = list.body.items.find((t: Task) => t.id === parent.id);
      expect(row.subtaskCount).toBe(1);

      // Devenir jalon avec des sous-tâches : refusé.
      const toMilestone = await f.patch('owner', `/work/tasks/${parent.id}`, {
        expectedRevision: parent.revision,
        isMilestone: true,
        dueDate: '2026-12-01',
      });
      expect(toMilestone.status).toBe(400);
      expect(f.issueCodes(toMilestone)).toContain('WORK_SUBTASK_DEPTH');
    });

    it('critère 2 : un parent forgé d’une autre organisation répond 404', async () => {
      const other = await f.post('ownerB', '/work/projects', { name: 'B', kind: 'internal' });
      const foreign = await f.post('ownerB', `/work/projects/${other.body.id}/tasks`, {
        title: 'De B',
      });
      expect(foreign.status).toBe(201);
      const res = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Forgé',
        parentTaskId: foreign.body.task.id,
      });
      expect(res.status).toBe(404);
      const dep = await task({ title: 'Dépend de B' });
      const forged = await f.post('owner', `/work/tasks/${dep.id}/dependencies`, {
        predecessorTaskId: foreign.body.task.id,
      });
      expect(forged.status).toBe(404);
    });

    it('jalon client terminé : suggestion de facture et notification au responsable du projet', async () => {
      const m = await f.post('owner', `/work/projects/${clientProject}/tasks`, {
        title: 'Livraison',
        isMilestone: true,
        dueDate: '2026-12-01',
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      f.notifications.length = 0;
      const done = await f.post('analyst', `/work/tasks/${m.body.task.id}/complete`, {
        expectedRevision: m.body.task.revision,
      });
      expect(done.status).toBe(200);
      expect(done.body.suggestions).toEqual([
        { code: 'PREPARE_INVOICE', taskId: m.body.task.id },
      ]);
      expect(f.notifications.map((n) => [n.kind, n.recipientUserId])).toEqual([
        ['work.milestone_completed', f.userId('admin')],
      ]);
    });
  });

  describe('dépendances', () => {
    it('critère 3 : un cycle répond 409 ; un conflit de dates rend un avertissement', async () => {
      const a = await task({ title: 'Fondations', dueDate: '2026-11-10' });
      const b = await task({ title: 'Murs', startDate: '2026-11-08', dueDate: '2026-11-20' });
      const c = await task({ title: 'Toiture' });

      const ab = await f.post('owner', `/work/tasks/${b.id}/dependencies`, {
        predecessorTaskId: a.id,
      });
      expect(ab.status, JSON.stringify(ab.body)).toBe(200);
      expect(ab.body.task.blocked).toBe(true);
      expect(ab.body.warnings).toEqual([
        { code: 'WORK_DEPENDENCY_DATE_CONFLICT', taskId: b.id, predecessorId: a.id },
      ]);

      const bc = await f.post('owner', `/work/tasks/${c.id}/dependencies`, {
        predecessorTaskId: b.id,
      });
      expect(bc.status).toBe(200);
      const ca = await f.post('owner', `/work/tasks/${a.id}/dependencies`, {
        predecessorTaskId: c.id,
      });
      expect(ca.status).toBe(409);
      expect(ca.body.code).toBe('WORK_DEPENDENCY_CYCLE');
      const self = await f.post('owner', `/work/tasks/${a.id}/dependencies`, {
        predecessorTaskId: a.id,
      });
      expect(self.status).toBe(409);

      const detail = await f.get('viewer', `/work/tasks/${b.id}`);
      expect(detail.body.predecessors.map((p: { taskId: string }) => p.taskId)).toEqual([a.id]);
      expect(detail.body.successors.map((p: { taskId: string }) => p.taskId)).toEqual([c.id]);

      const removed = await f.del('owner', `/work/tasks/${b.id}/dependencies/${a.id}`);
      expect(removed.status).toBe(200);
      expect(removed.body.task.blockedBy).toEqual([]);
      expect(removed.body.task.blocked).toBe(false);
    });

    it('suppression : refusée avec du temps saisi ; sinon retirée des dépendances', async () => {
      const a = await task({ title: 'Prédécesseur' });
      const b = await task({ title: 'Successeur' });
      await f.post('owner', `/work/tasks/${b.id}/dependencies`, { predecessorTaskId: a.id });

      const analyst = await f.del('analyst', `/work/tasks/${a.id}`);
      expect(analyst.status).toBe(403);
      expect(analyst.body.action).toBe('work.manage');

      const del = await f.del('owner', `/work/tasks/${a.id}`);
      expect(del.status).toBe(204);
      const after = await f.get('owner', `/work/tasks/${b.id}`);
      expect(after.body.blockedBy).toEqual([]);

      const timed = await task({ title: 'Avec temps' });
      const t = await f.post('owner', `/work/tasks/${timed.id}/time-entries`, {
        workedOn: '2026-10-01',
        minutes: 15,
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const refused = await f.del('owner', `/work/tasks/${timed.id}`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('WORK_TASK_HAS_TIME');
    });
  });

  describe('Mes tâches, assignation, rappels', () => {
    it('assigner notifie le nouveau responsable, jamais l’auteur ; sans work.update : 400', async () => {
      const t = await task({ title: 'À confier' });
      f.notifications.length = 0;
      const viewer = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        assigneeUserId: f.userId('viewer'),
      });
      expect(viewer.status).toBe(400);
      expect(f.issueCodes(viewer)).toContain('WORK_ASSIGNEE_NOT_ELIGIBLE');

      const res = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        assigneeUserId: f.userId('analyst'),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(f.notifications).toHaveLength(1);
      expect(f.notifications[0]).toMatchObject({
        kind: 'work.task_assigned',
        recipientUserId: f.userId('analyst'),
        requiredAction: 'work.read',
        href: `/projets/${projectId}?tache=${t.id}`,
      });

      f.notifications.length = 0;
      const self = await task({ title: 'Pour moi', assigneeUserId: f.userId('owner') });
      expect(self.id).toBeTruthy();
      expect(f.notifications).toHaveLength(0);
    });

    it('critère 6 : Mes tâches — les siennes, hors archivés, au jour de Kinshasa (23 h 30 UTC)', async () => {
      const analyst = f.userId('analyst');
      await task({ title: 'Échéance 30', dueDate: '2026-10-30', assigneeUserId: analyst });
      await task({ title: 'Échéance 29', dueDate: '2026-10-29', assigneeUserId: analyst });
      await task({ title: 'Sans date', assigneeUserId: analyst });
      await task({ title: 'Pas à moi', dueDate: '2026-10-30', assigneeUserId: f.userId('admin') });
      const archived = await f.post('owner', '/work/projects', { name: 'Archivé', kind: 'internal' });
      await f.post('owner', `/work/projects/${archived.body.id}/tasks`, {
        title: 'Archivée',
        dueDate: '2026-10-30',
        assigneeUserId: analyst,
      });
      await f.post('owner', `/work/projects/${archived.body.id}/archive`, {
        expectedRevision: archived.body.revision,
      });

      const service = f.app().get(WorkTasksService);
      // 23 h 30 UTC le 29 = 00 h 30 le 30 à Kinshasa.
      const view = await service.myTasks(
        f.orgId(),
        { userId: analyst, role: 'analyst' },
        new Date('2026-10-29T23:30:00Z'),
      );
      expect(view.asOf).toBe('2026-10-30');
      expect(view.today.map((t) => t.title)).toEqual(['Échéance 30']);
      expect(view.overdue.map((t) => t.title)).toEqual(['Échéance 29']);
      expect(view.noDate.map((t) => t.title)).toContain('Sans date');
      const all = [...view.overdue, ...view.today, ...view.next7Days, ...view.later, ...view.noDate];
      expect(all.map((t) => t.title)).not.toContain('Archivée');
      expect(all.map((t) => t.title)).not.toContain('Pas à moi');
      expect(view.today[0]!.projectName).toBe('Interne');

      const http = await f.get('analyst', '/work/my-tasks');
      expect(http.status).toBe(200);
      expect(http.body).toHaveProperty('asOf');
      const transverse = await f.get('analyst', '/work/tasks?assignee=me&limit=2');
      expect(transverse.status).toBe(200);
      expect(transverse.body.items).toHaveLength(2);
      expect(transverse.body.nextCursor).toEqual(expect.any(String));
    });

    it('critère 8 : un rappel par (tâche, échéance, type), même rejoué ; échéance changée → nouveau', async () => {
      const job = f.app().get(WorkDueRemindersJob);
      const analyst = f.userId('analyst');
      const now = new Date('2026-10-29T08:00:00Z');
      const soon = await task({ title: 'Rappel', dueDate: '2026-10-30', assigneeUserId: analyst });

      f.notifications.length = 0;
      await job.run(now);
      await job.run(now);
      await job.run(now);
      const mine = () => f.notifications.filter((n) => n.source.entityId === soon.id);
      expect(mine().map((n) => n.kind)).toEqual(['work.task_due_soon']);
      expect(mine()[0]!.dedupeKey).toBe(`work.task_due_soon:${soon.id}:2026-10-30`);
      expect(mine()[0]!.actorUserId).toBeNull();

      const detail = await f.get('owner', `/work/tasks/${soon.id}`);
      await f.patch('owner', `/work/tasks/${soon.id}`, {
        expectedRevision: detail.body.revision,
        dueDate: '2026-10-29',
      });
      await job.run(now);
      expect(mine().map((n) => n.kind)).toEqual(['work.task_due_soon', 'work.task_due_soon']);

      // Avant 7 h à Kinshasa, rien ne part.
      const early = await job.run(new Date('2026-10-30T05:00:00Z'));
      expect(early.claimed).toBe(0);
      await job.run(new Date('2026-10-30T08:00:00Z'));
      expect(mine().map((n) => n.kind)).toContain('work.task_overdue');
    });

    it('critère 8 : un ancien membre ne reçoit plus de rappel', async () => {
      const job = f.app().get(WorkDueRemindersJob);
      const admin = f.userId('admin');
      const t = await task({ title: 'Ancien membre', dueDate: '2026-11-02', assigneeUserId: admin });
      await f.db().collection('memberships').deleteOne({ organizationId: f.orgId(), userId: admin });
      f.notifications.length = 0;
      const report = await job.run(new Date('2026-11-01T08:00:00Z'));
      expect(f.notifications.filter((n) => n.source.entityId === t.id)).toEqual([]);
      expect(report.skipped).toBeGreaterThanOrEqual(1);
    });
  });
});
