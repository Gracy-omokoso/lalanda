// Visibilité des projets, membres et équipes — ADR-0060 (frontière de sécurité).
//
// Un projet `private` n'existe pas pour qui n'en est pas membre (404, jamais 403) :
// un test par point d'entrée (liste, recherche, portefeuille, fiche, aperçu, tâches,
// détail, calendrier, Mes tâches, commentaires, pièces jointes, temps, historique,
// marge, membres, notifications, brief du matin). Accès par une équipe : donné aux
// membres COURANTS (rejoindre ouvre, quitter ferme, retirer l'équipe ferme). Projet
// `organization` inchangé ; direction (Propriétaire, Administrateur) voit tout ;
// isolation entre organisations ; rôle limité aux projets dont il est membre.
//
// Rôles du montage : owner, admin (direction) ; analyst (membre DIRECT du projet
// privé) ; viewer (membre par l'ÉQUIPE) ; accountant (hors projet : `work.read`,
// `work.update`, `sales.read`, `treasury.read`, `analytics.read`).

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { NO_OVERRIDES } from '../authz/permissions.js';
import { WorkAccessService } from '../work/work-access.service.js';
import { inScope, isProjectScopedRole } from '../work/work-access.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture, type WorkAccount } from './work-e2e-fixtures.js';

