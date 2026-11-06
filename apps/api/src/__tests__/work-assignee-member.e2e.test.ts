// Assigner dans un projet que la personne ne voit pas — ADR-0066 § 3, contre la vraie
// application.
//
// Un responsable doit voir le projet de sa tâche. S'il ne le voit pas (projet privé
// dont il n'est pas membre, Invité externe hors du projet) : un gestionnaire
// (`work.manage`) l'ajoute comme membre direct (historique `project.member_added`,
// notification « ajouté au projet ») ; un simple membre reçoit
// `400` (problème `WORK_ASSIGNEE_NOT_MEMBER` sur `assigneeUserId`) et rien n'est écrit. `GET /work/members?projectId=`
// dit qui voit le projet (sélecteur de responsable).

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('assignation dans un projet privé — ADR-0066 § 3', () => {
  const f = useWorkFixture('wassm', { extraRoles: ['employee', 'guest'] });
  let privateId = '';
  let openId = '';

  const membres = async (projectId: string) =>
    (
      (await f.get('owner', `/work/projects/${projectId}/members`)).body.users as {
        userId: string;
      }[]
    ).map((u) => u.userId);

  it('montage : projet privé (le Comptable y est membre), projet ouvert', async () => {
    const p = await f.post('owner', '/work/projects', {
      name: 'Dossier confidentiel',
      kind: 'internal',
      visibility: 'private',
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    privateId = p.body.id;
    const add = await f.post('owner', `/work/projects/${privateId}/members`, {
      userIds: [f.userId('accountant')],
    });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const o = await f.post('owner', '/work/projects', {
      name: 'Chantier ouvert',
      kind: 'internal',
    });
    openId = o.body.id;
  });

  it('GET /work/members?projectId= : qui voit le projet ; hors portée → 404', async () => {
    const r = await f.get('accountant', `/work/members?projectId=${privateId}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sees = new Map(
      (r.body.items as { userId: string; seesProject: boolean }[]).map((m) => [
        m.userId,
        m.seesProject,
      ]),
    );
    expect(sees.get(f.userId('accountant'))).toBe(true);
    expect(sees.get(f.userId('owner'))).toBe(true);
    expect(sees.get(f.userId('admin'))).toBe(true); // direction
    expect(sees.get(f.userId('employee'))).toBe(false);
    expect((await f.get('employee', `/work/members?projectId=${privateId}`)).status).toBe(404);
    // Projet ouvert : tous sauf l'Invité externe, borné à ses projets.
    const o = await f.get('employee', `/work/members?projectId=${openId}`);
    const seesOpen = new Map(
      (o.body.items as { userId: string; seesProject: boolean }[]).map((m) => [
        m.userId,
        m.seesProject,
      ]),
    );
    expect(seesOpen.get(f.userId('employee'))).toBe(true);
    expect(seesOpen.get(f.userId('guest'))).toBe(false);
  });

  it('un simple membre : 400 WORK_ASSIGNEE_NOT_MEMBER, rien n’est écrit', async () => {
    const before = await f.db().collection('work_tasks').countDocuments({ projectId: privateId });
    const r = await f.post('accountant', `/work/projects/${privateId}/tasks`, {
      title: 'Préparer la paie',
      assigneeUserId: f.userId('employee'),
    });
    expect(r.status).toBe(400);
    expect(f.issueCodes(r)).toContain('WORK_ASSIGNEE_NOT_MEMBER');
    expect(await f.db().collection('work_tasks').countDocuments({ projectId: privateId })).toBe(
      before,
    );
    // Réassigner une tâche existante : même refus.
    const t = await f.post('accountant', `/work/projects/${privateId}/tasks`, {
      title: 'Archiver les bulletins',
    });
    expect(t.status).toBe(201);
    const p = await f.patch('accountant', `/work/tasks/${t.body.task.id}`, {
      expectedRevision: t.body.task.revision,
      assigneeUserId: f.userId('employee'),
    });
    expect(p.status).toBe(400);
    expect(f.issueCodes(p)).toContain('WORK_ASSIGNEE_NOT_MEMBER');
    expect(await membres(privateId)).not.toContain(f.userId('employee'));
  });

  it('un gestionnaire : l’assigné devient membre direct, notifié « ajouté au projet »', async () => {
    f.notifications.length = 0;
    const r = await f.post('owner', `/work/projects/${privateId}/tasks`, {
      title: 'Préparer la paie',
      assigneeUserId: f.userId('employee'),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await membres(privateId)).toContain(f.userId('employee'));
    const kinds = f.notifications
      .filter((n) => n.recipientUserId === f.userId('employee'))
      .map((n) => n.kind);
    expect(kinds).toContain('work.added_to_project');
    expect(kinds).toContain('work.task_assigned');
    expect((await f.get('employee', `/work/projects/${privateId}`)).status).toBe(200);
    const activity = await f
      .db()
      .collection('work_activity')
      .findOne({
        projectId: privateId,
        kind: 'project.member_added',
        'data.userIds': f.userId('employee'),
      });
    expect(activity).not.toBeNull();
  });

  it('projet ouvert : rien ne change, sauf pour l’Invité externe (ajouté par le gestionnaire)', async () => {
    const r = await f.post('accountant', `/work/projects/${openId}/tasks`, {
      title: 'Commander le carrelage',
      assigneeUserId: f.userId('employee'),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await membres(openId)).not.toContain(f.userId('employee'));
    const refus = await f.post('accountant', `/work/projects/${openId}/tasks`, {
      title: 'Valider la maquette',
      assigneeUserId: f.userId('guest'),
    });
    expect(refus.status).toBe(400);
    expect(f.issueCodes(refus)).toContain('WORK_ASSIGNEE_NOT_MEMBER');
    const ok = await f.post('owner', `/work/projects/${openId}/tasks`, {
      title: 'Valider la maquette',
      assigneeUserId: f.userId('guest'),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await membres(openId)).toContain(f.userId('guest'));
    expect((await f.get('guest', `/work/projects/${openId}`)).status).toBe(200);
  });
});
