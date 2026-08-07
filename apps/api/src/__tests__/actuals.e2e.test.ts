// S18b — suivi prévisionnel vs réalisé : périodes mensuelles, clôture, écarts,
// projection actualisée (docs/08, docs/22 § Période réalisée, ADR-0011).
//
// Exigences testées :
// 1. Sans plan validé, écarts et projection → 409 { code: 'NO_APPROVED_PLAN' }.
// 2. Saisie mensuelle (PUT) puis lecture (GET ?year=N).
// 3. Écarts corrects sur un cas chiffré, sens produit/charge respecté.
// 4. ADR-0011 friction n°3 : une ligne du réalisé absente du plan validé est
//    renvoyée « non comparable » — jamais un écart de 100 %.
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
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import 'reflect-metadata';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env');
loadDotenv({ path: envPath });

const hasMongo = Boolean(process.env['MONGODB_URI']);

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
  prevuMensuel: number | null;
  prevuCumule: number | null;
  realiseCumule: number;
  ecart: number | null;
  ecartPct: number | null;
  statut: 'favorable' | 'defavorable' | null;
}

interface ProjectionLineBody {
  lineId: string;
  comparable: boolean;
  planAnnuel: number | null;
  realiseClos: number;
  previsionnelRestant: number | null;
  totalProjete: number | null;
  ecartVsPlan: number | null;
}

const suite = hasMongo ? describe : describe.skip;

suite('périodes réalisées, clôture et écarts (S18b — docs/08)', () => {
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
    try {
      const db = mongoose.connection.db;
      if (db) {
        await Promise.all([
          db
            .collection('user')
            .deleteMany({ email: { $in: [owner.email, member.email, outsider.email] } }),
          db.collection('actual_periods').deleteMany({ projectId }),
          db.collection('financial_plans').deleteMany({ projectId }),
          db
            .collection('invitations')
            .deleteMany({ organizationId: ownerOrgId })
            .catch(() => {}),
          db
            .collection('projects')
            .deleteMany({ name: { $regex: `${tag}$` } })
            .catch(() => {}),
          db
            .collection('organizations')
            .deleteMany({ slug: { $regex: /^actowner|^actmember|^actout/ } })
            .catch(() => {}),
        ]);
      }
    } catch {
      // Best-effort.
    }
    await app?.close();
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
  it('sans plan validé : écarts et projection renvoient 409 NO_APPROVED_PLAN', async () => {
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
      // `caf_totale` n'existe pas dans le plan hello-world : cas ADR-0011 n°3.
      .send({ values: { ca: 1_200, cout_variable: 300, caf_totale: 500 } });
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

  it('refuse un mois hors bornes et une valeur non numérique (400)', async () => {
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

  it('ADR-0011 : une ligne absente du plan validé est « non comparable », pas 100 %', async () => {
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
    // Le réalisé saisi reste visible — on n'efface pas la donnée de l'utilisateur.
    expect(caf!.realiseCumule).toBe(500);
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

    // Une ligne non comparable n'est jamais projetée.
    const caf = lines.find((l) => l.lineId === 'caf_totale')!;
    expect(caf.comparable).toBe(false);
    expect(caf.planAnnuel).toBeNull();
    expect(caf.totalProjete).toBeNull();
    expect(caf.realiseClos).toBe(500);
  }, 30_000);

  // ─── 6. Réouverture ────────────────────────────────────────
  it('réouverture : motif obligatoire, owner uniquement, journalisée', async () => {
    // a) Sans motif → 400.
    const sansMotif = await request(app.getHttpServer())
      .post(`/projects/${projectId}/actual-periods/1/1/reopen`)
      .set('Cookie', cookiesOwner)
      .send({ reason: '   ' });
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe('REOPEN_REASON_REQUIRED');

    // b) Un simple `member` de la MÊME org est refusé (403) — pas un 404 : il a
    //    bien accès au projet, c'est la permission de réouverture qui manque.
    const cookiesMember = await registerAndLogin(member);
    const invite = await request(app.getHttpServer())
      .post(`/organizations/${ownerOrgId}/invitations`)
      .set('Cookie', cookiesOwner)
      .send({ email: member.email, role: 'member' });
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
    expect(parMember.body.code).toBe('REOPEN_OWNER_ONLY');

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
