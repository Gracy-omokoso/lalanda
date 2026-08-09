// S18b — suivi prévisionnel vs réalisé : périodes mensuelles, clôture, écarts,
// projection actualisée (docs/08, docs/22 § Période réalisée, ADR-0011).
//
// Exigences testées :
// 1. Sans plan validé, écarts et projection → 409 { code: 'NO_APPROVED_PLAN' }.
// 2. Saisie mensuelle (PUT) puis lecture (GET ?year=N).
// 3. Écarts corrects sur un cas chiffré, sens produit/charge respecté.
// 4. ADR-0011 friction n°3 : une ligne du réalisé absente du plan validé est
//    renvoyée « non comparable » — jamais un écart de 100 %.
// 4bis. Ligne du plan jamais saisie → `saisi: false` et réalisé `null`, jamais −100 %.
// 4ter. Exercice non publié par le plan comparé → `EXERCICE_ABSENT_DU_PLAN`.
// 4quater. Solde saisi incohérent avec ses composants → diagnostic `INCOHERENCE_SOLDE`.
// 4quinquies. `null` efface une cellule ; un lineId hors plan est refusé (`UNKNOWN_LINE`).
// 5. Période clôturée protégée : PUT refusé → 409 { code: 'PERIOD_CLOSED' }.
// 6. Réouverture : motif obligatoire (400), owner uniquement (403 pour un member),
//    journalisée dans `reopenedLog`, puis la saisie redevient possible.
// 7. Projection actualisée = réalisé CLÔTURÉ + prévisionnel des mois restants.
// 8. Isolation org : un user d'une autre org reçoit 404 sur tous les endpoints.
//
// Même convention que plans.e2e.test.ts : nécessite MONGODB_URI, sinon skip.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import type { Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import { e2eSuite, teardown } from './e2e-utils.js';

import { e2eSuite, teardown } from './e2e-utils.js';

async function makeApp(): Promise<INestApplication> {
  const { AppModule } = await import('../app.module.js');
  const { getAuth } = await import('../auth/auth.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({
    origin: [process.env['WEB_URL'] ?? 'http://localhost:3000'],
    credentials: true,
  });
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, ...handlers: unknown[]) => void;
  };
  expressApp.all('/auth/*', toNodeHandler(getAuth()));
  await app.init();
  return app;
}

interface VarianceLineBody {
  lineId: string;
  label: string;
  sens: 'produit' | 'charge';
  comparable: boolean;
  raison: string | null;
  saisi: boolean;
  base: 'projection' | 'activite_x12' | null;
  prevuMensuel: number | null;
  prevuCumule: number | null;
  realiseCumule: number | null;
  ecart: number | null;
  ecartPct: number | null;
  statut: 'favorable' | 'defavorable' | 'conforme' | null;
  diagnostics: { code: string; message: string; months: number[] }[];
}

interface ProjectionLineBody {
  lineId: string;
  comparable: boolean;
  raison: string | null;
  planAnnuel: number | null;
  realiseClos: number | null;
  previsionnelRestant: number | null;
  totalProjete: number | null;
  ecartVsPlan: number | null;
}

