// Notifications et membres externes — ADR-0079 § 3 bis et § 9.
//
// Vers l'ÉQUIPE : livrable validé par le client, modifications demandées (motif jamais
// recopié dans le titre), commentaire d'un client, temps saisi par un consultant (vers son
// référent), feuille soumise par un consultant (vers son référent).
// Vers les EXTERNES (e-mail seulement) : « un livrable attend votre validation »,
// « nouveau commentaire partagé » (seulement à ceux qui voient la tâche, jamais l'auteur),
// « un nouveau projet vous est ouvert » ; rafale regroupée ; lien vers /portail ; jamais de
// montant ; adresse masquée des journaux ; désinscription par lien signé (tout /
// validations seulement / rien) et depuis l'espace externe.
//
// Aucun envoi réel : transport mail espionné. Base dédiée (nom du fichier).

import 'reflect-metadata';

import { addDays, kinshasaDayOf } from '@lalanda/shared/work';
import type { Db } from 'mongodb';
import request from 'supertest';
import { beforeAll, expect, it, vi } from 'vitest';

import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { WorkExternalAuthService } from '../work/external/work-external-auth.service.js';
import { e2eSuite } from './e2e-utils.js';
import { E2E_HOOK_TIMEOUT_MS } from './e2e-timeouts.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const CLIENT = 'cliente@notif-externe.test';
const CLIENT2 = 'cliente2@notif-externe.test';
const CONSULTANT = 'consultant@notif-externe.test';
const COOKIE = 'lalanda_ext_session';
const AMOUNT = /USD|CDF|montant|\d+[,.]\d{2}\s?(USD|CDF|\$)/i;

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}

