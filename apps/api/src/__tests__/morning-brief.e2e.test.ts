// BRIEF DU MATIN BOUT EN BOUT (ADR-0033).
//
// Ce que ce fichier prouve, sur un vrai serveur et une vraie base :
//
//  · ISOLATION — deux organisations peuplées de factures différentes ; chacune
//    ne voit que ses chiffres, y compris en forçant le cookie d'organisation
//    active de l'autre, et le corps d'une explication refuse tout champ
//    d'organisation ;
//  · MOINDRE PRIVILÈGE — un Conseiller (sans `sales.read`) reçoit les faits de
//    ventes MASQUÉS : aucun montant dans le JSON ;
//  · DÉSACTIVATION — réglage par organisation (Propriétaire seulement, tracé) et
//    coupe-circuit plateforme ; aucun appel au modèle dans cette suite ;
//  · E-MAIL — désactivé par défaut, au plus un par jour, jamais à un ancien membre.
//
// Les factures sont insérées directement : on teste la lecture du brief, pas
// l'émission (couverte par `invoices.e2e.test.ts`).

import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import 'reflect-metadata';

import { dbOf, e2eSuite, makeE2EApp, registerAndLogin, teardown } from './e2e-utils.js';

e2eSuite('brief du matin — isolation, rôles, IA désactivable, e-mail (ADR-0033)', () => {
  let app: INestApplication;
  const tag = randomBytes(4).toString('hex');
  const owner = {
    email: `brief-a-${tag}@lalanda-test.local`,
    password: 'Passw0rd!briefA',
    name: 'A',
  };
  const ownerB = {
    email: `brief-b-${tag}@lalanda-test.local`,
    password: 'Passw0rd!briefB',
    name: 'B',
  };
  const viewer = {
    email: `brief-v-${tag}@lalanda-test.local`,
    password: 'Passw0rd!briefV',
    name: 'V',
  };
  const emails = [owner.email, ownerB.email, viewer.email];

  let cA: string[] = [];
  let cB: string[] = [];
  let cV: string[] = [];
  let orgA = '';
  let orgB = '';
  let viewerId = '';
  let envAvant: string | undefined;
  let cleAvant: string | undefined;

  const server = (): ReturnType<INestApplication['getHttpServer']> => app.getHttpServer();
  const asA = (): string[] => [...cA, `active_org_id=${orgA}`];
  const asV = (): string[] => [...cV, `active_org_id=${orgA}`];

  function invoice(organizationId: string, over: Record<string, unknown>): Record<string, unknown> {
    const at = new Date(Date.now() - 60_000);
    return {
      organizationId,
      proformaRef: `PF-2026-${randomBytes(4).toString('hex')}`,
      status: 'issued',
      type: 'FV',
      series: 'real',
      environment: null,
      currency: 'CDF',
      issuedAt: at,
      frozenAt: at,
      updatedAt: at,
      createdAt: at,
      sortAt: at,
      amountOnCredit: null,
      creditNote: null,
      normalization: null,
      documentAmounts: { calculation: { totals: { groups: [{ group: 'B', ht: '4321.00' }] } } },
      _schemaVersion: 1,
      ...over,
    };
  }

  beforeAll(async () => {
    // Aucun appel réel au modèle, quelle que soit la configuration locale.
    cleAvant = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    envAvant = process.env['MORNING_BRIEF_AI'];
    process.env['MORNING_BRIEF_AI'] = 'off';

    app = await makeE2EApp();
    cA = await registerAndLogin(app, owner);
    cB = await registerAndLogin(app, ownerB);
    orgA = (await request(server()).get('/organizations').set('Cookie', cA)).body.organizations[0]
      .id;
    orgB = (await request(server()).get('/organizations').set('Cookie', cB)).body.organizations[0]
      .id;

    const inv = await request(server())
      .post(`/organizations/${orgA}/invitations`)
      .set('Cookie', asA())
      .send({ email: viewer.email, role: 'advisor' });
    expect(inv.status).toBe(201);
    cV = await registerAndLogin(app, viewer);
    const acc = await request(server())
      .post('/invitations/accept')
      .set('Cookie', cV)
      .send({ token: inv.body.token });
    expect(acc.status).toBe(201);

    const db = await dbOf(app);
    viewerId = String((await db.collection('user').findOne({ email: viewer.email }))?._id);
    await db.collection('sales_invoices').insertMany([
      invoice(orgA, {}),
      invoice(orgA, { status: 'normalization_failed', issuedAt: null }),
      // Organisation B : des montants reconnaissables qui ne doivent JAMAIS
      // apparaître chez A.
      invoice(orgB, {
        documentAmounts: { calculation: { totals: { groups: [{ group: 'B', ht: '987654.00' }] } } },
        amountOnCredit: '55555.00',
      }),
      invoice(orgB, { status: 'normalization_failed', issuedAt: null }),
      invoice(orgB, { status: 'normalization_failed', issuedAt: null }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (envAvant === undefined) delete process.env['MORNING_BRIEF_AI'];
    else process.env['MORNING_BRIEF_AI'] = envAvant;
    if (cleAvant !== undefined) process.env['OPENAI_API_KEY'] = cleAvant;
    if (app) {
      const db = await dbOf(app);
      await db.collection('sales_invoices').deleteMany({ organizationId: { $in: [orgA, orgB] } });
    }
    await teardown(app, emails);
  }, 60_000);

  const fact = (body: { brief: { facts: { id: string }[] } }, id: string): unknown =>
    body.brief.facts.find((f) => f.id === id);

  it('chaque organisation ne voit que ses propres factures', async () => {
    const a = await request(server()).get('/morning-brief').set('Cookie', asA());
    expect(a.status).toBe(200);
    expect(fact(a.body, 'ca_mois.CDF')).toMatchObject({ status: 'known', value: '4321.00' });
    expect(fact(a.body, 'normalisation.echec')).toMatchObject({ value: '1' });
    expect(JSON.stringify(a.body)).not.toMatch(/987654|55555/);

    const b = await request(server()).get('/morning-brief').set('Cookie', cB);
    expect(fact(b.body, 'ca_mois.CDF')).toMatchObject({ value: '987654.00' });
    expect(fact(b.body, 'creances.CDF')).toMatchObject({ value: '55555.00' });
    expect(fact(b.body, 'normalisation.echec')).toMatchObject({ value: '2' });
  }, 60_000);

  it('forcer le cookie d’organisation active de l’autre ne donne pas ses chiffres', async () => {
    const b = await request(server())
      .get('/morning-brief')
      .set('Cookie', [...cB, `active_org_id=${orgA}`]);
    expect(JSON.stringify(b.body)).not.toContain('4321.00');
  }, 60_000);

  it('l’explication refuse tout champ d’organisation dans le corps', async () => {
    const res = await request(server())
      .post('/morning-brief/explanation')
      .set('Cookie', asA())
      .send({ intent: 'explain', organizationId: orgB });
    expect(res.status).toBe(400);
  }, 60_000);

  it('un Conseiller (sans sales.read) reçoit les faits de ventes masqués, sans aucun montant', async () => {
    const v = await request(server()).get('/morning-brief').set('Cookie', asV());
    expect(v.status).toBe(200);
    expect(fact(v.body, 'ca_mois.CDF')).toMatchObject({ status: 'hidden', value: null });
    expect(JSON.stringify(v.body)).not.toMatch(/4321/);
    expect(v.body.canManageAi).toBe(false);
    expect(v.body.brief.rulesSkipped.length).toBeGreaterThan(0);
  }, 60_000);

  it('coupe-circuit plateforme : explication déterministe, aucun appel', async () => {
    const res = await request(server())
      .post('/morning-brief/explanation')
      .set('Cookie', asA())
      .send({ intent: 'this_week' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'fallback', reason: 'desactivee_plateforme' });
    expect(res.body.items[0].texte).toContain('normaliser');
    const db = await dbOf(app);
    const logs = await db
      .collection('morning_brief_ai_logs')
      .find({ organizationId: orgA })
      .toArray();
    expect(logs.map((l) => l['outcome'])).toEqual(['disabled']);
    expect(logs[0]?.['prompt']).toBeNull();
    expect(logs[0]?.['expiresAt']).toBeInstanceOf(Date);
  }, 60_000);

  it('réglage par organisation : Propriétaire seulement, tracé au journal', async () => {
    const refus = await request(server())
      .put('/morning-brief/settings')
      .set('Cookie', asV())
      .send({ aiEnabled: false });
    expect(refus.status).toBe(403);

    delete process.env['MORNING_BRIEF_AI'];
    try {
      const ok = await request(server())
        .put('/morning-brief/settings')
        .set('Cookie', asA())
        .send({ aiEnabled: false });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ aiEnabled: false, aiDisabledBy: 'organization' });

      const expl = await request(server())
        .post('/morning-brief/explanation')
        .set('Cookie', asA())
        .send({ intent: 'explain' });
      expect(expl.body).toMatchObject({ source: 'fallback', reason: 'desactivee_organisation' });
      // L'organisation B n'est pas concernée.
      const prefsB = await request(server()).get('/morning-brief/preferences').set('Cookie', cB);
      expect(prefsB.body).toMatchObject({ aiEnabled: true, aiDisabledBy: null });
    } finally {
      process.env['MORNING_BRIEF_AI'] = 'off';
    }
    const db = await dbOf(app);
    const audit = await db
      .collection('audit_events')
      .findOne({ organizationId: orgA, action: 'morning_brief.settings.updated' });
    expect(audit).not.toBeNull();
  }, 60_000);

  it('e-mail : désactivé par défaut, au plus un par jour, jamais à un ancien membre', async () => {
    const def = await request(server()).get('/morning-brief/preferences').set('Cookie', asA());
    expect(def.body.emailDaily).toBe(false);

    for (const c of [asA(), asV(), cB]) {
      const r = await request(server())
        .put('/morning-brief/preferences')
        .set('Cookie', c)
        .send({ emailDaily: true });
      expect(r.status).toBe(200);
      expect(r.body.emailDaily).toBe(true);
    }

    // Le Conseiller quitte l'organisation A : il ne doit plus rien recevoir.
    const db = await dbOf(app);
    await db.collection('memberships').deleteOne({ organizationId: orgA, userId: viewerId });

    const { MailService } = await import('../mail/mail.service.js');
    const { MorningBriefEmailJob } = await import('../morning-brief/morning-brief-email.job.js');
    const mail = app.get(MailService);
    const spy = vi.spyOn(mail, 'sendMorningBrief').mockResolvedValue({ delivered: true } as never);
    const job = app.get(MorningBriefEmailJob);

    const today = new Date();
    const at6 = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 4, 30),
    );
    const at9 = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 8, 0),
    );
    try {
      // 5 h 30 à Kinshasa : trop tôt.
      expect(await job.run(at6)).toMatchObject({ claimed: 0 });

      const first = await job.run(at9);
      expect(first).toMatchObject({ claimed: 3, sent: 2, skipped: 1 });
      const destinataires = spy.mock.calls.map((c) => c[0].to).sort();
      expect(destinataires).toEqual([owner.email, ownerB.email].sort());

      const pourA = spy.mock.calls.find((c) => c[0].to === owner.email)?.[0];
      expect(JSON.stringify(pourA)).toContain('4 321,00 CDF');
      expect(JSON.stringify(pourA)).not.toMatch(/987|55 555/);

      // Même jour, nouveau passage : rien.
      expect(await job.run(new Date(at9.getTime() + 15 * 60_000))).toMatchObject({ claimed: 0 });
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
