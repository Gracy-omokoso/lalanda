// Import d'un fichier de tâches — ADR-0062, de bout en bout par l'API.
//
// Modèle téléchargeable, aperçu (rien n'est écrit), import d'un nouveau projet
// et dans un projet existant, droits (`work.manage` / `work.update`), isolation
// des organisations, fichier trop gros, refus quand des lignes sont en erreur.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from '../__tests__/e2e-utils.js';
import { useWorkFixture } from '../__tests__/work-e2e-fixtures.js';
import { WorkTasksService } from './work-tasks.service.js';

const csv = (lines: string[]) => Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');

e2eSuite('import d’un fichier de tâches (ADR-0062)', () => {
  const f = useWorkFixture('wimport');
  const upload = (who: Parameters<typeof f.postRaw>[0], path: string, body: Buffer) =>
    f
      .postRaw(who, path)
      .set('content-type', 'application/octet-stream')
      .set('x-file-name', 'plan.csv')
      .send(body);

  const fichier = () =>
    csv([
      'Section;Tâche;Responsable (e-mail);Début;Échéance;Priorité;Jalon;Dépend de;Étiquettes;Sous-tâche de;Estimation (heures)',
      `Préparation;Étudier les emplacements;wimport-analyst@inconnu.cd;02/11/2026;13/11/2026;Haute;Non;;Étude;;16`,
      'Préparation;Bail signé;;;27/11/2026;Urgente;Oui;2;Juridique;;',
      'Aménagement;Aménager la boutique;;30/11/2026;18/12/2026;Moyenne;Non;3;Travaux;;40',
      'Aménagement;Installer l’électricité;;30/11/2026;05/12/2026;Haute;Non;;Travaux;4;12',
      'Lancement;Ouverture;;;21/12/2026;Haute;Oui;4;;;',
    ]);

  it('modèle téléchargeable : .xlsx (zip) et .csv (BOM, « ; »)', async () => {
    const x = await f
      .get('viewer', '/work/import/template.xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const c = await f.get('viewer', '/work/import/template.csv');
    expect(c.status).toBe(200);
    expect(c.headers['content-type']).toContain('text/csv');
    expect(c.text).toContain('Section;Tâche;');
  });

  it('aperçu : lignes, erreurs ligne par ligne, compteurs — et rien n’est écrit', async () => {
    const body = csv([
      'Tâche;Responsable;Échéance;Dépend de',
      'A;inconnu@x.cd;10/01/2027;',
      'B;;31/02/2027;',
      'C;;;Z',
      'D;;;6',
      'E;;;5',
    ]);
    const before = await f.db().collection('work_projects').countDocuments();
    const res = await upload('analyst', '/work/import/preview', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.counts).toMatchObject({ rows: 5, valid: 4, invalid: 1 });
    const codes = (res.body.issues as { row: number; code: string; severity: string }[]).map(
      (i) => `${i.row}:${i.severity}:${i.code}`,
    );
    expect(codes).toContain('2:warning:IMPORT_ASSIGNEE_UNKNOWN');
    expect(codes).toContain('3:error:IMPORT_DATE_INVALID');
    expect(codes).toContain('4:warning:IMPORT_DEPENDENCY_UNKNOWN');
    expect(codes.some((c) => c.endsWith('WORK_DEPENDENCY_CYCLE'))).toBe(true);
    expect(await f.db().collection('work_projects').countDocuments()).toBe(before);
  });

  it('un lecteur ne peut ni prévisualiser ni importer ; un analyste ne crée pas de projet', async () => {
    expect((await upload('viewer', '/work/import/preview', fichier())).status).toBe(403);
    expect((await upload('analyst', '/work/import/projects?name=Boutique', fichier())).status).toBe(
      403,
    );
  });

  it('fichier trop gros : 413', async () => {
    const res = await upload(
      'owner',
      '/work/import/preview',
      Buffer.alloc(2 * 1024 * 1024 + 10, 0x41),
    );
    expect(res.status).toBe(413);
  });

  it('lignes en erreur : 422 sans confirmation, import des lignes valides avec skipInvalid', async () => {
    const body = csv(['Tâche;Échéance', 'Bonne;10/01/2027', 'Mauvaise;pas une date']);
    const refused = await upload('owner', '/work/import/projects?name=Avec%20erreurs', body);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('IMPORT_HAS_ERRORS');
    const ok = await upload(
      'owner',
      '/work/import/projects?name=Avec%20erreurs&skipInvalid=true',
      body,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.createdTasks).toBe(1);
  });

  let projectId = '';

  it('nouveau projet depuis le fichier : sections, sous-tâches, jalons, dépendances, étiquettes', async () => {
    const res = await upload(
      'owner',
      `/work/import/projects?name=${encodeURIComponent('Boutique Gombe')}&startDate=2026-11-02&dueDate=2026-12-31`,
      fichier(),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      projectName: 'Boutique Gombe',
      createdTasks: 4,
      createdSubtasks: 1,
      createdMilestones: 2,
      createdDependencies: 3,
    });
    expect(res.body.createdColumns).toEqual(['Préparation', 'Aménagement', 'Lancement']);
    projectId = res.body.projectId;

    const p = await f.get('owner', `/work/projects/${projectId}`);
    expect(p.body.columns.map((c: { label: string }) => c.label)).toEqual([
      'À faire',
      'En cours',
      'En revue',
      'Préparation',
      'Aménagement',
      'Lancement',
      'Terminé',
    ]);
    const t = await f.get('owner', `/work/projects/${projectId}/tasks`);
    const items = t.body.items as {
      title: string;
      parentTaskId: string | null;
      isMilestone: boolean;
      blockedBy: { taskId: string }[];
      estimateMinutes: number | null;
      assignee: unknown;
      labelKeys: string[];
    }[];
    expect(items).toHaveLength(5);
    const by = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(by['Installer l’électricité']!.parentTaskId).not.toBeNull();
    expect(by['Bail signé']!.isMilestone).toBe(true);
    expect(by['Étudier les emplacements']!.estimateMinutes).toBe(960);
    expect(by['Étudier les emplacements']!.assignee).toBeNull();
    expect(by['Ouverture']!.blockedBy).toHaveLength(1);
    const settings = await f.get('owner', '/work/settings');
    const keys = (settings.body.labels as { label: string }[]).map((l) => l.label);
    expect(keys).toEqual(expect.arrayContaining(['Étude', 'Juridique', 'Travaux']));
    const audit = await f
      .db()
      .collection('audit_events')
      .findOne({ action: 'work.plan.project_created', targetId: projectId });
    expect(audit?.['metadata']).toMatchObject({ origin: 'import', tasks: 4 });
  });

  it('importer des tâches dans un projet existant (work.update) ; section inconnue sans droit de gérer', async () => {
    const body = csv([
      'Section;Tâche;Étiquettes',
      'Préparation;Relire le bail;Juridique',
      'Nouvelle section;Autre;Inédite',
    ]);
    const pre = await upload('analyst', `/work/import/preview?projectId=${projectId}`, body);
    expect(pre.status).toBe(200);
    expect((pre.body.issues as { code: string }[]).map((i) => i.code)).toEqual(
      expect.arrayContaining(['IMPORT_SECTION_NOT_ALLOWED', 'IMPORT_LABEL_NOT_ALLOWED']),
    );
    const res = await upload('analyst', `/work/projects/${projectId}/import`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ createdTasks: 2, createdColumns: [], createdLabels: [] });
    const t = await f.get('owner', `/work/projects/${projectId}/tasks`);
    expect(t.body.items).toHaveLength(7);
  });

  it('isolation : le projet d’une autre organisation répond 404, à l’aperçu comme à l’import', async () => {
    expect(
      (await upload('ownerB', `/work/import/preview?projectId=${projectId}`, fichier())).status,
    ).toBe(404);
    expect((await upload('ownerB', `/work/projects/${projectId}/import`, fichier())).status).toBe(
      404,
    );
  });

  it('un responsable d’une autre organisation n’est jamais reconnu', async () => {
    const body = csv(['Tâche;Responsable', `A;wimport-ownerB-x@lalanda-test.local`]);
    const res = await upload('owner', '/work/import/preview', body);
    expect(res.body.rows[0].assignee).toBeNull();
  });

  it('responsable reconnu par e-mail d’un membre de l’organisation', async () => {
    const members = await f.get('owner', `/organizations/${f.orgId()}/members`);
    const analyst = (members.body.members as { role: string; email: string }[]).find(
      (m) => m.role === 'analyst',
    )!;
    const res = await upload(
      'owner',
      '/work/import/preview',
      csv(['Tâche;Responsable', `A;${analyst.email}`]),
    );
    expect(res.body.rows[0].assignee?.userId).toBe(f.userId('analyst'));
  });

  it('annulation propre : un échec en cours de création ne laisse pas de projet', async () => {
    const before = await f
      .db()
      .collection('work_projects')
      .countDocuments({ organizationId: f.orgId() });
    // Le propriétaire de l'organisation B n'est pas membre de A : refusé AVANT toute écriture.
    const res = await upload(
      'owner',
      `/work/import/projects?name=Refus&ownerUserId=${f.userId('ownerB')}`,
      csv(['Tâche', 'A']),
    );
    expect(res.status).toBe(404);
    expect(
      await f.db().collection('work_projects').countDocuments({ organizationId: f.orgId() }),
    ).toBe(before);
  });

  it('annulation propre : une panne au milieu des écritures retire le projet et ses tâches', async () => {
    const tasks = f.app().get(WorkTasksService);
    const original = tasks.addDependency.bind(tasks);
    tasks.addDependency = async () => {
      throw new Error('panne simulée');
    };
    try {
      const before = await f
        .db()
        .collection('work_projects')
        .countDocuments({ organizationId: f.orgId() });
      const beforeTasks = await f
        .db()
        .collection('work_tasks')
        .countDocuments({ organizationId: f.orgId() });
      const res = await upload('owner', '/work/import/projects?name=Panne', fichier());
      expect(res.status).toBe(500);
      expect(
        await f.db().collection('work_projects').countDocuments({ organizationId: f.orgId() }),
      ).toBe(before);
      expect(
        await f.db().collection('work_tasks').countDocuments({ organizationId: f.orgId() }),
      ).toBe(beforeTasks);
    } finally {
      tasks.addDependency = original;
    }
  });
});
