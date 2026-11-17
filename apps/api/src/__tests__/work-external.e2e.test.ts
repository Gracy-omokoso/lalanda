// Membres externes d'un projet — ADR-0078, contre la vraie application.
//
// Une seule application Nest (fixture « work »), aucun envoi réel : le transport d'e-mail
// est espionné (le code est lu dans le message intercepté). Couvre : invitation (fiche du
// projet seulement), connexion par code (usage unique, essais bornés, expiration, débit,
// réponse identique pour une adresse inconnue), isolement strict (projets, tâches,
// commentaires, organisations, routes de l'ERP → 401), absence de montants, validation
// client et facture, consultant (ses tâches, « peut ouvrir le projet », temps valorisé au
// taux d'achat dans la marge, récapitulatif, feuille validée par le référent), cycle de
// vie (retrait, fiche désactivée, archivage), audit, conversion d'un Invité.

import 'reflect-metadata';

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import request from 'supertest';
import { beforeAll, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const CLIENT = 'contact.client@exemple-externe.test';
const CONSULTANT = 'consultant@exemple-externe.test';
const CLIENT2 = 'autre.client@exemple-externe.test';
const COOKIE = 'lalanda_ext_session';

/** Clés qui ne doivent JAMAIS apparaître dans une réponse de l'espace externe. */
const FORBIDDEN_KEYS =
  /"(amount|margin|cost|timeCost|hourlyCost|hourlyRate|loggedMinutes|estimateMinutes|assignee|followers|collaborators|members|invoice|billing|received|expenses)"/i;

e2eSuite('Projets : membres externes et espace externe — ADR-0078', () => {
  const f = useWorkFixture('wext', { extraRoles: ['employee', 'guest'] });
  const sent: MailMessage[] = [];
  let db: Db;
  let customer1 = '';
  let customer2 = '';
  let supplier = '';
  let p1 = '';
  let p2 = '';
  let p3 = '';
  let pB = '';
  let hidden = '';
  let shared = '';
  let consultantTask = '';
  let milestone = '';
  let clientId = '';
  let consultantId = '';
  let clientCookie = '';
  let consultantCookie = '';

  const server = () => f.app().getHttpServer();
  const portal = (cookie: string) => ({
    get: (path: string) =>
      request(server())
        .get(path)
        .set('Cookie', [`${COOKIE}=${cookie}`]),
    post: (path: string, body: unknown = {}) =>
      request(server())
        .post(path)
        .set('Cookie', [`${COOKIE}=${cookie}`])
        .send(body as object),
    put: (path: string, body: unknown) =>
      request(server())
        .put(path)
        .set('Cookie', [`${COOKIE}=${cookie}`])
        .send(body as object),
    del: (path: string) =>
      request(server())
        .delete(path)
        .set('Cookie', [`${COOKIE}=${cookie}`]),
  });
  const lastCodeFor = (email: string): string => {
    const mail = [...sent].reverse().find((m) => m.to === email && /code/i.test(m.subject));
    expect(mail, `aucun code intercepté pour ${email}`).toBeDefined();
    const match = /Voici votre code[^:]*: (\d{6})/.exec(mail!.text);
    expect(match).not.toBeNull();
    return match![1]!;
  };
  const login = async (email: string): Promise<string> => {
    expect((await request(server()).post('/portal/auth/request-code').send({ email })).status).toBe(
      202,
    );
    const res = await request(server())
      .post('/portal/auth/verify')
      .send({ email, code: lastCodeFor(email) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = raw.find((c) => c.startsWith(`${COOKIE}=`));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    return cookie!.split(';')[0]!.slice(COOKIE.length + 1);
  };
  const rev = async (taskId: string): Promise<number> =>
    (await f.get('owner', `/work/tasks/${taskId}`)).body.revision as number;

  beforeAll(async () => {
    db = f.db();
    const transport = f.app().get(MailTransport);
    vi.spyOn(transport, 'send').mockImplementation(async (m: MailMessage) => {
      sent.push(m);
      return { delivered: true };
    });
    const now = new Date();
    const fiche = (organizationId: string, name: string) => ({
      organizationId,
      name,
      type: 'company',
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    customer1 = String(
      (await db.collection('customers').insertOne(fiche(f.orgId(), 'Client Gombe'))).insertedId,
    );
    customer2 = String(
      (await db.collection('customers').insertOne(fiche(f.orgId(), 'Client Limete'))).insertedId,
    );
    const customerB = String(
      (await db.collection('customers').insertOne(fiche(f.orgB(), 'Client de B'))).insertedId,
    );
    supplier = String(
      (
        await db.collection('suppliers').insertOne({
          ...fiche(f.orgId(), 'Cabinet Conseil Kin'),
          mergedInto: null,
        })
      ).insertedId,
    );
    const projet = async (who: 'owner' | 'ownerB', body: Record<string, unknown>) => {
      const r = await f.post(who, '/work/projects', body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    p1 = await projet('owner', {
      name: 'Site Gombe',
      kind: 'client',
      ownerUserId: f.userId('employee'),
      links: { customerId: customer1 },
    });
    p2 = await projet('owner', {
      name: 'Site Limete',
      kind: 'client',
      links: { customerId: customer2 },
    });
    p3 = await projet('owner', { name: 'Interne', kind: 'internal' });
    pB = await projet('ownerB', {
      name: 'Projet de B',
      kind: 'client',
      links: { customerId: customerB },
    });
    const tache = async (body: Record<string, unknown>) => {
      const r = await f.post('owner', `/work/projects/${p1}/tasks`, body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.task.id as string;
    };
    hidden = await tache({ title: 'Marge et sous-traitance (interne)', estimateMinutes: 600 });
    shared = await tache({ title: 'Maquette de la page d’accueil' });
    consultantTask = await tache({ title: 'Audit SEO' });
    milestone = await tache({ title: 'Livraison V1', isMilestone: true, dueDate: '2026-12-15' });
  }, E2E_HOOK_TIMEOUT_MS);

  it('invitation : contact client sur un projet client de SA fiche, consultant relié à un fournisseur', async () => {
    const interne = await f.post('owner', `/work/projects/${p3}/external-members`, {
      kind: 'client',
      email: CLIENT,
      name: 'Mme Kabila',
      customerId: customer1,
    });
    expect(interne.status).toBe(409);
    expect(interne.body.code).toBe('WORK_EXTERNAL_PROJECT_NOT_CLIENT');
    const mauvaiseFiche = await f.post('owner', `/work/projects/${p1}/external-members`, {
      kind: 'client',
      email: CLIENT,
      name: 'Mme Kabila',
      customerId: customer2,
    });
    expect(mauvaiseFiche.status).toBe(400);
    expect(f.issueCodes(mauvaiseFiche)).toContain('WORK_EXTERNAL_CUSTOMER_MISMATCH');
    const nonGestion = await f.post('accountant', `/work/projects/${p1}/external-members`, {
      kind: 'client',
      email: CLIENT,
      name: 'Mme Kabila',
      customerId: customer1,
    });
    expect(nonGestion.status).toBe(403);
    const sansReferent = await f.post('owner', `/work/projects/${p1}/external-members`, {
      kind: 'consultant',
      email: CONSULTANT,
      name: 'M. Tshisekedi',
      supplierId: supplier,
    });
    expect(sansReferent.status).toBe(400);

    sent.length = 0;
    const client = await f.post('employee', `/work/projects/${p1}/external-members`, {
      kind: 'client',
      email: CLIENT.toUpperCase(),
      name: 'Mme Kabila',
      customerId: customer1,
    });
    expect(client.status, JSON.stringify(client.body)).toBe(201);
    clientId = client.body.account.id;
    expect(client.body.account.email).toBe(CLIENT);
    expect(client.body.account.customerName).toBe('Client Gombe');
    expect(sent.some((m) => m.to === CLIENT && /vous ouvre/.test(m.subject))).toBe(true);

    const consultant = await f.post('owner', `/work/projects/${p1}/external-members`, {
      kind: 'consultant',
      email: CONSULTANT,
      name: 'M. Tshisekedi',
      supplierId: supplier,
      referentUserId: f.userId('employee'),
    });
    expect(consultant.status, JSON.stringify(consultant.body)).toBe(201);
    consultantId = consultant.body.account.id;
    expect(consultant.body.canOpenProject).toBe(false);

    const deux = await f.post('owner', `/work/projects/${p1}/external-members`, {
      kind: 'client',
      email: CLIENT,
      name: 'Mme Kabila',
      customerId: customer1,
    });
    expect(deux.status).toBe(409);
    expect(deux.body.code).toBe('WORK_EXTERNAL_ALREADY_MEMBER');

    const liste = await f.get('analyst', `/work/projects/${p1}/external-members`);
    expect(liste.status).toBe(200);
    expect(liste.body.members).toHaveLength(2);
    expect((await f.get('ownerB', `/work/projects/${p1}/external-members`)).status).toBe(404);
  });

  it('connexion : code haché, usage unique, réponse identique pour une adresse inconnue', async () => {
    sent.length = 0;
    const inconnue = await request(server())
      .post('/portal/auth/request-code')
      .send({ email: 'personne@exemple-externe.test' });
    expect(inconnue.status).toBe(202);
    const connue = await request(server())
      .post('/portal/auth/request-code')
      .send({ email: CLIENT });
    expect(connue.status).toBe(202);
    expect(connue.body).toEqual(inconnue.body);
    expect(sent.filter((m) => m.to === 'personne@exemple-externe.test')).toHaveLength(0);
    const code = lastCodeFor(CLIENT);
    const defi = await db
      .collection('work_external_challenges')
      .findOne({ email: CLIENT, consumedAt: null });
    expect(defi).not.toBeNull();
    expect(JSON.stringify(defi)).not.toContain(code);
    expect(defi!['codeHash']).toMatch(/^[0-9a-f]{64}$/);

    const faux = await request(server())
      .post('/portal/auth/verify')
      .send({ email: CLIENT, code: code === '000000' ? '111111' : '000000' });
    const absent = await request(server())
      .post('/portal/auth/verify')
      .send({ email: 'personne@exemple-externe.test', code: '123456' });
    expect(faux.status).toBe(400);
    expect(absent.status).toBe(400);
    expect(faux.body).toEqual(absent.body);
    expect(faux.body.code).toBe('EXTERNAL_CODE_INVALID');

    const ok = await request(server()).post('/portal/auth/verify').send({ email: CLIENT, code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.me.kind).toBe('client');
    const raw = ([] as string[]).concat(ok.headers['set-cookie'] ?? []);
    clientCookie = raw
      .find((c) => c.startsWith(`${COOKIE}=`))!
      .split(';')[0]!
      .slice(COOKIE.length + 1);
    const encore = await request(server())
      .post('/portal/auth/verify')
      .send({ email: CLIENT, code });
    expect(encore.status).toBe(400);
    // Le jeton n'est stocké que haché.
    const session = await db.collection('work_external_sessions').findOne({ accountId: clientId });
    expect(JSON.stringify(session)).not.toContain(clientCookie);
    expect((await portal(clientCookie).get('/portal/me')).body.name).toBe('Mme Kabila');
  });

  it('connexion : cinq essais au plus par code, code expiré refusé, débit borné', async () => {
    await request(server()).post('/portal/auth/request-code').send({ email: CONSULTANT });
    const code = lastCodeFor(CONSULTANT);
    const faux = code === '000000' ? '999999' : '000000';
    for (let i = 0; i < 5; i += 1) {
      await request(server()).post('/portal/auth/verify').send({ email: CONSULTANT, code: faux });
    }
    const apres = await request(server())
      .post('/portal/auth/verify')
      .send({ email: CONSULTANT, code });
    expect(apres.status).toBe(400);

    await request(server()).post('/portal/auth/request-code').send({ email: CONSULTANT });
    const code2 = lastCodeFor(CONSULTANT);
    await db
      .collection('work_external_challenges')
      .updateMany(
        { email: CONSULTANT, consumedAt: null },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
    expect(
      (await request(server()).post('/portal/auth/verify').send({ email: CONSULTANT, code: code2 }))
        .status,
    ).toBe(400);

    const audits = await db
      .collection('audit_events')
      .find({ organizationId: f.orgId(), action: 'work.external.code_failed' })
      .toArray();
    expect(audits.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(audits)).not.toContain(CONSULTANT);

    // Débit : 5 demandes par adresse et par fenêtre.
    const statuts: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuts.push(
        (await request(server()).post('/portal/auth/request-code').send({ email: CLIENT2 })).status,
      );
    }
    expect(statuts.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuts[5]).toBe(429);
  });

  it('isolement : le client ne voit que SES projets et les tâches visibles, aucune route de l’ERP', async () => {
    const c = portal(clientCookie);
    const projets = await c.get('/portal/projects');
    expect(projets.status).toBe(200);
    expect((projets.body.items as { id: string }[]).map((p) => p.id)).toEqual([p1]);
    expect(projets.body.items[0].leadName).toBe('Membre employee');
    for (const id of [p2, p3, pB]) expect((await c.get(`/portal/projects/${id}`)).status).toBe(404);
    expect((await c.get(`/portal/projects/${p1}`)).body.tasks).toHaveLength(0);

    // La gestion du projet rend une tâche visible ; un Membre ne le peut pas.
    const refus = await f.put('accountant', `/work/tasks/${shared}/client-settings`, {
      expectedRevision: await rev(shared),
      clientVisible: true,
    });
    expect(refus.status).toBe(403);
    const vis = await f.put('employee', `/work/tasks/${shared}/client-settings`, {
      expectedRevision: await rev(shared),
      clientVisible: true,
    });
    expect(vis.status, JSON.stringify(vis.body)).toBe(200);
    const vue = await c.get(`/portal/projects/${p1}`);
    expect((vue.body.tasks as { id: string }[]).map((t) => t.id)).toEqual([shared]);
    expect((await c.get(`/portal/tasks/${hidden}`)).status).toBe(404);
    expect((await c.get(`/portal/tasks/${shared}`)).status).toBe(200);
    expect(JSON.stringify(vue.body)).not.toMatch(FORBIDDEN_KEYS);
    expect(JSON.stringify((await c.get(`/portal/tasks/${shared}`)).body)).not.toMatch(
      FORBIDDEN_KEYS,
    );

    // Aucune route de l'ERP n'accepte la session externe (ni avec une organisation active).
    for (const path of [
      '/work/projects',
      `/work/projects/${p1}`,
      `/work/tasks/${shared}`,
      '/sales/customers',
      '/treasury/expenses',
      '/hr/employees',
      '/purchases/suppliers',
      '/organizations',
    ]) {
      const r = await request(server())
        .get(path)
        .set('Cookie', [`${COOKIE}=${clientCookie}`, `active_org_id=${f.orgId()}`]);
      expect([401, 403, 404], path).toContain(r.status);
      expect(r.status, path).toBe(401);
    }
    // Ni l'inverse : une session interne n'ouvre pas l'espace externe.
    expect((await request(server()).get('/portal/me').set('Cookie', f.as('owner'))).status).toBe(
      401,
    );
  });

  it('commentaires : internes par défaut, partagés visibles ; l’externe écrit toujours partagé', async () => {
    const interne = await f.post('owner', `/work/tasks/${shared}/comments`, {
      body: 'Prix plancher : 1 200 USD',
    });
    expect(interne.status).toBe(201);
    expect(interne.body.visibility).toBe('internal');
    const partage = await f.post('analyst', `/work/tasks/${shared}/comments`, {
      body: 'Première version en ligne.',
      visibility: 'shared',
    });
    expect(partage.status).toBe(201);
    const c = portal(clientCookie);
    const detail = await c.get(`/portal/tasks/${shared}`);
    const textes = (detail.body.comments as { body: string; authorName: string }[]).map(
      (x) => x.body,
    );
    expect(textes).toEqual(['Première version en ligne.']);
    expect(detail.body.comments[0].authorName).toBe('L’équipe projet');

    const reponse = await c.post(`/portal/tasks/${shared}/comments`, {
      body: 'Merci, quelques retours.',
    });
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(201);
    const fil = await f.get('owner', `/work/tasks/${shared}/comments`);
    const duClient = (
      fil.body.items as { body: string; visibility: string; author: { external?: string } }[]
    ).find((x) => x.body === 'Merci, quelques retours.')!;
    expect(duClient.visibility).toBe('shared');
    expect(duClient.author.external).toBe('client');
    const masquer = await f.put(
      'owner',
      `/work/comments/${(duClient as unknown as { id: string }).id}/visibility`,
      {
        expectedRevision: 1,
        visibility: 'internal',
      },
    );
    expect(masquer.status).toBe(409);
    // Un commentaire interne passé en partagé par son auteur devient visible.
    const bascule = await f.put('owner', `/work/comments/${interne.body.id}/visibility`, {
      expectedRevision: interne.body.revision,
      visibility: 'shared',
    });
    expect(bascule.status, JSON.stringify(bascule.body)).toBe(200);
    expect((await c.get(`/portal/tasks/${shared}`)).body.comments).toHaveLength(3);
    // Les commentaires existants (sans champ) restent internes.
    const ancien = await db.collection('work_comments').insertOne({
      organizationId: f.orgId(),
      projectId: p1,
      taskId: shared,
      authorUserId: f.userId('owner'),
      body: 'Ancien commentaire',
      mentionedUserIds: [],
      attachmentIds: [],
      editedAt: null,
      deletedAt: null,
      revision: 1,
      createdBy: f.userId('owner'),
      updatedBy: f.userId('owner'),
      createdAt: new Date(),
      updatedAt: new Date(),
      _schemaVersion: 1,
    });
    expect(ancien.insertedId).toBeInstanceOf(ObjectId);
    expect(
      ((await c.get(`/portal/tasks/${shared}`)).body.comments as { body: string }[]).some(
        (x) => x.body === 'Ancien commentaire',
      ),
    ).toBe(false);
  });

  it('validation client d’un jalon : motif obligatoire, puis approbation exigée avant le brouillon de facture', async () => {
    const reglage = await f.put('owner', `/work/tasks/${milestone}/client-settings`, {
      expectedRevision: await rev(milestone),
      clientVisible: true,
      clientApprovalRequired: true,
    });
    expect(reglage.status, JSON.stringify(reglage.body)).toBe(200);
    expect(reglage.body.clientApproval.state).toBe('pending');
    expect(
      (
        await f.post('owner', `/work/tasks/${milestone}/complete`, {
          expectedRevision: await rev(milestone),
        })
      ).status,
    ).toBe(200);
    const facture = await f.post('owner', `/work/tasks/${milestone}/prepare-invoice`, {
      source: 'empty',
    });
    expect(facture.status).toBe(409);
    expect(facture.body.code).toBe('WORK_MILESTONE_NOT_CLIENT_APPROVED');

    const c = portal(clientCookie);
    const projet = await c.get(`/portal/projects/${p1}`);
    expect(projet.body.project.pendingClientApprovals).toBe(1);
    const sansMotif = await c.post(`/portal/tasks/${milestone}/client-decision`, {
      expectedRevision: await rev(milestone),
      decision: 'request_changes',
    });
    expect(sansMotif.status).toBe(400);
    const modifs = await c.post(`/portal/tasks/${milestone}/client-decision`, {
      expectedRevision: await rev(milestone),
      decision: 'request_changes',
      reason: 'Le logo est flou.',
    });
    expect(modifs.status, JSON.stringify(modifs.body)).toBe(200);
    expect(modifs.body.clientApproval.state).toBe('changes_requested');
    const encore = await c.post(`/portal/tasks/${milestone}/client-decision`, {
      expectedRevision: await rev(milestone),
      decision: 'approve',
    });
    expect(encore.status).toBe(409);
    const remise = await f.post('owner', `/work/tasks/${milestone}/client-approval/reset`, {
      expectedRevision: await rev(milestone),
    });
    expect(remise.status, JSON.stringify(remise.body)).toBe(201);
    const ok = await c.post(`/portal/tasks/${milestone}/client-decision`, {
      expectedRevision: await rev(milestone),
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.clientApproval.state).toBe('approved');
    const facture2 = await f.post('owner', `/work/tasks/${milestone}/prepare-invoice`, {
      source: 'empty',
    });
    expect(facture2.body.code).not.toBe('WORK_MILESTONE_NOT_CLIENT_APPROVED');
    const audit = await db
      .collection('audit_events')
      .findOne({ organizationId: f.orgId(), action: 'work.external.client_approved' });
    expect(audit?.['actorUserId']).toBe(clientId);
    expect(audit?.['actorRole']).toBe('external_client');
  });

  it('consultant : ses tâches seulement, puis la vue du projet sur option, sans montants', async () => {
    consultantCookie = await login(CONSULTANT);
    const k = portal(consultantCookie);
    expect((await k.get(`/portal/projects/${p1}`)).body.tasks).toHaveLength(0);
    const affecte = await f.put('employee', `/work/tasks/${consultantTask}/client-settings`, {
      expectedRevision: await rev(consultantTask),
      consultantAssigneeId: consultantId,
    });
    expect(affecte.status, JSON.stringify(affecte.body)).toBe(200);
    expect(affecte.body.consultantAssignee.name).toBe('M. Tshisekedi');
    const vue = await k.get(`/portal/projects/${p1}`);
    expect((vue.body.tasks as { id: string; mine: boolean }[]).map((t) => [t.id, t.mine])).toEqual([
      [consultantTask, true],
    ]);
    expect((await k.get(`/portal/tasks/${hidden}`)).status).toBe(404);
    const decision = await k.post(`/portal/tasks/${consultantTask}/client-decision`, {
      expectedRevision: 1,
      decision: 'approve',
    });
    expect(decision.status).toBe(403);

    const ouvre = await f.put('employee', `/work/projects/${p1}/external-members/${consultantId}`, {
      canOpenProject: true,
    });
    expect(ouvre.status, JSON.stringify(ouvre.body)).toBe(200);
    const complet = await k.get(`/portal/projects/${p1}`);
    expect(complet.body.fullView).toBe(true);
    expect((complet.body.tasks as unknown[]).length).toBe(4);
    expect(JSON.stringify(complet.body)).not.toMatch(FORBIDDEN_KEYS);
    expect(JSON.stringify(complet.body)).not.toContain('Membre owner');
  });

  it('consultant : temps sur SES tâches, valorisé au taux d’achat dans la marge et le récapitulatif', async () => {
    const k = portal(consultantCookie);
    const surAutre = await k.post(`/portal/tasks/${shared}/time-entries`, {
      workedOn: '2026-11-10',
      minutes: 60,
    });
    expect(surAutre.status).toBe(403);
    const avecAutrui = await k.post(`/portal/tasks/${consultantTask}/time-entries`, {
      workedOn: '2026-11-10',
      minutes: 60,
      userId: f.userId('owner'),
    });
    expect(avecAutrui.status).toBe(400);
    const saisie = await k.post(`/portal/tasks/${consultantTask}/time-entries`, {
      workedOn: '2026-11-10',
      minutes: 90,
      note: 'Analyse des mots-clés',
    });
    expect(saisie.status, JSON.stringify(saisie.body)).toBe(201);

    const tauxRefuse = await f.post('analyst', `/work/external-accounts/${consultantId}/rates`, {
      currency: 'USD',
      hourlyRate: '40.00',
      effectiveFrom: '2026-01-01',
    });
    expect(tauxRefuse.status).toBe(403);
    const taux = await f.post('owner', `/work/external-accounts/${consultantId}/rates`, {
      currency: 'USD',
      hourlyRate: '40.00',
      effectiveFrom: '2026-01-01',
    });
    expect(taux.status, JSON.stringify(taux.body)).toBe(201);

    const marge = await f.get('owner', `/work/projects/${p1}/margin`);
    expect(marge.status, JSON.stringify(marge.body)).toBe(200);
    const usd = (marge.body.currencies as { currency: string; timeCost: string }[]).find(
      (x) => x.currency === 'USD',
    );
    expect(usd?.timeCost).toBe('60.00');
    const ligne = (
      marge.body.byMember as { user: { userId: string; external?: string }; cost: string }[]
    ).find((m) => m.user.userId === consultantId);
    expect(ligne?.cost).toBe('60.00');
    expect(ligne?.user.external).toBe('consultant');

    const recap = await f.get('owner', `/work/external-accounts/${consultantId}/time-recap`);
    expect(recap.status).toBe(200);
    expect(recap.body.rows).toEqual([
      {
        period: '2026-11',
        projectId: p1,
        projectName: 'Site Gombe',
        currency: 'USD',
        minutes: 90,
        amount: '60.00',
      },
    ]);
    const csv = await f.get('owner', `/work/external-accounts/${consultantId}/time-recap.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('2026-11;Site Gombe;90;1.50;USD;60.00');
    const fiche = await f.get('owner', `/work/suppliers/${supplier}/consultants`);
    expect(fiche.status).toBe(200);
    expect(fiche.body.consultants[0].recap.totals).toEqual([
      { currency: 'USD', minutes: 90, amount: '60.00' },
    ]);
    // Le consultant ne voit jamais son taux ni de montant.
    expect(JSON.stringify((await k.get(`/portal/tasks/${consultantTask}`)).body)).not.toMatch(
      FORBIDDEN_KEYS,
    );
  });

  it('consultant : semaine soumise, validée par son référent (ADR-0077), puis verrouillée', async () => {
    const k = portal(consultantCookie);
    const semaine = await k.get('/portal/timesheet?week=2026-11-09');
    expect(semaine.status, JSON.stringify(semaine.body)).toBe(200);
    expect(semaine.body.totalMinutes).toBe(90);
    expect(semaine.body.canSubmit).toBe(true);
    const soumise = await k.post('/portal/timesheet/submit', {
      week: '2026-11-09',
      expectedRevision: 0,
    });
    expect(soumise.status, JSON.stringify(soumise.body)).toBe(200);
    expect(soumise.body.status).toBe('submitted');

    const enAttente = await f.get('employee', '/work/timesheets/pending');
    expect(
      (enAttente.body.items as { user: { userId: string } }[]).map((p) => p.user.userId),
    ).toContain(consultantId);
    const autre = await f.post('analyst', '/work/timesheets/approve', {
      userId: consultantId,
      week: '2026-11-09',
      expectedRevision: soumise.body.revision,
    });
    expect(autre.status).toBe(404);
    const approuve = await f.post('employee', '/work/timesheets/approve', {
      userId: consultantId,
      week: '2026-11-09',
      expectedRevision: soumise.body.revision,
    });
    expect(approuve.status, JSON.stringify(approuve.body)).toBe(200);
    const entree = (await k.get('/portal/timesheet?week=2026-11-09')).body.entries[0];
    const bloque = await k.put(`/portal/time-entries/${entree.id}`, {
      expectedRevision: entree.revision,
      minutes: 120,
    });
    expect(bloque.status).toBe(409);
    expect(bloque.body.code).toBe('WORK_TIMESHEET_LOCKED');
  });

  it('cycle de vie : retrait du membre, fiche désactivée, archivage — accès fermés, sessions révoquées', async () => {
    // Retrait du consultant : sa session tombe (aucun autre accès).
    const retrait = await f.del(
      'employee',
      `/work/projects/${p1}/external-members/${consultantId}`,
    );
    expect(retrait.status).toBe(204);
    expect((await portal(consultantCookie).get('/portal/me')).status).toBe(401);
    const revoquee = await db
      .collection('work_external_sessions')
      .findOne({ accountId: consultantId });
    expect(revoquee?.['revokedAt']).toBeInstanceOf(Date);

    // Archivage : le client d'un autre projet perd son accès.
    const z = await f.post('owner', `/work/projects/${p2}/external-members`, {
      kind: 'client',
      email: CLIENT2,
      name: 'M. Mukwege',
      customerId: customer2,
    });
    expect(z.status, JSON.stringify(z.body)).toBe(201);
    const cookieZ = await login(CLIENT2);
    expect((await portal(cookieZ).get('/portal/projects')).status).toBe(200);
    const projet = await f.get('owner', `/work/projects/${p2}`);
    expect(
      (
        await f.post('owner', `/work/projects/${p2}/archive`, {
          expectedRevision: projet.body.revision,
        })
      ).status,
    ).toBe(200);
    expect((await portal(cookieZ).get('/portal/projects')).status).toBe(401);
    const demande = await request(server())
      .post('/portal/auth/request-code')
      .send({ email: CLIENT2 });
    expect(demande.status).toBe(202);

    // Fiche client désactivée : le contact est fermé à la requête suivante.
    await db
      .collection('customers')
      .updateOne({ _id: new ObjectId(customer1) }, { $set: { active: false } });
    expect((await portal(clientCookie).get('/portal/projects')).status).toBe(401);
    const compte = await f.get('owner', '/work/external-accounts');
    const ferme = (
      compte.body.items as { id: string; status: string; closedReason: string }[]
    ).find((a) => a.id === clientId);
    expect(ferme?.status).toBe('closed');
    expect(ferme?.closedReason).toBe('customer_inactive');
    await db
      .collection('customers')
      .updateOne({ _id: new ObjectId(customer1) }, { $set: { active: true } });

    const actions = (
      await db
        .collection('audit_events')
        .find({ organizationId: f.orgId(), action: /^work\.external\./ })
        .toArray()
    ).map((a) => a['action']);
    for (const a of [
      'work.external.invited',
      'work.external.signed_in',
      'work.external.code_failed',
      'work.external.access_closed',
      'work.external.sessions_revoked',
      'work.external.closed',
    ]) {
      expect(actions, a).toContain(a);
    }
  });

  it('conversion manuelle d’un Invité externe en contact client ; le rôle guest reste inchangé', async () => {
    const ajout = await f.post('owner', `/work/projects/${p1}/members`, {
      userIds: [f.userId('guest')],
    });
    expect(ajout.status, JSON.stringify(ajout.body)).toBe(201);
    const projets = await f.get('owner', `/work/guests/${f.userId('guest')}/projects`);
    expect((projets.body.items as { projectId: string }[]).map((p) => p.projectId)).toEqual([p1]);
    expect(
      (
        await f.post('owner', `/work/guests/${f.userId('employee')}/convert`, {
          kind: 'client',
          projectIds: [p1],
          customerId: customer1,
        })
      ).status,
    ).toBe(400);
    const conv = await f.post('owner', `/work/guests/${f.userId('guest')}/convert`, {
      kind: 'client',
      projectIds: [p1],
      customerId: customer1,
    });
    expect(conv.status, JSON.stringify(conv.body)).toBe(201);
    expect(conv.body.kind).toBe('client');
    expect(conv.body.projectCount).toBe(1);
    const membres = await f.get('owner', `/work/projects/${p1}/members`);
    expect((membres.body.users as { userId: string }[]).map((u) => u.userId)).not.toContain(
      f.userId('guest'),
    );
    const org = await f.get('owner', `/organizations/${f.orgId()}/members`);
    expect(
      (org.body.members as { userId: string; role: string }[]).find(
        (m) => m.userId === f.userId('guest'),
      )?.role,
    ).toBe('guest');
  });
});
