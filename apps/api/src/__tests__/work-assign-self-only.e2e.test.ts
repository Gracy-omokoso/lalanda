// Stagiaire : n'assigner une tâche qu'à soi-même — ADR-0066 § 2 (tranche la décision
// ouverte n° 3 d'ADR-0059), contre la vraie application.
//
// Le Stagiaire (`intern`, liste `SELF_ASSIGN_ONLY_ROLES`) crée des tâches et les fait
// avancer, mais n'assigne qu'à lui-même (ou laisse sans responsable) et ne réassigne
// jamais la tâche d'un autre : `403 WORK_ASSIGN_SELF_ONLY`. L'Analyste, sans la règle,
// assigne qui il veut. `GET /work/members` dit la règle à l'écran ; l'aperçu d'import
// importe sans responsable les lignes assignées à un autre.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');

e2eSuite('Stagiaire : assignation à soi seulement — ADR-0066 § 2', () => {
  const f = useWorkFixture('wself', { extraRoles: ['intern'] });
  let projectId = '';
  let autreTache = '';

  const creer = (who: 'intern' | 'analyst', assigneeUserId: string | null) =>
    f.post(who, `/work/projects/${projectId}/tasks`, {
      title: `Tâche ${who} ${Math.random().toString(36).slice(2, 6)}`,
      ...(assigneeUserId !== null ? { assigneeUserId } : {}),
    });
  const reassigner = async (who: 'intern' | 'analyst', taskId: string, to: string | null) => {
    const t = await f.get(who, `/work/tasks/${taskId}`);
    return f.patch(who, `/work/tasks/${taskId}`, {
      expectedRevision: t.body.revision,
      assigneeUserId: to,
    });
  };

  it('montage : projet ouvert, une tâche de l’Analyste', async () => {
    const p = await f.post('owner', '/work/projects', { name: 'Boutique Gombe', kind: 'internal' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.body.id;
    const t = await creer('analyst', f.userId('analyst'));
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    autreTache = t.body.task.id;
  });

  it('crée une tâche pour lui-même ou sans responsable ; jamais pour un autre', async () => {
    const moi = await creer('intern', f.userId('intern'));
    expect(moi.status, JSON.stringify(moi.body)).toBe(201);
    expect(moi.body.task.assignee.userId).toBe(f.userId('intern'));
    expect((await creer('intern', null)).status).toBe(201);
    const autre = await creer('intern', f.userId('analyst'));
    expect(autre.status).toBe(403);
    expect(autre.body.code).toBe('WORK_ASSIGN_SELF_ONLY');
  });

  it('prend une tâche libre, la rend ; ne la donne pas à un autre', async () => {
    const t = await creer('intern', null);
    const id = t.body.task.id as string;
    expect((await reassigner('intern', id, f.userId('intern'))).status).toBe(200);
    const donnee = await reassigner('intern', id, f.userId('analyst'));
    expect(donnee.status).toBe(403);
    expect(donnee.body.code).toBe('WORK_ASSIGN_SELF_ONLY');
    expect((await reassigner('intern', id, null)).status).toBe(200);
  });

  it('ne réassigne pas la tâche d’un collègue (ni à lui, ni à personne) ; la fait avancer', async () => {
    for (const to of [f.userId('intern'), null]) {
      const r = await reassigner('intern', autreTache, to);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('WORK_ASSIGN_SELF_ONLY');
    }
    const t = await f.get('intern', `/work/tasks/${autreTache}`);
    const titre = await f.patch('intern', `/work/tasks/${autreTache}`, {
      expectedRevision: t.body.revision,
      title: 'Étudier les emplacements (mis à jour)',
    });
    expect(titre.status, JSON.stringify(titre.body)).toBe(200);
    expect(titre.body.task.assignee.userId).toBe(f.userId('analyst'));
  });

  it('l’Analyste (sans la règle) assigne et réassigne librement', async () => {
    const t = await creer('analyst', f.userId('intern'));
    expect(t.status).toBe(201);
    expect((await reassigner('analyst', t.body.task.id, f.userId('analyst'))).status).toBe(200);
  });

  it('GET /work/members dit la règle de l’appelant', async () => {
    const stagiaire = await f.get('intern', '/work/members');
    expect(stagiaire.status).toBe(200);
    expect(stagiaire.body.assignSelfOnly).toBe(true);
    expect((await f.get('analyst', '/work/members')).body.assignSelfOnly).toBe(false);
  });

  it('import : les lignes assignées à un autre arrivent sans responsable', async () => {
    const body = csv([
      'Tâche;Responsable;Échéance',
      'Inventaire;Membre analyst;10/01/2027',
      'Vitrine;Membre intern;12/01/2027',
    ]);
    const res = await f
      .postRaw('intern', `/work/import/preview?projectId=${projectId}`)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'plan.csv')
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const codes = (res.body.issues as { row: number; code: string }[]).map(
      (i) => `${i.row}:${i.code}`,
    );
    expect(codes).toContain('2:IMPORT_ASSIGNEE_SELF_ONLY');
    expect(codes).not.toContain('3:IMPORT_ASSIGNEE_SELF_ONLY');
    const rows = res.body.rows as { row: number; assignee: { userId: string } | null }[];
    expect(rows.find((r) => r.row === 2)!.assignee).toBeNull();
    expect(rows.find((r) => r.row === 3)!.assignee?.userId).toBe(f.userId('intern'));
  });
});
