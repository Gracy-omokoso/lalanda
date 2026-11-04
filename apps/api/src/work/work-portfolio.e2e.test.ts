// Accueil des projets (portefeuille) et parcours d'équipe — ADR-0058.
//
// 1. Parcours d'équipe, de bout en bout par l'API : la dirigeante invite un
//    membre → il crée son compte et accepte → il est proposé comme responsable →
//    on lui assigne une tâche → il la voit dans « Mes tâches » et reçoit la
//    notification in-app → il la termine ; mention en commentaire. Le piège du
//    rôle par défaut de l'invitation (« Lecteur », sans `work.update`) est fixé
//    par un test : un Lecteur ne peut pas être responsable d'une tâche.
//
// Aucun e-mail réel : sans `ZEPTOMAIL_TOKEN` ni `SMTP_HOST`, le transport
// journalise (mail.transport.ts) ; le jeton d'invitation est lu dans la réponse.

import 'reflect-metadata';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { e2eSuite, registerAndLogin } from '../__tests__/e2e-utils.js';
import { useWorkFixture } from '../__tests__/work-e2e-fixtures.js';

/** Jour de Kinshasa (UTC+1, sans heure d'été). */
const kinshasaDay = (offsetDays = 0): string =>
  new Date(Date.now() + 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

interface NotificationRow {
  kind: string;
  title: string;
  href: string;
  readAt: string | null;
}

e2eSuite('parcours d’équipe et portefeuille des projets (ADR-0058)', () => {
  const f = useWorkFixture('wportf');

  describe('parcours d’équipe : inviter, accepter, assigner, voir, notifier', () => {
    const tag = Math.random().toString(16).slice(2, 8);
    const membre = {
      email: `wportf-membre-${tag}@lalanda-test.local`,
      password: 'Passw0rd!equipe',
      name: 'Bea Kanku',
    };
    let cookies: string[] = [];
    let membreId = '';
    let projectId = '';
    let taskId = '';
    const as = (): string[] => [...cookies, `active_org_id=${f.orgId()}`];

    it('la dirigeante invite un membre « Analyste » ; aucun e-mail réel, jeton rendu', async () => {
      const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, {
        email: membre.email,
        role: 'analyst',
      });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(typeof inv.body.token).toBe('string');

      cookies = await registerAndLogin(f.app(), membre);
      const pending = await request(f.app().getHttpServer())
        .get('/invitations/pending')
        .set('Cookie', cookies);
      expect(pending.status).toBe(200);
      expect(pending.body.invitations).toHaveLength(1);

      const acc = await request(f.app().getHttpServer())
        .post('/invitations/accept')
        .set('Cookie', cookies)
        .send({ token: inv.body.token });
      expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    });

    it('le nouveau membre est proposé comme responsable (work.update)', async () => {
      const res = await f.get('owner', '/work/members');
      expect(res.status).toBe(200);
      const m = (res.body.items as { userId: string; name: string; canUpdate: boolean }[]).find(
        (x) => x.name === membre.name,
      );
      expect(m?.canUpdate).toBe(true);
      membreId = m!.userId;
    });

    it('un projet est créé, une tâche lui est assignée pour aujourd’hui', async () => {
      const p = await f.post('owner', '/work/projects', {
        name: 'Lancement boutique Gombe',
        kind: 'internal',
        ownerUserId: f.userId('owner'),
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      projectId = p.body.id;

      f.notifications.length = 0;
      const t = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Préparer les visuels',
        assigneeUserId: membreId,
        dueDate: kinshasaDay(),
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      taskId = t.body.task.id;
      expect(
        f.notifications.filter(
          (n) => n.kind === 'work.task_assigned' && n.recipientUserId === membreId,
        ),
      ).toHaveLength(1);
    });

    it('il voit la tâche dans « Mes tâches » (Aujourd’hui) et le projet dans son portefeuille', async () => {
      const mine = await request(f.app().getHttpServer()).get('/work/my-tasks').set('Cookie', as());
      expect(mine.status).toBe(200);
      expect((mine.body.today as { id: string }[]).map((t) => t.id)).toContain(taskId);

      const pf = await request(f.app().getHttpServer())
        .get('/work/portfolio?scope=mine')
        .set('Cookie', as());
      expect(pf.status, JSON.stringify(pf.body)).toBe(200);
      expect((pf.body.items as { id: string }[]).map((p) => p.id)).toContain(projectId);
    });

    it('il reçoit la notification in-app, qui mène à la tâche', async () => {
      const res = await request(f.app().getHttpServer()).get('/notifications').set('Cookie', as());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const n = (res.body.items as NotificationRow[]).find((x) => x.kind === 'work.task_assigned');
      expect(n).toBeDefined();
      expect(n!.readAt).toBeNull();
      expect(n!.href).toContain(projectId);
      expect(n!.href).toContain(taskId);
      const count = await request(f.app().getHttpServer())
        .get('/notifications/unread-count')
        .set('Cookie', as());
      expect(count.body.unread).toBeGreaterThanOrEqual(1);
    });

    it('il est mentionné en commentaire puis termine la tâche', async () => {
      f.notifications.length = 0;
      const c = await f.post('owner', `/work/tasks/${taskId}/comments`, {
        body: `@[${membreId}] les visuels pour demain ?`,
        mentionedUserIds: [membreId],
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect(
        f.notifications.filter(
          (n) => n.kind === 'work.mentioned' && n.recipientUserId === membreId,
        ),
      ).toHaveLength(1);

      const detail = await request(f.app().getHttpServer())
        .get(`/work/tasks/${taskId}`)
        .set('Cookie', as());
      const done = await request(f.app().getHttpServer())
        .post(`/work/tasks/${taskId}/complete`)
        .set('Cookie', as())
        .send({ expectedRevision: detail.body.revision });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.task.done).toBe(true);

      const mine = await request(f.app().getHttpServer()).get('/work/my-tasks').set('Cookie', as());
      expect((mine.body.today as { id: string }[]).map((t) => t.id)).not.toContain(taskId);
    });

    it('piège du rôle par défaut : un Lecteur ne peut pas être responsable d’une tâche', async () => {
      const res = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Tâche pour un Lecteur',
        assigneeUserId: f.userId('viewer'),
      });
      expect(res.status).toBe(400);
      expect(f.issueCodes(res)).toContain('WORK_ASSIGNEE_NOT_ELIGIBLE');
    });
  });
  describe('portefeuille : GET /work/portfolio', () => {
    const ids: Record<string, string> = {};

    it('prépare trois projets : en bonne voie, à risque, en retard ; un archivé', async () => {
      const mk = async (name: string, body: Record<string, unknown> = {}) => {
        const r = await f.post('owner', '/work/projects', { name, kind: 'internal', ...body });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return r.body.id as string;
      };
      const task = async (projectId: string, body: Record<string, unknown>) => {
        const r = await f.post('owner', `/work/projects/${projectId}/tasks`, body);
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return r.body.task as { id: string; revision: number };
      };
      ids.ok = await mk('Bonne voie', { dueDate: kinshasaDay(30) });
      const t = await task(ids.ok, { title: 'Faite', assigneeUserId: f.userId('analyst') });
      const done = await f.post('owner', `/work/tasks/${t.id}/complete`, {
        expectedRevision: t.revision,
      });
      expect(done.status).toBe(200);
      await task(ids.ok, { title: 'Ouverte', dueDate: kinshasaDay(5) });

      ids.risk = await mk('À risque');
      await task(ids.risk, {
        title: 'Jalon dépassé',
        isMilestone: true,
        dueDate: kinshasaDay(-2),
      });

      ids.late = await mk('En retard', { startDate: kinshasaDay(-20), dueDate: kinshasaDay(-1) });
      await task(ids.late, { title: 'Reste', dueDate: kinshasaDay(-3) });

      ids.archived = await mk('Ancien');
      const p = await f.get('owner', `/work/projects/${ids.archived}`);
      const a = await f.post('owner', `/work/projects/${ids.archived}/archive`, {
        expectedRevision: p.body.revision,
      });
      expect(a.status).toBe(200);
    });

    it('santé, avancement, membres et couleur calculés par le serveur', async () => {
      const res = await f.get('viewer', '/work/portfolio');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.scope).toBe('all');
      const by = new Map(
        (res.body.items as { id: string }[]).map((p) => [p.id, p as Record<string, unknown>]),
      );
      expect(by.has(ids.archived!)).toBe(false);
      const ok = by.get(ids.ok!)!;
      expect(ok.health).toBe('on_track');
      expect(ok.totalTaskCount).toBe(2);
      expect(ok.doneTaskCount).toBe(1);
      expect(ok.progressPercent).toBe(50);
      expect((ok.members as { userId: string }[]).map((m) => m.userId)).toEqual([
        f.userId('analyst'),
      ]);
      expect(typeof ok.color).toBe('string');
      expect(by.get(ids.risk!)!.health).toBe('at_risk');
      expect(by.get(ids.risk!)!.overdueMilestoneCount).toBe(1);
      expect(by.get(ids.late!)!.health).toBe('late');
      expect(res.body.stats.activeProjects).toBeGreaterThanOrEqual(3);
      expect(res.body.stats.overdueTasks).toBeGreaterThanOrEqual(2);
      expect(res.body.stats.completedThisWeek).toBeGreaterThanOrEqual(1);
    });

    it('« Mes projets » : responsable, assigné ou abonné seulement', async () => {
      const mine = await f.get('analyst', '/work/portfolio?scope=mine');
      expect(mine.status).toBe(200);
      const got = (mine.body.items as { id: string; mine: boolean }[]).map((p) => p.id);
      expect(got).toContain(ids.ok);
      expect(got).not.toContain(ids.risk);
      expect((mine.body.items as { mine: boolean }[]).every((p) => p.mine)).toBe(true);
    });

    it('« Archivés » : seulement les projets archivés, santé fermée', async () => {
      const res = await f.get('owner', '/work/portfolio?scope=archived');
      expect(res.status).toBe(200);
      const items = res.body.items as { id: string; health: string }[];
      expect(items.map((p) => p.id)).toEqual([ids.archived]);
      expect(items[0]!.health).toBe('closed');
    });

    it('droits : le Conseiller (sans work.read) est refusé ; filtre inconnu 400', async () => {
      const advisor = await f.get('advisor', '/work/portfolio');
      expect(advisor.status).toBe(403);
      expect(advisor.body.action).toBe('work.read');
      expect((await f.get('owner', '/work/portfolio?scope=tout')).status).toBe(400);
    });

    it('isolation : une autre organisation ne voit rien et ses chiffres sont à zéro', async () => {
      const res = await f.get('ownerB', '/work/portfolio');
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.stats).toMatchObject({
        activeProjects: 0,
        overdueTasks: 0,
        completedThisWeek: 0,
      });
      // Organisation active forgée en cookie vers A depuis B : la garde ne retient
      // qu'une organisation dont l'appelant est membre ; aucun projet de A ne sort.
      const forged = await request(f.app().getHttpServer())
        .get('/work/portfolio')
        .set('Cookie', [...f.as('ownerB').slice(0, -1), `active_org_id=${f.orgId()}`]);
      if (forged.status === 200) expect(forged.body.items).toEqual([]);
      else expect([403, 404]).toContain(forged.status);
    });
  });
});
