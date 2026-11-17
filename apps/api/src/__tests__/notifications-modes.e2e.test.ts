// Notifications : modes, canaux, événements — ADR-0079.
//
// § 1 DIAGNOSTIC DE LA CLOCHE à DEUX utilisateurs : A (owner) agit, B (analyst) reçoit ;
// la cloche reçoit, compte, sert et marque comme lu ; l'auteur n'est pas notifié, sauf
// s'il coche « Me notifier aussi de mes propres actions » ; les non lues d'une AUTRE
// organisation (organisation personnelle active) sont signalées.
// § 3 ÉMISSION : chef et adjoint (mode Atténué par défaut) reçoivent la vie de leur projet,
// un simple membre (Essentiel) non ; feuilles de temps ; archivage.
// § 4 RÉGLAGES : surcharges gardées par mode ; défauts et obligations d'organisation ;
// conversion SANS PERTE des préférences ADR-0061 ; ancienne route toujours servie.
// § 5 GARDE-FOUS : rafales regroupées (cloche et e-mail), heures calmes, plafond WhatsApp.
// § 6 VÉRIFIABILITÉ : « M'envoyer un test » par canal, journal d'envoi (soi, administrateur),
// sans titre ni contenu.
// Producteur hors Projets (CRM) : même mécanisme, e-mail selon le mode.
//
// Aucun envoi réel : transport mail espionné ; Slack non connecté ; WhatsApp non configuré.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.js';
import { NOTIFICATIONS_PORT, type NotificationsPort } from '../notifications/notifications.port.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const TODAY = kinshasaDayOf(new Date());
function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}

