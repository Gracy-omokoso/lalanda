// Heures de début et d'échéance, fuseau de l'organisation — ADR-0080.
//
// Couvre : réglage du fuseau (paramètres de l'organisation, servi avec les
// réglages des Projets), création et modification avec heure (projets, tâches,
// jalons), refus (heure sans date, format, échéance avant le début le même
// jour, jalon avec heure de début), « en retard » à l'heure exacte dans le
// fuseau de l'organisation (« Mes tâches », compteurs), rappel « échéance dans
// 1 h » et retard à l'heure (une seule fois, échéance changée → nouveau),
// isolation entre organisations.

import 'reflect-metadata';

import { orgClock } from '@lalanda/shared/work';
import { describe, expect, it } from 'vitest';

import { WorkDueRemindersJob } from '../work/work-reminders.job.js';
import { WorkTasksService } from '../work/work-tasks.service.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

interface Task {
  id: string;
  revision: number;
  startDate: string | null;
  dueDate: string | null;
  startTime: string | null;
  dueTime: string | null;
}

e2eSuite('heures de début et d’échéance, fuseau de l’organisation (ADR-0080)', () => {
  const f = useWorkFixture('wheure');
  let projectId = '';

  async function task(body: Record<string, unknown>): Promise<Task> {
    const res = await f.post('owner', `/work/projects/${projectId}/tasks`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.task as Task;
  }

  async function fuseau(who: 'owner' | 'ownerB', value: string): Promise<void> {
    const cur = await f.get(who, '/organizations/current/settings');
    expect(cur.status).toBe(200);
    const res = await f.put(who, '/organizations/current/settings', {
      name: cur.body.name,
      pays: cur.body.pays,
      deviseAffichage: cur.body.deviseAffichage,
      fuseauHoraire: value,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fuseauHoraire).toBe(value);
  }

  describe('fuseau de l’organisation', () => {
    it('Kinshasa par défaut, deux fuseaux proposés, servi avec les réglages des Projets', async () => {
      const s = await f.get('owner', '/organizations/current/settings');
      expect(s.status).toBe(200);
      expect(s.body.fuseauHoraire).toBe('Africa/Kinshasa');
      expect(s.body.options.timeZones.map((z: { value: string }) => z.value)).toEqual([
        'Africa/Kinshasa',
        'Africa/Lubumbashi',
      ]);
      const w = await f.get('viewer', '/work/settings');
      expect(w.status).toBe(200);
      expect(w.body.timeZone).toBe('Africa/Kinshasa');
    });

    it('fuseau inconnu refusé ; absent du corps → inchangé ; réservé à organization.manage', async () => {
      const cur = await f.get('owner', '/organizations/current/settings');
      const base = { name: cur.body.name, pays: cur.body.pays, deviseAffichage: 'USD' };
      const ko = await f.put('owner', '/organizations/current/settings', {
        ...base,
        fuseauHoraire: 'Europe/Paris',
      });
      expect(ko.status).toBe(400);
      await fuseau('owner', 'Africa/Lubumbashi');
      const sans = await f.put('owner', '/organizations/current/settings', base);
      expect(sans.status).toBe(200);
      expect(sans.body.fuseauHoraire).toBe('Africa/Lubumbashi');
      expect((await f.get('analyst', '/work/settings')).body.timeZone).toBe('Africa/Lubumbashi');
      const analyst = await f.put('analyst', '/organizations/current/settings', {
        ...base,
        fuseauHoraire: 'Africa/Kinshasa',
      });
      expect(analyst.status).toBe(403);
      await fuseau('owner', 'Africa/Kinshasa');
    });

    it('isolation : le fuseau d’une organisation ne touche pas l’autre', async () => {
      await fuseau('ownerB', 'Africa/Lubumbashi');
      expect((await f.get('owner', '/work/settings')).body.timeZone).toBe('Africa/Kinshasa');
      expect((await f.get('ownerB', '/work/settings')).body.timeZone).toBe('Africa/Lubumbashi');
    });
  });

  describe('projets', () => {
    it('crée un projet avec heures ; sans heure, comportement inchangé', async () => {
      const p = await f.post('owner', '/work/projects', {
        name: 'Lancement',
        kind: 'internal',
        startDate: '2030-01-10',
        startTime: '08:30',
        dueDate: '2030-01-31',
        dueTime: '17:00',
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      expect(p.body).toMatchObject({ startTime: '08:30', dueTime: '17:00' });
      projectId = p.body.id;

      const sans = await f.post('owner', '/work/projects', {
        name: 'Sans heure',
        kind: 'internal',
        dueDate: '2030-01-31',
      });
      expect(sans.status).toBe(201);
      expect(sans.body).toMatchObject({ dueDate: '2030-01-31', startTime: null, dueTime: null });
    });

    it('refuse une heure sans date, un format faux et une échéance avant le début le même jour', async () => {
      const sansDate = await f.post('owner', '/work/projects', {
        name: 'X',
        kind: 'internal',
        dueTime: '10:00',
      });
      expect(sansDate.status).toBe(400);
      expect(f.issueCodes(sansDate)).toContain('WORK_TIME_WITHOUT_DATE');
      const format = await f.post('owner', '/work/projects', {
        name: 'X',
        kind: 'internal',
        dueDate: '2030-01-31',
        dueTime: '5pm',
      });
      expect(format.status).toBe(400);
      expect(f.issueCodes(format)).toContain('WORK_TIME_INVALID');
      const inverse = await f.post('owner', '/work/projects', {
        name: 'X',
        kind: 'internal',
        startDate: '2030-01-31',
        startTime: '18:00',
        dueDate: '2030-01-31',
        dueTime: '17:00',
      });
      expect(inverse.status).toBe(400);
      expect(f.issueCodes(inverse)).toContain('WORK_DATES_INVERTED');
    });

    it('modifier : effacer l’échéance efface son heure ; inversion contre l’état stocké refusée', async () => {
      const p = await f.post('owner', '/work/projects', {
        name: 'Modif',
        kind: 'internal',
        startDate: '2030-02-01',
        startTime: '09:00',
        dueDate: '2030-02-01',
        dueTime: '18:00',
      });
      const inv = await f.put('owner', `/work/projects/${p.body.id}`, {
        expectedRevision: p.body.revision,
        dueTime: '08:00',
      });
      expect(inv.status).toBe(400);
      expect(f.issueCodes(inv)).toContain('WORK_DATES_INVERTED');
      const clear = await f.put('owner', `/work/projects/${p.body.id}`, {
        expectedRevision: p.body.revision,
        dueDate: null,
      });
      expect(clear.status, JSON.stringify(clear.body)).toBe(200);
      expect(clear.body).toMatchObject({ dueDate: null, dueTime: null, startTime: '09:00' });
    });
  });

  describe('tâches et jalons', () => {
    it('crée et modifie l’heure d’une tâche ; l’heure seule ; refus contre l’état stocké', async () => {
      const t = await task({ title: 'Remise', dueDate: '2030-01-15', dueTime: '14:00' });
      expect(t).toMatchObject({ dueDate: '2030-01-15', dueTime: '14:00', startTime: null });
      const heure = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        dueTime: '16:30',
      });
      expect(heure.status, JSON.stringify(heure.body)).toBe(200);
      expect(heure.body.task.dueTime).toBe('16:30');
      // Historique : l'échéance a changé (jour inchangé, heure changée).
      const rev = heure.body.task.revision;
      const sansJour = await task({ title: 'Sans jour' });
      const ko = await f.patch('owner', `/work/tasks/${sansJour.id}`, {
        expectedRevision: sansJour.revision,
        dueTime: '10:00',
      });
      expect(ko.status).toBe(400);
      expect(f.issueCodes(ko)).toContain('WORK_TIME_WITHOUT_DATE');
      const clear = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: rev,
        dueDate: null,
      });
      expect(clear.status).toBe(200);
      expect(clear.body.task).toMatchObject({ dueDate: null, dueTime: null });
    });

    it('jalon : heure d’échéance permise, heure de début refusée', async () => {
      const j = await task({
        title: 'Livraison',
        isMilestone: true,
        dueDate: '2030-01-20',
        dueTime: '12:00',
      });
      expect(j.dueTime).toBe('12:00');
      const ko = await f.post('owner', `/work/projects/${projectId}/tasks`, {
        title: 'Jalon faux',
        isMilestone: true,
        dueDate: '2030-01-20',
        startTime: '08:00',
      });
      expect(ko.status).toBe(400);
      expect(f.issueCodes(ko)).toContain('WORK_MILESTONE_HAS_START');
    });

    it('isolation : une autre organisation ne lit ni ne modifie la tâche', async () => {
      const t = await task({ title: 'Privée', dueDate: '2030-01-15', dueTime: '09:00' });
      expect((await f.get('ownerB', `/work/tasks/${t.id}`)).status).toBe(404);
      const patch = await f.patch('ownerB', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        dueTime: '10:00',
      });
      expect(patch.status).toBe(404);
    });
  });

  describe('en retard à l’heure exacte, dans le fuseau de l’organisation', () => {
    it('« Mes tâches » : 10 h passées → en retard ; sans heure → aujourd’hui ; Lubumbashi avance l’heure', async () => {
      const analyst = f.userId('analyst');
      await task({
        title: 'H10',
        dueDate: '2030-03-05',
        dueTime: '10:00',
        assigneeUserId: analyst,
      });
      await task({
        title: 'H16',
        dueDate: '2030-03-05',
        dueTime: '16:00',
        assigneeUserId: analyst,
      });
      await task({ title: 'Journée', dueDate: '2030-03-05', assigneeUserId: analyst });
      const service = f.app().get(WorkTasksService);
      const actor = { userId: analyst, role: 'analyst' as const, context: {} };
      // 09:30 UTC = 10:30 à Kinshasa = 11:30 à Lubumbashi.
      const at = new Date('2030-03-05T09:30:00Z');
      const titres = (xs: { title?: string }[]) => xs.map((x) => x.title);

      const kin = await service.myTasks(f.orgId(), actor, at);
      expect(kin).toMatchObject({
        asOf: '2030-03-05',
        asOfTime: '10:30',
        timeZone: 'Africa/Kinshasa',
      });
      expect(titres(kin.overdue)).toContain('H10');
      expect(titres(kin.today)).toEqual(expect.arrayContaining(['H16', 'Journée']));
      expect(titres(kin.today)).not.toContain('H10');

      // 08:30 UTC = 09:30 à Kinshasa (pas encore 10 h) mais 10:30 à Lubumbashi.
      const avant = new Date('2030-03-05T08:30:00Z');
      expect(titres((await service.myTasks(f.orgId(), actor, avant)).overdue)).not.toContain('H10');
      await fuseau('owner', 'Africa/Lubumbashi');
      const est = await service.myTasks(f.orgId(), actor, avant);
      expect(est.timeZone).toBe('Africa/Lubumbashi');
      expect(titres(est.overdue)).toContain('H10');
      await fuseau('owner', 'Africa/Kinshasa');
    });

    it('compteurs de la liste des projets : une échéance à l’heure passée compte en retard', async () => {
      const now = orgClock(new Date(), 'Africa/Kinshasa');
      const p = await f.post('owner', '/work/projects', { name: 'Compteurs', kind: 'internal' });
      const t = await f.post('owner', `/work/projects/${p.body.id}/tasks`, {
        title: 'Minuit',
        dueDate: now.today,
        dueTime: '00:00',
      });
      expect(t.status).toBe(201);
      await f.post('owner', `/work/projects/${p.body.id}/tasks`, {
        title: 'Journée',
        dueDate: now.today,
      });
      const list = await f.get('owner', '/work/projects?limit=100');
      const row = (list.body.items as { id: string; overdueTaskCount: number }[]).find(
        (x) => x.id === p.body.id,
      );
      expect(row?.overdueTaskCount).toBe(1);
      const portfolio = await f.get('owner', '/work/portfolio?scope=all');
      const item = (portfolio.body.items as { id: string; overdueTaskCount: number }[]).find(
        (x) => x.id === p.body.id,
      );
      expect(item?.overdueTaskCount).toBe(1);
      expect(portfolio.body.timeZone).toBe('Africa/Kinshasa');
    });
  });

  describe('rappels', () => {
    it('« échéance dans 1 h » puis retard à l’heure : une fois chacun ; heure changée → nouveau', async () => {
      const job = f.app().get(WorkDueRemindersJob);
      const analyst = f.userId('analyst');
      // 14:00 à Kinshasa = 13:00 UTC.
      const t = await task({
        title: 'Rendez-vous client',
        dueDate: '2030-04-10',
        dueTime: '14:00',
        assigneeUserId: analyst,
      });
      const mine = () =>
        f.notifications.filter((n) => n.source.entityId === t.id && n.actorUserId === null);
      f.notifications.length = 0;

      // 12:30 UTC = 13:30 à Kinshasa : dans l'heure.
      await job.run(new Date('2030-04-10T12:30:00Z'));
      await job.run(new Date('2030-04-10T12:35:00Z'));
      const inHour = mine().filter((n) => n.kind === 'work.task_due_in_hour');
      expect(inHour).toHaveLength(1);
      expect(inHour[0]!.dedupeKey).toBe(`work.task_due_in_hour:${t.id}:2030-04-10T14:00`);
      expect(inHour[0]!.title).toContain('14:00 WAT');
      expect(inHour[0]!.recipientUserId).toBe(analyst);
      expect(mine().map((n) => n.kind)).not.toContain('work.task_overdue');

      // 12:59 UTC = 13:59 : pas encore en retard ; 13:00 UTC = 14:00 : en retard.
      await job.run(new Date('2030-04-10T12:59:00Z'));
      expect(mine().map((n) => n.kind)).not.toContain('work.task_overdue');
      await job.run(new Date('2030-04-10T13:00:00Z'));
      await job.run(new Date('2030-04-10T13:05:00Z'));
      const late = mine().filter((n) => n.kind === 'work.task_overdue');
      expect(late).toHaveLength(1);
      expect(late[0]!.dedupeKey).toBe(`work.task_overdue:${t.id}:2030-04-10T14:00`);

      // Repousser l'heure le même jour rouvre les deux rappels.
      const d = await f.get('owner', `/work/tasks/${t.id}`);
      await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: d.body.revision,
        dueTime: '16:00',
      });
      await job.run(new Date('2030-04-10T14:30:00Z'));
      expect(mine().filter((n) => n.kind === 'work.task_due_in_hour')).toHaveLength(2);
      await job.run(new Date('2030-04-10T15:00:00Z'));
      expect(mine().filter((n) => n.kind === 'work.task_overdue')).toHaveLength(2);
    });

    it('avant 7 h : les rappels à l’heure partent, pas ceux du jour', async () => {
      const job = f.app().get(WorkDueRemindersJob);
      const analyst = f.userId('analyst');
      const tot = await task({
        title: 'Départ matinal',
        dueDate: '2030-05-02',
        dueTime: '06:30',
        assigneeUserId: analyst,
      });
      const veille = await task({
        title: 'Hier sans heure',
        dueDate: '2030-05-01',
        assigneeUserId: analyst,
      });
      f.notifications.length = 0;
      // 05:00 UTC = 06:00 à Kinshasa : dans l'heure.
      await job.run(new Date('2030-05-02T05:00:00Z'));
      // 05:30 UTC = 06:30 : en retard, avant 7 h.
      await job.run(new Date('2030-05-02T05:30:00Z'));
      const of = (id: string) =>
        f.notifications
          .filter((n) => n.source.entityId === id && n.actorUserId === null)
          .map((n) => n.kind);
      expect(of(tot.id)).toEqual(['work.task_due_in_hour', 'work.task_overdue']);
      expect(of(veille.id)).toEqual([]);
      // À 7 h, le retard « au jour » part.
      await job.run(new Date('2030-05-02T06:00:00Z'));
      expect(of(veille.id)).toEqual(['work.task_overdue']);
    });

    it('fuseau de Lubumbashi : l’heure de l’Est déclenche le rappel une heure plus tôt (UTC)', async () => {
      const job = f.app().get(WorkDueRemindersJob);
      const analyst = f.userId('analyst');
      const t = await task({
        title: 'Réunion à l’Est',
        dueDate: '2030-06-03',
        dueTime: '14:00',
        assigneeUserId: analyst,
      });
      await fuseau('owner', 'Africa/Lubumbashi');
      f.notifications.length = 0;
      // 12:00 UTC = 14:00 à Lubumbashi (mais 13:00 à Kinshasa).
      await job.run(new Date('2030-06-03T12:00:00Z'));
      const kinds = f.notifications
        .filter((n) => n.source.entityId === t.id && n.actorUserId === null)
        .map((n) => n.kind);
      expect(kinds).toContain('work.task_overdue');
      const title = f.notifications.find(
        (n) => n.source.entityId === t.id && n.kind === 'work.task_overdue',
      )!.title;
      expect(title).toContain('14:00 CAT');
      await fuseau('owner', 'Africa/Kinshasa');
    });
  });
});
