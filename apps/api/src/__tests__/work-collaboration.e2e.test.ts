// Collaborateurs, abonnés, achèvement, liste de contrôle — ADR-0076 § 2 et § 4, contre la
// vraie application.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('Projets : collaborateurs, abonnés, liste de contrôle — ADR-0076 § 2 et § 4', () => {
  const f = useWorkFixture('wcollab', { extraRoles: ['employee', 'intern'] });
  let projectId = '';
  let taskId = '';

  const rev = async (id: string): Promise<number> =>
    (await f.get('owner', `/work/tasks/${id}`)).body.revision as number;

  it('montage : projet avec chef, tâche confiée à l’Analyste par le chef', async () => {
    const p = await f.post('owner', '/work/projects', {
      name: 'Salon de Kinshasa',
      kind: 'internal',
      ownerUserId: f.userId('employee'),
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.body.id;
    const t = await f.post('employee', `/work/projects/${projectId}/tasks`, {
      title: 'Réserver le stand',
      assigneeUserId: f.userId('analyst'),
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    taskId = t.body.task.id;
  });

  it('un Membre ne modifie pas la tâche d’un collègue ; collaborateur, il la modifie', async () => {
    const refus = await f.patch('accountant', `/work/tasks/${taskId}`, {
      expectedRevision: await rev(taskId),
      title: 'Réserver le stand A12',
    });
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe('WORK_TASK_EDIT_FORBIDDEN');

    f.notifications.length = 0;
    const ajout = await f.patch('analyst', `/work/tasks/${taskId}`, {
      expectedRevision: await rev(taskId),
      collaboratorUserIds: [f.userId('accountant')],
    });
    expect(ajout.status, JSON.stringify(ajout.body)).toBe(200);
    expect(ajout.body.task.collaboratorUserIds).toEqual([f.userId('accountant')]);
    expect(f.notifications.map((n) => [n.kind, n.recipientUserId])).toContainEqual([
      'work.task_collaborator_added',
      f.userId('accountant'),
    ]);

    const ok = await f.patch('accountant', `/work/tasks/${taskId}`, {
      expectedRevision: await rev(taskId),
      title: 'Réserver le stand A12',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const detail = await f.get('accountant', `/work/tasks/${taskId}`);
    expect(detail.body.collaborators.map((c: { userId: string }) => c.userId)).toEqual([
      f.userId('accountant'),
    ]);
    expect(detail.body.following).toBe(true);
    expect(detail.body.myRights).toMatchObject({
      canEdit: true,
      canComplete: false,
      canCheck: true,
    });
  });

  it('le collaborateur ne termine pas la tâche d’un autre ; « Je collabore » ; le responsable termine', async () => {
    const termine = await f.post('accountant', `/work/tasks/${taskId}/complete`, {
      expectedRevision: await rev(taskId),
    });
    expect(termine.status).toBe(403);
    expect(termine.body.code).toBe('WORK_TASK_COMPLETE_FORBIDDEN');
    const glisse = await f.post('accountant', `/work/tasks/${taskId}/move`, {
      columnKey: 'done',
      expectedRevision: await rev(taskId),
    });
    expect(glisse.status).toBe(403);
    const deplace = await f.post('accountant', `/work/tasks/${taskId}/move`, {
      columnKey: 'doing',
      expectedRevision: await rev(taskId),
    });
    expect(deplace.status, JSON.stringify(deplace.body)).toBe(200);

    const mes = await f.get('accountant', '/work/my-tasks');
    expect(mes.status).toBe(200);
    expect((mes.body.collaborating as { id: string }[]).map((t) => t.id)).toContain(taskId);

    const fait = await f.post('analyst', `/work/tasks/${taskId}/complete`, {
      expectedRevision: await rev(taskId),
    });
    expect(fait.status, JSON.stringify(fait.body)).toBe(200);
    expect(fait.body.task.done).toBe(true);
    const rouvre = await f.post('accountant', `/work/tasks/${taskId}/reopen`, {
      expectedRevision: fait.body.task.revision,
    });
    expect(rouvre.status).toBe(403);
    expect(
      (
        await f.post('employee', `/work/tasks/${taskId}/reopen`, {
          expectedRevision: fait.body.task.revision,
        })
      ).status,
    ).toBe(200);
  });

  it('sous-tâche sans responsable : le responsable de la parente la termine, pas un autre', async () => {
    const s = await f.post('analyst', `/work/projects/${projectId}/tasks`, {
      title: 'Payer l’acompte',
      parentTaskId: taskId,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const subId = s.body.task.id as string;
    expect(
      (await f.post('accountant', `/work/tasks/${subId}/complete`, { expectedRevision: 1 })).status,
    ).toBe(403);
    expect(
      (await f.post('analyst', `/work/tasks/${subId}/complete`, { expectedRevision: 1 })).status,
    ).toBe(200);
  });

  it('Suivre / Ne plus suivre : toute personne qui voit la tâche, Lecteur d’organisation compris', async () => {
    const suit = await f.post('viewer', `/work/tasks/${taskId}/follow`);
    expect(suit.status, JSON.stringify(suit.body)).toBe(200);
    expect(suit.body.following).toBe(true);
    expect((await f.get('viewer', `/work/tasks/${taskId}`)).body.following).toBe(true);
    const quitte = await f.del('viewer', `/work/tasks/${taskId}/follow`);
    expect(quitte.status).toBe(200);
    expect((await f.get('viewer', `/work/tasks/${taskId}`)).body.following).toBe(false);
  });

  it('liste de contrôle : composer, cocher (doneBy), refus du Lecteur, 30 éléments au plus', async () => {
    const pose = await f.put('analyst', `/work/tasks/${taskId}/checklist`, {
      expectedRevision: await rev(taskId),
      items: [
        { text: 'Plan du stand', done: false },
        { text: 'Badge exposant', done: false },
      ],
    });
    expect(pose.status, JSON.stringify(pose.body)).toBe(200);
    expect(pose.body.task.checklistTotal).toBe(2);
    expect(pose.body.task.checklistDone).toBe(0);
    const d = await f.get('accountant', `/work/tasks/${taskId}`);
    const items = d.body.checklist as { id: string; text: string; done: boolean }[];
    const coche = await f.put('accountant', `/work/tasks/${taskId}/checklist`, {
      expectedRevision: d.body.revision,
      items: items.map((i, n) => ({ id: i.id, text: i.text, done: n === 0 })),
    });
    expect(coche.status, JSON.stringify(coche.body)).toBe(200);
    expect(coche.body.task.checklistDone).toBe(1);
    const apres = await f.get('owner', `/work/tasks/${taskId}`);
    expect(apres.body.checklist[0].doneBy.userId).toBe(f.userId('accountant'));

    // Le Stagiaire, Lecteur du projet, ne coche pas.
    await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('intern')],
      role: 'viewer',
    });
    const lecteur = await f.put('intern', `/work/tasks/${taskId}/checklist`, {
      expectedRevision: apres.body.revision,
      items: (apres.body.checklist as { id: string; text: string }[]).map((i) => ({
        id: i.id,
        text: i.text,
        done: true,
      })),
    });
    expect(lecteur.status).toBe(403);
    expect(lecteur.body.code).toBe('WORK_CHECKLIST_FORBIDDEN');

    const trop = await f.put('analyst', `/work/tasks/${taskId}/checklist`, {
      expectedRevision: apres.body.revision,
      items: Array.from({ length: 31 }, (_, i) => ({ text: `Élément ${i}`, done: false })),
    });
    expect(trop.status).toBe(400);

    const liste = await f.get('owner', `/work/projects/${projectId}/tasks`);
    const vue = (
      liste.body.items as { id: string; checklistDone: number; checklistTotal: number }[]
    ).find((t) => t.id === taskId);
    expect(vue).toMatchObject({ checklistDone: 1, checklistTotal: 2 });
  });
});
