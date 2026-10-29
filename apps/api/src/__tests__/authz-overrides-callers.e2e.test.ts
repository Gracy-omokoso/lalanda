// ADR-0041 — A3 : les appelants qui décidaient par TITRE passent aux droits
// EFFECTIFS du membre (titre + ajouts − retraits), PREUVE BOUT EN BOUT.
//
// Les écarts sont écrits DIRECTEMENT dans `memberships` (la route d'écriture est le
// lot A4). Chaque cas vérifie les deux positions de l'interrupteur
// `MEMBER_PERMISSIONS_ENABLED` :
//
//   - ÉTEINT (défaut) : un écart stocké est sans effet, le comportement est
//     strictement celui d'avant ADR-0041 ;
//   - ALLUMÉ :
//       · un membre privé de `crm.read` ne voit plus aucune relance CRM dans
//         « Mes tâches », la cloche ni le brief ; privé de `crm.manage`, il n'est
//         plus assignable ni responsable ; un Lecteur ayant reçu `crm.manage` l'est ;
//       · le brief cache la trésorerie à qui a perdu `treasury.read` ;
//       · projets (critère 15) : un Lecteur ayant reçu `work.update` est proposé
//         comme responsable, un Comptable privé de `work.update` ne l'est plus ;
//       · alertes DGI (critère 14) : un membre ayant reçu `fiscal.manage` reçoit
//         l'alerte, un Directeur financier qui en est privé ne la reçoit plus.

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Action } from '../authz/permissions.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { NormalizationAlertsService } from '../sales/normalization/normalization-alerts.service.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture, type WorkAccount, type WorkRole } from './work-e2e-fixtures.js';

interface Entry {
  source: 'work' | 'crm';
  activityId?: string;
}
type Groups = Record<'overdue' | 'today' | 'next7Days' | 'later' | 'noDate', Entry[]>;
interface Fact {
  id: string;
  status: string;
  value: string | null;
}

