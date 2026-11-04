// Aperçu d'un projet — ADR-0057 : `GET /work/projects/:projectId/overview`.
//
// Droit `work.read` (le Conseiller n'y accède pas), chiffres calculés par le
// serveur, et isolation entre organisations (404, jamais une fuite de chiffres).

import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('aperçu d’un projet — santé, charge, isolation (ADR-0057)', () => {
  const f = useWorkFixture('wover');
  let projectId = '';
  let lateTaskId = '';

  describe('aperçu', () => {
    it('prépare un projet : tâches, retard, jalon, sous-tâche, commentaire', async () => {
      const p = await f.post('owner', '/work/projects', { name: 'Salon Kin', kind: 'internal' });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      projectId = p.body.id;

      const late = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Réserver la salle',
        dueDate: '2020-01-10',
        assigneeUserId: f.userId('analyst'),
      });
      expect(late.status, JSON.stringify(late.body)).toBe(201);
      lateTaskId = late.body.task.id;
      await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Sous-tâche en retard',
        parentTaskId: lateTaskId,
        dueDate: '2020-01-05',
      });
      const done = await f.post('owner', `/work/projects/${projectId}/tasks`, { title: 'Brief' });
      const c = await f.post('owner', `/work/tasks/${done.body.task.id}/complete`, {
        expectedRevision: done.body.task.revision,
      });
      expect(c.status).toBe(200);
      await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Ouverture',
        isMilestone: true,
        dueDate: '2099-06-01',
      });
      const com = await f.post('analyst', `/work/tasks/${lateTaskId}/comments`, {
        body: 'Je m’en occupe.',
        mentionedUserIds: [],
      });
      expect(com.status, JSON.stringify(com.body)).toBe(201);
    });

    it('le Lecteur lit les chiffres calculés par le serveur', async () => {
      const res = await f.get('viewer', `/work/projects/${projectId}/overview`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.projectId).toBe(projectId);
      expect(res.body.totals).toEqual({
        open: 2,
        done: 1,
        overdue: 1,
        unassigned: 1,
        milestones: 1,
      });
      expect(res.body.health).toEqual({ status: 'at_risk', reasons: ['OVERDUE_TASKS'] });
      expect(res.body.overdueTasks.map((t: { taskId: string }) => t.taskId)).toEqual([lateTaskId]);
      expect(res.body.overdueTasks[0].assignee.userId).toBe(f.userId('analyst'));
      expect(res.body.upcomingMilestones).toHaveLength(1);
      expect(res.body.weeks).toHaveLength(8);
      expect(res.body.weeks.at(-1)).toMatchObject({ done: 1, total: 3 });
      expect(res.body.commentCounts).toEqual({ [lateTaskId]: 1 });
      const charge = res.body.openByAssignee.map(
        (x: { assignee: { userId: string } | null; open: number }) => [
          x.assignee?.userId ?? null,
          x.open,
        ],
      );
      expect(charge).toEqual([
        [f.userId('analyst'), 1],
        [null, 1],
      ]);
    });

    it('le Conseiller (sans work.read) est refusé', async () => {
      const res = await f.get('advisor', `/work/projects/${projectId}/overview`);
      expect(res.status).toBe(403);
      expect(res.body.action).toBe('work.read');
    });

    it('isolation : une autre organisation reçoit 404, et voit ses seuls chiffres', async () => {
      const foreign = await f.get('ownerB', `/work/projects/${projectId}/overview`);
      expect(foreign.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain('Réserver');

      const pB = await f.post('ownerB', '/work/projects', { name: 'Projet B', kind: 'internal' });
      expect(pB.status).toBe(201);
      const mine = await f.get('ownerB', `/work/projects/${pB.body.id}/overview`);
      expect(mine.status).toBe(200);
      expect(mine.body.totals.open + mine.body.totals.done).toBe(0);
      expect(mine.body.commentCounts).toEqual({});
      expect(mine.body.health.status).toBe('on_track');

      const cross = await f.get('owner', `/work/projects/${pB.body.id}/overview`);
      expect(cross.status).toBe(404);
    });

    it('identifiant mal formé : 404', async () => {
      const res = await f.get('owner', '/work/projects/pas-un-id/overview');
      expect([400, 404]).toContain(res.status);
    });
  });
});
