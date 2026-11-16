// Import et plans IA : mêmes règles de rôle que la création unitaire — ADR-0076 § 1,
// contre la vraie application. Le Lecteur n'importe rien ; seuls le chef, l'adjoint et
// `work.manage` importent des jalons ; un Lecteur n'est pas responsable ; le chef et
// l'adjoint d'un projet créé par import ou par l'IA ne sont ni Invité ni Stagiaire. Tout
// refus tombe AVANT écriture.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');

e2eSuite('Projets : import et plans IA sous les rôles du projet — ADR-0076 § 1', () => {
  const f = useWorkFixture('wplanrole', { extraRoles: ['employee', 'intern', 'guest'] });
  let projectId = '';

  const upload = (who: Parameters<typeof f.postRaw>[0], path: string, body: Buffer) =>
    f
      .postRaw(who, path)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'plan.csv')
      .send(body);
  const count = () => f.db().collection('work_tasks').countDocuments({ projectId });

  it('montage : chef Salarié, Analyste Membre, Stagiaire Lecteur', async () => {
    const p = await f.post('owner', '/work/projects', {
      name: 'Dépôt Matete',
      kind: 'internal',
      ownerUserId: f.userId('employee'),
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.body.id;
    const m = await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('analyst')],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const v = await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('intern')],
      role: 'viewer',
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
  });

  it('le Lecteur n’importe rien', async () => {
    const r = await upload('intern', `/work/projects/${projectId}/import`, csv(['Tâche', 'A']));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('WORK_TASK_CREATE_FORBIDDEN');
    expect(await count()).toBe(0);
  });

  it('un Membre n’importe pas de jalon ; rien n’est écrit', async () => {
    const r = await upload(
      'analyst',
      `/work/projects/${projectId}/import`,
      csv(['Tâche;Échéance;Jalon', 'Inventaire;10/01/2027;Non', 'Réception;20/01/2027;Oui']),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('WORK_PROJECT_MANAGE_FORBIDDEN');
    expect(await count()).toBe(0);
  });

  it('un Lecteur n’est pas responsable d’une tâche importée ; rien n’est écrit', async () => {
    const r = await upload(
      'employee',
      `/work/projects/${projectId}/import`,
      csv(['Tâche;Responsable', 'Inventaire;Membre intern']),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(f.issueCodes(r)).toContain('WORK_ASSIGNEE_VIEWER');
    expect(await count()).toBe(0);
  });

  it('un Membre importe des tâches ; le chef importe des jalons', async () => {
    const membre = await upload(
      'analyst',
      `/work/projects/${projectId}/import`,
      csv(['Tâche', 'Inventaire']),
    );
    expect(membre.status, JSON.stringify(membre.body)).toBe(201);
    const chef = await upload(
      'employee',
      `/work/projects/${projectId}/import`,
      csv(['Tâche;Échéance;Jalon', 'Réception;20/01/2027;Oui']),
    );
    expect(chef.status, JSON.stringify(chef.body)).toBe(201);
    expect(chef.body.createdMilestones).toBe(1);
    expect(await count()).toBe(2);
  });

  it('import en nouveau projet : chef ou adjoint Invité ou Stagiaire refusé, aucun projet créé', async () => {
    const before = await f.db().collection('work_projects').countDocuments();
    for (const [param, who] of [
      ['ownerUserId', 'intern'],
      ['deputyUserId', 'guest'],
    ] as const) {
      const r = await upload(
        'owner',
        `/work/import/projects?name=Nouveau&${param}=${f.userId(who)}`,
        csv(['Tâche', 'A']),
      );
      expect(r.status, `${param} ${JSON.stringify(r.body)}`).toBe(400);
      expect(f.issueCodes(r)).toContain('WORK_PROJECT_LEAD_NOT_ELIGIBLE');
    }
    expect(await f.db().collection('work_projects').countDocuments()).toBe(before);
    const ok = await upload(
      'owner',
      `/work/import/projects?name=Nouveau&ownerUserId=${f.userId('employee')}&deputyUserId=${f.userId('analyst')}`,
      csv(['Tâche', 'A']),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const p = await f.get('owner', `/work/projects/${ok.body.projectId}`);
    expect(p.body.deputy.userId).toBe(f.userId('analyst'));
  });

  it('plan IA relu : chef ou adjoint Invité ou Stagiaire refusé, aucun projet créé', async () => {
    const before = await f.db().collection('work_projects').countDocuments();
    for (const lead of [{ ownerUserId: f.userId('guest') }, { deputyUserId: f.userId('intern') }]) {
      const r = await f.post('owner', '/work/plans/projects', {
        origin: 'ai',
        project: { name: 'Plan IA', kind: 'internal', ...lead },
        tasks: [{ ref: 'T1', title: 'A' }],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(f.issueCodes(r)).toContain('WORK_PROJECT_LEAD_NOT_ELIGIBLE');
    }
    expect(await f.db().collection('work_projects').countDocuments()).toBe(before);
  });
});
