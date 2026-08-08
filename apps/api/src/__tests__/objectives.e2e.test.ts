// S18d — objectifs financiers et taux d'atteinte (docs/01, ADR-0011 contrat 4).
//
// Exigences testées :
// 1. GET/PUT des cibles (remplacement complet : une cible absente est effacée).
// 2. zod refuse une clé inconnue et une cible négative.
// 3. 409 NO_APPROVED_PLAN tant qu'aucun plan n'est validé.
// 4. Cas chiffré : plan validé seedé, cible = 2 × valeur du snapshot → atteinte 50 %,
//    cible = valeur exacte → 100 % / « atteint ».
// 5. Ligne absente du snapshot (`ca_annuel_5`, horizon 3 ans) → atteinte null
//    + raison LIGNE_INDISPONIBLE — jamais 0 (ADR-0011, risque n°4).
// 6. Isolation org : un user d'une autre org reçoit 404 sur toutes les routes.
//
// Le taux est calculé contre des IDS DE LIGNES du snapshot, jamais contre des
// valeurs moteur en dur (ADR-0011 contrat 1) : les attentes chiffrées sont
// dérivées de la valeur lue dans le plan validé.

import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import type { Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';

import 'reflect-metadata';

import type { FinancialPlanDocument } from '../plans/plan.schema.js';
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

interface AttainmentItem {
  objectif: string;
  cible: number;
  lineId: string | null;
  valeur: number | null;
  atteinte: number | null;
  statut: string;
  raison: string | null;
}

e2eSuite('objectifs financiers et taux d’atteinte (S18d — docs/01)', () => {
  let app: INestApplication;

  const tag = Math.random().toString(36).slice(2, 8);
  const userA = {
    email: `obja-${tag}@lalanda-test.local`,
    password: 'Passw0rd!obja',
    name: 'ObjAlice',
  };
  const userB = {
    email: `objb-${tag}@lalanda-test.local`,
    password: 'Passw0rd!objb',
    name: 'ObjBob',
  };
  /** Porte le projet « legacy » : le plan free plafonne à 1 projet par org (S16b). */
  const userC = {
    email: `objc-${tag}@lalanda-test.local`,
    password: 'Passw0rd!objc',
    name: 'ObjCarl',
  };

  let cookiesA: string[] = [];
  let projectId = '';
  /** Valeur de `ca_annuel_1` figée dans le plan validé v1 — base des cas chiffrés. */
  let caAnnuel1 = 0;

  beforeAll(async () => {
    app = await makeApp();
    cookiesA = await registerAndLogin(userA);
    // Template sectoriel : il expose la feuille `projection` (ca_annuel_1..3),
    // contrairement au template de démo `hello-world`.
    const created = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookiesA)
      .send({ name: `Objectifs ${tag}`, templateSlug: 'prestation-services' });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  }, 60_000);

  afterAll(async () => {
    await teardown(app, [userA.email, userB.email, userC.email]);
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

  it('projet sans objectifs : toutes les cibles absentes (pas un 404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.ca_cible_an1).toBeUndefined();
    expect(res.body.updatedAt).toBeNull();
  }, 30_000);

  it('PUT = remplacement complet : une cible absente est effacée', async () => {
    const server = app.getHttpServer();

    const put1 = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 500_000, resultat_net_cible_an1: 80_000 });
    expect(put1.status).toBe(200);
    expect(put1.body.ca_cible_an1).toBe(500_000);
    expect(put1.body.resultat_net_cible_an1).toBe(80_000);

    const put2 = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 600_000 });
    expect(put2.status).toBe(200);
    expect(put2.body.ca_cible_an1).toBe(600_000);
    expect(put2.body.resultat_net_cible_an1).toBeUndefined();

    const read = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(read.body.ca_cible_an1).toBe(600_000);
    expect(read.body.resultat_net_cible_an1).toBeUndefined();
  }, 30_000);

  it('zod refuse une clé inconnue et une cible négative', async () => {
    const server = app.getHttpServer();

    const inconnue = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: 1000, objectif_fantaisie: 42 });
    expect(inconnue.status).toBe(400);
    expect(inconnue.body.code).toBe('INVALID_REQUEST');

    const negative = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: -1 });
    expect(negative.status).toBe(400);
  }, 30_000);

  it('sans plan validé : 409 NO_APPROVED_PLAN', async () => {
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_APPROVED_PLAN');
  }, 30_000);

  it('cas chiffré : plan validé seedé → atteinte 50 % puis 100 %', async () => {
    const server = app.getHttpServer();

    // Seed : fige la version courante en plan validé v1.
    const approve = await request(server)
      .post(`/projects/${projectId}/plans`)
      .set('Cookie', cookiesA)
      .send({});
    expect(approve.status).toBe(201);
    expect(approve.body.version).toBe(1);

    // Valeur observée de référence, lue dans le SNAPSHOT (pas recalculée).
    const lines = approve.body.result.lines as { lineId: string; value: number }[];
    const ligne = lines.find((l) => l.lineId === 'ca_annuel_1');
    expect(ligne).toBeDefined();
    caAnnuel1 = ligne!.value;
    expect(caAnnuel1).toBeGreaterThan(0);

    // Cible = 2 × valeur observée → 50 %, statut « non atteint » (< 80 %).
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1 * 2 });

    const moitie = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(moitie.status).toBe(200);
    expect(moitie.body.source).toBe('plan_valide');
    expect(moitie.body.planVersion).toBe(1);
    expect(moitie.body.planApprovedAt).toBeTruthy();

    const ca = (moitie.body.objectifs as AttainmentItem[]).find(
      (o) => o.objectif === 'ca_cible_an1',
    );
    expect(ca).toMatchObject({
      lineId: 'ca_annuel_1',
      valeur: caAnnuel1,
      atteinte: 50,
      statut: 'non_atteint',
      raison: null,
    });

    // Cible = valeur observée exacte → 100 %, statut « atteint ».
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1 });

    const pile = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    const caPile = (pile.body.objectifs as AttainmentItem[]).find(
      (o) => o.objectif === 'ca_cible_an1',
    );
    expect(caPile?.atteinte).toBe(100);
    expect(caPile?.statut).toBe('atteint');
  }, 60_000);

  it('ligne absente du snapshot (plan validé pré-FIN-001) → atteinte null + LIGNE_INDISPONIBLE (jamais 0)', async () => {
    const server = app.getHttpServer();

    // Ce cas exige un plan validé dont le snapshot NE CONTIENT PAS `ca_annuel_5`.
    //
    // La première version du test visait `ca_annuel_5` sur un plan fraîchement
    // validé, en pariant sur le fait que les templates projetaient 3 exercices.
    // C'était une précondition datée, pas un invariant : FIN-001 (S18a) a livré
    // l'horizon 5 exercices, la ligne existe, le taux se calcule (0,8 %) et le
    // test échoue. Viser une ligne « qui n'existe pas encore » finit toujours
    // par casser — la ligne finit par exister.
    //
    // On seede donc explicitement un état ANTÉRIEUR à FIN-001 : un projet dédié
    // dont le plan validé est ramené à un horizon 3 exercices. C'est exactement
    // la situation décrite par l'ADR-0011 (risque n°4) et elle reste vraie en
    // production tant que des plans validés avant FIN-001 existent en base.
    //
    // Utilisateur dédié : le plan `free` plafonne à un projet par organisation
    // (entitlements S16b), l'org de A a déjà le sien.
    const cookiesC = await registerAndLogin(userC);
    const createdLegacy = await request(server)
      .post('/projects')
      .set('Cookie', cookiesC)
      .send({ name: `Objectifs legacy ${tag}`, templateSlug: 'prestation-services' });
    expect(createdLegacy.status).toBe(201);
    const legacyProjectId = createdLegacy.body.id as string;

    const approve = await request(server)
      .post(`/projects/${legacyProjectId}/plans`)
      .set('Cookie', cookiesC)
      .send({});
    expect(approve.status).toBe(201);

    // Downgrade du snapshot figé : on retire les exercices 4 et 5 pour retrouver
    // la forme d'un plan validé pré-FIN-001. Écriture directe dans la collection
    // — c'est un état hérité qu'aucune route ne peut produire aujourd'hui.
    const { FinancialPlan } = await import('../plans/plan.schema.js');
    const { getModelToken } = await import('@nestjs/mongoose');
    const planModel = app.get<Model<FinancialPlanDocument>>(getModelToken(FinancialPlan.name));

    const plan = await planModel.findOne({ projectId: legacyProjectId, version: 1 }).exec();
    expect(plan).not.toBeNull();

    // Seules les séries annuelles 4 et 5 sont retirées (convention `_annuel_N`,
    // ADR-0011 contrat 2). Suffisant et volontairement minimal : aucun objectif
    // ne pointe vers les feuilles `bilan`/`caf`/`seuil_rentabilite` de FIN-001.
    const lignes3Exercices = plan!.result.lines.filter((l) => !/_annuel_[45]$/.test(l.lineId));
    const maj = await planModel
      .updateOne(
        { _id: plan!._id },
        { $set: { result: { ...plan!.result, lines: lignes3Exercices } } },
      )
      .exec();
    expect(maj.modifiedCount).toBe(1);

    // Préconditions du seed, vérifiées et non supposées : la ligne à 1 an est
    // mesurable, celle à 5 ans est absente. Si le moteur renomme ses lignes,
    // c'est ici que le test doit échouer — pas en silence sur l'assertion finale.
    const seede = await planModel.findOne({ _id: plan!._id }).exec();
    const idsSeedes = seede!.result.lines.map((l) => l.lineId);
    expect(idsSeedes).toContain('ca_annuel_1');
    expect(idsSeedes).not.toContain('ca_annuel_5');

    const caLegacy = seede!.result.lines.find((l) => l.lineId === 'ca_annuel_1')!.value;
    expect(caLegacy).toBeGreaterThan(0);

    // Objectif à 1 an mesurable + objectif à 5 ans non mesurable, dans le MÊME appel.
    await request(server)
      .put(`/projects/${legacyProjectId}/objectives`)
      .set('Cookie', cookiesC)
      .send({ ca_cible_an1: caLegacy, ca_cible_an5: 9_000_000 });

    const res = await request(server)
      .get(`/projects/${legacyProjectId}/objectives/attainment`)
      .set('Cookie', cookiesC);
    expect(res.status).toBe(200);

    const objectifs = res.body.objectifs as AttainmentItem[];
    const an5 = objectifs.find((o) => o.objectif === 'ca_cible_an5');
    expect(an5).toMatchObject({
      cible: 9_000_000,
      lineId: null,
      valeur: null,
      atteinte: null,
      statut: 'indisponible',
      raison: 'LIGNE_INDISPONIBLE',
    });
    expect(an5?.atteinte).not.toBe(0);

    // L'objectif mesurable reste évalué normalement — une ligne manquante ne
    // contamine pas le reste de la réponse.
    expect(objectifs.find((o) => o.objectif === 'ca_cible_an1')?.atteinte).toBe(100);
  }, 60_000);

  it('horizon 5 exercices (FIN-001) : `ca_annuel_5` est désormais mesurable', async () => {
    const server = app.getHttpServer();

    // Contrepartie du test précédent : sur un plan validé APRÈS FIN-001, l'objectif
    // à 5 ans n'est plus « indisponible » mais bel et bien chiffré. Sans ce cas,
    // remplacer la précondition périmée par un seed pré-FIN-001 ferait perdre la
    // couverture de l'horizon 5 exercices livré en S18a.
    await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA)
      .send({ ca_cible_an1: caAnnuel1, ca_cible_an5: 9_000_000 });

    const res = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesA);
    expect(res.status).toBe(200);

    const an5 = (res.body.objectifs as AttainmentItem[]).find((o) => o.objectif === 'ca_cible_an5');
    expect(an5?.lineId).toBe('ca_annuel_5');
    expect(an5?.raison).toBeNull();
    expect(an5?.valeur).toBeGreaterThan(0);
    expect(an5?.atteinte).toBeGreaterThan(0);
  }, 60_000);

  it('isolation org : un autre user reçoit 404 sur toutes les routes objectifs', async () => {
    const cookiesB = await registerAndLogin(userB);
    const server = app.getHttpServer();

    const get = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesB);
    expect(get.status).toBe(404);
    expect(get.body.code).toBe('PROJECT_NOT_FOUND');

    const put = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesB)
      .send({ ca_cible_an1: 1 });
    expect(put.status).toBe(404);

    // Corps malformé + projet hors scope : 404, pas 400 (scope vérifié avant zod).
    const malforme = await request(server)
      .put(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesB)
      .send({ objectif_fantaisie: 42 });
    expect(malforme.status).toBe(404);

    // 404 (projet hors scope) prime sur le 409 métier : aucune fuite d'information.
    const attainment = await request(server)
      .get(`/projects/${projectId}/objectives/attainment`)
      .set('Cookie', cookiesB);
    expect(attainment.status).toBe(404);

    // La cible de A n'a pas été écrasée par la tentative de B.
    const check = await request(server)
      .get(`/projects/${projectId}/objectives`)
      .set('Cookie', cookiesA);
    expect(check.body.ca_cible_an1).toBe(caAnnuel1);
  }, 60_000);

  it('sans session : 401 sur toutes les routes objectifs', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get(`/projects/${projectId}/objectives`)).status).toBe(401);
    expect((await request(server).put(`/projects/${projectId}/objectives`).send({})).status).toBe(
      401,
    );
    expect((await request(server).get(`/projects/${projectId}/objectives/attainment`)).status).toBe(
      401,
    );
  }, 30_000);
});
