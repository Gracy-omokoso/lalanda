// RELANCES CRM DANS « MES TÂCHES », LA CLOCHE ET LE BRIEF — ADR-0040 — C4.
//
// Sur un vrai serveur et une vraie base :
//
//  · critère 8 — une relance assignée à U, échéance hier à 23 h 30 UTC
//    (aujourd'hui à Kinshasa) : dans « Mes tâches » de U, groupe `today`,
//    `source: 'crm'` ; cochée par `POST /crm/activities/:id/complete`, elle sort
//    de la liste, l'activité est faite, AUCUN document `work_tasks` n'est créé ;
//    décochée par `…/reopen`, elle revient ;
//  · critère 9 — sans `crm.read`, U ne voit ni la relance ni sa notification ;
//  · critère 10 — un rappel par (activité, échéance), même rejoué ; changer
//    l'échéance en crée un nouveau ; assigner à V notifie V, pas l'auteur ;
//  · critère 11 — brief : deux relances en retard → `mes_relances.en_retard = 2`
//    et R10 ; `pipeline` = opportunités ouvertes ; sans `crm.read`, faits
//    `hidden` et R10 non évaluée ;
//  · assigné : défaut le créateur, membre détenant `crm.manage`, jamais `null`
//    à échéance, 404 pour un identifiant forgé ou d'une autre organisation ;
//  · isolation : l'organisation B ne voit, ne coche ni ne rouvre rien de A.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { beforeAll, describe, expect, it } from 'vitest';

import { CrmNotifier } from '../crm/crm-notifier.js';
import { CrmDueRemindersJob } from '../crm/crm-reminders.job.js';
import type { NotificationInput } from '../notifications/notifications.port.js';
import { WorkTasksService } from '../work/work-tasks.service.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture, type WorkAccount } from './work-e2e-fixtures.js';

interface Activity {
  id: string;
  revision: number;
  done: boolean;
  dueDay: string | null;
  assigneeUserId: string | null;
}

interface Entry {
  id: string;
  source: 'work' | 'crm';
  activityId?: string;
  subject?: string;
  href?: string;
  opportunityTitle?: string | null;
  revision: number;
}

type Groups = Record<'overdue' | 'today' | 'next7Days' | 'later' | 'noDate', Entry[]>;