e2eSuite('périodes réalisées, clôture et écarts (S18b — docs/08)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const owner = {
    email: `actowner-${tag}@lalanda-test.local`,
    password: 'Passw0rd!actowner',
    name: 'ActualOwner',
  };
  const member = {
    email: `actmember-${tag}@lalanda-test.local`,
    password: 'Passw0rd!actmember',
    name: 'ActualMember',
  };
  const outsider = {
    email: `actout-${tag}@lalanda-test.local`,
    password: 'Passw0rd!actout',
    name: 'ActualOutsider',
  };

  let cookiesOwner: string[] = [];
  let projectId = '';
  let ownerOrgId = '';

  beforeAll(async () => {
    app = await makeApp();
    cookiesOwner = await registerAndLogin(owner);

    const orgs = await request(app.getHttpServer())
      .get('/organizations')
      .set('Cookie', cookiesOwner);
    expect(orgs.status).toBe(200);
    ownerOrgId = (orgs.body.organizations as { id: string }[])[0]!.id;

    // hello-world : ca = prix_unitaire × quantite_mois = 10 × 100 = 1 000 / mois,
    // cout_variable = 40 % du CA = 400 / mois. Le plan annuel vaut donc
    // 12 000 de CA et 4 800 de coût variable (convention MVP : mensuel × 12).
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesOwner)
      .send({
        name: `Réalisé ${tag}`,
        templateSlug: 'hello-world',
        driverValues: { prix_unitaire: 10, quantite_mois: 100 },
      });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [owner.email, member.email, outsider.email]);
  }, 30_000);

  async function registerAndLogin(user: {
    email: string;
    password: string;
    name: string;
  }): Promise<string[]> {
    const server = app.getHttpServer();
    let res = await request(server)
      .post('/auth/sign-up/email')
      .send({ email: user.email, password: user.password, name: user.name });
    if (res.status >= 400) {
      res = await request(server)
        .post('/auth/sign-in/email')
        .send({ email: user.email, password: user.password });
    }
    expect(res.status).toBeLessThan(400);
    const rawCookies = res.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    return cookies.map((c: string) => c.split(';')[0]!);
  }

  // ─── 1. Aucune référence sans plan validé ──────────────────
  it('sans plan validé : écarts, projection ET saisie renvoient 409 NO_APPROVED_PLAN', async () => {
    const variances = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect(variances.status).toBe(409);
    expect(variances.body.code).toBe('NO_APPROVED_PLAN');

    const projection = await request(app.getHttpServer())
      .get(`/projects/${projectId}/updated-projection?year=1`)
      .set('Cookie', cookiesOwner);
    expect(projection.status).toBe(409);
    expect(projection.body.code).toBe('NO_APPROVED_PLAN');

    // Saisir un réalisé sans référence n'a pas de sens et ouvrirait la porte aux
    // lignes fantômes : la saisie est bornée par le plan validé courant.
    const saisie = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/1`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 1_000 } });
    expect(saisie.status).toBe(409);
    expect(saisie.body.code).toBe('NO_APPROVED_PLAN');
  }, 30_000);

  // ─── 2. Saisie mensuelle ───────────────────────────────────
  it('valide un plan puis saisit deux mois de réalisé', async () => {
    const plan = await request(app.getHttpServer())
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesOwner)
      .send({});
    expect(plan.status).toBe(201);
    expect(plan.body.version).toBe(1);

    const m1 = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/1`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 1_200, cout_variable: 300 } });
    expect(m1.status).toBe(200);
    expect(m1.body.status).toBe('open');
    expect(m1.body.values.ca).toBe(1_200);
    expect(m1.body.closedAt).toBeNull();

    const m2 = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/2`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 900, cout_variable: 500 } });
    expect(m2.status).toBe(200);

    // Saisie incrémentale : un second PUT fusionne sans écraser les clés absentes.
    const m2bis = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/2`)
      .set('Cookie', cookiesOwner)
      .send({ values: { cout_variable: 450 } });
    expect(m2bis.status).toBe(200);
    expect(m2bis.body.values.ca).toBe(900);
    expect(m2bis.body.values.cout_variable).toBe(450);

    const list = await request(app.getHttpServer())
      .get(`/projects/${projectId}/actual-periods?year=1`)
      .set('Cookie', cookiesOwner);
    expect(list.status).toBe(200);
    expect(list.body.year).toBe(1);
    expect((list.body.periods as { month: number }[]).map((p) => p.month)).toEqual([1, 2]);
  }, 30_000);

  it('refuse un mois hors bornes, une valeur non numérique et une ligne hors plan (400)', async () => {
    const badMonth = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/13`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 1 } });
    expect(badMonth.status).toBe(400);
    expect(badMonth.body.code).toBe('INVALID_PERIOD');

    const badValue = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/3`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 'beaucoup' } });
    expect(badValue.status).toBe(400);
    expect(badValue.body.code).toBe('INVALID_VALUES');

    // Ligne inconnue du compte d'exploitation → refusée, pas stockée en fantôme.
    const ghost = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/3`)
      .set('Cookie', cookiesOwner)
      .send({ values: { caf_totale: 500 } });
    expect(ghost.status).toBe(400);
    expect(ghost.body.code).toBe('UNKNOWN_LINE');
  }, 30_000);

  it('une valeur null efface la cellule et la ramène à « non saisi »', async () => {
    const set = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/4`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 700, cout_variable: 200 } });
    expect(set.status).toBe(200);
    expect(set.body.values.ca).toBe(700);

    const erase = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/4`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: null } });
    expect(erase.status).toBe(200);
    expect(erase.body.values.ca).toBeUndefined();
    // Les autres cellules du mois sont intactes.
    expect(erase.body.values.cout_variable).toBe(200);

    // Un 0 explicite reste une observation, lui.
    const zero = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/4`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 0 } });
    expect(zero.status).toBe(200);
    expect(zero.body.values.ca).toBe(0);

    // Nettoyage : ce mois ne doit pas polluer les cumuls des tests suivants.
    const cleanup = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/4`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: null, cout_variable: null } });
    expect(cleanup.status).toBe(200);
    expect(Object.keys(cleanup.body.values)).toHaveLength(0);
  }, 30_000);

  // ─── 3 & 4. Écarts et lignes non comparables ───────────────
  it('calcule les écarts sur le cas chiffré et respecte le sens des lignes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect(res.status).toBe(200);
    expect(res.body.planVersion).toBe(1);
    expect(res.body.convention).toBe('annuel/12');
    expect(res.body.monthsCounted).toEqual([1, 2]);

    const lines = res.body.lines as VarianceLineBody[];
    const byId = Object.fromEntries(lines.map((l) => [l.lineId, l]));

    // CA : prévu 1 000/mois × 2 mois = 2 000 ; réalisé 1 200 + 900 = 2 100.
    const ca = byId['ca']!;
    expect(ca.comparable).toBe(true);
    expect(ca.sens).toBe('produit');
    expect(ca.prevuMensuel).toBe(1_000);
    expect(ca.prevuCumule).toBe(2_000);
    expect(ca.realiseCumule).toBe(2_100);
    expect(ca.ecart).toBe(100);
    expect(ca.ecartPct).toBe(0.05);
    // Produit au-dessus du plan → favorable.
    expect(ca.statut).toBe('favorable');

    // Coût variable : prévu 400 × 2 = 800 ; réalisé 300 + 450 = 750 → sous le plan.
    const cout = byId['cout_variable']!;
    expect(cout.sens).toBe('charge');
    expect(cout.prevuCumule).toBe(800);
    expect(cout.realiseCumule).toBe(750);
    expect(cout.ecart).toBe(-50);
    // Charge sous le plan → favorable (sens inverse du produit, docs/08 § Écarts).
    expect(cout.statut).toBe('favorable');

    // `resultat_avant_impot` est un solde de gestion, pas un impôt.
    expect(byId['resultat_avant_impot']!.sens).toBe('produit');
  }, 30_000);

  it('une ligne du plan jamais saisie n’est pas un écart de −100 %', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect(res.status).toBe(200);

    // `resultat_net` fait partie du plan mais n'a jamais été saisi.
    const net = (res.body.lines as VarianceLineBody[]).find((l) => l.lineId === 'resultat_net')!;
    expect(net.comparable).toBe(true);
    expect(net.saisi).toBe(false);
    expect(net.realiseCumule).toBeNull();
    expect(net.ecart).toBeNull();
    expect(net.ecartPct).toBeNull();
    expect(net.statut).toBeNull();
    // Le prévu, lui, est une donnée réelle du plan.
    expect(net.prevuMensuel).toBe(70);
  }, 30_000);

  it('B1 : un exercice que le plan ne publie pas n’est jamais extrapolé', async () => {
    // hello-world n'a pas de feuille `projection` : seul l'exercice 1 est publié.
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=3`)
      .set('Cookie', cookiesOwner);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(3);

    const lines = res.body.lines as VarianceLineBody[];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.comparable === false)).toBe(true);
    expect(lines.every((l) => l.raison === 'EXERCICE_ABSENT_DU_PLAN')).toBe(true);
    expect(lines.every((l) => l.prevuMensuel === null && l.ecart === null)).toBe(true);
    expect(lines.every((l) => l.statut === null)).toBe(true);

    const proj = await request(app.getHttpServer())
      .get(`/projects/${projectId}/updated-projection?year=3`)
      .set('Cookie', cookiesOwner);
    expect(proj.status).toBe(200);
    expect((proj.body.lines as ProjectionLineBody[]).every((l) => l.totalProjete === null)).toBe(
      true,
    );

    // L'exercice 1, lui, reste comparé via `activite × 12`.
    const an1 = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect((an1.body.lines as VarianceLineBody[])[0]!.base).toBe('activite_x12');
  }, 30_000);

  it('I2 : un solde saisi incohérent avec ses composants est signalé', async () => {
    // marge_brute = ca - cout_variable. Sur M5 : 800 − 300 = 500, on saisit 900.
    const saisie = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/5`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 800, cout_variable: 300, marge_brute: 900 } });
    expect(saisie.status).toBe(200);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    const marge = (res.body.lines as VarianceLineBody[]).find((l) => l.lineId === 'marge_brute')!;
    expect(marge.diagnostics).toHaveLength(1);
    expect(marge.diagnostics[0]!.code).toBe('INCOHERENCE_SOLDE');
    expect(marge.diagnostics[0]!.months).toEqual([5]);
    // La saisie n'est pas corrigée d'office — seulement signalée.
    expect(marge.realiseCumule).toBe(900);

    // Corrigée, la ligne redevient muette.
    const fix = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/5`)
      .set('Cookie', cookiesOwner)
      .send({ values: { marge_brute: 500 } });
    expect(fix.status).toBe(200);
    const after = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect(
      (after.body.lines as VarianceLineBody[]).find((l) => l.lineId === 'marge_brute')!.diagnostics,
    ).toHaveLength(0);

    // Nettoyage pour ne pas perturber les cumuls des tests suivants.
    await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/5`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: null, cout_variable: null, marge_brute: null } });
  }, 30_000);

  it('ADR-0011 : une ligne absente du plan validé est « non comparable », pas 100 %', async () => {
    // L'API refuse désormais d'écrire une ligne hors plan (cf. UNKNOWN_LINE), mais
    // le cas existe en base : saisie antérieure au contrôle, ou plan re-validé sur
    // un template qui ne publie plus la ligne. On simule cet héritage en écrivant
    // directement dans la collection, puis on vérifie le chemin de LECTURE.
    const { ActualPeriod } = await import('../actuals/actual-period.schema.js');
    const { getModelToken } = await import('@nestjs/mongoose');
    // Le modèle de l'app, pas `mongoose.connection` : Nest ouvre sa propre connexion.
    const model = app.get<Model<unknown>>(getModelToken(ActualPeriod.name));
    const injected = await model
      .updateOne({ projectId, year: 1, month: 2 }, { $set: { 'values.caf_totale': 500 } })
      .exec();
    expect(injected.matchedCount).toBe(1);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/variances?year=1`)
      .set('Cookie', cookiesOwner);
    expect(res.status).toBe(200);

    const caf = (res.body.lines as VarianceLineBody[]).find((l) => l.lineId === 'caf_totale');
    expect(caf).toBeDefined();
    expect(caf!.comparable).toBe(false);
    expect(caf!.raison).toBe('LIGNE_ABSENTE_DU_PLAN');
    expect(caf!.prevuMensuel).toBeNull();
    expect(caf!.prevuCumule).toBeNull();
    expect(caf!.ecart).toBeNull();
    expect(caf!.ecartPct).toBeNull();
    expect(caf!.statut).toBeNull();
    // Le réalisé hérité reste visible — on n'efface pas la donnée de l'utilisateur.
    expect(caf!.realiseCumule).toBe(500);

    // Et il reste effaçable via la sentinelle `null`, malgré le contrôle d'écriture.
    const clean = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/2`)
      .set('Cookie', cookiesOwner)
      .send({ values: { caf_totale: null } });
    expect(clean.status).toBe(200);
    expect(clean.body.values.caf_totale).toBeUndefined();
  }, 30_000);

  // ─── 5. Période clôturée protégée ──────────────────────────
  it('clôture le mois 1 puis refuse toute saisie (409 PERIOD_CLOSED)', async () => {
    const close = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/close`)
      .set('Cookie', cookiesOwner);
    expect(close.status).toBe(201);
    expect(close.body.status).toBe('closed');
    expect(close.body.closedAt).toBeTruthy();
    expect(close.body.closedBy).toBeTruthy();

    const refused = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/1`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 99_999 } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PERIOD_CLOSED');

    // La valeur d'origine n'a pas bougé.
    const list = await request(app.getHttpServer())
      .get(`/projects/${projectId}/actual-periods?year=1`)
      .set('Cookie', cookiesOwner);
    const m1 = (list.body.periods as { month: number; values: Record<string, number> }[]).find(
      (p) => p.month === 1,
    );
    expect(m1!.values['ca']).toBe(1_200);

    // Re-clôturer une période déjà clôturée est refusé explicitement (docs/22).
    const again = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/close`)
      .set('Cookie', cookiesOwner);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PERIOD_ALREADY_CLOSED');
  }, 30_000);

  // ─── 7. Projection actualisée ──────────────────────────────
  it('projette sur le réalisé CLÔTURÉ + le prévisionnel des mois restants', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/updated-projection?year=1`)
      .set('Cookie', cookiesOwner);
    expect(res.status).toBe(200);
    // Seul le mois 1 est clôturé ; le mois 2 saisi reste « à venir ».
    expect(res.body.monthsClosed).toEqual([1]);

    const lines = res.body.lines as ProjectionLineBody[];
    const ca = lines.find((l) => l.lineId === 'ca')!;
    expect(ca.planAnnuel).toBe(12_000);
    expect(ca.realiseClos).toBe(1_200);
    // 11 mois restants × 1 000.
    expect(ca.previsionnelRestant).toBe(11_000);
    expect(ca.totalProjete).toBe(12_200);
    expect(ca.ecartVsPlan).toBe(200);

    // Ligne du plan absente du mois clôturé : observation manquante, pas un zéro
    // (sinon la projection afficherait un effondrement inventé).
    const net = lines.find((l) => l.lineId === 'resultat_net')!;
    expect(net.comparable).toBe(true);
    expect(net.planAnnuel).toBe(840);
    expect(net.realiseClos).toBeNull();
    expect(net.totalProjete).toBeNull();
    expect(net.ecartVsPlan).toBeNull();
  }, 30_000);

  // ─── 6. Réouverture ────────────────────────────────────────
  it('réouverture : motif obligatoire, double permission (R3), journalisée', async () => {
    // a) Sans motif → 400.
    const sansMotif = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/reopen`)
      .set('Cookie', cookiesOwner)
      .send({ reason: '   ' });
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe('REOPEN_REASON_REQUIRED');

    // b) Un membre de la MÊME org sans droit de réouverture est refusé (403) —
    //    pas un 404 : il a bien accès au projet, c'est la permission qui manque.
    //
    //    S20a — le rôle et le code d'erreur ont changé, VOLONTAIREMENT (ADR-0012
    //    §6 R3). Avant, la réouverture était réservée à `owner` par un test de
    //    rôle codé en dur (`REOPEN_OWNER_ONLY`). Elle exige désormais DEUX
    //    permissions, `period.close` ET `plan.approve` — la « deuxième permission
    //    distincte » de docs/12. On invite donc un `analyst`, qui détient
    //    ni l'une ni l'autre, et on attend le refus générique de la matrice.
    const cookiesMember = await registerAndLogin(member);
    const invite = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', cookiesOwner)
      .send({ email: member.email, role: 'analyst' });
    expect(invite.status).toBe(201);
    const accept = await request(app.getHttpServer())
      .post('/invitations/accept')
      .set('Cookie', cookiesMember)
      .send({ token: invite.body.token });
    expect(accept.status).toBe(201);

    const memberScoped = [...cookiesMember, `active_org_id=${ownerOrgId}`];
    const parMember = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/reopen`)
      .set('Cookie', memberScoped)
      .send({ reason: 'erreur de saisie' });
    expect(parMember.status).toBe(403);
    expect(parMember.body.code).toBe('FORBIDDEN');
    expect(parMember.body.action).toBe('period.close');

    // c) L'owner rouvre avec motif → trace d'audit append-only.
    const reopen = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/reopen`)
      .set('Cookie', cookiesOwner)
      .send({ reason: 'facture de janvier reçue en retard' });
    expect(reopen.status).toBe(201);
    expect(reopen.body.status).toBe('open');
    expect(reopen.body.closedAt).toBeNull();
    expect(reopen.body.reopenedLog).toHaveLength(1);
    expect(reopen.body.reopenedLog[0].reason).toBe('facture de janvier reçue en retard');
    expect(reopen.body.reopenedLog[0].reopenedBy).toBeTruthy();

    // d) La saisie redevient possible sur la période rouverte.
    const corrige = await request(app.getHttpServer())
      .put(`/projects/${projectId}/actual-periods/1/1`)
      .set('Cookie', cookiesOwner)
      .send({ values: { ca: 1_300 } });
    expect(corrige.status).toBe(200);
    expect(corrige.body.values.ca).toBe(1_300);
    // Le journal survit à la nouvelle saisie.
    expect(corrige.body.reopenedLog).toHaveLength(1);

    // e) Rouvrir une période ouverte n'a pas de sens → 409.
    const dejaOuverte = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/reopen`)
      .set('Cookie', cookiesOwner)
      .send({ reason: 'encore' });
    expect(dejaOuverte.status).toBe(409);
    expect(dejaOuverte.body.code).toBe('PERIOD_NOT_CLOSED');
  }, 60_000);

  it('aucune saisie du réalisé ne modifie le plan validé (docs/08)', async () => {
    const plans = await request(app.getHttpServer())
      .get(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesOwner);
    expect(plans.status).toBe(200);
    expect(plans.body.plans).toHaveLength(1);
    expect(plans.body.plans[0].status).toBe('approved');
    expect(plans.body.plans[0].version).toBe(1);
  }, 30_000);

  // ─── 8. Isolation org ──────────────────────────────────────
  it('isolation org : un user d’une autre org reçoit 404 sur tous les endpoints', async () => {
    const cookiesOut = await registerAndLogin(outsider);
    const server = app.getHttpServer();

    const put = await request(server)
      .put(`/projects/${projectId}/actual-periods/1/1`)
      .set('Cookie', cookiesOut)
      .send({ values: { ca: 1 } });
    expect(put.status).toBe(404);
    expect(put.body.code).toBe('PROJECT_NOT_FOUND');

    for (const path of [
      `/projects/${projectId}/actual-periods?year=1`,
      `/projects/${projectId}/variances?year=1`,
      `/projects/${projectId}/updated-projection?year=1`,
    ]) {
      const res = await request(server).get(path).set('Cookie', cookiesOut);
      expect(res.status).toBe(404);
    }

    for (const path of [
      `/projects/${projectId}/actual-periods/1/1/close`,
      `/projects/${projectId}/actual-periods/1/1/reopen`,
    ]) {
      const res = await request(server).post(path).set('Cookie', cookiesOut).send({ reason: 'x' });
      expect(res.status).toBe(404);
    }

    // Et sans session du tout : 401.
    const anon = await request(server).get(`/projects/${projectId}/actual-periods?year=1`);
    expect(anon.status).toBe(401);
  }, 60_000);
});