e2eSuite('projets privés, membres et équipes — ADR-0060', () => {
  const f = useWorkFixture('wvis');
  const today = kinshasaDayOf(new Date());
  const yesterday = addDays(today, -1);

  let teamId = '';
  let teamRevision = 0;
  let privateId = '';
  let orgProjectId = '';
  let taskId = '';
  let orgTaskId = '';
  let commentId = '';
  let attachmentId = '';
  let entryId = '';

  const ids = (res: { body: { items: { id: string }[] } }): string[] =>
    res.body.items.map((p) => p.id);

  /** Tous les points d'entrée d'un projet privé, pour un appelant donné. */
  async function statuses(who: WorkAccount): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const probe = async (name: string, req: Promise<{ status: number }>) => {
      out[name] = (await req).status;
    };
    await probe('fiche', f.get(who, `/work/projects/${privateId}`));
    await probe('aperçu', f.get(who, `/work/projects/${privateId}/overview`));
    await probe('tâches du projet', f.get(who, `/work/projects/${privateId}/tasks`));
    await probe('tâches filtrées', f.get(who, `/work/tasks?projectId=${privateId}`));
    await probe('détail de tâche', f.get(who, `/work/tasks/${taskId}`));
    await probe('historique projet', f.get(who, `/work/projects/${privateId}/activity`));
    await probe('historique tâche', f.get(who, `/work/tasks/${taskId}/activity`));
    await probe('commentaires', f.get(who, `/work/tasks/${taskId}/comments`));
    await probe('pièces de la tâche', f.get(who, `/work/tasks/${taskId}/attachments`));
    await probe('pièce jointe', f.get(who, `/work/attachments/${attachmentId}`));
    await probe('temps filtré', f.get(who, `/work/time-entries?projectId=${privateId}`));
    await probe('temps résumé', f.get(who, `/work/projects/${privateId}/time-summary`));
    await probe('marge', f.get(who, `/work/projects/${privateId}/margin`));
    await probe('membres', f.get(who, `/work/projects/${privateId}/members`));
    return out;
  }

  const allNotFound = (s: Record<string, number>) => {
    for (const [name, status] of Object.entries(s)) expect(status, name).toBe(404);
  };
  const allOk = (s: Record<string, number>) => {
    for (const [name, status] of Object.entries(s)) expect(status, name).toBe(200);
  };

  describe('équipes (RH)', () => {
    it('lecture large, gestion hr.manage ; membres = utilisateurs de l’organisation', async () => {
      const refused = await f.post('analyst', '/hr/teams', { name: 'Chantier' });
      expect(refused.status).toBe(403);

      const created = await f.post('owner', '/hr/teams', {
        name: 'Équipe chantier',
        description: 'Poseurs et chef de chantier',
        leadUserId: f.userId('viewer'),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      teamId = created.body.id;
      teamRevision = created.body.revision;
      // Le responsable compte parmi les membres.
      expect(created.body.members.map((m: { userId: string }) => m.userId)).toEqual([
        f.userId('viewer'),
      ]);

      const dup = await f.post('admin', '/hr/teams', { name: 'équipe CHANTIER' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('HR_TEAM_NAME_EXISTS');

      // Utilisateur d'une autre organisation : 404.
      const foreign = await f.post('owner', `/hr/teams/${teamId}/members`, {
        userIds: [f.userId('ownerB')],
      });
      expect(foreign.status).toBe(404);

      // Une autre organisation ne voit pas l'équipe.
      expect((await f.get('ownerB', `/hr/teams/${teamId}`)).status).toBe(404);
      expect((await f.get('ownerB', '/hr/teams')).body.items).toEqual([]);

      // Sélecteur des Projets (work.read).
      const picker = await f.get('viewer', '/work/teams');
      expect(picker.status).toBe(200);
      expect(picker.body.items).toEqual([{ teamId, name: 'Équipe chantier', memberCount: 1 }]);
    });
  });

  describe('préparation', () => {
    it('un projet privé (membre direct + équipe) et un projet de l’organisation', async () => {
      const p = await f.post('owner', '/work/projects', {
        name: 'Chantier confidentiel',
        kind: 'internal',
        visibility: 'private',
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      expect(p.body.visibility).toBe('private');
      privateId = p.body.id;

      const o = await f.post('owner', '/work/projects', {
        name: 'Chantier ouvert',
        kind: 'internal',
      });
      expect(o.status).toBe(201);
      expect(o.body.visibility).toBe('organization');
      orgProjectId = o.body.id;

      const add = await f.post('owner', `/work/projects/${privateId}/members`, {
        userIds: [f.userId('analyst')],
        teamIds: [teamId],
      });
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      expect(add.body.users.map((u: { userId: string }) => u.userId)).toContain(
        f.userId('analyst'),
      );
      expect(add.body.teams[0].members.map((m: { userId: string }) => m.userId)).toEqual([
        f.userId('viewer'),
      ]);
      // Le créateur d'un projet privé en est membre.
      expect(add.body.users.map((u: { userId: string }) => u.userId)).toContain(f.userId('owner'));

      f.notifications.length = 0;
      const t = await f.post('owner', `/work/projects/${privateId}/tasks`, {
        title: 'Poser le carrelage',
        dueDate: yesterday,
        assigneeUserId: f.userId('analyst'),
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      taskId = t.body.task.id;
      expect(f.notifications.map((n) => n.recipientUserId)).toContain(f.userId('analyst'));

      const ot = await f.post('owner', `/work/projects/${orgProjectId}/tasks`, {
        title: 'Tâche ouverte',
        dueDate: yesterday,
        assigneeUserId: f.userId('accountant'),
      });
      orgTaskId = ot.body.task.id;

      const c = await f.post('analyst', `/work/tasks/${taskId}/comments`, { body: 'Commencé.' });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      commentId = c.body.id;

      const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
      const a = await f
        .postRaw('analyst', `/work/tasks/${taskId}/attachments`)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', 'plan.pdf')
        .send(pdf);
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      attachmentId = a.body.id;

      const e = await f.post('analyst', `/work/tasks/${taskId}/time-entries`, {
        workedOn: yesterday,
        minutes: 90,
      });
      expect(e.status, JSON.stringify(e.body)).toBe(201);
      entryId = e.body.id;
    });
  });

  describe('hors projet : 404 partout, absent des listes', () => {
    it('chaque point d’entrée répond 404', async () => {
      allNotFound(await statuses('accountant'));
    });

    it('écritures : tâche, commentaire, saisie de temps, membres → 404', async () => {
      expect(
        (await f.patch('accountant', `/work/tasks/${taskId}`, { expectedRevision: 1, title: 'x' }))
          .status,
      ).toBe(404);
      expect(
        (await f.post('accountant', `/work/projects/${privateId}/tasks`, { title: 'Intrus' }))
          .status,
      ).toBe(404);
      expect(
        (
          await f.put('accountant', `/work/comments/${commentId}`, {
            expectedRevision: 1,
            body: 'x',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await f.put('accountant', `/work/time-entries/${entryId}`, {
            expectedRevision: 1,
            minutes: 10,
          })
        ).status,
      ).toBe(404);
    });

    it('liste et recherche des projets', async () => {
      const list = await f.get('accountant', '/work/projects');
      expect(ids(list)).toContain(orgProjectId);
      expect(ids(list)).not.toContain(privateId);
      const search = await f.get('accountant', '/work/projects?q=confidentiel');
      expect(search.body.items).toEqual([]);
    });

    it('portefeuille (accueil) : projet et chiffres', async () => {
      const outsider = await f.get('accountant', '/work/portfolio?scope=all');
      expect(outsider.status).toBe(200);
      expect(ids(outsider)).not.toContain(privateId);
      expect(outsider.body.stats.overdueTasks).toBe(1);
      const owner = await f.get('owner', '/work/portfolio?scope=all');
      expect(owner.body.stats.overdueTasks).toBe(2);
      const lock = (owner.body.items as { id: string; visibility: string }[]).find(
        (p) => p.id === privateId,
      );
      expect(lock?.visibility).toBe('private');
    });

    it('calendrier et liste transverse des tâches', async () => {
      const cal = await f.get('accountant', `/work/tasks?dueFrom=${yesterday}&dueTo=${today}`);
      expect(cal.status).toBe(200);
      const taskIds = (cal.body.items as { id: string }[]).map((t) => t.id);
      expect(taskIds).toContain(orgTaskId);
      expect(taskIds).not.toContain(taskId);
    });

    it('temps : la liste transverse exclut les saisies du projet privé', async () => {
      const time = await f.get('accountant', '/work/time-entries');
      expect((time.body.items as { id: string }[]).map((e) => e.id)).not.toContain(entryId);
    });

    it('notifications : l’intrus n’en reçoit aucune du projet privé', async () => {
      const res = await f.get('accountant', '/notifications');
      expect(
        (res.body.items as { source: { projectId?: string } }[]).filter(
          (n) => n.source.projectId === privateId,
        ),
      ).toEqual([]);
    });
  });

  describe('membres : accès complet', () => {
    it('membre direct et membre par l’équipe accèdent à tout', async () => {
      allOk(await statuses('analyst'));
      allOk(await statuses('viewer'));
    });

    it('direction : le Propriétaire et l’Administrateur voient le projet sans en être membres', async () => {
      allOk(await statuses('admin'));
      expect(ids(await f.get('admin', '/work/projects'))).toContain(privateId);
    });

    it('Mes tâches, notifications et brief du matin de l’assigné', async () => {
      const mine = await f.get('analyst', '/work/my-tasks');
      expect(mine.status).toBe(200);
      expect(JSON.stringify(mine.body)).toContain(taskId);
      const notes = await f.get('analyst', '/notifications');
      expect(
        (notes.body.items as { source: { projectId?: string } }[]).some(
          (n) => n.source.projectId === privateId,
        ),
      ).toBe(true);
      const brief = await f.get('analyst', '/morning-brief');
      const fact = (brief.body.brief.facts as { id: string; value: string | null }[]).find(
        (x) => x.id === 'mes_taches.en_retard',
      );
      expect(fact?.value).toBe('1');
    });
  });

  describe('accès dynamique par l’équipe', () => {
    it('rejoindre l’équipe ouvre le projet ; la quitter le ferme', async () => {
      allNotFound(await statuses('accountant'));
      const join = await f.post('owner', `/hr/teams/${teamId}/members`, {
        userIds: [f.userId('accountant')],
      });
      expect(join.status, JSON.stringify(join.body)).toBe(200);
      teamRevision = join.body.revision;
      allOk(await statuses('accountant'));
      expect(ids(await f.get('accountant', '/work/projects'))).toContain(privateId);

      const leave = await f.del('owner', `/hr/teams/${teamId}/members/${f.userId('accountant')}`);
      expect(leave.status).toBe(200);
      allNotFound(await statuses('accountant'));
    });

    it('retirer l’équipe du projet → ses membres perdent l’accès', async () => {
      allOk(await statuses('analyst'));
      const res = await f.del('owner', `/work/projects/${privateId}/members/teams/${teamId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.teams).toEqual([]);
      allNotFound(await statuses('viewer'));
      // L'équipe existe toujours côté RH.
      expect((await f.get('owner', `/hr/teams/${teamId}`)).status).toBe(200);
      expect(teamRevision).toBeGreaterThan(0);
    });

    it('retirer un membre direct : Mes tâches, notifications et brief se vident', async () => {
      const res = await f.del(
        'owner',
        `/work/projects/${privateId}/members/users/${f.userId('analyst')}`,
      );
      expect(res.status).toBe(200);
      allNotFound(await statuses('analyst'));
      const mine = await f.get('analyst', '/work/my-tasks');
      expect(JSON.stringify(mine.body)).not.toContain(taskId);
      const notes = await f.get('analyst', '/notifications');
      expect(
        (notes.body.items as { source: { projectId?: string } }[]).some(
          (n) => n.source.projectId === privateId,
        ),
      ).toBe(false);
      const count = await f.get('analyst', '/notifications/unread-count');
      expect(count.body.unread).toBe(
        (notes.body.items as { readAt: string | null }[]).filter((n) => n.readAt === null).length,
      );
      const brief = await f.get('analyst', '/morning-brief');
      const fact = (brief.body.brief.facts as { id: string; value: string | null }[]).find(
        (x) => x.id === 'mes_taches.en_retard',
      );
      expect(fact?.value).toBe('0');
    });

    it('une notification n’est jamais émise vers qui ne voit pas le projet', async () => {
      f.notifications.length = 0;
      const t = await f.post('owner', `/work/projects/${privateId}/tasks`, {
        title: 'Assignée à un non-membre',
        assigneeUserId: f.userId('accountant'),
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      expect(f.notifications.map((n) => n.recipientUserId)).not.toContain(f.userId('accountant'));
    });
  });

  describe('visibilité et isolation', () => {
    it('repasser le projet en « organisation » le rend visible ; défaut inchangé', async () => {
      const current = await f.get('owner', `/work/projects/${privateId}`);
      const res = await f.put('owner', `/work/projects/${privateId}`, {
        expectedRevision: current.body.revision,
        visibility: 'organization',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await f.get('accountant', `/work/projects/${privateId}`)).status).toBe(200);
      const back = await f.put('owner', `/work/projects/${privateId}`, {
        expectedRevision: res.body.revision,
        visibility: 'private',
      });
      expect(back.status).toBe(200);
      expect((await f.get('accountant', `/work/projects/${privateId}`)).status).toBe(404);
    });

    it('une autre organisation : 404 sur le projet, l’équipe, les membres', async () => {
      expect((await f.get('ownerB', `/work/projects/${privateId}`)).status).toBe(404);
      expect((await f.get('ownerB', `/work/projects/${orgProjectId}`)).status).toBe(404);
      const b = await f.post('ownerB', '/work/projects', { name: 'Projet B', kind: 'internal' });
      const foreignTeam = await f.post('ownerB', `/work/projects/${b.body.id}/members`, {
        teamIds: [teamId],
      });
      expect(foreignTeam.status).toBe(404);
      const foreignUser = await f.post('owner', `/work/projects/${orgProjectId}/members`, {
        userIds: [f.userId('ownerB')],
      });
      expect(foreignUser.status).toBe(404);
      expect((await f.get('ownerB', '/work/teams')).body.items).toEqual([]);
    });

    it('membre sans work.read : refusé comme membre de projet', async () => {
      const res = await f.post('owner', `/work/projects/${orgProjectId}/members`, {
        userIds: [f.userId('advisor')],
      });
      expect(res.status).toBe(400);
      expect(f.issueCodes(res)).toContain('WORK_MEMBER_NOT_ELIGIBLE');
    });

    it('gérer les membres exige work.manage', async () => {
      const res = await f.post('analyst', `/work/projects/${orgProjectId}/members`, {
        userIds: [f.userId('viewer')],
      });
      expect(res.status).toBe(403);
    });
  });

  describe('rôle limité aux projets dont il est membre (pont de fusion `guest`)', () => {
    it('isProjectScopedRole', () => {
      expect(isProjectScopedRole('guest')).toBe(true);
      expect(isProjectScopedRole('viewer')).toBe(false);
      expect(isProjectScopedRole('owner')).toBe(false);
    });

    it('un rôle limité ne voit que ses projets, même ceux de l’organisation', async () => {
      const access = f.app().get(WorkAccessService);
      const asGuest = (userId: string) =>
        access.scopeOf(f.orgId(), {
          userId,
          role: 'guest' as never,
          context: NO_OVERRIDES,
        });
      // L'Analyste a été retiré du projet privé : rien ne lui est ouvert.
      const none = await asGuest(f.userId('analyst'));
      expect(none.kind).toBe('allow');
      expect(inScope(none, privateId)).toBe(false);
      expect(inScope(none, orgProjectId)).toBe(false);
      // Membre direct du projet de l'organisation : seulement celui-là.
      await f.post('owner', `/work/projects/${orgProjectId}/members`, {
        userIds: [f.userId('analyst')],
      });
      const one = await asGuest(f.userId('analyst'));
      expect(inScope(one, orgProjectId)).toBe(true);
      expect(inScope(one, privateId)).toBe(false);
      // Le Lecteur est responsable de l'équipe (retirée du projet privé) : rien.
      expect(inScope(await asGuest(f.userId('viewer')), privateId)).toBe(false);
    });
  });
});