e2eSuite('CRM — relances dans Mes tâches, cloche et brief (ADR-0040 — C4)', () => {
  const f = useWorkFixture('crmag');
  const crmNotifications: NotificationInput[] = [];
  const today = kinshasaDayOf(new Date());
  const yesterday = addDays(today, -1);
  let opportunityId = '';

  beforeAll(() => {
    // Enregistreur autour du port réel (motif de `work-e2e-fixtures.ts`).
    const notifier = f.app().get(CrmNotifier);
    const inner = notifier.port;
    notifier.port = {
      notify: async (input) => {
        crmNotifications.push(input);
        await inner.notify(input);
      },
    };
  });

  async function activity(
    who: WorkAccount,
    body: Record<string, unknown>,
    status = 201,
  ): Promise<Activity> {
    const res = await f.post(who, '/crm/activities', body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body as Activity;
  }
  async function myTasks(who: WorkAccount): Promise<Groups> {
    const res = await f.get(who, '/work/my-tasks');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Groups;
  }
  const all = (g: Groups): Entry[] => [
    ...g.overdue,
    ...g.today,
    ...g.next7Days,
    ...g.later,
    ...g.noDate,
  ];
  const crmIds = (g: Groups): string[] =>
    all(g)
      .filter((e) => e.source === 'crm')
      .map((e) => e.activityId!);

  it('prépare une opportunité ouverte', async () => {
    const o = await f.post('owner', '/crm/opportunities', {
      title: 'Logiciel de caisse',
      prospectName: 'Prospect SARL',
      amount: '1500',
      currency: 'USD',
    });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    opportunityId = o.body.id;
  });

  describe('assigné (§ 2.4)', () => {
    it('défaut : le créateur ; jour d’échéance au jour de Kinshasa', async () => {
      const a = await activity('owner', {
        kind: 'call',
        subject: 'Appeler',
        dueAt: '2026-11-03T23:30:00Z', // 4 nov., 0 h 30 à Kinshasa
      });
      expect(a.assigneeUserId).toBe(f.userId('owner'));
      expect(a.dueDay).toBe('2026-11-04');
      const note = await activity('owner', { kind: 'note', subject: 'Note' });
      expect(note.dueDay).toBeNull();
    });

    it('membre sans crm.manage : 400 ; identifiant forgé ou d’une autre organisation : 404 ; null à échéance : 400', async () => {
      const base = { kind: 'follow_up', subject: 'Relance', dueAt: `${today}T10:00:00Z` };
      const analyst = await f.post('owner', '/crm/activities', {
        ...base,
        assigneeUserId: f.userId('analyst'),
      });
      expect(analyst.status).toBe(400);
      expect(f.issueCodes(analyst)).toContain('CRM_ASSIGNEE_NOT_ELIGIBLE');
      const forged = await f.post('owner', '/crm/activities', {
        ...base,
        assigneeUserId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      });
      expect(forged.status).toBe(404);
      const other = await f.post('owner', '/crm/activities', {
        ...base,
        assigneeUserId: f.userId('ownerB'),
      });
      expect(other.status).toBe(404);
      const none = await f.post('owner', '/crm/activities', { ...base, assigneeUserId: null });
      expect(none.status).toBe(400);
      expect(f.issueCodes(none)).toContain('CRM_ASSIGNEE_REQUIRED');
    });
  });

  describe('Mes tâches mixte (§ 5)', () => {
    it('critère 8 : relance du jour de Kinshasa, cochée depuis Mes tâches, sans copie', async () => {
      const workTasksBefore = await f.db().collection('work_tasks').countDocuments();
      crmNotifications.length = 0;
      const a = await activity('owner', {
        kind: 'follow_up',
        subject: 'Relancer pour la signature',
        dueAt: `${yesterday}T23:30:00Z`,
        opportunityId,
        assigneeUserId: f.userId('admin'),
      });
      expect(a.dueDay).toBe(today);

      // Critère 10 : assigner à V notifie V, jamais l'auteur.
      const assigned = crmNotifications.filter((n) => n.source.entityId === a.id);
      expect(assigned.map((n) => [n.kind, n.recipientUserId])).toEqual([
        ['crm.activity_assigned', f.userId('admin')],
      ]);
      expect(assigned[0]).toMatchObject({
        requiredAction: 'crm.read',
        source: { module: 'crm', entityType: 'activity', entityId: a.id },
        href: `/crm/opportunites/${opportunityId}`,
        actorUserId: f.userId('owner'),
      });

      const g = await myTasks('admin');
      const item = g.today.find((e) => e.activityId === a.id);
      expect(item).toMatchObject({
        source: 'crm',
        id: `crm:${a.id}`,
        subject: 'Relancer pour la signature',
        opportunityTitle: 'Logiciel de caisse',
        href: `/crm/opportunites/${opportunityId}`,
        revision: a.revision,
      });
      // L'auteur ne la voit pas : elle n'est pas à lui.
      expect(crmIds(await myTasks('owner'))).not.toContain(a.id);

      // Cocher au même endroit : la route du CRM.
      const done = await f.post('admin', `/crm/activities/${a.id}/complete`, {
        expectedRevision: item!.revision,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(crmIds(await myTasks('admin'))).not.toContain(a.id);
      const stored = await f
        .db()
        .collection('crm_activities')
        .findOne({ subject: 'Relancer pour la signature' });
      expect(stored?.['done']).toBe(true);
      expect(await f.db().collection('work_tasks').countDocuments()).toBe(workTasksBefore);

      // Décocher : elle revient.
      const reopened = await f.post('admin', `/crm/activities/${a.id}/reopen`, {
        expectedRevision: done.body.revision,
      });
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect(reopened.body.done).toBe(false);
      expect(crmIds(await myTasks('admin'))).toContain(a.id);
      // Révision périmée : 409.
      const stale = await f.post('admin', `/crm/activities/${a.id}/complete`, {
        expectedRevision: done.body.revision,
      });
      expect(stale.status).toBe(409);
      // Une note ne se rouvre pas.
      const note = await activity('admin', { kind: 'note', subject: 'Note' });
      const noteReopen = await f.post('admin', `/crm/activities/${note.id}/reopen`, {
        expectedRevision: note.revision,
      });
      expect(noteReopen.status).toBe(409);
      expect(noteReopen.body.code).toBe('CRM_NOTE_ALWAYS_DONE');
    });

    it('filtres de liste : assignee=me, dueFrom, dueTo', async () => {
      const mine = await f.get(
        'admin',
        `/crm/activities?assignee=me&dueFrom=${today}&dueTo=${today}`,
      );
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect(mine.body.items.length).toBeGreaterThanOrEqual(1);
      for (const a of mine.body.items as Activity[]) {
        expect(a.assigneeUserId).toBe(f.userId('admin'));
        expect(a.dueDay).toBe(today);
      }
      const bad = await f.get('admin', '/crm/activities?dueFrom=29-10-2026');
      expect(bad.status).toBe(400);
    });

    it('isolation : l’organisation B ne voit, ne coche ni ne rouvre rien de A', async () => {
      const a = await activity('owner', {
        kind: 'call',
        subject: 'Isolation',
        dueAt: `${today}T09:00:00Z`,
      });
      expect(crmIds(await myTasks('ownerB'))).toEqual([]);
      expect(
        (await f.post('ownerB', `/crm/activities/${a.id}/complete`, { expectedRevision: 1 }))
          .status,
      ).toBe(404);
      expect(
        (await f.post('ownerB', `/crm/activities/${a.id}/reopen`, { expectedRevision: 1 })).status,
      ).toBe(404);
    });
  });

  describe('rappels (§ 5.4)', () => {
    it('critère 10 : un rappel par (activité, échéance), même rejoué ; échéance changée → nouveau', async () => {
      const job = f.app().get(CrmDueRemindersJob);
      const now = new Date('2026-10-29T08:00:00Z');
      const a = await activity('owner', {
        kind: 'follow_up',
        subject: 'Rappel',
        dueAt: '2026-10-30T10:00:00Z',
        assigneeUserId: f.userId('admin'),
      });
      crmNotifications.length = 0;
      await job.run(now);
      await job.run(now);
      await job.run(now);
      const mine = () => crmNotifications.filter((n) => n.source.entityId === a.id);
      expect(mine().map((n) => n.kind)).toEqual(['crm.activity_due_soon']);
      expect(mine()[0]).toMatchObject({
        dedupeKey: `crm.activity_due_soon:${a.id}:2026-10-30`,
        actorUserId: null,
        recipientUserId: f.userId('admin'),
      });

      // Échéance changée (heure de la veille en UTC, jour du 29 à Kinshasa).
      const moved = await f.put('owner', `/crm/activities/${a.id}`, {
        kind: 'follow_up',
        subject: 'Rappel',
        dueAt: '2026-10-29T10:00:00Z',
        assigneeUserId: f.userId('admin'),
        done: false,
        expectedRevision: a.revision,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body.dueDay).toBe('2026-10-29');
      await job.run(now);
      expect(mine().map((n) => n.kind)).toEqual(['crm.activity_due_soon', 'crm.activity_due_soon']);
      // Le même assigné n'est pas renotifié d'une assignation.
      expect(mine().some((n) => n.kind === 'crm.activity_assigned')).toBe(false);

      // Avant 7 h à Kinshasa, rien ; le lendemain, « en retard », une seule fois.
      expect((await job.run(new Date('2026-10-30T05:00:00Z'))).claimed).toBe(0);
      await job.run(new Date('2026-10-30T08:00:00Z'));
      await job.run(new Date('2026-10-30T08:15:00Z'));
      expect(mine().filter((n) => n.kind === 'crm.activity_overdue')).toHaveLength(1);
    });
  });

  describe('brief du matin (§ 5.5)', () => {
    it('critère 11 : deux relances en retard → mes_relances.en_retard = 2 et R10 ; pipeline connu', async () => {
      for (const day of [yesterday, addDays(today, -7)]) {
        await activity('owner', {
          kind: 'follow_up',
          subject: `Retard ${day}`,
          dueAt: `${day}T12:00:00Z`,
          assigneeUserId: f.userId('accountant'),
        });
      }
      const res = await f.get('accountant', '/morning-brief');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const b = res.body.brief as {
        version: string;
        facts: { id: string; status: string; value: string | null }[];
        alerts: { ruleId: string; message: string; actionPath: string }[];
        recommendations: { ruleId: string }[];
      };
      expect(b.version).toBe('1.3.0');
      const fact = (id: string) => b.facts.find((x) => x.id === id);
      expect(fact('mes_relances.en_retard')).toMatchObject({ status: 'known', value: '2' });
      expect(fact('mes_relances.aujourdhui')).toMatchObject({ status: 'known', value: '0' });
      expect(fact('pipeline')).toMatchObject({ status: 'known', value: '1' });
      const r10 = b.alerts.find((x) => x.ruleId === 'relances_en_retard');
      expect(r10).toMatchObject({ actionPath: '/projets/mes-taches' });
      expect(r10?.message).toBe('2 relances clients ont dépassé leur échéance.');
    });

    it('critère 11 : sans crm.read, faits masqués et R10 non évaluée ; B ne voit rien de A', async () => {
      const res = await f.get('advisor', '/morning-brief');
      expect(res.status).toBe(200);
      const b = res.body.brief as {
        facts: { id: string; status: string; value: string | null }[];
        rulesSkipped: { ruleId: string; reason: string }[];
      };
      for (const id of [
        'mes_relances.en_retard',
        'mes_relances.aujourdhui',
        'relances.en_retard',
        'pipeline',
      ]) {
        expect(b.facts.find((x) => x.id === id)).toMatchObject({ status: 'hidden', value: null });
      }
      expect(b.rulesSkipped).toContainEqual({ ruleId: 'relances_en_retard', reason: 'hidden' });

      const other = await f.get('ownerB', '/morning-brief');
      const facts = other.body.brief.facts as { id: string; value: string | null }[];
      expect(facts.find((x) => x.id === 'pipeline')?.value).toBe('0');
      expect(facts.find((x) => x.id === 'relances.en_retard')?.value).toBe('0');
    });
  });

  describe('droit retiré (§ 5.1)', () => {
    it('critère 9 : sans crm.read, ni relance dans Mes tâches, ni notification', async () => {
      const accountant = f.userId('accountant');
      const a = await activity('owner', {
        kind: 'meeting',
        subject: 'Droit retiré',
        dueAt: `${today}T15:00:00Z`,
        assigneeUserId: accountant,
      });
      const service = f.app().get(WorkTasksService);
      const withRead = await service.myTasks(f.orgId(), {
        userId: accountant,
        role: 'accountant',
        context: {},
      });
      expect(crmIds(withRead as unknown as Groups)).toContain(a.id);
      const notifs = async () =>
        (await f.get('accountant', '/notifications')).body.items as {
          kind: string;
          source: { entityId: string };
        }[];
      expect((await notifs()).some((n) => n.source.entityId === a.id)).toBe(true);

      // Cas théorique : le rôle ne détient plus `crm.read`.
      const without = await service.myTasks(f.orgId(), {
        userId: accountant,
        role: 'advisor',
        context: {},
      });
      expect(crmIds(without as unknown as Groups)).toEqual([]);
      await f
        .db()
        .collection('memberships')
        .updateOne(
          { organizationId: f.orgId(), userId: accountant },
          { $set: { role: 'advisor' } },
        );
      expect((await notifs()).some((n) => n.kind.startsWith('crm.'))).toBe(false);
      expect((await f.get('accountant', '/work/my-tasks')).status).toBe(403);
    });
  });
});
