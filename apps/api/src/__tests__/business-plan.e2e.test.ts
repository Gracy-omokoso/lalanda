// BUSINESS PLAN NARRATIF BOUT EN BOUT (ADR-0037).
//
// Ce que ce fichier prouve, sur un vrai serveur et une vraie base :
//
//  · CRÉATION — document vide à la première lecture, rattachement à une version
//    figée du plan (version et empreinte servies), tableaux du moteur RELUS dans
//    le snapshot, identiques à ceux du plan figé ;
//  · IA SIMULÉE — aucun appel réel : le client du modèle est remplacé par un
//    double. Une proposition vérifiée est rangée À CÔTÉ du texte, marquée, et ne
//    devient publiable qu'à l'acceptation (`ai_accepted`) ; une réponse qui cite
//    un NOMBRE INVENTÉ est rejetée : rien n'est enregistré, rien n'est décompté ;
//  · VERSIONS — validation refusée tant qu'une proposition attend ou sans plan
//    figé ; version immuable ; « inchangé » détecté ;
//  · EXPORT PDF — rendu Chromium remplacé par un double qui renvoie le HTML : le
//    document cite la version et l'empreinte du plan, porte le filigrane de
//    l'offre gratuite, et l'export est journalisé ;
//  · ISOLATION — une autre organisation reçoit 404 sur le projet.

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import 'reflect-metadata';

import type { OpenAIChatClient } from '../ai/ai-actions.service.js';
import { BusinessPlanAiService } from '../business-plan/business-plan-ai.service.js';
import { PdfRenderingService } from '../reports/pdf-rendering.service.js';
import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

