// Validation des tâches et des jalons, statut déclaré du projet — ADR-0076 § 3 et § 5,
// contre la vraie application. Aucune facture n'est émise : seul le brouillon `FV`
// d'ADR-0039 § 6.3 se prépare, après l'approbation.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('Projets : validation des tâches, statut du projet — ADR-0076 § 3 et § 5', () => {
  const f = useWorkFixture('wapprove', { extraRoles: ['employee'] });
  let projectId = '';
  let milestoneId = '';

  const rev = async (id: string): Promise<number> =>
    (await f.get('owner', `/work/tasks/${id}`)).body.revision as number;

  it('montage : projet client, chef Salarié, adjoint Comptable, jalon « à valider » confié à l’Analyste', async () => {
    const c = await f.post('owner', '/sales/customers', { type: 'PP', name: 'Client Gombe' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const p = await f.post('owner', '/work/projects', {
      name: 'Campagne Gombe',
      kind: 'client',
      ownerUserId: f.userId('employee'),
      deputyUserId: f.userId('accountant'),
      links: { customerId: c.body.id },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    projectId = p.body.id;
    const refus = await f.post('analyst', `/work/projects/${projectId}/tasks`, {
      title: 'Livrable',
      approval: { required: true },
    });
    expect(refus.status).toBe(403);
    const m = await f.post('employee', `/work/projects/${projectId}/tasks`, {
      title: 'Livraison des visuels',
      isMilestone: true,
      dueDate: '2027-02-01',
      assigneeUserId: f.userId('analyst'),
      approval: { required: true },
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    milestoneId = m.body.task.id;
    expect(m.body.task.approval).toMatchObject({ required: true, state: 'none' });
  });

  it('à valider : « terminer » est refusé, la facture aussi ; le responsable soumet', async () => {
    const termine = await f.post('analyst', `/work/tasks/${milestoneId}/complete`, {
      expectedRevision: await rev(milestoneId),
    });
    expect(termine.status).toBe(409);
    expect(termine.body.code).toBe('WORK_TASK_APPROVAL_REQUIRED');
    const facture = await f.post('owner', `/work/tasks/${milestoneId}/prepare-invoice`, {
      source: 'empty',
    });
    expect(facture.status).toBe(409);
    expect(facture.body.code).toBe('WORK_MILESTONE_NOT_DONE');

    expect(
      (
        await f.post('viewer', `/work/tasks/${milestoneId}/approval/submit`, {
          expectedRevision: await rev(milestoneId),
        })
      ).status,
    ).toBe(403);
    f.notifications.length = 0;
    const soumis = await f.post('analyst', `/work/tasks/${milestoneId}/approval/submit`, {
      expectedRevision: await rev(milestoneId),
    });
    expect(soumis.status, JSON.stringify(soumis.body)).toBe(200);
    expect(soumis.body.task.approval).toMatchObject({
      state: 'pending',
      pendingApproverUserId: f.userId('employee'),
    });
    expect(f.notifications.map((n) => [n.kind, n.recipientUserId])).toContainEqual([
      'work.task_approval_requested',
      f.userId('employee'),
    ]);
  });

  it('« À valider » dans Mes tâches et le brief du validateur', async () => {
    const mes = await f.get('employee', '/work/my-tasks');
    expect((mes.body.toApprove as { id: string }[]).map((t) => t.id)).toContain(milestoneId);
    const brief = await f.get('employee', '/morning-brief');
    expect(brief.status, JSON.stringify(brief.body)).toBe(200);
    const fact = (brief.body.brief.facts as { id: string; value: string | null }[]).find(
      (x) => x.id === 'mes_validations_taches.en_attente',
    );
    expect(fact?.value).toBe('1');
    const detail = await f.get('employee', `/work/tasks/${milestoneId}`);
    expect(detail.body.myRights.canDecide).toBe(true);
    expect((await f.get('analyst', `/work/tasks/${milestoneId}`)).body.myRights.canDecide).toBe(
      false,
    );
  });

  it('demander des modifications exige un motif ; la tâche revient au responsable', async () => {
    const sansMotif = await f.post('employee', `/work/tasks/${milestoneId}/approval/decide`, {
      expectedRevision: await rev(milestoneId),
      decision: 'request_changes',
    });
    expect(sansMotif.status).toBe(400);
    const membre = await f.post('analyst', `/work/tasks/${milestoneId}/approval/decide`, {
      expectedRevision: await rev(milestoneId),
      decision: 'approve',
    });
    expect(membre.status).toBe(403);
    f.notifications.length = 0;
    const retour = await f.post('employee', `/work/tasks/${milestoneId}/approval/decide`, {
      expectedRevision: await rev(milestoneId),
      decision: 'request_changes',
      reason: 'Le logo du client manque.',
    });
    expect(retour.status, JSON.stringify(retour.body)).toBe(200);
    expect(retour.body.task.done).toBe(false);
    expect(retour.body.task.approval.state).toBe('changes_requested');
    expect(f.notifications.map((n) => [n.kind, n.recipientUserId])).toContainEqual([
      'work.task_approval_decided',
      f.userId('analyst'),
    ]);
    const d = await f.get('analyst', `/work/tasks/${milestoneId}`);
    expect(d.body.approvalDetail.reason).toBe('Le logo du client manque.');
  });

  it('approuver termine le jalon et propose seulement alors le brouillon de facture', async () => {
    await f.post('analyst', `/work/tasks/${milestoneId}/approval/submit`, {
      expectedRevision: await rev(milestoneId),
    });
    const ok = await f.post('employee', `/work/tasks/${milestoneId}/approval/decide`, {
      expectedRevision: await rev(milestoneId),
      decision: 'approve',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.task.done).toBe(true);
    expect(ok.body.task.approval.state).toBe('approved');
    expect(ok.body.suggestions).toEqual([{ code: 'PREPARE_INVOICE', taskId: milestoneId }]);
    const act = await f.get('owner', `/work/tasks/${milestoneId}/activity`);
    const kinds = (act.body.items as { kind: string }[]).map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'task.approval_submitted',
        'task.approval_changes_requested',
        'task.approval_approved',
        'task.completed',
      ]),
    );
  });

  it('jalon terminé puis marqué « à valider » : pas de brouillon de facture avant approbation', async () => {
    const m = await f.post('employee', `/work/projects/${projectId}/tasks`, {
      title: 'Bilan',
      isMilestone: true,
      dueDate: '2027-03-01',
    });
    const id = m.body.task.id as string;
    await f.post('employee', `/work/tasks/${id}/complete`, {
      expectedRevision: m.body.task.revision,
    });
    const marque = await f.patch('employee', `/work/tasks/${id}`, {
      expectedRevision: await rev(id),
      approval: { required: true },
    });
    expect(marque.status, JSON.stringify(marque.body)).toBe(200);
    const facture = await f.post('owner', `/work/tasks/${id}/prepare-invoice`, { source: 'empty' });
    expect(facture.status).toBe(409);
    expect(facture.body.code).toBe('WORK_MILESTONE_NOT_APPROVED');
  });

  it('personne ne valide sa propre soumission ; l’adjoint valide celle du chef ; refus motivé', async () => {
    const t = await f.post('employee', `/work/projects/${projectId}/tasks`, {
      title: 'Brief créatif',
      assigneeUserId: f.userId('employee'),
      approval: { required: true },
    });
    const id = t.body.task.id as string;
    await f.post('employee', `/work/tasks/${id}/approval/submit`, {
      expectedRevision: await rev(id),
    });
    const soi = await f.post('employee', `/work/tasks/${id}/approval/decide`, {
      expectedRevision: await rev(id),
      decision: 'approve',
    });
    expect(soi.status).toBe(409);
    expect(soi.body.code).toBe('WORK_SELF_APPROVAL_FORBIDDEN');
    const refus = await f.post('accountant', `/work/tasks/${id}/approval/decide`, {
      expectedRevision: await rev(id),
      decision: 'reject',
      reason: 'Hors budget.',
    });
    expect(refus.status, JSON.stringify(refus.body)).toBe(200);
    expect(refus.body.task.approval.state).toBe('rejected');
    expect(refus.body.task.done).toBe(false);
  });

  it('statut du projet : publié par le chef, refusé au Membre, historique, Aperçu et portefeuille', async () => {
    const membre = await f.post('analyst', `/work/projects/${projectId}/status-updates`, {
      status: 'at_risk',
      text: 'Retard',
    });
    expect(membre.status).toBe(403);
    await f.post('employee', `/work/projects/${projectId}/members`, {
      userIds: [f.userId('analyst')],
    });
    f.notifications.length = 0;
    const s = await f.post('employee', `/work/projects/${projectId}/status-updates`, {
      status: 'at_risk',
      text: 'Le client tarde à valider les maquettes.',
      date: '2026-11-16',
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body).toMatchObject({ status: 'at_risk', date: '2026-11-16' });
    expect(f.notifications.map((n) => [n.kind, n.recipientUserId])).toEqual(
      expect.arrayContaining([
        ['work.project_status_posted', f.userId('analyst')],
        ['work.project_status_posted', f.userId('accountant')],
      ]),
    );
    expect(f.notifications.some((n) => n.recipientUserId === f.userId('employee'))).toBe(false);
    const h = await f.get('viewer', `/work/projects/${projectId}/status-updates`);
    expect(h.status).toBe(200);
    expect(h.body.items).toHaveLength(1);
    const p = await f.get('viewer', `/work/projects/${projectId}`);
    expect(p.body.latestStatus.status).toBe('at_risk');
    const portfolio = await f.get('owner', '/work/portfolio');
    const row = (
      portfolio.body.items as {
        id: string;
        latestStatus: { status: string } | null;
        health: string;
      }[]
    ).find((x) => x.id === projectId);
    expect(row?.latestStatus?.status).toBe('at_risk');
    expect(row?.health).toEqual(expect.any(String));
  });
});
