// Projets du RUN, réglages, membres, RBAC et isolation — ADR-0039 (lot L1).
//
// Critères d'acceptation couverts : 1 (rôles), 2 (404 entre organisations, y
// compris par identifiant forgé dans un corps), colonnes et étiquettes en usage,
// archivage, suppression refusée quand du temps est saisi, historique.

import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const today = (): string => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

e2eSuite('projets du RUN — réglages, projets, RBAC, isolation (ADR-0039)', () => {
  const f = useWorkFixture('wproj');
  let projectId = '';
  let revision = 0;

  describe('réglages et membres', () => {
    it('réglages par défaut (révision 0), puis enregistrés par un gestionnaire', async () => {
      const def = await f.get('viewer', '/work/settings');
      expect(def.status).toBe(200);
      expect(def.body.revision).toBe(0);
      expect(def.body.dueSoonDays).toBe(1);
      expect(def.body.defaultColumns.map((c: { key: string }) => c.key)).toEqual([
        'todo',
        'doing',
        'review',
        'done',
      ]);

      const refused = await f.put('analyst', '/work/settings', { ...def.body });
      expect(refused.status).toBe(403);

      const put = await f.put('admin', '/work/settings', {
        expectedRevision: 0,
        labels: [
          { key: 'urgent', label: 'Urgent', color: 'red' },
          { key: 'client', label: 'Client', color: 'blue' },
        ],
        defaultColumns: def.body.defaultColumns,
        dueSoonDays: 2,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.revision).toBe(1);

      const stale = await f.put('admin', '/work/settings', {
        expectedRevision: 0,
        labels: [],
        defaultColumns: def.body.defaultColumns,
        dueSoonDays: 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_REVISION');

      const color = await f.put('admin', '/work/settings', {
        expectedRevision: 1,
        labels: [{ key: 'x', label: 'X', color: '#ff0000' }],
        defaultColumns: def.body.defaultColumns,
        dueSoonDays: 1,
      });
      expect(color.status).toBe(400);
    });

    it('membres proposés : détenteurs de work.read seulement, sans le Conseiller', async () => {
      const res = await f.get('viewer', '/work/members');
      expect(res.status).toBe(200);
      const ids = (res.body.items as { userId: string; canUpdate: boolean }[]).map((m) => m.userId);
      expect(ids).toContain(f.userId('viewer'));
      expect(ids).not.toContain(f.userId('advisor'));
      const viewer = (res.body.items as { userId: string; canUpdate: boolean }[]).find(
        (m) => m.userId === f.userId('viewer'),
      );
      expect(viewer?.canUpdate).toBe(false);
    });
  });

  describe('projets', () => {
    it('critère 1 : le Lecteur lit, l’Analyste ne crée pas de projet, le Conseiller ne lit pas', async () => {
      expect((await f.get('viewer', '/work/projects')).status).toBe(200);
      const advisor = await f.get('advisor', '/work/projects');
      expect(advisor.status).toBe(403);
      expect(advisor.body.action).toBe('work.read');
      const analyst = await f.post('analyst', '/work/projects', { name: 'X', kind: 'internal' });
      expect(analyst.status).toBe(403);
      expect(analyst.body.action).toBe('work.manage');
    });

    it('crée un projet avec les colonnes des réglages ; dates inversées refusées', async () => {
      const inverted = await f.post('owner', '/work/projects', {
        name: 'Inversé',
        kind: 'internal',
        startDate: '2026-11-10',
        dueDate: '2026-11-01',
      });
      expect(inverted.status).toBe(400);
      expect(f.issueCodes(inverted)).toContain('WORK_DATES_INVERTED');

      const res = await f.post('owner', '/work/projects', {
        name: 'Chantier Gombe',
        kind: 'client',
        description: 'Rénovation',
        ownerUserId: f.userId('admin'),
        startDate: '2026-11-01',
        dueDate: '2026-12-15',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.columns).toHaveLength(4);
      expect(res.body.owner.userId).toBe(f.userId('admin'));
      expect(res.body.visibility).toBe('organization');
      projectId = res.body.id;
      revision = res.body.revision;
    });

    it('responsable sans work.update : 400 ; membre d’une autre organisation : 404', async () => {
      const viewer = await f.post('owner', '/work/projects', {
        name: 'P',
        kind: 'internal',
        ownerUserId: f.userId('viewer'),
      });
      expect(viewer.status).toBe(400);
      expect(f.issueCodes(viewer)).toContain('WORK_ASSIGNEE_NOT_ELIGIBLE');
      const foreign = await f.post('owner', '/work/projects', {
        name: 'P',
        kind: 'internal',
        ownerUserId: f.userId('ownerB'),
      });
      expect(foreign.status).toBe(404);
    });

    it('critère 2 : un client d’une autre organisation, forgé dans le corps, répond 404', async () => {
      const c = await f.post('ownerB', '/sales/customers', {
        type: 'PP',
        name: 'Client de B',
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const res = await f.post('owner', '/work/projects', {
        name: 'Forgé',
        kind: 'client',
        links: { customerId: c.body.id },
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('critère 2 : le projet est introuvable depuis l’organisation B', async () => {
      expect((await f.get('ownerB', `/work/projects/${projectId}`)).status).toBe(404);
      expect((await f.get('ownerB', `/work/projects/${projectId}/tasks`)).status).toBe(404);
      const put = await f.put('ownerB', `/work/projects/${projectId}`, {
        expectedRevision: revision,
        name: 'Piraté',
      });
      expect(put.status).toBe(404);
      const list = await f.get('ownerB', '/work/projects');
      expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(projectId);
    });

    it('liste avec compteurs : tâches ouvertes, en retard, prochain jalon', async () => {
      const t1 = await f.post('analyst', `/work/projects/${projectId}/tasks`, {
        title: 'En retard',
        dueDate: '2026-01-05',
      });
      expect(t1.status, JSON.stringify(t1.body)).toBe(201);
      const m = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Réception',
        isMilestone: true,
        dueDate: '2099-12-01',
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const list = await f.get('viewer', '/work/projects?q=gombe');
      expect(list.status).toBe(200);
      const row = list.body.items.find((p: { id: string }) => p.id === projectId);
      expect(row.openTaskCount).toBe(2);
      expect(row.overdueTaskCount).toBe(1);
      expect(row.nextMilestone.title).toBe('Réception');
      expect(list.body.nextCursor).toBeNull();
    });

    it('colonnes : retirer une colonne qui porte des tâches est refusé (409)', async () => {
      const current = await f.get('owner', `/work/projects/${projectId}`);
      revision = current.body.revision;
      const removeTodo = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: revision,
        columns: [
          { key: 'doing', label: 'En cours', category: 'todo' },
          { key: 'done', label: 'Terminé', category: 'done' },
        ],
      });
      expect(removeTodo.status).toBe(409);
      expect(removeTodo.body.code).toBe('WORK_COLUMN_IN_USE');

      const category = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: revision,
        columns: [
          { key: 'todo', label: 'À faire', category: 'in_progress' },
          { key: 'start', label: 'Départ', category: 'todo' },
          { key: 'done', label: 'Terminé', category: 'done' },
        ],
      });
      expect(category.status).toBe(409);
      expect(category.body.code).toBe('WORK_COLUMN_CATEGORY_CHANGED');

      const rename = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: revision,
        columns: [
          { key: 'todo', label: 'Backlog', category: 'todo' },
          { key: 'doing', label: 'En cours', category: 'in_progress' },
          { key: 'done', label: 'Fini', category: 'done' },
        ],
      });
      expect(rename.status, JSON.stringify(rename.body)).toBe(200);
      expect(rename.body.columns).toHaveLength(3);
      revision = rename.body.revision;

      const stale = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: revision - 1,
        name: 'X',
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('STALE_REVISION');
    });

    it('étiquette posée sur une tâche : la retirer des réglages est refusé', async () => {
      const t = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Étiquetée',
        labelKeys: ['urgent'],
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const unknown = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Étiquette inconnue',
        labelKeys: ['inconnue'],
      });
      expect(unknown.status).toBe(400);
      expect(f.issueCodes(unknown)).toContain('WORK_LABEL_UNKNOWN');

      const settings = await f.get('owner', '/work/settings');
      const res = await f.put('owner', '/work/settings', {
        expectedRevision: settings.body.revision,
        labels: [{ key: 'client', label: 'Client', color: 'blue' }],
        defaultColumns: settings.body.defaultColumns,
        dueSoonDays: settings.body.dueSoonDays,
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORK_LABEL_IN_USE');
      expect(res.body.details.taskCount).toBe(1);
    });

    it('archiver masque le projet et gèle ses tâches ; restaurer le rend', async () => {
      const arch = await f.post('admin', `/work/projects/${projectId}/archive`, {
        expectedRevision: revision,
      });
      expect(arch.status, JSON.stringify(arch.body)).toBe(200);
      expect(arch.body.status).toBe('archived');
      const list = await f.get('owner', '/work/projects');
      expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(projectId);
      const archived = await f.get('owner', '/work/projects?status=archived');
      expect(archived.body.items.map((p: { id: string }) => p.id)).toContain(projectId);

      const write = await f.post('owner', `/work/projects/${projectId}/tasks`, { title: 'Non' });
      expect(write.status).toBe(409);
      expect(write.body.code).toBe('WORK_PROJECT_ARCHIVED');

      const restored = await f.post('admin', `/work/projects/${projectId}/restore`, {
        expectedRevision: arch.body.revision,
      });
      expect(restored.status).toBe(200);
      expect(restored.body.status).toBe('active');
      revision = restored.body.revision;
    });

    it('suppression : refusée quand du temps est saisi (archiver), permise sinon', async () => {
      const tasks = await f.get('owner', `/work/projects/${projectId}/tasks`);
      const taskId = tasks.body.items[0].id as string;
      const time = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: today(),
        minutes: 30,
      });
      expect(time.status, JSON.stringify(time.body)).toBe(201);
      const refused = await f.del('owner', `/work/projects/${projectId}`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('WORK_PROJECT_NOT_EMPTY');

      const empty = await f.post('owner', '/work/projects', { name: 'Vide', kind: 'internal' });
      const viewerDel = await f.del('viewer', `/work/projects/${empty.body.id}`);
      expect(viewerDel.status).toBe(403);
      const del = await f.del('owner', `/work/projects/${empty.body.id}`);
      expect(del.status).toBe(204);
      expect((await f.get('owner', `/work/projects/${empty.body.id}`)).status).toBe(404);
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ action: 'work.project.deleted', targetId: empty.body.id });
      expect(audit).not.toBeNull();
    });

    it('historique du projet : création, archivage, restauration, paginé', async () => {
      const res = await f.get('viewer', `/work/projects/${projectId}/activity?limit=100`);
      expect(res.status).toBe(200);
      const kinds = (res.body.items as { kind: string }[]).map((a) => a.kind);
      expect(kinds).toEqual(
        expect.arrayContaining([
          'project.created',
          'project.archived',
          'project.restored',
          'task.created',
          'time.logged',
        ]),
      );
      const page = await f.get('viewer', `/work/projects/${projectId}/activity?limit=1`);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.nextCursor).toEqual(expect.any(String));
      const bad = await f.get('viewer', `/work/projects/${projectId}/activity?cursor=abc`);
      expect(bad.status).toBe(400);
    });
  });
});