/** Lit le corps binaire d'une réponse supertest. */
function binary(req: request.Test): request.Test {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

e2eSuite('business plan narratif — plan figé, IA vérifiée, versions, PDF (ADR-0037)', () => {
  let app: INestApplication;
  const tag = randomBytes(4).toString('hex');
  const owner = { email: `bp-a-${tag}@lalanda-test.local`, password: 'Passw0rd!bpA', name: 'A' };
  const other = { email: `bp-b-${tag}@lalanda-test.local`, password: 'Passw0rd!bpB', name: 'B' };
  const emails = [owner.email, other.email];

  let cA: string[] = [];
  let cB: string[] = [];
  let orgA = '';
  let orgB = '';
  let projectId = '';
  let fingerprint = '';
  let cleAvant: string | undefined;

  /** Réponse que le double du modèle renverra au prochain appel. */
  let reponseModele = '';
  const chatJson = vi.fn<OpenAIChatClient['chatJson']>(async () => reponseModele);

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const asA = (): string[] => [...cA, `active_org_id=${orgA}`];
  const asB = (): string[] => [...cB, `active_org_id=${orgB}`];
  const base = (): string => `/projects/${projectId}/business-plan`;

  beforeAll(async () => {
    // Aucun appel réel au modèle, quelle que soit la configuration locale.
    cleAvant = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['BUSINESS_PLAN_AI'];

    app = await makeE2EApp();
    // Double du client du modèle (le champ est privé : remplacé à l'exécution).
    (app.get(BusinessPlanAiService) as unknown as { openai: OpenAIChatClient }).openai = {
      chatJson,
    };
    // Double du rendu Chromium : `%PDF-FAKE` suivi du HTML qui serait imprimé.
    vi.spyOn(app.get(PdfRenderingService), 'render').mockImplementation(async (html) =>
      Buffer.from(`%PDF-FAKE\n${html}`),
    );

    cA = await registerAndLogin(app, owner);
    cB = await registerAndLogin(app, other);
    orgA = (await request(server()).get('/organizations').set('Cookie', cA)).body.organizations[0]
      .id;
    orgB = (await request(server()).get('/organizations').set('Cookie', cB)).body.organizations[0]
      .id;

    const created = await request(server())
      .post('/projects')
      .set('Cookie', asA())
      .send({ name: `Restaurant ${tag}`, templateSlug: 'restaurant-kinshasa' });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  }, 180_000);

  afterAll(async () => {
    if (cleAvant !== undefined) process.env['OPENAI_API_KEY'] = cleAvant;
    if (app) {
      const db = await dbOf(app);
      for (const c of [
        'business_plans',
        'business_plan_versions',
        'business_plan_settings',
        'business_plan_ai_logs',
        'ai_usage_events',
      ]) {
        await db.collection(c).deleteMany({ organizationId: { $in: [orgA, orgB] } });
      }
    }
    await teardown(app, emails);
  }, 60_000);

  it('crée un document vide, tableaux en direct marqués brouillon', async () => {
    const res = await request(server()).get(base()).set('Cookie', asA());
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(9);
    expect(res.body.planVersion).toBeNull();
    expect(res.body.plan.status).toBe('live');
    expect(res.body.plan.label).toMatch(/BROUILLON/);
    expect(res.body.blockers.map((b: { code: string }) => b.code)).toContain(
      'BUSINESS_PLAN_NO_FROZEN_PLAN',
    );
  });

  it('se rattache à une version figée : version, empreinte et lignes du snapshot', async () => {
    const plan = await request(server()).post(`/projects/${projectId}/plans`).set('Cookie', asA());
    expect(plan.status).toBe(201);
    fingerprint = plan.body.fingerprint;

    const put = await request(server())
      .put(`${base()}/plan`)
      .set('Cookie', asA())
      .send({ planVersion: plan.body.version });
    expect(put.status).toBe(200);
    expect(put.body.plan).toMatchObject({ status: 'frozen', version: 1, fingerprint });

    // Les valeurs insérées sont celles du snapshot, À L'IDENTIQUE.
    const snapshot = new Map<string, number>(
      plan.body.result.lines.map((l: { lineId: string; value: number }) => [l.lineId, l.value]),
    );
    const section = put.body.sections.find((s: { id: string }) => s.id === 'plan_financier');
    const rows = section.tables.flatMap((t: { rows: unknown[] }) => t.rows) as {
      lineId: string;
      value: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.value).toBe(snapshot.get(r.lineId));
    expect(section.hypotheses.length).toBeGreaterThan(0);

    const inconnue = await request(server())
      .put(`${base()}/plan`)
      .set('Cookie', asA())
      .send({ planVersion: 99 });
    expect(inconnue.status).toBe(404);
  });

  it('enregistre le texte saisi par l’utilisateur', async () => {
    const res = await request(server())
      .put(`${base()}/sections/resume`)
      .set('Cookie', asA())
      .send({ text: 'Un restaurant de quartier à Gombe.' });
    expect(res.status).toBe(200);
    const resume = res.body.sections.find((s: { id: string }) => s.id === 'resume');
    expect(resume).toMatchObject({ text: 'Un restaurant de quartier à Gombe.', origin: 'user' });

    const inconnue = await request(server())
      .put(`${base()}/sections/inconnue`)
      .set('Cookie', asA())
      .send({ text: 'x' });
    expect(inconnue.status).toBe(400);
  });

  it('IA simulée : un NOMBRE INVENTÉ est rejeté — rien d’enregistré, rien de décompté', async () => {
    const db = await dbOf(app);
    const avant = await db
      .collection('ai_usage_events')
      .countDocuments({ organizationId: orgA, source: 'llm' });
    reponseModele = JSON.stringify({
      texte: 'Nous réaliserons 987 654 USD de chiffre d’affaires dès la première année.',
      sources: ['reponses'],
    });
    const res = await request(server())
      .post(`${base()}/sections/marche_concurrence/draft`)
      .set('Cookie', asA())
      .send({ notes: 'Clientèle de bureaux.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ proposal: null, source: 'fallback', reason: 'rejetee' });
    expect(res.body.detail).toMatch(/987 654/);

    const doc = await request(server()).get(base()).set('Cookie', asA());
    expect(doc.body.pendingProposals).toEqual([]);
    expect(
      await db
        .collection('ai_usage_events')
        .countDocuments({ organizationId: orgA, source: 'llm' }),
    ).toBe(avant);
    // Le journal garde le motif et des empreintes — ni le prompt, ni la réponse.
    const log = await db
      .collection('business_plan_ai_logs')
      .findOne({ organizationId: orgA, outcome: 'rejected' });
    expect(log).toMatchObject({ sectionId: 'marche_concurrence' });
    expect(log?.['responseSha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(log)).not.toContain('987 654 USD de chiffre');
    expect(JSON.stringify(log)).not.toContain('Clientèle de bureaux');
  });

  it('IA simulée : proposition vérifiée, marquée, puis acceptée par l’utilisateur', async () => {
    reponseModele = JSON.stringify({
      texte: 'Nous visons d’abord la clientèle de bureaux du quartier. [à compléter]',
      sources: ['reponses'],
    });
    const res = await request(server())
      .post(`${base()}/sections/marche_concurrence/draft`)
      .set('Cookie', asA())
      .send({ notes: 'Clientèle de bureaux.' });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe('llm');
    // Une proposition acceptée par le vérificateur compte UN message du quota.
    const db = await dbOf(app);
    expect(
      await db
        .collection('ai_usage_events')
        .countDocuments({ organizationId: orgA, source: 'llm', action: 'ai.business_plan' }),
    ).toBe(1);
    expect(res.body.proposal.text).toMatch(/clientèle de bureaux/);
    // Le modèle a reçu les données du projet, jamais le nom de l'organisation.
    const envoye = chatJson.mock.calls.at(-1)![0].user;
    expect(envoye).toContain('<donnees_non_fiables>');
    expect(envoye).not.toContain(owner.email);

    const doc = await request(server()).get(base()).set('Cookie', asA());
    const section = doc.body.sections.find((s: { id: string }) => s.id === 'marche_concurrence');
    expect(section.proposal.text).toMatch(/clientèle de bureaux/);
    expect(section.text).toBe(''); // la proposition n'est pas le texte
    expect(doc.body.blockers.map((b: { code: string }) => b.code)).toContain(
      'BUSINESS_PLAN_PENDING_AI',
    );

    const refus = await request(server()).post(`${base()}/versions`).set('Cookie', asA());
    expect(refus.status).toBe(409);
    expect(refus.body.code).toBe('BUSINESS_PLAN_PENDING_AI');

    const acc = await request(server())
      .post(`${base()}/sections/marche_concurrence/proposal/accept`)
      .set('Cookie', asA());
    expect(acc.status).toBe(201);
    const accepted = acc.body.sections.find((s: { id: string }) => s.id === 'marche_concurrence');
    expect(accepted).toMatchObject({ origin: 'ai_accepted', proposal: null });
    expect(accepted.originNote).toMatch(/assistée par l’IA/);
  });

  it('IA désactivée par l’organisation : aucun appel au modèle', async () => {
    const off = await request(server())
      .put('/business-plan/settings')
      .set('Cookie', asA())
      .send({ aiEnabled: false });
    expect(off.status).toBe(200);
    const appels = chatJson.mock.calls.length;
    const res = await request(server())
      .post(`${base()}/sections/risques/draft`)
      .set('Cookie', asA())
      .send({});
    expect(res.body).toMatchObject({ proposal: null, reason: 'desactivee_organisation' });
    expect(chatJson.mock.calls.length).toBe(appels);
    await request(server())
      .put('/business-plan/settings')
      .set('Cookie', asA())
      .send({ aiEnabled: true });
  });

  it('valide une version immuable, puis refuse une validation sans changement', async () => {
    const v1 = await request(server()).post(`${base()}/versions`).set('Cookie', asA());
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({
      version: 1,
      soleApprover: true,
      plan: { version: 1, fingerprint },
    });

    const again = await request(server()).post(`${base()}/versions`).set('Cookie', asA());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('BUSINESS_PLAN_UNCHANGED');

    const doc = await request(server()).get(base()).set('Cookie', asA());
    expect(doc.body.changedSinceLastVersion).toBe(false);
    expect(doc.body.versions).toHaveLength(1);
  });

  it('exporte le PDF de la version validée : plan cité, filigrane de l’offre, journalisé', async () => {
    const res = await binary(request(server()).get(`${base()}/pdf?version=1`).set('Cookie', asA()));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/business-plan-.*-v1\.pdf/);
    const html = (res.body as Buffer).toString('utf8');
    expect(html.startsWith('%PDF-FAKE')).toBe(true);
    expect(html).toContain('Business plan validé v1');
    expect(html).toContain('Plan financier validé v1');
    expect(html).toContain(fingerprint);
    // Offre gratuite par défaut : filigrane imposé par l'API.
    expect(html).toContain('Généré avec Lalanda — offre gratuite');

    const db = await dbOf(app);
    const audit = await db
      .collection('audit_events')
      .findOne({ organizationId: orgA, action: 'report.export', 'metadata.kind': 'business_plan' });
    expect(audit?.['metadata']).toMatchObject({ businessPlanVersion: 1 });

    const brouillon = await binary(request(server()).get(`${base()}/pdf`).set('Cookie', asA()));
    expect(brouillon.status).toBe(200);
    expect((brouillon.body as Buffer).toString('utf8')).toContain('BROUILLON');
  });

  it('isole les organisations : 404 sur le projet d’une autre', async () => {
    expect((await request(server()).get(base()).set('Cookie', asB())).status).toBe(404);
    expect(
      (
        await request(server())
          .put(`${base()}/sections/resume`)
          .set('Cookie', asB())
          .send({ text: 'intrusion' })
      ).status,
    ).toBe(404);
    expect(
      (await request(server()).get(`${base()}/pdf?version=1`).set('Cookie', asB())).status,
    ).toBe(404);
    const liste = await request(server()).get('/business-plan').set('Cookie', asB());
    expect(liste.status).toBe(200);
    expect(liste.body.projects).toEqual([]);
    const mine = await request(server()).get('/business-plan').set('Cookie', asA());
    expect(mine.body.projects[0]).toMatchObject({
      projectId,
      planVersion: 1,
      lastValidated: { version: 1 },
    });
  });
});
