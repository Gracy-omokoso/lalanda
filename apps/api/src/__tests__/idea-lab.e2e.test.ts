// ADR-0036 — Idea Lab et validation d'idée.
//
// Exigences testées :
// 1. Fiche : création, lecture, comparaison ; taille de marché sans source → 400.
// 2. Validation : note sans preuve → 400 ; score « indisponible » sous le seuil,
//    puis calculé par le moteur ; parcours GROW en VALIDATION par l'idée notée.
// 3. Expériences : taux calculé, conclusion exigée pour une expérience terminée,
//    preuve citant une expérience inconnue → 400.
// 4. RBAC : le Lecteur et le Conseiller lisent, ne modifient pas, n'appellent pas l'IA ;
//    seul `organization.manage` règle l'IA.
// 5. Isolation : une autre organisation ne voit ni l'idée ni ne la promeut ; un projet
//    d'une autre organisation → 404.
// 6. Promotion : cartes de texte ajoutées au Canvas existant, idempotente, aucun
//    nombre ni driver écrit.
// 7. IA : sans clé → repli déterministe, quota intact ; désactivée → repli, aucun appel.

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('Idea Lab et validation d’idée (ADR-0036)', () => {
  let app: INestApplication;
  let cleAvant: string | undefined;
  const tag = Math.random().toString(36).slice(2, 8);
  const user = (name: string) => ({
    email: `idea-${name}-${tag}@lalanda-test.local`,
    password: `Passw0rd!idea-${name}`,
    name: `Idea ${name}`,
  });
  const owner = user('owner');
  const advisor = user('advisor');
  const viewer = user('viewer');
  const outsider = user('outsider');

  const cookies: Record<string, string[]> = {};
  let orgId = '';
  let ideaId = '';
  let outsiderProjectId = '';

  const server = () => app.getHttpServer();
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    who: string,
    body?: unknown,
  ) => {
    const r = request(server())[method](path).set('Cookie', cookies[who]!);
    return body === undefined ? r : r.send(body as object);
  };

  const FICHE = {
    title: 'Chambre froide partagée',
    problem: 'Les commerçantes du marché perdent leurs invendus de poisson.',
    target: 'Commerçantes de poisson du marché de la Liberté',
    solution: 'Location de casiers réfrigérés à la journée.',
    alternatives: [{ name: 'Glacières', description: 'Glace achetée chaque matin', source: null }],
    revenueModel: 'Location à la journée',
    country: 'CD',
    market: 'Marchés de Kinshasa',
    hypotheses: [{ id: 'h1', text: 'Les commerçantes paieront chaque jour', status: 'a_tester' }],
  };

  async function orgOf(who: string): Promise<string> {
    const res = await call('get', '/organizations', who);
    expect(res.status).toBe(200);
    return (res.body.organizations as { id: string }[])[0]!.id;
  }

  async function invite(email: string, role: string, who: string): Promise<void> {
    const inv = await call('post', `/organizations/${orgId}/invitations`, 'owner', { email, role });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const acc = await call('post', '/invitations/accept', who, { token: inv.body.token });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    cookies[who] = [...cookies[who]!, `active_org_id=${orgId}`];
  }

  beforeAll(async () => {
    // Aucun appel à un modèle réel : sans clé, l'IA retombe sur le texte déterministe.
    cleAvant = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    app = await makeE2EApp();
    cookies['owner'] = await registerAndLogin(app, owner);
    cookies['advisor'] = await registerAndLogin(app, advisor);
    cookies['viewer'] = await registerAndLogin(app, viewer);
    cookies['outsider'] = await registerAndLogin(app, outsider);
    orgId = await orgOf('owner');
    await invite(advisor.email, 'advisor', 'advisor');
    await invite(viewer.email, 'viewer', 'viewer');
    const p = await call('post', '/projects', 'outsider', {
      name: `Autre ${tag}`,
      templateSlug: 'hello-world',
    });
    expect(p.status).toBe(201);
    outsiderProjectId = p.body.id;
  }, 180_000);

  afterAll(async () => {
    if (cleAvant !== undefined) process.env['OPENAI_API_KEY'] = cleAvant;
    await teardown(app, [owner.email, advisor.email, viewer.email, outsider.email]);
  }, 60_000);

  // ─── 1. Fiche ────────────────────────────────────────────────────────────────
  it('crée une idée, la liste et la compare ; taille de marché sans source refusée', async () => {
    const created = await call('post', '/idea-lab/ideas', 'owner', FICHE);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ideaId = created.body.id;
    expect(created.body).toMatchObject({
      title: FICHE.title,
      gridVersion: 'IDEA_VALIDATION_GRID_V1',
      archived: false,
      marketSize: null,
    });
    expect(created.body.validation.score).toMatchObject({
      disponible: false,
      raison: 'CRITERES_INSUFFISANTS',
    });

    const sansSource = await call('put', `/idea-lab/ideas/${ideaId}`, 'owner', {
      ...FICHE,
      marketSize: { value: '1200', unit: 'personnes', scope: 'Commerçantes de poisson' },
    });
    expect(sansSource.status).toBe(400);
    expect(sansSource.body.message).toMatch(/source/);

    const avecSource = await call('put', `/idea-lab/ideas/${ideaId}`, 'owner', {
      ...FICHE,
      marketSize: {
        value: '1200',
        unit: 'personnes',
        scope: 'Commerçantes de poisson',
        source: 'Comptage au marché, octobre 2026',
      },
    });
    expect(avecSource.status, JSON.stringify(avecSource.body)).toBe(200);
    expect(avecSource.body.marketSize).toMatchObject({ value: '1200', currency: null });

    const list = await call('get', '/idea-lab/ideas', 'owner');
    expect(list.status).toBe(200);
    expect(list.body.ideas).toHaveLength(1);
    expect(list.body.comparison[0]).toMatchObject({ id: ideaId, rang: null, score: null });
    expect(list.body.grid.version).toBe('IDEA_VALIDATION_GRID_V1');
    expect(list.body).toMatchObject({ canEdit: true, canManageAi: true });

    const journey = await call('get', '/grow/journey', 'owner');
    expect(journey.body.journey.suggeree).toBe('IDEA');
    const item = journey.body.journey.etapes[0].checklist.find(
      (i: { id: string }) => i.id === 'idea.lab',
    );
    expect(item).toMatchObject({ mode: 'auto', fait: true });
  });

  // ─── 2 et 3. Validation et expériences ───────────────────────────────────────
  it('expériences et notes : taux du moteur, preuve obligatoire, score puis parcours', async () => {
    const nonConclue = await call('post', `/idea-lab/ideas/${ideaId}/experiments`, 'owner', {
      type: 'entretiens',
      title: 'Entretiens au marché',
      status: 'terminee',
    });
    expect(nonConclue.status).toBe(400);

    const exp = await call('post', `/idea-lab/ideas/${ideaId}/experiments`, 'owner', {
      type: 'entretiens',
      title: 'Entretiens au marché',
      hypothesis: 'Les invendus sont un problème quotidien',
      targetPct: 60,
      status: 'terminee',
      conclusion: 'confirmee',
      results: { realises: 12, confirmant: 9 },
    });
    expect(exp.status, JSON.stringify(exp.body)).toBe(201);
    const e = exp.body.experiments[0];
    expect(e.summary).toMatchObject({
      taux: { numerateur: 9, denominateur: 12, valeur: 0.75 },
      atteint: true,
      ecartConclusion: false,
      termineeAvecResultat: true,
    });

    const sansPreuve = await call('put', `/idea-lab/ideas/${ideaId}/ratings/probleme`, 'owner', {
      note: 3,
    });
    expect(sansPreuve.status).toBe(400);
    const inconnue = await call('put', `/idea-lab/ideas/${ideaId}/ratings/probleme`, 'owner', {
      note: 3,
      proof: '9 entretiens sur 12',
      experimentIds: ['inconnue'],
    });
    expect(inconnue.status).toBe(400);
    const critereInconnu = await call('put', `/idea-lab/ideas/${ideaId}/ratings/beaute`, 'owner', {
      note: 3,
      proof: 'aucune',
    });
    expect(critereInconnu.status).toBe(404);

    const notes: [string, number][] = [
      ['probleme', 3],
      ['alternatives', 2],
      ['cible', 4],
    ];
    for (const [c, note] of notes) {
      const r = await call('put', `/idea-lab/ideas/${ideaId}/ratings/${c}`, 'owner', {
        note,
        proof: 'Constaté lors des entretiens',
        experimentIds: c === 'probleme' ? [e.id] : [],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const trois = await call('get', `/idea-lab/ideas/${ideaId}`, 'owner');
    expect(trois.body.validation.score.disponible).toBe(false);

    const quatre = await call('put', `/idea-lab/ideas/${ideaId}/ratings/marche`, 'owner', {
      note: 2,
      proof: 'Comptage au marché',
    });
    expect(quatre.status).toBe(200);
    // 100 × (25×3 + 15×2 + 10×4 + 10×2) ÷ (4 × 60) = 68,75 → 69
    expect(quatre.body.validation.score).toMatchObject({
      disponible: true,
      valeur: 69,
      niveau: 'a_consolider',
    });

    const journey = await call('get', '/grow/journey', 'owner');
    expect(journey.body.journey.suggeree).toBe('VALIDATION');
    expect(journey.body.journey.reglesVersion).toBe('GROW_JOURNEY_RULES_V2');
  });

  // ─── 4. RBAC ─────────────────────────────────────────────────────────────────
  it('Lecteur et Conseiller lisent ; ils ne modifient rien et n’appellent pas l’IA', async () => {
    for (const who of ['viewer', 'advisor']) {
      expect((await call('get', '/idea-lab/ideas', who)).status).toBe(200);
      const one = await call('get', `/idea-lab/ideas/${ideaId}`, who);
      expect(one.status).toBe(200);
      expect((await call('get', '/idea-lab/ideas', who)).body.canEdit).toBe(false);
      expect((await call('post', '/idea-lab/ideas', who, FICHE)).status).toBe(403);
      expect((await call('put', `/idea-lab/ideas/${ideaId}`, who, FICHE)).status).toBe(403);
      expect(
        (await call('post', `/idea-lab/ideas/${ideaId}/assist`, who, { intent: 'hypotheses' }))
          .status,
      ).toBe(403);
      expect((await call('put', '/idea-lab/settings', who, { aiEnabled: false })).status).toBe(403);
    }
  });

  // ─── 5. Isolation ────────────────────────────────────────────────────────────
  it('une autre organisation ne voit ni ne modifie l’idée ; projet étranger → 404', async () => {
    expect((await call('get', `/idea-lab/ideas/${ideaId}`, 'outsider')).status).toBe(404);
    expect((await call('put', `/idea-lab/ideas/${ideaId}`, 'outsider', {})).status).toBe(404);
    expect((await call('get', '/idea-lab/ideas', 'outsider')).body.ideas).toEqual([]);
    expect((await call('get', '/idea-lab/ideas/pas-un-id', 'owner')).status).toBe(404);
    const foreign = await call('post', `/idea-lab/ideas/${ideaId}/promote`, 'owner', {
      projectId: outsiderProjectId,
    });
    expect(foreign.status).toBe(404);
  });

  // ─── 6. Promotion ────────────────────────────────────────────────────────────
  it('promotion : cartes de texte dans le Canvas, idempotente, aucun nombre ni driver', async () => {
    const p = await call('post', '/projects', 'owner', {
      name: FICHE.title,
      templateSlug: 'hello-world',
    });
    expect(p.status).toBe(201);
    const projectId = p.body.id as string;
    const driversAvant = p.body.driverValues;

    const first = await call('post', `/idea-lab/ideas/${ideaId}/promote`, 'owner', { projectId });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.added).toHaveLength(4);
    expect(first.body.canvasVersion).toBe(1);

    const canvas = await call('get', `/projects/${projectId}/canvas`, 'owner');
    expect(canvas.body.blocs.proposition_valeur.map((c: { texte: string }) => c.texte)).toEqual([
      `Problème : ${FICHE.problem}`,
      `Solution : ${FICHE.solution}`,
    ]);
    expect(canvas.body.blocs.segments_clients[0].texte).toBe(FICHE.target);
    expect(canvas.body.blocs.couts).toEqual([]);
    // La taille de marché (1200) n'est écrite nulle part dans le Canvas.
    expect(JSON.stringify(canvas.body.blocs)).not.toContain('1200');

    const again = await call('post', `/idea-lab/ideas/${ideaId}/promote`, 'owner', { projectId });
    expect(again.status).toBe(201);
    expect(again.body.added).toEqual([]);
    expect(again.body.present).toHaveLength(4);
    expect(again.body.canvasVersion).toBe(1);

    const project = await call('get', `/projects/${projectId}`, 'owner');
    expect(project.body.driverValues).toEqual(driversAvant);
    expect(again.body.idea.promotions).toHaveLength(2);
  });

  // ─── 7. IA ───────────────────────────────────────────────────────────────────
  it('IA sans clé : repli déterministe, quota intact ; désactivée par l’organisation', async () => {
    const r = await call('post', `/idea-lab/ideas/${ideaId}/assist`, 'owner', {
      intent: 'questions_entretien',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ source: 'fallback', reason: 'indisponible' });
    expect(r.body.answer.questions.length).toBeGreaterThanOrEqual(5);
    const quota = await call('get', '/ai/quota', 'owner');
    expect(quota.body.used).toBe(0);

    expect(
      (await call('post', `/idea-lab/ideas/${ideaId}/assist`, 'owner', { intent: 'x' })).status,
    ).toBe(400);

    const off = await call('put', '/idea-lab/settings', 'owner', { aiEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ aiEnabled: false, disabledBy: 'organization' });
    const r2 = await call('post', `/idea-lab/ideas/${ideaId}/assist`, 'owner', {
      intent: 'reformuler',
    });
    expect(r2.body).toMatchObject({ source: 'fallback', reason: 'desactivee_organisation' });
    expect(r2.body.answer.reformulation.probleme).toBe(FICHE.problem);
  });

  it('archivage : l’idée sort de la comparaison et des faits du parcours', async () => {
    const a = await call('put', `/idea-lab/ideas/${ideaId}/archived`, 'owner', { archived: true });
    expect(a.status).toBe(200);
    const list = await call('get', '/idea-lab/ideas', 'owner');
    expect(list.body.comparison).toEqual([]);
    expect(list.body.ideas[0].archived).toBe(true);
    const journey = await call('get', '/grow/journey', 'owner');
    expect(journey.body.journey.suggeree).toBe('IDEA');
  });
});