e2eSuite('ADR-0041 A3 — appelants sur les droits effectifs', () => {
  const f = useWorkFixture('a3');
  const INTERRUPTEUR = process.env['MEMBER_PERMISSIONS_ENABLED'];
  const today = kinshasaDayOf(new Date());

  function allumer(): void {
    process.env['MEMBER_PERMISSIONS_ENABLED'] = 'true';
  }
  function eteindre(): void {
    delete process.env['MEMBER_PERMISSIONS_ENABLED'];
  }
  afterEach(() => eteindre());
  afterAll(() => {
    if (INTERRUPTEUR === undefined) eteindre();
    else process.env['MEMBER_PERMISSIONS_ENABLED'] = INTERRUPTEUR;
  });

  /** Écrit l'écart directement en base — aucune route d'écriture avant A4. */
  async function ecart(
    who: WorkRole,
    value: { grants?: Action[]; revokes?: Action[] },
  ): Promise<void> {
    const res = await f
      .db()
      .collection('memberships')
      .updateOne(
        { organizationId: f.orgId(), userId: f.userId(who) },
        { $set: { grants: value.grants ?? [], revokes: value.revokes ?? [] } },
      );
    expect(res.matchedCount).toBe(1);
  }

  async function crmTaskIds(who: WorkAccount): Promise<string[]> {
    const res = await f.get(who, '/work/my-tasks');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const g = res.body as Groups;
    return [...g.overdue, ...g.today, ...g.next7Days, ...g.later, ...g.noDate]
      .filter((e) => e.source === 'crm')
      .map((e) => e.activityId!);
  }
  async function crmNotifications(who: WorkAccount): Promise<string[]> {
    const res = await f.get(who, '/notifications');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.items as { kind: string }[])
      .map((n) => n.kind)
      .filter((k) => k.startsWith('crm.'));
  }
  async function brief(who: WorkAccount): Promise<Fact[]> {
    const res = await f.get(who, '/morning-brief');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.brief.facts as Fact[];
  }
  const fact = (facts: Fact[], id: string): Fact | undefined => facts.find((x) => x.id === id);

  describe('relances CRM : Mes tâches, cloche, brief, assignation', () => {
    let activityId = '';

    it('prépare une relance en retard assignée au Comptable (notifiée)', async () => {
      const res = await f.post('owner', '/crm/activities', {
        kind: 'follow_up',
        subject: 'Relance A3',
        dueAt: `${addDays(today, -1)}T12:00:00Z`,
        assigneeUserId: f.userId('accountant'),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      activityId = res.body.id as string;
      await ecart('accountant', { revokes: ['crm.read', 'crm.manage'] });
    });

    it('interrupteur ÉTEINT : le retrait stocké est sans effet', async () => {
      expect(await crmTaskIds('accountant')).toContain(activityId);
      expect(await crmNotifications('accountant')).toContain('crm.activity_assigned');
      expect(fact(await brief('accountant'), 'mes_relances.en_retard')).toMatchObject({
        status: 'known',
        value: '1',
      });
      // Toujours assignable : la décision reste par titre.
      const assign = await f.post('owner', '/crm/activities', {
        kind: 'call',
        subject: 'Encore assignable',
        dueAt: `${today}T15:00:00Z`,
        assigneeUserId: f.userId('accountant'),
      });
      expect(assign.status, JSON.stringify(assign.body)).toBe(201);
    });

    it('interrupteur ALLUMÉ : privé de crm.read, plus aucune relance nulle part', async () => {
      allumer();
      expect(await crmTaskIds('accountant')).toEqual([]);
      expect(await crmNotifications('accountant')).toEqual([]);
      const unread = await f.get('accountant', '/notifications/unread-count');
      expect(unread.status).toBe(200);
      const facts = await brief('accountant');
      for (const id of ['mes_relances.en_retard', 'mes_relances.aujourdhui', 'pipeline']) {
        expect(fact(facts, id), id).toMatchObject({ status: 'hidden', value: null });
      }
      // Le titre seul le donnerait encore : le Propriétaire, lui, voit tout.
      expect(fact(await brief('owner'), 'pipeline')?.status).not.toBe('hidden');
    });

    it('interrupteur ALLUMÉ : éligibilité d’assigné et de responsable sur crm.manage effectif', async () => {
      allumer();
      const refused = await f.post('owner', '/crm/activities', {
        kind: 'call',
        subject: 'Plus assignable',
        dueAt: `${today}T15:00:00Z`,
        assigneeUserId: f.userId('accountant'),
      });
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('CRM_ASSIGNEE_NOT_ELIGIBLE');
      const owner = await f.post('owner', '/crm/opportunities', {
        title: 'Responsable retiré',
        prospectName: 'Prospect A3',
        currency: 'USD',
        ownerId: f.userId('accountant'),
      });
      expect(owner.status, JSON.stringify(owner.body)).toBe(400);
      expect(owner.body.code).toBe('CRM_OWNER_NOT_ELIGIBLE');

      // Un Lecteur (titre sans crm.manage) qui le reçoit par ajout devient éligible.
      await ecart('viewer', { grants: ['crm.manage'] });
      const granted = await f.post('owner', '/crm/activities', {
        kind: 'call',
        subject: 'Lecteur assignable',
        dueAt: `${today}T15:00:00Z`,
        assigneeUserId: f.userId('viewer'),
      });
      expect(granted.status, JSON.stringify(granted.body)).toBe(201);
      const opp = await f.post('owner', '/crm/opportunities', {
        title: 'Responsable ajouté',
        prospectName: 'Prospect A3 bis',
        currency: 'USD',
        ownerId: f.userId('viewer'),
      });
      expect(opp.status, JSON.stringify(opp.body)).toBe(201);
      await ecart('viewer', {});
    });

    it('retrait effacé : tout réapparaît, interrupteur allumé', async () => {
      await ecart('accountant', {});
      allumer();
      expect(await crmTaskIds('accountant')).toContain(activityId);
      expect(await crmNotifications('accountant')).toContain('crm.activity_assigned');
    });
  });

  describe('brief : trésorerie', () => {
    it('privé de treasury.read, l’Administrateur ne voit plus la trésorerie (allumé seulement)', async () => {
      await ecart('admin', { revokes: ['treasury.read'] });
      expect(fact(await brief('admin'), 'tresorerie')?.status).not.toBe('hidden');
      allumer();
      expect(fact(await brief('admin'), 'tresorerie')).toMatchObject({
        status: 'hidden',
        value: null,
      });
      await ecart('admin', {});
      expect(fact(await brief('admin'), 'tresorerie')?.status).not.toBe('hidden');
    });
  });

  describe('projets : responsables d’une tâche (critère 15)', () => {
    async function members(): Promise<Map<string, { canUpdate: boolean }>> {
      const res = await f.get('owner', '/work/members');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return new Map(
        (res.body.items as { userId: string; canUpdate: boolean }[]).map((m) => [m.userId, m]),
      );
    }

    it('Lecteur + work.update proposé et assignable ; Comptable − work.update ne l’est plus', async () => {
      await ecart('viewer', { grants: ['work.update'] });
      await ecart('accountant', { revokes: ['work.update'] });
      const viewer = f.userId('viewer');
      const accountant = f.userId('accountant');

      let m = await members();
      expect(m.get(viewer)?.canUpdate).toBe(false);
      expect(m.get(accountant)?.canUpdate).toBe(true);

      allumer();
      m = await members();
      expect(m.get(viewer)?.canUpdate).toBe(true);
      expect(m.get(accountant)?.canUpdate).toBe(false);

      const project = await f.post('owner', '/work/projects', {
        name: 'Projet A3',
        kind: 'internal',
      });
      expect(project.status, JSON.stringify(project.body)).toBe(201);
      const ok = await f.post('owner', `/work/projects/${project.body.id}/tasks`, {
        title: 'Pour le Lecteur',
        assigneeUserId: viewer,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const ko = await f.post('owner', `/work/projects/${project.body.id}/tasks`, {
        title: 'Pour le Comptable',
        assigneeUserId: accountant,
      });
      expect(ko.status, JSON.stringify(ko.body)).toBe(400);

      await ecart('viewer', {});
      await ecart('accountant', {});
    });
  });

  describe('alertes DGI : détenteurs effectifs de fiscal.manage (critère 14)', () => {
    const envoyes: MailMessage[] = [];
    let bucket = Date.UTC(2026, 9, 30, 8);

    beforeAll(async () => {
      vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
        envoyes.push(m);
        return { delivered: true };
      });
      // Un Directeur financier : l'Analyste de la suite reçoit ce titre.
      await f
        .db()
        .collection('memberships')
        .updateOne(
          { organizationId: f.orgId(), userId: f.userId('analyst') },
          { $set: { role: 'finance_director' } },
        );
      await ecart('analyst', { revokes: ['fiscal.manage'] });
      await ecart('admin', { grants: ['fiscal.manage'] });
    });
    afterAll(() => {
      vi.restoreAllMocks();
    });

    async function destinataires(): Promise<string[]> {
      envoyes.length = 0;
      bucket += 3_600_000;
      const at = new Date(bucket);
      const outcome = await f
        .app()
        .get(NormalizationAlertsService)
        .notify({
          organizationId: f.orgId(),
          cause: 'normalization_uncertain',
          subject: { type: 'sales_invoice', id: `a3-${bucket}`, label: 'F-A3', number: 'F-A3' },
          since: at,
          bucket: at,
          now: at,
        });
      expect(outcome).toBe('sent');
      return envoyes.map((m) => m.to).sort();
    }
    const emailOf = async (who: WorkRole): Promise<string> => {
      const user = await f
        .db()
        .collection('user')
        .findOne({ _id: new (await import('mongodb')).ObjectId(f.userId(who)) });
      return String(user?.['email']);
    };

    it('ÉTEINT : par titre (Propriétaire et Directeur financier), écarts ignorés', async () => {
      expect(await destinataires()).toEqual(
        [await emailOf('owner'), await emailOf('analyst')].sort(),
      );
    });

    it('ALLUMÉ : l’Administrateur ayant reçu fiscal.manage la reçoit, le DAF qui en est privé non', async () => {
      allumer();
      expect(await destinataires()).toEqual(
        [await emailOf('owner'), await emailOf('admin')].sort(),
      );
    });
  });
});