e2eSuite('notifications : modes, canaux, événements (ADR-0079)', () => {
  const f = useWorkFixture('nmod');
  const mails: MailMessage[] = [];
  let projectId = '';

  beforeAll(() => {
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { delivered: true } as never;
    });
  });

  const flush = () => f.app().get(NotificationDispatcher).flush();
  async function bell(who: Parameters<typeof f.get>[0]) {
    const res = await f.get(who, '/notifications?limit=50');
    expect(res.status).toBe(200);
    return res.body.items as { id: string; kind: string; title: string; count?: number }[];
  }
  async function settings(who: Parameters<typeof f.get>[0]) {
    const res = await f.get(who, '/notifications/settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }
  async function putSettings(who: Parameters<typeof f.get>[0], patch: Record<string, unknown>) {
    const cur = await settings(who);
    const res = await f.put(who, '/notifications/settings', {
      expectedRevision: cur.revision,
      mode: cur.mode,
      overrides: cur.overrides,
      notifyOwnActions: cur.notifyOwnActions,
      quietHours: cur.quietHours,
      ...patch,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }
  async function task(body: Record<string, unknown>, who: 'owner' | 'admin' = 'owner') {
    const t = await f.post(who, `/work/projects/${projectId}/tasks`, body);
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    return t.body.task as { id: string; revision: number; number: number };
  }
  async function deliveries(who: Parameters<typeof f.get>[0], path = '/notifications/deliveries') {
    await flush();
    const res = await f.get(who, `${path}?limit=200`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as {
      kind: string;
      userId: string;
      userName?: string;
      channels: Record<string, { status: string; reason: string | null }>;
      test: boolean;
    }[];
  }

  it('montage : un projet commun', async () => {
    const p = await f.post('owner', '/work/projects', { name: 'Chantier Gombe', kind: 'internal' });
    expect(p.status).toBe(201);
    projectId = p.body.id;
  });

  describe('§ 1 diagnostic de la cloche — A agit, B reçoit', () => {
    it('B reçoit, compte, lit ; A (l’auteur) ne reçoit rien', async () => {
      const before = (await f.get('analyst', '/notifications/unread-count')).body.unread as number;
      const t = await task({ title: 'Poser le carrelage', assigneeUserId: f.userId('analyst') });
      const count = await f.get('analyst', '/notifications/unread-count');
      expect(count.status).toBe(200);
      expect(count.body.unread).toBe(before + 1);
      const items = await bell('analyst');
      const mine = items.find(
        (n) => n.kind === 'work.task_assigned' && n.title.includes(`#${t.number}`),
      );
      expect(mine, JSON.stringify(items)).toBeDefined();
      expect((await bell('owner')).some((n) => n.kind === 'work.task_assigned')).toBe(false);
      const read = await f.post('analyst', `/notifications/${mine!.id}/read`);
      expect(read.status).toBe(200);
      expect((await f.get('analyst', '/notifications/unread-count')).body.unread).toBe(before);
      // Journal de B : cloche servie, e-mail parti (assignation : urgent en Essentiel).
      const log = (await deliveries('analyst')).find((d) => d.kind === 'work.task_assigned');
      expect(log?.channels['bell']).toMatchObject({ status: 'sent' });
      expect(log?.channels['email']).toMatchObject({ status: 'sent' });
      expect(JSON.stringify(log)).not.toContain('carrelage');
    });

    it('« Me notifier aussi de mes propres actions » : désactivé par défaut, puis effectif', async () => {
      expect((await settings('accountant')).notifyOwnActions).toBe(false);
      await task({ title: 'Auto-assignée sans option', assigneeUserId: f.userId('owner') });
      expect((await bell('owner')).some((n) => n.title.includes('Auto-assignée sans option'))).toBe(
        false,
      );
      await putSettings('owner', { notifyOwnActions: true });
      await task({ title: 'Auto-assignée avec option', assigneeUserId: f.userId('owner') });
      expect((await bell('owner')).some((n) => n.title.includes('Auto-assignée avec option'))).toBe(
        true,
      );
      await putSettings('owner', { notifyOwnActions: false });
    });

    it('non lues d’une AUTRE organisation signalées (organisation personnelle active)', async () => {
      const orgs = await f.get('analyst', '/organizations');
      const personal = (orgs.body.organizations as { id: string }[]).find(
        (o) => o.id !== f.orgId(),
      );
      expect(personal).toBeDefined();
      const cookies = f
        .as('analyst')
        .filter((c) => !c.startsWith('active_org_id='))
        .concat(`active_org_id=${personal!.id}`);
      const res = await request(f.app().getHttpServer())
        .get('/notifications/unread-elsewhere')
        .set('Cookie', cookies);
      expect(res.status).toBe(200);
      const elsewhere = res.body.organizations as { organizationId: string; unread: number }[];
      // Une tâche de plus pour B : il y a au moins une non lue dans l'organisation de l'équipe.
      expect(elsewhere.find((o) => o.organizationId === f.orgId())).toBeUndefined();
      await task({ title: 'Pour l’autre organisation', assigneeUserId: f.userId('analyst') });
      const again = await request(f.app().getHttpServer())
        .get('/notifications/unread-elsewhere')
        .set('Cookie', cookies);
      expect(
        (again.body.organizations as { organizationId: string; unread: number }[]).find(
          (o) => o.organizationId === f.orgId(),
        )?.unread,
      ).toBeGreaterThan(0);
    });
  });

  describe('§ 3 et § 4 — modes par rôle dans le projet', () => {
    it('défauts : membre → Essentiel ; chef → Atténué pour SON projet', async () => {
      const s = await settings('accountant');
      expect(s.mode).toBeNull();
      expect(s.effectiveMode).toBe('essentiel');
      expect(s.projectLeadMode).toBe('attenue');
      // L'analyste devient chef, le comptable membre.
      const p = await f.get('owner', `/work/projects/${projectId}`);
      const put = await f.put('owner', `/work/projects/${projectId}`, {
        expectedRevision: p.body.revision,
        ownerUserId: f.userId('analyst'),
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      await f.post('owner', `/work/projects/${projectId}/members`, {
        userIds: [f.userId('accountant')],
      });
      f.notifications.length = 0;
      const t = await task({ title: 'Créée sous les yeux du chef' });
      expect(
        f.notifications.some(
          (n) =>
            n.kind === 'work.task_created' &&
            n.recipientUserId === f.userId('analyst') &&
            n.audience === 'project_lead',
        ),
      ).toBe(true);
      expect(
        f.notifications.some(
          (n) => n.kind === 'work.task_created' && n.recipientUserId === f.userId('accountant'),
        ),
      ).toBe(false);
      // Terminée et commentée : le chef suit son projet.
      f.notifications.length = 0;
      await f.post('owner', `/work/tasks/${t.id}/complete`, { expectedRevision: t.revision });
      await f.post('owner', `/work/tasks/${t.id}/comments`, { body: 'Bravo pour la pose' });
      const kinds = f.notifications
        .filter((n) => n.recipientUserId === f.userId('analyst'))
        .map((n) => n.kind);
      expect(kinds).toContain('work.task_completed');
      expect(kinds).toContain('work.comment_added');
    });

    it('Essentiel choisi par le chef : plus de « tâche créée » (palier Atténué)', async () => {
      await putSettings('analyst', { mode: 'essentiel' });
      f.notifications.length = 0;
      await task({ title: 'Créée en mode Essentiel' });
      expect(f.notifications.some((n) => n.kind === 'work.task_created')).toBe(false);
      const log = (await deliveries('analyst')).find((d) => d.kind === 'work.task_created');
      expect(log?.channels['bell']).toMatchObject({ status: 'skipped', reason: 'channel_off' });
    });

    it('surcharges GARDÉES par mode ; « revenir au mode d’origine »', async () => {
      const cur = await settings('analyst');
      const s1 = await putSettings('analyst', {
        mode: 'perroquet',
        overrides: { ...cur.overrides, perroquet: { 'work.task_assigned': { whatsapp: false } } },
      });
      expect(s1.customized.perroquet).toBe(true);
      const s2 = await putSettings('analyst', { mode: 'essentiel' });
      expect(s2.overrides.perroquet).toEqual({ 'work.task_assigned': { whatsapp: false } });
      const s3 = await putSettings('analyst', { mode: 'perroquet' });
      expect(s3.customized.perroquet).toBe(true);
      // Revenir au mode d'origine : on vide les surcharges de CE mode seulement.
      const s4 = await putSettings('analyst', {
        overrides: { ...s3.overrides, perroquet: {} },
      });
      expect(s4.customized.perroquet).toBe(false);
      await putSettings('analyst', { mode: null });
    });

    it('révision attendue et corps contrôlé', async () => {
      const cur = await settings('viewer');
      const stale = await f.put('viewer', '/notifications/settings', {
        expectedRevision: cur.revision + 5,
        mode: null,
        overrides: {},
        notifyOwnActions: false,
        quietHours: cur.quietHours,
      });
      expect(stale.status).toBe(409);
      const bad = await f.put('viewer', '/notifications/settings', {
        expectedRevision: cur.revision,
        mode: 'bavard',
        overrides: {},
        notifyOwnActions: false,
        quietHours: cur.quietHours,
      });
      expect(bad.status).toBe(400);
    });
  });

  describe('§ 4 — réglages d’organisation', () => {
    it('réservés à `organization.manage` ; obligation qui l’emporte sur la surcharge', async () => {
      const cur = await f.get('analyst', '/notifications/organization-settings');
      expect(cur.status).toBe(200);
      expect(cur.body.canManage).toBe(false);
      const body = {
        expectedRevision: cur.body.revision,
        projectLeadMode: 'attenue',
        memberMode: 'essentiel',
        byRole: {},
        mandatory: [{ kind: 'work.task_approval_requested', channel: 'bell' }],
        whatsappDailyCap: 20,
      };
      expect((await f.put('analyst', '/notifications/organization-settings', body)).status).toBe(
        403,
      );
      const put = await f.put('owner', '/notifications/organization-settings', body);
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.mandatory).toEqual(body.mandatory);
      const bad = await f.put('owner', '/notifications/organization-settings', {
        ...body,
        expectedRevision: put.body.revision,
        mandatory: [{ kind: 'hr.leave_requested', channel: 'whatsapp' }],
      });
      expect(bad.status).toBe(400);
      // Le comptable coupe la cloche des validations : l'obligation la rallume.
      const s = await settings('accountant');
      await putSettings('accountant', {
        overrides: {
          ...s.overrides,
          essentiel: { 'work.task_approval_requested': { bell: false } },
        },
      });
      const after = await settings('accountant');
      expect(after.mandatory).toEqual(body.mandatory);
    });

    it('mode par défaut d’un rôle', async () => {
      const cur = await f.get('owner', '/notifications/organization-settings');
      const put = await f.put('owner', '/notifications/organization-settings', {
        expectedRevision: cur.body.revision,
        projectLeadMode: 'attenue',
        memberMode: 'essentiel',
        byRole: { admin: 'perroquet' },
        mandatory: cur.body.mandatory,
        whatsappDailyCap: 20,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect((await settings('admin')).effectiveMode).toBe('perroquet');
      expect((await settings('viewer')).effectiveMode).toBe('essentiel');
      const unknown = await f.put('owner', '/notifications/organization-settings', {
        expectedRevision: put.body.revision,
        projectLeadMode: 'attenue',
        memberMode: 'essentiel',
        byRole: { pilote: 'perroquet' },
        mandatory: [],
        whatsappDailyCap: 20,
      });
      expect(unknown.status).toBe(400);
    });
  });

  describe('§ 4.3 — conversion sans perte des préférences ADR-0061', () => {
    it('un ancien réglage donne exactement le même résultat ; rien n’est supprimé', async () => {
      const legacy = {
        organizationId: f.orgId(),
        userId: f.userId('viewer'),
        events: {
          task_assigned: { bell: false, email: false, slack: false, whatsapp: false },
          task_status_changed: { bell: false, email: true, slack: false, whatsapp: false },
        },
        digest: { enabled: true, hour: 8, workingDaysOnly: true },
        digestEnabled: true,
        digestLastSentOn: null,
        revision: 3,
        _schemaVersion: 1,
      };
      await f
        .db()
        .collection('work_notification_preferences')
        .insertOne({ ...legacy });
      // L'ancien écran lit exactement ses cases.
      const old = await f.get('viewer', '/work/notification-preferences');
      expect(old.status).toBe(200);
      expect(old.body.revision).toBe(3);
      expect(old.body.events.task_assigned).toEqual(legacy.events.task_assigned);
      expect(old.body.events.task_status_changed).toEqual(legacy.events.task_status_changed);
      expect(old.body.digest).toEqual(legacy.digest);
      const s = await settings('viewer');
      expect(s.migratedFrom).toBe('adr-0061');
      expect(s.customized.essentiel).toBe(true);
      // L'ancien document est intact.
      const kept = await f
        .db()
        .collection('work_notification_preferences')
        .findOne({ organizationId: f.orgId(), userId: f.userId('viewer') });
      expect(kept?.['events']).toEqual(legacy.events);
      expect(kept?.['revision']).toBe(3);
    });

    it('ancienne route : PUT toujours servi, converti dans le mode choisi', async () => {
      const cur = await f.get('accountant', '/work/notification-preferences');
      const events = { ...cur.body.events, comment_on_followed: { bell: true, email: true } };
      const put = await f.put('accountant', '/work/notification-preferences', {
        expectedRevision: cur.body.revision,
        events,
        digest: cur.body.digest,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.events.comment_on_followed).toMatchObject({ bell: true, email: true });
      const s = await settings('accountant');
      expect(s.overrides.essentiel['work.comment_on_followed']).toEqual({ email: true });
      // Résumé quotidien seul (écran unique).
      const digest = await f.put('accountant', '/work/notification-preferences/digest', {
        expectedRevision: put.body.revision,
        digest: { enabled: true, hour: 9, workingDaysOnly: false },
      });
      expect(digest.status, JSON.stringify(digest.body)).toBe(200);
      expect(digest.body.digest).toEqual({ enabled: true, hour: 9, workingDaysOnly: false });
      expect(digest.body.events.comment_on_followed).toMatchObject({ email: true });
    });
  });

  describe('§ 5 — garde-fous', () => {
    it('rafale : trois commentaires = UNE ligne dans la cloche, UN e-mail', async () => {
      const t = await task({ title: 'Rafale', assigneeUserId: f.userId('admin') });
      // L'administrateur (Perroquet par son rôle) suit la tâche : e-mail des commentaires.
      mails.length = 0;
      for (const body of ['Un', 'Deux', 'Trois']) {
        const c = await f.post('owner', `/work/tasks/${t.id}/comments`, { body });
        expect(c.status, JSON.stringify(c.body)).toBe(201);
      }
      const rows = (await bell('admin')).filter(
        (n) => n.kind === 'work.comment_on_followed' && n.title.includes('Rafale'),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.count).toBe(3);
      expect(rows[0]!.title).toMatch(/^3 nouveaux commentaires — /);
      const sent = mails.filter((m) => m.to.includes('nmod-admin') && m.subject.includes('Rafale'));
      expect(sent).toHaveLength(1);
      const log = (await deliveries('admin')).filter((d) => d.kind === 'work.comment_on_followed');
      expect(log.filter((d) => d.channels['email']?.reason === 'grouped').length).toBe(2);
    });

    it('heures calmes : Slack et WhatsApp retenus, cloche et e-mail partent', async () => {
      const h = (new Date().getUTCHours() + 1) % 24;
      await putSettings('accountant', {
        quietHours: { enabled: true, start: h, end: (h + 1) % 24 },
      });
      await task({ title: 'La nuit', assigneeUserId: f.userId('accountant') });
      const log = (await deliveries('accountant')).find((d) => d.kind === 'work.task_assigned');
      expect(log?.channels['bell']).toMatchObject({ status: 'sent' });
      expect(log?.channels['email']).toMatchObject({ status: 'sent' });
      expect(log?.channels['slack']).toMatchObject({ status: 'skipped', reason: 'quiet_hours' });
      expect(log?.channels['whatsapp']).toMatchObject({ status: 'skipped', reason: 'quiet_hours' });
      await putSettings('accountant', { quietHours: { enabled: false, start: 21, end: 7 } });
    });

    it('plafond quotidien WhatsApp par personne', async () => {
      const cur = await f.get('owner', '/notifications/organization-settings');
      await f.put('owner', '/notifications/organization-settings', {
        expectedRevision: cur.body.revision,
        projectLeadMode: cur.body.projectLeadMode,
        memberMode: cur.body.memberMode,
        byRole: cur.body.byRole,
        mandatory: cur.body.mandatory,
        whatsappDailyCap: 0,
      });
      await task({ title: 'Plafond', assigneeUserId: f.userId('accountant') });
      const log = (await deliveries('accountant')).find((d) => d.kind === 'work.task_assigned');
      expect(log?.channels['whatsapp']).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
    });
  });

  describe('§ 3 — autres émissions', () => {
    it('feuille de temps : soumise → gestionnaires ; validée → la personne', async () => {
      const week = mondayOf(TODAY);
      f.notifications.length = 0;
      const sub = await f.post('accountant', '/work/timesheets/submit', {
        week,
        expectedRevision: 0,
      });
      expect([200, 201], JSON.stringify(sub.body)).toContain(sub.status);
      expect(
        f.notifications.some(
          (n) => n.kind === 'work.timesheet_submitted' && n.recipientUserId === f.userId('owner'),
        ),
      ).toBe(true);
      const ok = await f.post('owner', '/work/timesheets/approve', {
        week,
        userId: f.userId('accountant'),
        expectedRevision: 1,
      });
      expect([200, 201], JSON.stringify(ok.body)).toContain(ok.status);
      expect(
        f.notifications.some(
          (n) =>
            n.kind === 'work.timesheet_approved' && n.recipientUserId === f.userId('accountant'),
        ),
      ).toBe(true);
    });

    it('projet archivé : chef et membres prévenus', async () => {
      const p = await f.post('owner', '/work/projects', {
        name: 'À archiver',
        kind: 'internal',
        ownerUserId: f.userId('analyst'),
      });
      f.notifications.length = 0;
      const a = await f.post('owner', `/work/projects/${p.body.id}/archive`, {
        expectedRevision: p.body.revision,
      });
      expect([200, 201]).toContain(a.status);
      expect(
        f.notifications.some(
          (n) => n.kind === 'work.project_archived' && n.recipientUserId === f.userId('analyst'),
        ),
      ).toBe(true);
    });

    it('producteur hors Projets (CRM) : même mécanisme, e-mail selon le mode', async () => {
      const port = f.app().get<NotificationsPort>(NOTIFICATIONS_PORT);
      mails.length = 0;
      await port.notify({
        organizationId: f.orgId(),
        recipientUserId: f.userId('viewer'),
        kind: 'crm.activity_assigned',
        requiredAction: 'analytics.read',
        source: { module: 'crm', entityType: 'activity', entityId: 'act-1' },
        title: 'Relance assignée : appeler Kin Services',
        href: '/crm/agenda',
        actorUserId: f.userId('owner'),
      });
      expect((await bell('viewer')).some((n) => n.kind === 'crm.activity_assigned')).toBe(true);
      expect(mails.some((m) => m.subject.includes('appeler Kin Services'))).toBe(true);
      const log = (await deliveries('viewer')).find((d) => d.kind === 'crm.activity_assigned');
      // Modèle WhatsApp générique pas encore approuvé : « indisponible pour cet événement ».
      expect(log?.channels['whatsapp']?.reason).toBe('channel_off');
    });
  });

  describe('§ 6 — vérifiabilité', () => {
    it('« M’envoyer un test » sur chaque canal, cinq par heure au plus', async () => {
      const bellTest = await f.post('viewer', '/notifications/test', { channel: 'bell' });
      expect(bellTest.status, JSON.stringify(bellTest.body)).toBe(200);
      expect(bellTest.body.outcome.status).toBe('sent');
      expect((await bell('viewer')).some((n) => n.kind === 'organization.notification_test')).toBe(
        true,
      );
      mails.length = 0;
      const mailTest = await f.post('viewer', '/notifications/test', { channel: 'email' });
      expect(mailTest.body.outcome.status).toBe('sent');
      expect(mails.some((m) => m.to.includes('nmod-viewer'))).toBe(true);
      const slackTest = await f.post('viewer', '/notifications/test', { channel: 'slack' });
      expect(slackTest.body.outcome).toMatchObject({
        status: 'skipped',
        reason: 'slack_not_connected',
      });
      const waTest = await f.post('viewer', '/notifications/test', { channel: 'whatsapp' });
      expect(waTest.body.outcome.status).toBe('skipped');
      await f.post('viewer', '/notifications/test', { channel: 'bell' });
      const sixth = await f.post('viewer', '/notifications/test', { channel: 'bell' });
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('NOTIFICATION_TEST_RATE_LIMITED');
    });

    it('état des canaux de l’appelant', async () => {
      const res = await f.get('viewer', '/notifications/channels');
      expect(res.status).toBe(200);
      const by = Object.fromEntries(
        (res.body.channels as { channel: string; ready: boolean; reason: string | null }[]).map(
          (c) => [c.channel, c],
        ),
      );
      expect(by['bell']).toMatchObject({ ready: true });
      expect(by['email']).toMatchObject({ ready: true });
      expect(by['slack']).toMatchObject({ ready: false });
      expect(by['whatsapp']).toMatchObject({ ready: false, reason: 'whatsapp_unavailable' });
      expect(res.body.whatsappKinds).toContain('work.task_assigned');
      expect(res.body.whatsappKinds).not.toContain('crm.activity_assigned');
    });

    it('journal : chacun le sien ; l’administrateur celui de l’organisation, sans contenu', async () => {
      const mine = await deliveries('viewer');
      expect(mine.every((d) => d.userId === f.userId('viewer'))).toBe(true);
      expect(mine.some((d) => d.test)).toBe(true);
      expect((await f.get('analyst', '/notifications/deliveries/organization')).status).toBe(403);
      const all = await deliveries('owner', '/notifications/deliveries/organization');
      expect(new Set(all.map((d) => d.userId)).size).toBeGreaterThan(2);
      expect(all.every((d) => typeof d.userName === 'string')).toBe(true);
      const raw = JSON.stringify(all);
      expect(raw).not.toContain('carrelage');
      expect(raw).not.toContain('"title"');
      // Autre organisation : rien.
      const b = await f.get('ownerB', '/notifications/deliveries/organization');
      expect(b.status).toBe(200);
      expect(b.body.items).toEqual([]);
    });
  });
});
