// ADR-0032 — GROW : santé, indicateurs investisseurs, parcours.
//
// Exigences testées :
// 1. Forfait : sans `actualsEnabled` (free), santé et indicateurs → 403
//    PLAN_FEATURE_UNAVAILABLE ; le parcours reste ouvert.
// 2. Aucune donnée : tout est indisponible avec une raison, jamais un zéro.
// 3. Réalisé clôturé → burn, marges ; solde déclaré → runway ; ventes → concentration.
// 4. RBAC : le Lecteur lit et ne déclare rien ; le Conseiller (sans `sales.read`)
//    lit les parts SANS les noms des clients.
// 5. Validation : montant en nombre, date future, projet d'une autre organisation,
//    point de checklist automatique.
// 6. GROW lit : aucune donnée de BUILD ni de RUN n'est modifiée par ses routes.
// 7. Isolation : une autre organisation ne voit rien.

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('GROW — santé, indicateurs investisseurs, parcours (ADR-0032)', () => {
  let app: INestApplication;
  const tag = Math.random().toString(36).slice(2, 8);
  const user = (name: string) => ({
    email: `grow-${name}-${tag}@lalanda-test.local`,
    password: `Passw0rd!grow-${name}`,
    name: `Grow ${name}`,
  });
  const owner = user('owner');
  const advisor = user('advisor');
  const viewer = user('viewer');
  const outsider = user('outsider');

  const cookies: Record<string, string[]> = {};
  let orgId = '';
  let outsiderOrgId = '';
  let projectId = '';
  let outsiderProjectId = '';

  const server = () => app.getHttpServer();
  const get = (path: string, who: string) =>
    request(server()).get(path).set('Cookie', cookies[who]!);
  const put = (path: string, who: string, body: unknown) =>
    request(server())
      .put(path)
      .set('Cookie', cookies[who]!)
      .send(body as object);

  async function orgOf(who: string): Promise<string> {
    const res = await get('/organizations', who);
    expect(res.status).toBe(200);
    return (res.body.organizations as { id: string }[])[0]!.id;
  }

  async function invite(email: string, role: string, who: string): Promise<void> {
    const inv = await request(server())
      .post(`/organizations/${orgId}/invitations`)
      .set('Cookie', cookies['owner']!)
      .send({ email, role });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const acc = await request(server())
      .post('/invitations/accept')
      .set('Cookie', cookies[who]!)
      .send({ token: inv.body.token });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    // Organisation active : celle qui invite (chaque compte a aussi la sienne, en free).
    cookies[who] = [...cookies[who]!, `active_org_id=${orgId}`];
  }

  beforeAll(async () => {
    app = await makeE2EApp();
    cookies['owner'] = await registerAndLogin(app, owner);
    cookies['advisor'] = await registerAndLogin(app, advisor);
    cookies['viewer'] = await registerAndLogin(app, viewer);
    cookies['outsider'] = await registerAndLogin(app, outsider);
    orgId = await orgOf('owner');
    outsiderOrgId = await orgOf('outsider');
    const p = await request(server())
      .post('/projects')
      .set('Cookie', cookies['outsider']!)
      .send({ name: `Autre ${tag}`, templateSlug: 'hello-world' });
    expect(p.status).toBe(201);
    outsiderProjectId = p.body.id;
  }, 120_000);

  afterAll(async () => {
    if (app) {
      const db = await dbOf(app);
      await db
        .collection('sales_invoices')
        .deleteMany({ organizationId: { $in: [orgId, outsiderOrgId] } });
    }
    await teardown(app, [owner.email, advisor.email, viewer.email, outsider.email]);
  }, 60_000);

  // ─── 1. Forfait ──────────────────────────────────────────────────────────────
  it('offre free : santé et indicateurs refusés (403 explicite), parcours ouvert', async () => {
    for (const path of ['/grow/health', '/grow/indicators']) {
      const res = await get(path, 'owner');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'PLAN_FEATURE_UNAVAILABLE',
        feature: 'grow',
        plan: 'free',
        upgradeUrl: '/pricing',
      });
      expect(res.body.message).toMatch(/parcours reste accessible/);
    }
    const journey = await get('/grow/journey', 'owner');
    expect(journey.status).toBe(200);
    expect(journey.body.journey).toMatchObject({ suggeree: 'IDEA', retenue: 'IDEA' });
    const profile = await get('/grow/profile', 'owner');
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ planAllowsGrow: false, plan: 'free', declaredCash: null });

    const { BillingService } = await import('../billing/billing.service.js');
    await app.get(BillingService).setPlan(orgId, 'business');
  }, 60_000);

  // ─── 2. Aucune donnée ────────────────────────────────────────────────────────
  it('sans données : indicateurs indisponibles et motivés, score non publié', async () => {
    const ind = await get('/grow/indicators', 'owner');
    expect(ind.status).toBe(200);
    for (const i of Object.values(ind.body.indicateurs) as { disponible: boolean }[]) {
      expect(i.disponible).toBe(false);
    }
    expect(ind.body.indicateurs.burn_rate.raison).toBe('AUCUN_PROJET');
    const health = await get('/grow/health', 'owner');
    expect(health.status).toBe(200);
    expect(health.body.health.score).toMatchObject({
      disponible: false,
      raison: 'DONNEES_INSUFFISANTES',
    });
  }, 60_000);

  // ─── 3. Données réelles ──────────────────────────────────────────────────────
  it('réalisé clôturé → burn et marges ; plan validé et CA → étape FIRST_CUSTOMER', async () => {
    const p = await request(server())
      .post('/projects')
      .set('Cookie', cookies['owner']!)
      .send({
        name: `Grow ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(p.status).toBe(201);
    projectId = p.body.id;
    const plan = await request(server())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookies['owner']!)
      .send({});
    expect(plan.status).toBe(201);

    const months: [number, Record<string, number>][] = [
      [1, { ca: 1000, marge_brute: 600, resultat_net: -100 }],
      [2, { ca: 1000, marge_brute: 600, resultat_net: -200 }],
      [3, { ca: 1000, marge_brute: 600, resultat_net: -300 }],
    ];
    for (const [month, values] of months) {
      const saisie = await put(`/projects/${projectId}/actual-periods/1/${month}`, 'owner', {
        values,
      });
      expect(saisie.status, JSON.stringify(saisie.body)).toBe(200);
      const close = await request(server())
        .post(`/projects/${projectId}/actual-periods/1/${month}/close`)
        .set('Cookie', cookies['owner']!);
      expect(close.status).toBe(201);
    }

    const ind = await get('/grow/indicators', 'owner');
    expect(ind.status).toBe(200);
    expect(ind.body.indicateurs.burn_rate).toMatchObject({
      disponible: true,
      valeur: 200,
      devise: 'USD',
    });
    expect(ind.body.indicateurs.burn_rate.sources[0].source).toBe('build.actuals');
    expect(ind.body.indicateurs.marge_brute).toMatchObject({ disponible: true, valeur: 0.6 });
    expect(ind.body.indicateurs.runway).toMatchObject({ raison: 'TRESORERIE_NON_DECLAREE' });
    expect(ind.body.faits).toMatchObject({
      projet: { id: projectId, selection: 'only_project' },
      moisClotures: 3,
    });

    const journey = await get('/grow/journey', 'owner');
    expect(journey.body.journey.suggeree).toBe('FIRST_CUSTOMER');
  }, 120_000);

  it('solde déclaré → runway ; montant en nombre et date future refusés', async () => {
    const bad = await put('/grow/declared-cash', 'owner', {
      amount: 1200,
      currency: 'USD',
      asOf: '2026-01-01',
    });
    expect(bad.status).toBe(400);
    const future = await put('/grow/declared-cash', 'owner', {
      amount: '1200.00',
      currency: 'USD',
      asOf: '2999-01-01',
    });
    expect(future.status).toBe(400);
    expect(future.body.code).toBe('DATE_IN_FUTURE');

    const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
    const ok = await put('/grow/declared-cash', 'owner', {
      amount: '1200.00',
      currency: 'USD',
      asOf: today,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.declaredCash).toMatchObject({ amount: '1200.00', currency: 'USD', asOf: today });

    const ind = await get('/grow/indicators', 'owner');
    expect(ind.body.indicateurs.runway).toMatchObject({
      disponible: true,
      valeur: 6,
      unite: 'mois',
    });
    expect(ind.body.indicateurs.runway.hypotheses.join(' ')).toMatch(/DÉCLARÉ/);

    const health = await get('/grow/health', 'owner');
    expect(health.status).toBe(200);
    expect(health.body.health.axes.find((a: { axe: string }) => a.axe === 'tresorerie').note).toBe(
      40,
    );
    expect(health.body.health.risques.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['PERTES']),
    );
  }, 60_000);

  it('ventes RUN → concentration clients, noms pour qui lit le fichier clients', async () => {
    const db = await dbOf(app);
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
    const doc = (customerId: string, name: string, ht: string, monthsBack: number) => ({
      organizationId: orgId,
      proformaRef: `PF-GROW-${customerId}-${monthsBack}`,
      status: 'issued',
      series: 'real',
      type: 'FV',
      currency: 'USD',
      issuedAt: new Date(
        Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() - monthsBack, 15, 12),
      ),
      customer: { customerId, name },
      lines: [{ catalogItemId: null }],
      documentAmounts: { calculation: { totals: { groups: [{ group: 'B', ht }] } } },
      normalizedAmounts: null,
    });
    await db
      .collection('sales_invoices')
      .insertMany([
        doc('cA', 'Alpha SARL', '600.00', 0),
        doc('cB', 'Beta SA', '300.00', 1),
        doc('cA', 'Alpha SARL', '100.00', 2),
      ]);

    const ind = await get('/grow/indicators', 'owner');
    expect(ind.body.indicateurs.concentration_clients).toMatchObject({
      disponible: true,
      valeur: 0.7,
    });
    expect(ind.body.indicateurs.concentration_clients.premiersClients[0]).toMatchObject({
      cle: 'cA',
      nom: 'Alpha SARL',
    });
  }, 60_000);

  // ─── 4. RBAC ─────────────────────────────────────────────────────────────────
  it('Conseiller : parts sans noms, aucune déclaration ; Lecteur : lit, ne déclare rien', async () => {
    await invite(advisor.email, 'advisor', 'advisor');
    await invite(viewer.email, 'viewer', 'viewer');

    const adv = await get('/grow/indicators', 'advisor');
    expect(adv.status).toBe(200);
    expect(adv.body.indicateurs.concentration_clients.premiersClients[0]).toMatchObject({
      cle: 'client-1',
      nom: null,
      part: 0.7,
    });
    expect(JSON.stringify(adv.body)).not.toMatch(/Alpha|Beta/);

    const advPut = await put('/grow/profile', 'advisor', {
      referenceProjectId: null,
      declaredStage: null,
      recurringCatalogItemIds: [],
    });
    expect(advPut.status).toBe(403);

    expect((await get('/grow/health', 'viewer')).status).toBe(200);
    expect(
      (await get('/grow/indicators', 'viewer')).body.indicateurs.concentration_clients
        .premiersClients[0].nom,
    ).toBe('Alpha SARL');
    const cash = await put('/grow/declared-cash', 'viewer', {
      amount: '1.00',
      currency: 'USD',
      asOf: '2026-01-01',
    });
    expect(cash.status).toBe(403);
    const del = await request(server())
      .delete('/grow/declared-cash')
      .set('Cookie', cookies['viewer']!);
    expect(del.status).toBe(403);
  }, 120_000);

  // ─── 5. Validation de la fiche ───────────────────────────────────────────────
  it('fiche : projet d’une autre organisation → 404 ; étape déclarée l’emporte, écart montré', async () => {
    const foreign = await put('/grow/profile', 'owner', {
      referenceProjectId: outsiderProjectId,
      declaredStage: null,
      recurringCatalogItemIds: [],
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('PROJECT_NOT_FOUND');

    const unknownField = await put('/grow/profile', 'owner', {
      referenceProjectId: null,
      declaredStage: null,
      recurringCatalogItemIds: [],
      score: 100,
    });
    expect(unknownField.status).toBe(400);

    const ok = await put('/grow/profile', 'owner', {
      referenceProjectId: projectId,
      declaredStage: 'FUNDRAISING',
      recurringCatalogItemIds: [],
    });
    expect(ok.status).toBe(200);
    const journey = await get('/grow/journey', 'owner');
    expect(journey.body.journey).toMatchObject({
      declaree: 'FUNDRAISING',
      retenue: 'FUNDRAISING',
      ecart: true,
    });
    const health = await get('/grow/health', 'owner');
    expect(health.body.health.groupe).toBe('croissance');
  }, 60_000);

  it('checklist : point automatique refusé, point manuel enregistré', async () => {
    const auto = await put('/grow/checklist/validation.plan', 'owner', { done: true });
    expect(auto.status).toBe(400);
    expect(auto.body.code).toBe('CHECKLIST_ITEM_AUTOMATIC');
    const unknown = await put('/grow/checklist/inconnu', 'owner', { done: true });
    expect(unknown.status).toBe(404);
    const ok = await put('/grow/checklist/idea.canvas', 'owner', { done: true });
    expect(ok.status).toBe(200);
    expect(ok.body.checklistDone).toEqual(['idea.canvas']);
    const journey = await get('/grow/journey', 'owner');
    const idea = journey.body.journey.etapes[0].checklist;
    expect(idea.find((i: { id: string }) => i.id === 'idea.canvas').fait).toBe(true);
    expect(idea.find((i: { id: string }) => i.id === 'idea.projet')).toMatchObject({
      mode: 'auto',
      fait: true,
    });
  }, 60_000);

  // ─── 6. Lecture seule ────────────────────────────────────────────────────────
  it('les routes GROW ne modifient ni le réalisé, ni les plans, ni les ventes', async () => {
    const db = await dbOf(app);
    const snap = async () =>
      JSON.stringify(
        await Promise.all(
          ['actual_periods', 'financial_plans', 'sales_invoices', 'projects'].map((c) =>
            db.collection(c).find({ organizationId: orgId }).sort({ _id: 1 }).toArray(),
          ),
        ),
      );
    const before = await snap();
    for (const path of ['/grow/health', '/grow/indicators', '/grow/journey', '/grow/profile']) {
      expect((await get(path, 'owner')).status).toBe(200);
    }
    await put('/grow/profile', 'owner', {
      referenceProjectId: projectId,
      declaredStage: null,
      recurringCatalogItemIds: [],
    });
    expect(await snap()).toBe(before);
  }, 60_000);

  // ─── 7. Isolation ────────────────────────────────────────────────────────────
  it('une autre organisation ne voit rien des données de la première', async () => {
    const profile = await get('/grow/profile', 'outsider');
    expect(profile.status).toBe(200);
    expect(profile.body.declaredCash).toBeNull();
    expect(profile.body.projects.map((p: { id: string }) => p.id)).toEqual([outsiderProjectId]);
    const journey = await get('/grow/journey', 'outsider');
    expect(journey.body.journey.declaree).toBeNull();
  }, 60_000);
});
