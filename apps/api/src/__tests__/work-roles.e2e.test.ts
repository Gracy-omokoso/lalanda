// Rôles dans le projet — ADR-0076 § 1, contre la vraie application.
//
// Le Chef de projet (`ownerUserId`) et l'Adjoint (`deputyUserId`), internes avec
// `work.update`, gèrent LEUR projet sans `work.manage` ; un Membre non ; le Lecteur lit
// et commente seulement ; l'Invité et le Stagiaire ne sont ni chef ni adjoint ; le rôle
// d'organisation reste un plafond.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('Projets : rôles dans le projet — ADR-0076 § 1', () => {
  const f = useWorkFixture('wroles', { extraRoles: ['employee', 'intern', 'guest'] });
  let projectId = '';
  let revision = 0;

  const projet = async () => {
    const p = await f.get('owner', `/work/projects/${projectId}`);
    revision = p.body.revision;
    return p;
  };

  it('montage : la direction nomme un Salarié chef et l’Analyste adjoint', async () => {
    const p = await f.post('owner', '/work/projects', {
      name: 'Chantier Limete',
      kind: 'internal',
      ownerUserId: f.userId('employee'),
      deputyUserId: f.userId('analyst'),
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.body.id;
    expect(p.body.deputy.userId).toBe(f.userId('analyst'));
    const vu = await f.get('employee', `/work/projects/${projectId}`);
    expect(vu.body.myRole).toBe('lead');
    expect(vu.body.myRights.canManage).toBe(true);
    const autre = await f.get('accountant', `/work/projects/${projectId}`);
    expect(autre.body.myRole).toBe('none');
    expect(autre.body.myRights.canManage).toBe(false);
  });

  it('ni Invité, ni Stagiaire, ni rôle sans work.update ne sont chef ou adjoint', async () => {
    await projet();
    for (const who of ['guest', 'intern', 'viewer'] as const) {
      const r = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: revision,
        deputyUserId: f.userId(who),
      });
      expect(r.status, who).toBe(400);
      expect(f.issueCodes(r), who).toContain('WORK_PROJECT_LEAD_NOT_ELIGIBLE');
    }
    const meme = await f.put('owner', `/work/projects/${projectId}`, {
      expectedRevision: revision,
      deputyUserId: f.userId('employee'),
    });
    expect(meme.status).toBe(400);
  });

  it('le chef gère sans work.manage : réglages, membres, archivage ; un non-membre non', async () => {
    await projet();
    const nom = await f.put('employee', `/work/projects/${projectId}`, {
      expectedRevision: revision,
      name: 'Chantier Limete (phase 1)',
    });
    expect(nom.status, JSON.stringify(nom.body)).toBe(200);
    const refus = await f.put('accountant', `/work/projects/${projectId}`, {
      expectedRevision: nom.body.revision,
      name: 'Intrus',
    });
    expect(refus.status).toBe(403);
    expect(refus.body.code).toBe('WORK_PROJECT_MANAGE_FORBIDDEN');

    const ajout = await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('accountant'), f.userId('intern')],
    });
    expect(ajout.status, JSON.stringify(ajout.body)).toBe(201);
    expect(ajout.body.canManage).toBe(true);
    const refusAjout = await f.post('accountant', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('guest')],
    });
    expect(refusAjout.status).toBe(403);

    const arch = await f.post('employee', `/work/projects/${projectId}/archive`, {
      expectedRevision: (await projet()).body.revision,
    });
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    const rest = await f.post('employee', `/work/projects/${projectId}/restore`, {
      expectedRevision: arch.body.revision,
    });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
  });

  it('l’adjoint gère mais ne nomme ni le chef ni l’adjoint ; le chef passe la main', async () => {
    await projet();
    const desc = await f.put('analyst', `/work/projects/${projectId}`, {
      expectedRevision: revision,
      description: 'Pose des carreaux',
    });
    expect(desc.status, JSON.stringify(desc.body)).toBe(200);
    const chef = await f.put('analyst', `/work/projects/${projectId}`, {
      expectedRevision: desc.body.revision,
      ownerUserId: f.userId('analyst'),
      deputyUserId: null,
    });
    expect(chef.status).toBe(403);
    const membres = await f.get('analyst', `/work/projects/${projectId}/members`);
    expect(membres.body.deputy.userId).toBe(f.userId('analyst'));
    expect(membres.body.canManage).toBe(true);
  });

  it('jalons et suppression de tâches : gestion seulement', async () => {
    const jalonMembre = await f.post('accountant', `/work/projects/${projectId}/tasks`, {
      title: 'Réception',
      isMilestone: true,
      dueDate: '2027-01-15',
    });
    expect(jalonMembre.status).toBe(403);
    const jalon = await f.post('employee', `/work/projects/${projectId}/tasks`, {
      title: 'Réception',
      isMilestone: true,
      dueDate: '2027-01-15',
    });
    expect(jalon.status, JSON.stringify(jalon.body)).toBe(201);
    const t = await f.post('accountant', `/work/projects/${projectId}/tasks`, { title: 'Devis' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await f.del('accountant', `/work/tasks/${t.body.task.id}`)).status).toBe(403);
    expect((await f.del('employee', `/work/tasks/${t.body.task.id}`)).status).toBe(204);
  });

  it('Lecteur : commente, ne crée pas, ne saisit pas de temps, n’est pas assignable', async () => {
    const role = await f.put(
      'employee',
      `/work/projects/${projectId}/members/users/${f.userId('intern')}/role`,
      { role: 'viewer' },
    );
    expect(role.status, JSON.stringify(role.body)).toBe(200);
    const intern = (role.body.users as { userId: string; role: string }[]).find(
      (u) => u.userId === f.userId('intern'),
    );
    expect(intern?.role).toBe('viewer');
    expect((await f.get('intern', `/work/projects/${projectId}`)).body.myRole).toBe('viewer');

    const cree = await f.post('intern', `/work/projects/${projectId}/tasks`, { title: 'X' });
    expect(cree.status).toBe(403);
    expect(cree.body.code).toBe('WORK_TASK_CREATE_FORBIDDEN');

    const t = await f.post('employee', `/work/projects/${projectId}/tasks`, { title: 'Métré' });
    const taskId = t.body.task.id as string;
    const assigne = await f.patch('employee', `/work/tasks/${taskId}`, {
      expectedRevision: t.body.task.revision,
      assigneeUserId: f.userId('intern'),
    });
    expect(assigne.status).toBe(400);
    expect(f.issueCodes(assigne)).toContain('WORK_ASSIGNEE_VIEWER');
    const collab = await f.patch('employee', `/work/tasks/${taskId}`, {
      expectedRevision: t.body.task.revision,
      collaboratorUserIds: [f.userId('intern')],
    });
    expect(collab.status).toBe(400);
    expect(f.issueCodes(collab)).toContain('WORK_COLLABORATOR_NOT_ELIGIBLE');

    const commente = await f.post('intern', `/work/tasks/${taskId}/comments`, {
      body: 'Je regarde le métré.',
    });
    expect(commente.status, JSON.stringify(commente.body)).toBe(201);
    const temps = await f.post('intern', `/work/tasks/${taskId}/time-entries`, {
      workedOn: '2026-10-01',
      minutes: 30,
    });
    expect(temps.status).toBe(403);
    const modifie = await f.patch('intern', `/work/tasks/${taskId}`, {
      expectedRevision: t.body.task.revision,
      title: 'Intrus',
    });
    expect(modifie.status).toBe(403);

    // Revenu Membre, il crée de nouveau.
    await f.put(
      'employee',
      `/work/projects/${projectId}/members/users/${f.userId('intern')}/role`,
      {
        role: 'member',
      },
    );
    expect(
      (await f.post('intern', `/work/projects/${projectId}/tasks`, { title: 'Y' })).status,
    ).toBe(201);
  });

  it('équipe Lecteur, historique du rôle, plafond du rôle d’organisation', async () => {
    const act = await f.get('owner', `/work/projects/${projectId}/activity`);
    const kinds = (act.body.items as { kind: string }[]).map((i) => i.kind);
    expect(kinds).toContain('project.member_role_changed');
    // Rôle d'organisation « Lecteur » (sans work.update) : lecture seule, même membre.
    await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('viewer')],
    });
    const v = await f.get('viewer', `/work/projects/${projectId}`);
    expect(v.body.myRights.canCreateTasks).toBe(false);
    expect(v.body.myRights.canManage).toBe(false);
    expect(
      (await f.post('viewer', `/work/projects/${projectId}/tasks`, { title: 'Z' })).status,
    ).toBe(403);
  });
});
