// Construction d'un plan par l'IA — ADR-0063, de bout en bout par l'API avec un
// client IA SIMULÉ (jamais d'appel réel) : réponse valide, JSON invalide, dates
// hors bornes, cycle, responsable inconnu, IA indisponible, quota épuisé ; puis
// création du projet relu par le créateur commun, droits et isolation.

import 'reflect-metadata';

import { expect, it } from 'vitest';

import { e2eSuite } from '../__tests__/e2e-utils.js';
import { useWorkFixture } from '../__tests__/work-e2e-fixtures.js';
import type { OpenAIChatClient } from '../ai/ai-actions.service.js';
import { WorkAiPlanService } from './work-ai-plan.service.js';

e2eSuite('construction d’un plan par l’IA (ADR-0063)', () => {
  const f = useWorkFixture('waiplan');
  const calls: { system: string; user: string; maxOutputTokens?: number }[] = [];
  const answer = (raw: string | (() => Promise<string>)) => {
    const client: OpenAIChatClient = {
      chatJson: async (args) => {
        calls.push(args);
        return typeof raw === 'string' ? raw : raw();
      },
    };
    f.app().get(WorkAiPlanService).client = client;
  };
  const usage = () =>
    f
      .db()
      .collection('ai_usage_events')
      .countDocuments({ organizationId: f.orgId(), source: 'llm' });

  const form = () => ({
    name: 'Site vitrine',
    context: 'Boutique de pagnes à Kinshasa',
    objective: 'Mettre en ligne le site de la boutique',
    deliverables: 'Maquettes, Site en ligne',
    startDate: '2026-11-09',
    dueDate: '2026-12-18',
    memberUserIds: [f.userId('analyst'), f.userId('admin')],
    sprintWeeks: 2,
    detail: 'standard',
  });
  const valid = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      resume: 'Cadrage puis réalisation.',
      sprints: [
        { numero: 1, objectif: 'Cadrer' },
        { numero: 2, objectif: 'Maquettes' },
      ],
      jalons: [{ ref: 'J1', titre: 'Maquettes validées', sprint: 2, dependDe: ['T2'] }],
      taches: [
        {
          ref: 'T1',
          titre: 'Cadrer le projet',
          sprint: 1,
          estimationHeures: 4,
          priorite: 'haute',
          dependDe: [],
          responsable: 'm1',
          etiquettes: ['Pilotage'],
        },
        {
          ref: 'T2',
          titre: 'Dessiner les maquettes',
          sprint: 2,
          estimationHeures: 12,
          priorite: 'moyenne',
          dependDe: ['T1'],
          responsable: 'm2',
          etiquettes: ['Design'],
        },
        {
          ref: 'T3',
          titre: 'Intégrer le site',
          sprint: 3,
          estimationHeures: 20,
          priorite: 'moyenne',
          dependDe: ['T2'],
          responsable: null,
          etiquettes: [],
        },
      ],
      ...over,
    });

  let draft: {
    draftId: string;
    description: string;
    tasks: { ref: string; title: string; dueDate: string; assigneeUserId: string | null }[];
  };

  it('réponse valide : plan relisible, dates des sprints, quota décompté une fois, prompt sans e-mail ni identifiant', async () => {
    answer(valid());
    const before = await usage();
    const res = await f.post('owner', '/work/ai/plan', form());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    draft = res.body;
    expect(res.body.sprints).toHaveLength(3);
    expect(res.body.tasks.map((t: { ref: string }) => t.ref)).toEqual(['T1', 'T2', 'T3', 'J1']);
    const t3 = res.body.tasks.find((t: { ref: string }) => t.ref === 'T3');
    expect(t3).toMatchObject({
      startDate: '2026-12-07',
      dueDate: '2026-12-18',
      labels: ['Sprint 3'],
    });
    expect(res.body.tasks[0].assigneeUserId).toBe(f.userId('analyst'));
    expect(res.body.mention).toMatch(/Rien n’est créé/);
    expect(await usage()).toBe(before + 1);
    const prompt = calls.at(-1)!;
    expect(prompt.user).not.toContain(f.userId('analyst'));
    expect(prompt.user).not.toContain('@lalanda-test.local');
    expect(prompt.maxOutputTokens).toBe(4096);
    expect(
      await f.db().collection('work_ai_plan_logs').countDocuments({ outcome: 'accepted' }),
    ).toBe(1);
  });

  it('régénérer compte de nouveau dans le quota', async () => {
    answer(valid());
    const before = await usage();
    expect((await f.post('owner', '/work/ai/plan', form())).status).toBe(200);
    expect(await usage()).toBe(before + 1);
  });

  it('JSON invalide : 422, message clair, rien de décompté, tentative journalisée', async () => {
    answer('{ "taches": [ ');
    const before = await usage();
    const res = await f.post('owner', '/work/ai/plan', form());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WORK_AI_INVALID_RESPONSE');
    expect(await usage()).toBe(before);
    expect(
      await f.db().collection('work_ai_plan_logs').countDocuments({ outcome: 'rejected' }),
    ).toBe(1);
  });

  it('dates hors bornes, cycle, responsable inconnu : corrigés et signalés', async () => {
    answer(
      valid({
        jalons: [{ ref: 'J1', titre: 'Fin', sprint: 3, date: '2027-05-01' }],
        taches: [
          { ref: 'A', titre: 'A', sprint: 7, dependDe: ['C'], responsable: 'm9' },
          { ref: 'B', titre: 'B', sprint: 1, dependDe: ['A'] },
          { ref: 'C', titre: 'C', sprint: 1, dependDe: ['B'] },
        ],
      }),
    );
    const res = await f.post('owner', '/work/ai/plan', form());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const t of res.body.tasks as { dueDate: string }[]) {
      expect(t.dueDate >= '2026-11-09' && t.dueDate <= '2026-12-18').toBe(true);
    }
    const c = (res.body.corrections as string[]).join('\n');
    expect(c).toMatch(/hors de la période/);
    expect(c).toMatch(/Boucle de dépendances/);
    expect(c).toMatch(/« m9 » inconnu/);
  });

  it('IA indisponible (panne, délai) : 503 et rien de décompté ; sans client : 503', async () => {
    answer(() => Promise.reject(Object.assign(new Error('délai'), { name: 'OpenAITimeoutError' })));
    const before = await usage();
    const res = await f.post('owner', '/work/ai/plan', form());
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_AI_UNAVAILABLE');
    f.app().get(WorkAiPlanService).client = null;
    expect((await f.post('owner', '/work/ai/plan', form())).status).toBe(503);
    expect(await usage()).toBe(before);
  });

  it('membre choisi d’une autre organisation : refusé, aucun appel', async () => {
    answer(valid());
    const n = calls.length;
    const res = await f.post('owner', '/work/ai/plan', {
      ...form(),
      memberUserIds: [f.userId('ownerB')],
    });
    expect(res.status).toBe(404);
    expect(calls.length).toBe(n);
  });

  it('droits : un analyste (sans work.manage) ne peut ni proposer ni créer', async () => {
    answer(valid());
    expect((await f.post('analyst', '/work/ai/plan', form())).status).toBe(403);
  });

  it('créer le projet relu : titre, date, responsable modifiés, tâche retirée — créateur commun', async () => {
    const tasks = draft.tasks
      .filter((t) => t.ref !== 'T3')
      .map((t) =>
        t.ref === 'T1' ? { ...t, title: 'Cadrer avec la dirigeante', assigneeUserId: null } : t,
      )
      .map((t) => (t.ref === 'J1' ? { ...t, dueDate: '2026-12-04' } : t));
    const body = {
      origin: 'ai',
      aiDraftId: draft.draftId,
      project: {
        name: 'Site vitrine',
        kind: 'internal',
        startDate: '2026-11-09',
        dueDate: '2026-12-18',
        description: draft.description,
      },
      tasks,
    };
    expect((await f.post('analyst', '/work/plans/projects', body)).status).toBe(403);
    const res = await f.post('owner', '/work/plans/projects', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      createdTasks: 3,
      createdMilestones: 1,
      createdDependencies: 2,
    });
    const list = await f.get('owner', `/work/projects/${res.body.projectId}/tasks`);
    const titles = (list.body.items as { title: string }[]).map((t) => t.title);
    expect(titles).toContain('Cadrer avec la dirigeante');
    expect(titles).not.toContain('Intégrer le site');
    const log = await f
      .db()
      .collection('work_ai_plan_logs')
      .findOne({ projectId: res.body.projectId });
    expect(log?.['outcome']).toBe('accepted');
    const audit = await f
      .db()
      .collection('audit_events')
      .findOne({ targetId: res.body.projectId, action: 'work.plan.project_created' });
    expect(audit?.['metadata']).toMatchObject({ origin: 'ai' });
  });

  it('plan modifié incohérent (cycle, référence inconnue) : 400 avant toute écriture', async () => {
    const before = await f.db().collection('work_projects').countDocuments();
    const res = await f.post('owner', '/work/plans/projects', {
      origin: 'ai',
      project: { name: 'Cycle', kind: 'internal' },
      tasks: [
        { ref: 'T1', title: 'A', dependsOn: ['T2'] },
        { ref: 'T2', title: 'B', dependsOn: ['T1'] },
      ],
    });
    expect(res.status).toBe(400);
    expect(f.issueCodes(res)).toContain('WORK_DEPENDENCY_CYCLE');
    const res2 = await f.post('owner', '/work/plans/projects', {
      origin: 'ai',
      project: { name: 'Inconnu', kind: 'internal' },
      tasks: [{ ref: 'T1', title: 'A', assigneeUserId: f.userId('ownerB') }],
    });
    expect(res2.status).toBe(404);
    expect(await f.db().collection('work_projects').countDocuments()).toBe(before);
  });

  it('quota épuisé : 403 avant tout appel, message qui nomme la limite', async () => {
    answer(valid());
    const now = new Date();
    await f
      .db()
      .collection('ai_usage_events')
      .insertMany(
        Array.from({ length: 2_100 }, () => ({
          organizationId: f.orgId(),
          userId: f.userId('owner'),
          action: 'test',
          source: 'llm',
          createdAt: now,
        })),
      );
    const n = calls.length;
    const res = await f.post('owner', '/work/ai/plan', form());
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/messages IA/);
    expect(calls.length).toBe(n);
  });
});