e2eSuite('notifications et membres externes (ADR-0079 § 3 bis, § 9)', () => {
  const f = useWorkFixture('nmx', { extraRoles: ['employee'] });
  const sent: MailMessage[] = [];
  let db: Db;
  let p1 = '';
  let p2 = '';
  let visible = '';
  let livrable = '';
  let consultantTask = '';
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
  });
  const login = async (email: string): Promise<string> => {
    await request(server()).post('/portal/auth/request-code').send({ email });
    await f.app().get(WorkExternalAuthService).settled();
    const mail = [...sent].reverse().find((m) => m.to === email && /code/i.test(m.subject));
    const code = /Voici votre code[^:]*: (\d{6})/.exec(mail!.text)![1]!;
    const res = await request(server()).post('/portal/auth/verify').send({ email, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    return raw
      .find((c) => c.startsWith(`${COOKIE}=`))!
      .split(';')[0]!
      .slice(COOKIE.length + 1);
  };
  const rev = async (taskId: string): Promise<number> =>
    (await f.get('owner', `/work/tasks/${taskId}`)).body.revision as number;
  const mailsTo = (email: string) => sent.filter((m) => m.to === email);

  beforeAll(async () => {
    db = f.db();
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      sent.push(m);
      return { delivered: true };
    });
    const now = new Date();
    const fiche = (name: string) => ({
      organizationId: f.orgId(),
      name,
      type: 'company',
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    const customer = String(
      (await db.collection('customers').insertOne(fiche('Client Gombe'))).insertedId,
    );
    const supplier = String(
      (await db.collection('suppliers').insertOne({ ...fiche('Cabinet Kin'), mergedInto: null }))
        .insertedId,
    );
    const projet = async (name: string) => {
      const r = await f.post('owner', '/work/projects', {
        name,
        kind: 'client',
        ownerUserId: f.userId('employee'),
        links: { customerId: customer },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    p1 = await projet('Site Gombe');
    p2 = await projet('Boutique Gombe');
    const tache = async (body: Record<string, unknown>) => {
      const r = await f.post('owner', `/work/projects/${p1}/tasks`, body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.task.id as string;
    };
    visible = await tache({ title: 'Maquette', assigneeUserId: f.userId('analyst') });
    livrable = await tache({ title: 'Livraison V1', assigneeUserId: f.userId('analyst') });
    consultantTask = await tache({ title: 'Audit SEO' });
    const invite = async (body: Record<string, unknown>, projectId = p1) => {
      const r = await f.post('owner', `/work/projects/${projectId}/external-members`, body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.account.id as string;
    };
    clientId = await invite({
      kind: 'client',
      email: CLIENT,
      name: 'Mme Kabila',
      customerId: customer,
    });
    await invite({ kind: 'client', email: CLIENT2, name: 'M. Lumbu', customerId: customer });
    consultantId = await invite({
      kind: 'consultant',
      email: CONSULTANT,
      name: 'M. Ilunga',
      supplierId: supplier,
      referentUserId: f.userId('employee'),
    });
    const reglage = async (taskId: string, body: Record<string, unknown>) => {
      const r = await f.put('owner', `/work/tasks/${taskId}/client-settings`, {
        expectedRevision: await rev(taskId),
        ...body,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    };
    await reglage(visible, { clientVisible: true });
    await reglage(consultantTask, { consultantAssigneeId: consultantId });
    clientCookie = await login(CLIENT);
    consultantCookie = await login(CONSULTANT);
  }, E2E_HOOK_TIMEOUT_MS);

  it('vers les externes : « un livrable attend votre validation » aux seuls contacts client', async () => {
    sent.length = 0;
    const r = await f.put('owner', `/work/tasks/${livrable}/client-settings`, {
      expectedRevision: await rev(livrable),
      clientVisible: true,
      clientApprovalRequired: true,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const m = mailsTo(CLIENT).find((x) => x.subject.includes('attend votre validation'));
    expect(m, JSON.stringify(sent.map((x) => x.subject))).toBeDefined();
    expect(m!.text).toContain('/portail/projets/');
    expect(m!.text).toContain('/portail/notifications?jeton=');
    expect(m!.text).not.toMatch(AMOUNT);
    expect(m!.redactInLogs).toBe(true);
    expect(mailsTo(CLIENT2).some((x) => x.subject.includes('attend votre validation'))).toBe(true);
    expect(mailsTo(CONSULTANT)).toEqual([]);
  });

  it('vers l’équipe : modifications demandées (sans le motif), puis validation par le client', async () => {
    f.notifications.length = 0;
    const c = portal(clientCookie);
    const modifs = await c.post(`/portal/tasks/${livrable}/client-decision`, {
      expectedRevision: await rev(livrable),
      decision: 'request_changes',
      reason: 'Le logo est flou et trop petit.',
    });
    expect(modifs.status, JSON.stringify(modifs.body)).toBe(200);
    const demande = f.notifications.filter((n) => n.kind === 'work.client_changes_requested');
    expect(demande.map((n) => n.recipientUserId).sort()).toEqual(
      [f.userId('analyst'), f.userId('employee')].sort(),
    );
    expect(demande.every((n) => !n.title.includes('logo'))).toBe(true);
    expect(sent.some((m) => m.text.includes('logo est flou'))).toBe(false);
    // Remise en attente : nouvel e-mail au client.
    sent.length = 0;
    const remise = await f.post('owner', `/work/tasks/${livrable}/client-approval/reset`, {
      expectedRevision: await rev(livrable),
    });
    expect(remise.status).toBe(201);
    expect(mailsTo(CLIENT).some((m) => m.subject.includes('attend votre validation'))).toBe(true);
    f.notifications.length = 0;
    const ok = await c.post(`/portal/tasks/${livrable}/client-decision`, {
      expectedRevision: await rev(livrable),
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
    expect(
      f.notifications.some(
        (n) => n.kind === 'work.client_approved' && n.recipientUserId === f.userId('employee'),
      ),
    ).toBe(true);
  });

  it('commentaire du client : l’équipe notifiée ; les AUTRES externes qui voient la tâche reçoivent un e-mail', async () => {
    f.notifications.length = 0;
    sent.length = 0;
    const r = await portal(clientCookie).post(`/portal/tasks/${visible}/comments`, {
      body: 'Pouvez-vous agrandir le titre ?',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const equipe = f.notifications.filter((n) => n.kind === 'work.external_comment');
    expect(equipe.map((n) => n.recipientUserId)).toContain(f.userId('analyst'));
    expect(equipe.map((n) => n.recipientUserId)).toContain(f.userId('employee'));
    // L'autrice ne reçoit rien ; l'autre contact client oui ; le consultant (tâche pas à lui) non.
    expect(mailsTo(CLIENT)).toEqual([]);
    expect(mailsTo(CLIENT2).some((m) => m.subject.includes('Nouveau commentaire'))).toBe(true);
    expect(mailsTo(CONSULTANT)).toEqual([]);
  });

  it('commentaire PARTAGÉ d’un membre interne : rafale regroupée (un seul e-mail en 10 min)', async () => {
    sent.length = 0;
    for (const body of ['Version 2 en ligne', 'Version 3 en ligne', 'Version 4 en ligne']) {
      const c = await f.post('owner', `/work/tasks/${visible}/comments`, {
        body,
        visibility: 'shared',
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
    }
    // Un commentaire INTERNE ne part jamais vers un externe.
    await f.post('owner', `/work/tasks/${visible}/comments`, { body: 'Note interne' });
    const a = mailsTo(CLIENT).filter((m) => m.subject.includes('Nouveau commentaire'));
    expect(a).toHaveLength(1);
    expect(sent.some((m) => m.text.includes('Note interne'))).toBe(false);
    const ledger = await db
      .collection('work_external_notifications')
      .find({ organizationId: f.orgId(), accountId: clientId, kind: 'shared_comment' })
      .toArray();
    expect(ledger.filter((l) => l['status'] === 'skipped:grouped')).toHaveLength(2);
    expect(JSON.stringify(ledger)).not.toContain(CLIENT);
  });

  it('consultant : temps saisi → son référent ; feuille soumise → son référent', async () => {
    f.notifications.length = 0;
    const k = portal(consultantCookie);
    const t = await k.post(`/portal/tasks/${consultantTask}/time-entries`, {
      workedOn: kinshasaDayOf(new Date()),
      minutes: 90,
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const temps = f.notifications.filter((n) => n.kind === 'work.consultant_time_logged');
    expect(temps.map((n) => n.recipientUserId)).toEqual([f.userId('employee')]);
    expect(temps[0]!.title).toMatch(/1 h 30/);
    expect(temps[0]!.title).not.toMatch(AMOUNT);
    f.notifications.length = 0;
    const sub = await k.post('/portal/timesheet/submit', {
      week: mondayOf(kinshasaDayOf(new Date())),
      expectedRevision: 0,
    });
    expect([200, 201], JSON.stringify(sub.body)).toContain(sub.status);
    expect(
      f.notifications
        .filter((n) => n.kind === 'work.timesheet_submitted')
        .map((n) => n.recipientUserId),
    ).toEqual([f.userId('employee')]);
  });

  it('« un nouveau projet vous est ouvert » pour un compte déjà actif (selon sa préférence)', async () => {
    sent.length = 0;
    const r = await f.post('owner', `/work/projects/${p2}/external-members`, {
      kind: 'client',
      email: CLIENT2,
      name: 'M. Lumbu',
      customerId: (await f.get('owner', `/work/projects/${p2}`)).body.links.customerId,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(mailsTo(CLIENT2).some((m) => m.subject.includes('nouveau projet vous est ouvert'))).toBe(
      true,
    );
    expect(mailsTo(CLIENT2).some((m) => /vous ouvre le projet/.test(m.subject))).toBe(false);
  });

  it('désinscription : lien signé (tout, validations seulement, rien), jeton faux refusé', async () => {
    sent.length = 0;
    await f.post('owner', `/work/tasks/${visible}/comments`, {
      body: 'Pour le jeton',
      visibility: 'shared',
    });
    // Lien du dernier e-mail reçu par la seconde cliente.
    await f.post('owner', `/work/tasks/${livrable}/comments`, {
      body: 'Autre tâche',
      visibility: 'shared',
    });
    const mail = [...mailsTo(CLIENT2)].reverse()[0]!;
    const jeton = decodeURIComponent(/jeton=([A-Za-z0-9._%-]+)/.exec(mail.text)![1]!);
    const lu = await request(server()).get(
      `/portal/notifications/preference?jeton=${encodeURIComponent(jeton)}`,
    );
    expect(lu.status).toBe(200);
    expect(lu.body).toEqual({ preference: 'all' });
    const faux = await request(server()).get(
      `/portal/notifications/preference?jeton=${encodeURIComponent(`${jeton.slice(0, -2)}xx`)}`,
    );
    expect(faux.status).toBe(404);
    const appr = await request(server())
      .put('/portal/notifications/preference')
      .send({ jeton, preference: 'approvals' });
    expect(appr.status, JSON.stringify(appr.body)).toBe(200);
    // « validations seulement » : plus de commentaire, toujours les livrables.
    sent.length = 0;
    const encore = await f.post('owner', `/work/projects/${p1}/tasks`, { title: 'Bannière' });
    const id = encore.body.task.id as string;
    await f.put('owner', `/work/tasks/${id}/client-settings`, {
      expectedRevision: await rev(id),
      clientVisible: true,
    });
    await f.post('owner', `/work/tasks/${id}/comments`, {
      body: 'Bannière prête',
      visibility: 'shared',
    });
    expect(mailsTo(CLIENT2).some((m) => m.subject.includes('Nouveau commentaire'))).toBe(false);
    await f.put('owner', `/work/tasks/${id}/client-settings`, {
      expectedRevision: await rev(id),
      clientVisible: true,
      clientApprovalRequired: true,
    });
    expect(mailsTo(CLIENT2).some((m) => m.subject.includes('attend votre validation'))).toBe(true);
    // « rien » depuis l'espace externe (session) : plus aucun e-mail.
    const rien = await portal(clientCookie).put('/portal/me/notifications', { preference: 'none' });
    expect(rien.status, JSON.stringify(rien.body)).toBe(200);
    expect((await portal(clientCookie).get('/portal/me/notifications')).body).toEqual({
      preference: 'none',
    });
    sent.length = 0;
    await f.post('owner', `/work/tasks/${id}/client-approval/reset`, {
      expectedRevision: await rev(id),
    });
    await f.post('owner', `/work/tasks/${visible}/comments`, {
      body: 'Encore',
      visibility: 'shared',
    });
    expect(mailsTo(CLIENT)).toEqual([]);
  });
});
