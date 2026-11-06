// Paramètres de la rubrique Projets — ADR-0061.
//
// Mes notifications (par utilisateur) : la cloche et l'e-mail de chaque événement sont
// RESPECTÉS à l'émission ; résumé quotidien au plus une fois par jour, à l'heure choisie,
// jamais un jour fermé si « jours ouvrés seulement ». Aucun envoi réel : le transport
// de test est espionné.
//
// Comportement des projets (organisation, `work.manage`) : chaque réglage a un effet
// testé — créateurs de projets, visibilité par défaut, modération des commentaires,
// jours ouvrés et « échéance proche », archivage automatique, alerte « passé à risque ».
// Couleur des cartes (post-it) : posée, retirée, refusée hors palette.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { WorkDigestJob } from '../work/preferences/work-digest.job.js';
import { WorkProjectWatchJob } from '../work/work-project-watch.job.js';
import { WorkDueRemindersJob } from '../work/work-reminders.job.js';
import { e2eSuite, registerAndLogin } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

e2eSuite('paramètres des Projets : notifications, comportement, couleurs (ADR-0061)', () => {
  const f = useWorkFixture('wset');
  const mails: MailMessage[] = [];
  const today = kinshasaDayOf(new Date());

  beforeAll(() => {
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { delivered: true } as never;
    });
  });

  async function project(name: string, extra: Record<string, unknown> = {}) {
    const p = await f.post('owner', '/work/projects', { name, kind: 'internal', ...extra });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    return p.body as { id: string; revision: number; visibility: string };
  }
  async function task(projectId: string, body: Record<string, unknown>) {
    const t = await f.post('owner', `/work/projects/${projectId}/tasks`, body);
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    return t.body.task as { id: string; revision: number };
  }
  async function settings(patch: Record<string, unknown>) {
    const cur = await f.get('owner', '/work/settings');
    const res = await f.put('owner', '/work/settings', {
      expectedRevision: cur.body.revision,
      labels: cur.body.labels,
      defaultColumns: cur.body.defaultColumns,
      dueSoonDays: cur.body.dueSoonDays,
      ...patch,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }

  describe('mes notifications', () => {
    it('valeurs par défaut sensées', async () => {
      const res = await f.get('analyst', '/work/notification-preferences');
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe(0);
      // ADR-0064 : colonne Slack — activée pour l'assignation et la mention seulement.
      // ADR-0065 : colonne WhatsApp — assignation, mention et échéance dépassée.
      expect(res.body.events.task_assigned).toEqual({
        bell: true,
        email: true,
        slack: true,
        whatsapp: true,
      });
      expect(res.body.events.mentioned).toEqual({
        bell: true,
        email: true,
        slack: true,
        whatsapp: true,
      });
      expect(res.body.events.task_overdue).toEqual({
        bell: true,
        email: true,
        slack: false,
        whatsapp: true,
      });
      expect(res.body.events.comment_on_followed).toEqual({
        bell: true,
        email: false,
        slack: false,
        whatsapp: false,
      });
      expect(res.body.events.task_status_changed).toEqual({
        bell: true,
        email: false,
        slack: false,
        whatsapp: false,
      });
      expect(res.body.digest).toEqual({ enabled: false, hour: 7, workingDaysOnly: true });
    });

    it('défauts : assignation → cloche ET e-mail', async () => {
      const p = await project('Notifications');
      f.notifications.length = 0;
      mails.length = 0;
      await task(p.id, { title: 'Défaut', assigneeUserId: f.userId('analyst') });
      expect(f.notifications.filter((n) => n.recipientUserId === f.userId('analyst'))).toHaveLength(
        1,
      );
      const mail = mails.find((m) => m.subject.includes('vous a assigné'));
      expect(mail?.to).toContain('wset-analyst');
      expect(mail?.text).toContain('/projets/');
    });

    it('préférences respectées : cloche coupée, e-mail activé, l’autre membre inchangé', async () => {
      const cur = await f.get('analyst', '/work/notification-preferences');
      const events = { ...cur.body.events };
      events.task_assigned = { bell: false, email: false };
      events.task_status_changed = { bell: false, email: true };
      const put = await f.put('analyst', '/work/notification-preferences', {
        expectedRevision: 0,
        events,
        digest: cur.body.digest,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.revision).toBe(1);
      // Les préférences d'un autre membre ne bougent pas.
      expect((await f.get('viewer', '/work/notification-preferences')).body.revision).toBe(0);

      const p = await project('Préférences');
      f.notifications.length = 0;
      mails.length = 0;
      const t = await task(p.id, { title: 'Carrelage', assigneeUserId: f.userId('analyst') });
      expect(f.notifications.filter((n) => n.recipientUserId === f.userId('analyst'))).toEqual([]);
      expect(mails.filter((m) => m.to.includes('wset-analyst'))).toEqual([]);

      // Statut changé par un autre : pas de cloche, un e-mail.
      const moved = await f.post('owner', `/work/tasks/${t.id}/move`, {
        columnKey: 'doing',
        expectedRevision: t.revision,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(
        f.notifications.filter(
          (n) => n.recipientUserId === f.userId('analyst') && n.kind === 'work.task_status_changed',
        ),
      ).toEqual([]);
      const mail = mails.find((m) => m.subject.includes('a déplacé'));
      expect(mail?.to).toContain('wset-analyst');
      expect(mail?.subject).toContain('En cours');
    });

    it('statut changé : cloche par défaut pour un assigné sans préférences', async () => {
      const p = await project('Statut');
      const t = await task(p.id, { title: 'Rapport', assigneeUserId: f.userId('accountant') });
      f.notifications.length = 0;
      await f.post('owner', `/work/tasks/${t.id}/complete`, { expectedRevision: t.revision });
      expect(
        f.notifications.some(
          (n) =>
            n.recipientUserId === f.userId('accountant') && n.kind === 'work.task_status_changed',
        ),
      ).toBe(true);
    });

    it('ajouté à un projet : notification aux personnes ajoutées', async () => {
      const p = await project('Ajout');
      f.notifications.length = 0;
      await f.post('owner', `/work/projects/${p.id}/members`, { userIds: [f.userId('viewer')] });
      expect(
        f.notifications.some(
          (n) => n.recipientUserId === f.userId('viewer') && n.kind === 'work.added_to_project',
        ),
      ).toBe(true);
    });

    it('validation : corps strict, heure 0 à 23', async () => {
      const cur = await f.get('viewer', '/work/notification-preferences');
      const bad = await f.put('viewer', '/work/notification-preferences', {
        expectedRevision: 0,
        events: cur.body.events,
        digest: { enabled: true, hour: 24, workingDaysOnly: true },
      });
      expect(bad.status).toBe(400);
    });

    it('résumé quotidien : à l’heure choisie, une fois par jour, jamais un jour fermé', async () => {
      const p = await project('Résumé');
      await task(p.id, {
        title: 'En retard pour le résumé',
        dueDate: addDays(today, -2),
        assigneeUserId: f.userId('accountant'),
      });
      const cur = await f.get('accountant', '/work/notification-preferences');
      await f.put('accountant', '/work/notification-preferences', {
        expectedRevision: cur.body.revision,
        events: cur.body.events,
        digest: { enabled: true, hour: 9, workingDaysOnly: false },
      });
      const job = f.app().get(WorkDigestJob);
      const at = (hourUtc: number) =>
        new Date(`${today}T${String(hourUtc).padStart(2, '0')}:30:00Z`);

      mails.length = 0;
      // 7 h 30 à Kinshasa (6 h 30 UTC) : trop tôt pour 9 h.
      expect((await job.run(at(6))).sent).toBe(0);
      // 10 h 30 à Kinshasa : envoyé.
      const r = await job.run(at(9));
      expect(r.sent).toBe(1);
      const digest = mails.find((m) => m.to.includes('wset-accountant'));
      expect(digest?.subject).toContain('vos projets');
      expect(digest?.text).toContain('En retard pour le résumé');
      // Une seule fois par jour.
      expect((await job.run(at(10))).sent).toBe(0);

      // Jours ouvrés seulement + aujourd'hui fermé → rien (le jour est réclamé).
      const closed = [1, 2, 3, 4, 5, 6, 7].filter(
        (d) => d !== ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
      );
      await settings({ workingDays: closed });
      const cur2 = await f.get('admin', '/work/notification-preferences');
      await f.put('admin', '/work/notification-preferences', {
        expectedRevision: cur2.body.revision,
        events: cur2.body.events,
        digest: { enabled: true, hour: 0, workingDaysOnly: true },
      });
      mails.length = 0;
      await job.run(at(12));
      expect(mails.filter((m) => m.to.includes('wset-admin'))).toEqual([]);
      await settings({ workingDays: [1, 2, 3, 4, 5] });
    });
  });

  describe('comportement des projets', () => {
    it('réglages par défaut : comportement antérieur', async () => {
      const res = await f.get('viewer', '/work/settings');
      expect(res.body.defaultVisibility).toBe('organization');
      expect(res.body.defaultView).toBe('overview');
      expect(res.body.projectCreatorRoles).toBeNull();
      expect(res.body.managersModerateComments).toBe(true);
      expect(res.body.showTaskNumbers).toBe(true);
      expect(res.body.autoArchiveCompletedDays).toBeNull();
    });

    it('un ancien client (sans les nouveaux champs) enregistre toujours ; un gestionnaire seulement', async () => {
      const cur = await f.get('admin', '/work/settings');
      const legacy = await f.put('admin', '/work/settings', {
        expectedRevision: cur.body.revision,
        labels: cur.body.labels,
        defaultColumns: cur.body.defaultColumns,
        dueSoonDays: cur.body.dueSoonDays,
      });
      expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
      expect(legacy.body.workingDays).toEqual(cur.body.workingDays);
      const refused = await f.put('analyst', '/work/settings', {
        expectedRevision: legacy.body.revision,
        labels: [],
        defaultColumns: cur.body.defaultColumns,
        dueSoonDays: 1,
        defaultVisibility: 'private',
      });
      expect(refused.status).toBe(403);
    });

    it('qui peut créer un projet : restreint aux rôles listés, la direction toujours', async () => {
      // Un Directeur financier (`work.manage`, pas `organization.manage`).
      const email = `wset-fd-${Date.now()}@lalanda-test.local`;
      const inv = await f.post('owner', `/organizations/${f.orgId()}/invitations`, {
        email,
        role: 'finance_director',
      });
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const cookies = await registerAndLogin(f.app(), {
        email,
        password: 'Passw0rd!projets',
        name: 'Directeur financier',
      });
      await request(f.app().getHttpServer())
        .post('/invitations/accept')
        .set('Cookie', cookies)
        .send({ token: inv.body.token });
      const asFd = [...cookies, `active_org_id=${f.orgId()}`];
      const create = () =>
        request(f.app().getHttpServer())
          .post('/work/projects')
          .set('Cookie', asFd)
          .send({ name: 'Projet du DAF', kind: 'internal' });

      expect((await create()).status).toBe(201);
      const bad = await f.get('owner', '/work/settings');
      const invalid = await f.put('owner', '/work/settings', {
        expectedRevision: bad.body.revision,
        labels: bad.body.labels,
        defaultColumns: bad.body.defaultColumns,
        dueSoonDays: bad.body.dueSoonDays,
        projectCreatorRoles: ['viewer'],
      });
      expect(invalid.status).toBe(400);
      expect(f.issueCodes(invalid)).toContain('WORK_CREATOR_ROLE_INVALID');

      await settings({ projectCreatorRoles: ['owner'] });
      const refused = await create();
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('WORK_PROJECT_CREATION_RESTRICTED');
      // L'Administrateur (direction) crée toujours.
      expect(
        (await f.post('admin', '/work/projects', { name: 'Admin', kind: 'internal' })).status,
      ).toBe(201);
      await settings({ projectCreatorRoles: null });
      expect((await create()).status).toBe(201);
    });

    it('visibilité par défaut : un nouveau projet naît privé, son créateur membre', async () => {
      await settings({ defaultVisibility: 'private' });
      const p = await project('Privé par défaut');
      expect(p.visibility).toBe('private');
      const members = await f.get('owner', `/work/projects/${p.id}/members`);
      expect(members.body.users.map((u: { userId: string }) => u.userId)).toEqual([
        f.userId('owner'),
      ]);
      expect((await f.get('analyst', `/work/projects/${p.id}`)).status).toBe(404);
      // Choix explicite à la création : prioritaire.
      const open = await project('Ouvert explicitement', { visibility: 'organization' });
      expect(open.visibility).toBe('organization');
      await settings({ defaultVisibility: 'organization' });
    });

    it('commentaires des autres : modérés par les gestionnaires selon le réglage', async () => {
      const p = await project('Commentaires');
      const t = await task(p.id, { title: 'Discussion' });
      const c = await f.post('analyst', `/work/tasks/${t.id}/comments`, { body: 'Mon avis' });
      expect(c.status).toBe(201);
      // Par défaut : un gestionnaire modifie le commentaire d'un autre.
      const edit = await f.put('admin', `/work/comments/${c.body.id}`, {
        expectedRevision: c.body.revision,
        body: 'Avis reformulé',
      });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      await settings({ managersModerateComments: false });
      const refusedEdit = await f.put('admin', `/work/comments/${c.body.id}`, {
        expectedRevision: edit.body.revision,
        body: 'Encore',
      });
      expect(refusedEdit.status).toBe(403);
      expect((await f.del('admin', `/work/comments/${c.body.id}`)).status).toBe(403);
      // L'auteur garde la main.
      expect((await f.del('analyst', `/work/comments/${c.body.id}`)).status).toBe(204);
      await settings({ managersModerateComments: true });
    });

    it('jours ouvrés : un vendredi, « échéance proche » (1 jour) atteint le lundi', async () => {
      const p = await project('Jours ouvrés');
      // Vendredi 7 janvier 2028 ; lundi 10 ; mardi 11.
      const monday = await task(p.id, {
        title: 'Pour lundi',
        dueDate: '2028-01-10',
        assigneeUserId: f.userId('analyst'),
      });
      await task(p.id, {
        title: 'Pour mardi',
        dueDate: '2028-01-11',
        assigneeUserId: f.userId('analyst'),
      });
      await settings({ dueSoonDays: 1, workingDays: [1, 2, 3, 4, 5] });
      f.notifications.length = 0;
      await f.app().get(WorkDueRemindersJob).run(new Date('2028-01-07T09:00:00Z'));
      const soon = f.notifications.filter((n) => n.kind === 'work.task_due_soon');
      expect(soon.map((n) => n.source.entityId)).toEqual([monday.id]);
    });

    it('archivage automatique des projets terminés après N jours', async () => {
      const p = await project('À archiver');
      const done = await f.put('owner', `/work/projects/${p.id}`, {
        expectedRevision: p.revision,
        status: 'completed',
      });
      expect(done.status).toBe(200);
      const job = f.app().get(WorkProjectWatchJob);
      // Jamais (défaut) : rien ne bouge.
      expect(await job.autoArchive(new Date(Date.now() + 30 * 86_400_000))).toBe(0);
      await settings({ autoArchiveCompletedDays: 3 });
      expect(await job.autoArchive(new Date(Date.now() + 2 * 86_400_000))).toBe(0);
      expect(await job.autoArchive(new Date(Date.now() + 4 * 86_400_000))).toBeGreaterThan(0);
      expect((await f.get('owner', `/work/projects/${p.id}`)).body.status).toBe('archived');
      await settings({ autoArchiveCompletedDays: null });
    });

    it('projet passé à risque : une notification à l’entrée, pas de doublon', async () => {
      const p = await project('Risqué', { ownerUserId: f.userId('analyst') });
      await task(p.id, { title: 'En retard', dueDate: addDays(today, -1) });
      const job = f.app().get(WorkProjectWatchJob);
      f.notifications.length = 0;
      await job.healthAlerts(new Date());
      const alert = f.notifications.filter(
        (n) => n.kind === 'work.project_at_risk' && n.source.projectId === p.id,
      );
      expect(alert.map((n) => n.recipientUserId)).toEqual([f.userId('analyst')]);
      f.notifications.length = 0;
      await job.healthAlerts(new Date());
      expect(f.notifications.filter((n) => n.kind === 'work.project_at_risk')).toEqual([]);
    });
  });

  describe('couleur des cartes (post-it)', () => {
    it('posée, relue, retirée ; hors palette refusée', async () => {
      const p = await project('Post-it');
      const t = await task(p.id, { title: 'Jaune', color: 'yellow' });
      const list = await f.get('viewer', `/work/projects/${p.id}/tasks`);
      expect(list.body.items[0].color).toBe('yellow');
      const bad = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        color: '#ff0',
      });
      expect(bad.status).toBe(400);
      const cleared = await f.patch('owner', `/work/tasks/${t.id}`, {
        expectedRevision: t.revision,
        color: null,
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body.task.color).toBeNull();
      const plain = await task(p.id, { title: 'Sans couleur' });
      expect((await f.get('owner', `/work/tasks/${plain.id}`)).body.color ?? null).toBeNull();
    });
  });
});
