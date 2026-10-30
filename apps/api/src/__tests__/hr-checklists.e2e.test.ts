// Listes d'entrée et de sortie contre la vraie application (ADR-0045 § 2.9, O4,
// § 6.1 ; critères 15, 19, 20). ADR-0045 — H4.
//
// Couvre : modèles proposés à l'activation (idempotents), modèle personnalisé ;
// instanciation de la liste de départ de B avec assignés RÉSOLUS (manager, RH,
// salarié, compte étranger ramené aux RH) et échéances = date pivot + décalage ;
// l'élément « Matériel repris » apparaît dans « Mes tâches » de son SEUL assigné et
// dans AUCUN projet RUN ; un détenteur de `work.read` ne voit nulle part le départ ;
// cocher par l'assigné ou `hr.manage` seulement (404 sinon) ; notification
// `hr.checklist_item_assigned` sans auteur ; sortie qui propose la liste sans retirer
// l'accès ; isolation entre organisations.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { e2eSuite } from './e2e-utils.js';
import { code, fiche, hrFixture, ok, type HrAccount, type HrFixture } from './hr-e2e-fixtures.js';

const tag = randomBytes(4).toString('hex');

vi.setConfig({ testTimeout: 180_000 });

e2eSuite('RH — listes d’entrée et de sortie (ADR-0045 H4)', () => {
  let fx: HrFixture;
  let db: Db;
  /** B : fiche du Lecteur ; A : son manager (Analyste) ; S : fiche sans compte. */
  const id = { A: '', B: '', S: '' };
  const tpl = { onboarding: '', offboarding: '' };
  let depart = '';

  const hrItemsOf = async (c: HrAccount) => {
    const t = ok(await fx.get(c, '/work/my-tasks'));
    return [
      ...t['overdue'],
      ...t['today'],
      ...t['next7Days'],
      ...t['later'],
      ...t['noDate'],
    ].filter(
      (e: { source: string; kind: string }) => e.source === 'hr' && e.kind === 'checklist_item',
    );
  };
  const del = (c: HrAccount, path: string) =>
    request(fx.app.getHttpServer()).delete(path).set('Cookie', fx.as(c));

  beforeAll(async () => {
    fx = await hrFixture(tag, 'rh-listes');
    db = fx.db;
    const res = ok(
      await fx.post('owner', '/hr/employees/from-members', {
        userIds: [fx.userIds['analyst'], fx.userIds['viewer']],
      }),
      201,
    );
    const byUser = (u: string) =>
      res['items'].find((e: { userId: string }) => e.userId === u)['id'] as string;
    id.A = byUser(fx.userIds['analyst']);
    id.B = byUser(fx.userIds['viewer']);
    const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
    ok(
      await fx.put('owner', `/hr/employees/${id.B}`, {
        expectedRevision: b!['revision'],
        managerEmployeeId: id.A,
        startDate: '2026-01-05',
      }),
    );
    id.S = ok(await fx.post('owner', '/hr/employees', fiche(`Chauffeur ${tag}`)), 201)['id'];
  }, 300_000);

  beforeEach(() => fx.clearThrottle());

  afterAll(async () => {
    try {
      if (fx) await fx.db.dropDatabase();
    } finally {
      await fx?.app.close();
    }
  }, 60_000);

  describe('modèles', () => {
    it('deux modèles proposés à l’activation, une seule fois ; lecture `hr.read`', async () => {
      const page = ok(await fx.get('hr_manager', '/hr/checklist-templates'));
      ok(await fx.get('admin', '/hr/checklist-templates'));
      expect(page['items']).toHaveLength(2);
      for (const t of page['items']) {
        expect(t['isDefault']).toBe(true);
        tpl[t['kind'] as 'onboarding' | 'offboarding'] = t['id'];
      }
      const depart = page['items'].find((t: { kind: string }) => t.kind === 'offboarding');
      expect(depart['items'].map((i: { label: string }) => i.label)).toEqual([
        'Matériel repris',
        'Accès Lalanda retiré',
        'Documents de fin remis',
      ]);
      expect(
        await db.collection('hr_checklist_templates').countDocuments({ organizationId: fx.orgN }),
      ).toBe(2);
      // Aucun accès pour qui n'a pas `hr.read`.
      for (const c of ['analyst', 'accountant', 'viewer'] as const) {
        expect((await fx.get(c, '/hr/checklist-templates')).status, c).toBe(403);
      }
      // L'autre organisation a les siens.
      const autres = ok(await fx.get('ownerB', '/hr/checklist-templates'));
      expect(autres['items'].map((t: { id: string }) => t.id)).not.toContain(tpl.offboarding);
    });

    it('modèle personnalisé : création, modification, retrait ; `hr.manage`', async () => {
      const corps = {
        kind: 'onboarding',
        label: 'Accueil chauffeur',
        items: [
          { label: 'Permis vérifié', assignee: 'hr', offsetDays: -3 },
          { label: 'Clés remises', assignee: { userId: fx.userIds['ownerB'] }, offsetDays: 0 },
          { label: 'Badge', assignee: 'employee', offsetDays: 2 },
        ],
      };
      expect((await fx.post('analyst', '/hr/checklist-templates', corps)).status).toBe(403);
      code(
        await fx.post('hr_manager', '/hr/checklist-templates', { ...corps, items: [] }),
        400,
        'INVALID_REQUEST',
      );
      const t = ok(await fx.post('hr_manager', '/hr/checklist-templates', corps), 201);
      expect(t['isDefault']).toBe(false);
      expect(t['items'].every((i: { id: string }) => i.id.length > 0)).toBe(true);
      code(
        await fx.put('hr_manager', `/hr/checklist-templates/${t['id']}`, {
          expectedRevision: 9,
          label: 'x',
        }),
        409,
        'STALE_REVISION',
      );
      const t2 = ok(
        await fx.put('hr_manager', `/hr/checklist-templates/${t['id']}`, {
          expectedRevision: 1,
          label: 'Accueil chauffeurs',
        }),
      );
      expect(t2['revision']).toBe(2);
      expect(
        (
          await fx.put('ownerB', `/hr/checklist-templates/${t['id']}`, {
            expectedRevision: 2,
            label: 'y',
          })
        ).status,
      ).toBe(404);

      // Instanciée pour le chauffeur sans compte : tout revient aux RH (l'auteur) ;
      // le compte d'une autre organisation n'est jamais assigné.
      const liste = ok(
        await fx.post('hr_manager', `/hr/employees/${id.S}/checklists`, { templateId: t['id'] }),
        201,
      );
      expect(liste['pivotDate']).toBe('2026-01-05');
      expect(
        liste['items'].map((i: { assigneeUserId: string; dueDate: string }) => [
          i.assigneeUserId,
          i.dueDate,
        ]),
      ).toEqual([
        [fx.userIds['hr_manager'], '2026-01-02'],
        [fx.userIds['hr_manager'], '2026-01-05'],
        [fx.userIds['hr_manager'], '2026-01-07'],
      ]);

      expect((await del('admin', `/hr/checklist-templates/${t['id']}`)).status).toBe(204);
      code(
        await fx.post('hr_manager', `/hr/employees/${id.S}/checklists`, { templateId: t['id'] }),
        404,
        'CHECKLIST_TEMPLATE_NOT_FOUND',
      );
      // La liste déjà instanciée reste.
      const listes = ok(await fx.get('hr_manager', `/hr/checklists?employeeId=${id.S}`));
      expect(listes['items']).toHaveLength(1);
    });
  });

  describe('liste de départ de B', () => {
    it('sortie : propose la liste de départ, n’efface pas l’accès', async () => {
      const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
      const fin = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const sortie = ok(
        await fx.post('owner', `/hr/employees/${id.B}/exit`, {
          endDate: fin,
          exitCategory: 'resignation',
          expectedRevision: b!['revision'],
        }),
      );
      expect(sortie['offboardingSuggested']).toBe(true);
      expect(
        await db
          .collection('memberships')
          .countDocuments({ organizationId: fx.orgN, userId: fx.userIds['viewer'] }),
      ).toBe(1);
      // Rien n'est créé seul.
      expect(await db.collection('hr_checklists').countDocuments({ employeeId: id.B })).toBe(0);
    });

    it('instanciation : assignés résolus, échéances, notification, rien dans un projet', async () => {
      code(
        await fx.post('hr_manager', `/hr/employees/${id.B}/checklists`, {
          templateId: tpl.offboarding,
          hrAssigneeUserId: fx.userIds['analyst'],
        }),
        409,
        'CHECKLIST_ASSIGNEE_NOT_HR',
      );
      expect(
        (await fx.post('admin', `/hr/employees/${id.B}/checklists`, { templateId: 'x' })).status,
      ).toBe(400);
      expect(
        (
          await fx.post('ownerB', `/hr/employees/${id.B}/checklists`, {
            templateId: tpl.offboarding,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await fx.post('analyst', `/hr/employees/${id.B}/checklists`, {
            templateId: tpl.offboarding,
          })
        ).status,
      ).toBe(403);
      const tasksAvant = await db.collection('work_tasks').countDocuments({});
      const projetsAvant = await db.collection('work_projects').countDocuments({});

      const liste = ok(
        await fx.post('hr_manager', `/hr/employees/${id.B}/checklists`, {
          templateId: tpl.offboarding,
          hrAssigneeUserId: fx.userIds['admin'],
        }),
        201,
      );
      depart = liste['id'];
      const b = await db.collection('hr_employees').findOne({ _id: new ObjectId(id.B) });
      expect(liste).toMatchObject({
        employeeId: id.B,
        kind: 'offboarding',
        kindLabel: 'Liste de départ',
        pivotDate: b!['endDate'],
        done: 0,
        total: 3,
      });
      expect(
        liste['items'].map((i: { label: string; assigneeUserId: string }) => [
          i.label,
          i.assigneeUserId,
        ]),
      ).toEqual([
        ['Matériel repris', fx.userIds['analyst']],
        ['Accès Lalanda retiré', fx.userIds['admin']],
        ['Documents de fin remis', fx.userIds['admin']],
      ]);
      // Aucun projet ni aucune tâche RUN.
      expect(await db.collection('work_tasks').countDocuments({})).toBe(tasksAvant);
      expect(await db.collection('work_projects').countDocuments({})).toBe(projetsAvant);

      // Une notification par assigné, l'auteur exclu, sans libellé d'élément.
      const notifs = await db
        .collection('notifications')
        .find({ organizationId: fx.orgN, kind: 'hr.checklist_item_assigned' })
        .toArray();
      expect(notifs.map((n) => n['recipientUserId']).sort()).toEqual(
        [fx.userIds['admin'], fx.userIds['analyst']].sort(),
      );
      for (const n of notifs) {
        expect(n['href']).toBe('/projets/mes-taches');
        expect(n['title']).not.toContain('Matériel');
      }
    });

    it('« Mes tâches » : l’élément chez son seul assigné ; le départ invisible ailleurs', async () => {
      const chezA = await hrItemsOf('analyst');
      expect(chezA).toHaveLength(1);
      expect(chezA[0]).toMatchObject({
        source: 'hr',
        kind: 'checklist_item',
        checklistId: depart,
        itemId: 'materiel-repris',
        id: `hr:item:${depart}:materiel-repris`,
        label: 'Matériel repris',
        kindLabel: 'Liste de départ',
        done: false,
      });
      expect((await hrItemsOf('admin')).map((i: { label: string }) => i.label).sort()).toEqual([
        'Accès Lalanda retiré',
        'Documents de fin remis',
      ]);
      // Ni B lui-même, ni un autre détenteur de `work.read`.
      for (const c of ['viewer', 'accountant', 'finance_director', 'owner'] as const) {
        const items = await hrItemsOf(c);
        expect(items, c).toEqual([]);
      }
      // Les projets RUN ne portent rien du départ.
      const projets = ok(await fx.get('accountant', '/work/projects'));
      expect(JSON.stringify(projets)).not.toContain('Matériel repris');
      // Les listes RH : `hr.read` seulement.
      for (const c of ['accountant', 'analyst', 'viewer'] as const) {
        expect((await fx.get(c, `/hr/checklists?employeeId=${id.B}`)).status, c).toBe(403);
      }
      // `/hr/me` de l'assigné.
      const me = ok(await fx.get('analyst', '/hr/me'));
      expect(me['checklistItems']).toEqual([
        expect.objectContaining({
          checklistId: depart,
          itemId: 'materiel-repris',
          kind: 'offboarding',
        }),
      ]);
    });

    it('cocher : l’assigné ou `hr.manage` ; sinon 404', async () => {
      const chemin = (item: string, sens: 'done' | 'undone') =>
        `/hr/checklists/${depart}/items/${item}/${sens}`;
      code(await fx.post('viewer', chemin('materiel-repris', 'done')), 404, 'CHECKLIST_NOT_FOUND');
      code(
        await fx.post('accountant', chemin('materiel-repris', 'done')),
        404,
        'CHECKLIST_NOT_FOUND',
      );
      code(await fx.post('ownerB', chemin('materiel-repris', 'done')), 404, 'CHECKLIST_NOT_FOUND');
      // L'assigné ne coche pas l'élément d'un autre.
      code(await fx.post('analyst', chemin('documents-fin', 'done')), 404, 'CHECKLIST_NOT_FOUND');
      const fait = ok(await fx.post('analyst', chemin('materiel-repris', 'done')));
      expect(fait).toMatchObject({ id: 'materiel-repris', doneBy: fx.userIds['analyst'] });
      expect(fait['doneAt']).not.toBeNull();
      expect(await hrItemsOf('analyst')).toEqual([]);
      // `hr.manage` décoche ; l'élément revient chez son assigné.
      const defait = ok(await fx.post('hr_manager', chemin('materiel-repris', 'undone')));
      expect(defait['doneAt']).toBeNull();
      expect(await hrItemsOf('analyst')).toHaveLength(1);
      code(await fx.post('hr_manager', chemin('inconnu', 'done')), 404, 'CHECKLIST_ITEM_NOT_FOUND');
      // Toujours pas de projet.
      const liste = ok(await fx.get('admin', `/hr/checklists?employeeId=${id.B}`));
      expect(liste['items'][0]['done']).toBe(0);
    });
  });
});
