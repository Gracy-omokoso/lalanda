// Notifications des Projets par WhatsApp — ADR-0065.
//
// AUCUN appel réel à Meta : `WhatsAppApi.http` est remplacé par un faux `fetch` qui
// enregistre chaque appel (adresse, en-têtes, corps) et répond ce que le test décide.
// Aucun e-mail réel (transport espionné), aucun SMS. Les secrets du fournisseur et les
// numéros sont inventés.
//
// Couvre : fournisseur non configuré ; saisie du numéro et code (empreinte seule, 10 min,
// 5 essais, 3 codes par heure) ; numéro strictement personnel (ni un collègue, ni le
// Propriétaire, ni l'organisation B ne le lisent) ; préférences (colonne facultative,
// activation réservée au numéro vérifié) ; envois par modèle selon préférences et
// visibilité, jamais ses propres gestes ; limite de débit ; numéro injoignable → « à
// vérifier » ; plafond mensuel ; jeton refusé → fournisseur signalé dans `/admin` ;
// `WHATSAPP_ENABLED` ; webhook (poignée de main, signature, statuts, « STOP ») ;
// isolation A/B ; retrait du numéro.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k-whatsapp-e2e';

import { IntegrationsService } from '../integrations/integrations.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { WhatsAppApi } from '../whatsapp/whatsapp-api.js';
import { WhatsAppNotifier } from '../whatsapp/whatsapp-notifier.service.js';
import { hubSignature } from '../whatsapp/whatsapp-security.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture, type WorkAccount } from './work-e2e-fixtures.js';

const PHONE_NUMBER_ID = '109876543210987';
const WABA_ID = '209876543210987';
const ACCESS_TOKEN = 'EAAG-ANTIFUITE-whatsapp-e2e-7c1f93';
const APP_SECRET = 'fedcba9876543210fedcba9876543210';
const VERIFY_TOKEN = 'ANTIFUITE-verif-webhook-e2e-42';
const SECRETS = [ACCESS_TOKEN, APP_SECRET, VERIFY_TOKEN];

const PHONES: Partial<Record<WorkAccount, string>> = {
  analyst: '+243812345612',
  owner: '+243823456701',
  ownerB: '+243899999988',
};

interface MetaCall {
  url: string;
  headers: Record<string, string>;
  body: {
    to: string;
    template: {
      name: string;
      language: { code: string };
      components: Array<{ type: string; parameters: Array<{ text: string }> }>;
    };
  };
}

type Handler = (call: MetaCall) => { status?: number; body?: unknown };

e2eSuite('notifications des Projets par WhatsApp (ADR-0065)', () => {
  const f = useWorkFixture('whatsapp');
  const calls: MetaCall[] = [];
  /** Tous les appels depuis le début (jamais vidé) : le dernier code envoyé. */
  const allCalls: MetaCall[] = [];
  let handlers: Handler[] = [];
  const sleeps: number[] = [];
  let wamidSeq = 0;

  const flush = () => f.app().get(WhatsAppNotifier).flush();
  const templates = () => calls.map((c) => c.body.template.name);
  const lastCode = (): string => {
    const c = [...allCalls]
      .reverse()
      .find((x) => x.body.template.name === 'lalanda_code_verification');
    return c!.body.template.components[0]!.parameters[0]!.text;
  };

  async function configure(config: Record<string, string> = {}): Promise<void> {
    const svc = f.app().get(IntegrationsService) as unknown as {
      tester: { test: () => Promise<{ ok: boolean; latencyMs: number; detail: string }> };
      update: IntegrationsService['update'];
    };
    svc.tester = { test: async () => ({ ok: true, latencyMs: 0, detail: 'simulé' }) };
    await svc.update(
      'whatsapp',
      {
        config: { phoneNumberId: PHONE_NUMBER_ID, businessAccountId: WABA_ID, ...config },
        secrets: { accessToken: ACCESS_TOKEN, appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN },
        enabled: true,
      },
      { userId: 'platform-admin', platformRole: 'platform_super_admin', ip: null, userAgent: null },
      false,
    );
  }

  async function project(name: string, extra: Record<string, unknown> = {}) {
    const p = await f.post('owner', '/work/projects', { name, kind: 'internal', ...extra });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    return p.body as { id: string };
  }
  async function task(projectId: string, body: Record<string, unknown>) {
    const t = await f.post('owner', `/work/projects/${projectId}/tasks`, body);
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    return t.body.task as { id: string; revision: number };
  }

  async function verifyNumber(who: WorkAccount, phone = PHONES[who]!): Promise<void> {
    const r = await f.post(who, '/work/whatsapp/number', { phone });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = await f.post(who, '/work/whatsapp/number/verify', { code: lastCode() });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.number.status).toBe('verified');
  }

  async function setPrefs(
    who: WorkAccount,
    change: Record<string, Partial<Record<'bell' | 'email' | 'slack' | 'whatsapp', boolean>>>,
  ): Promise<request.Response> {
    const cur = await f.get(who, '/work/notification-preferences');
    const events = { ...cur.body.events };
    for (const [e, c] of Object.entries(change)) events[e] = { ...events[e], ...c };
    return f.put(who, '/work/notification-preferences', {
      expectedRevision: cur.body.revision,
      events,
      digest: cur.body.digest,
    });
  }

  function noSecretIn(label: string, payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const s of SECRETS) expect(text.includes(s), `${label} contient un secret`).toBe(false);
  }

  function webhook(payload: unknown, secret = APP_SECRET) {
    const raw = JSON.stringify(payload);
    return request(f.app().getHttpServer())
      .post('/whatsapp/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', hubSignature(secret, raw))
      .send(raw);
  }

  function change(value: Record<string, unknown>, phoneNumberId = PHONE_NUMBER_ID) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '243810000000', phone_number_id: phoneNumberId },
                ...value,
              },
            },
          ],
        },
      ],
    };
  }

  beforeAll(() => {
    const api = f.app().get(WhatsAppApi);
    api.http = async (url, init) => {
      expect(url.startsWith(`https://graph.facebook.com/v24.0/${PHONE_NUMBER_ID}/messages`)).toBe(
        true,
      );
      const call: MetaCall = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)) as MetaCall['body'],
      };
      calls.push(call);
      allCalls.push(call);
      const h = handlers.shift();
      const r = h ? h(call) : { body: { messages: [{ id: `wamid.E2E${(wamidSeq += 1)}` }] } };
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    };
    api.sleep = async (ms) => {
      sleeps.push(ms);
    };
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      void m;
      return { delivered: true } as never;
    });
  });

  afterEach(async () => {
    await flush();
    calls.length = 0;
    handlers = [];
    sleeps.length = 0;
    delete process.env['WHATSAPP_ENABLED'];
  });

  describe('fournisseur non configuré', () => {
    it('rien ne casse : indisponible et expliqué, aucun appel', async () => {
      const v = await f.get('analyst', '/work/whatsapp');
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({
        available: false,
        unavailableReason: 'not_configured',
        number: null,
        codesLeftThisHour: 3,
        quota: { used: 0, limit: 1000, reached: false },
      });
      const c = await f.post('analyst', '/work/whatsapp/number', { phone: PHONES.analyst });
      expect(c.status).toBe(503);
      expect(c.body.code).toBe('WHATSAPP_NOT_AVAILABLE');
      const prefs = await f.get('analyst', '/work/notification-preferences');
      expect(prefs.body.events.task_assigned.whatsapp).toBe(true);
      expect(prefs.body.events.comment_on_followed.whatsapp).toBe(false);
      const p = await project('Avant WhatsApp');
      await task(p.id, { title: 'Sans WhatsApp', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
    });
  });

  describe('numéro et code de vérification', () => {
    beforeAll(async () => {
      await configure();
    });

    it('numéro invalide ou corps inattendu : 400, aucun appel', async () => {
      const bad = await f.post('analyst', '/work/whatsapp/number', { phone: '+243 12' });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('WHATSAPP_PHONE_INVALID');
      const extra = await f.post('analyst', '/work/whatsapp/number', {
        phone: PHONES.analyst,
        userId: f.userId('owner'),
      });
      expect(extra.status).toBe(400);
      expect(calls).toEqual([]);
    });

    it('code envoyé par modèle d’authentification ; seule l’empreinte est gardée', async () => {
      const r = await f.post('analyst', '/work/whatsapp/number', { phone: '0812345612' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({
        available: true,
        number: {
          phone: PHONES.analyst,
          phoneMasked: '+243 81 *** **12',
          status: 'pending',
          verifiedAt: null,
          code: { attemptsLeft: 5 },
        },
        codesLeftThisHour: 2,
      });
      noSecretIn('POST /work/whatsapp/number', r.body);
      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(call.body).toMatchObject({
        to: '243812345612',
        template: { name: 'lalanda_code_verification', language: { code: 'fr' } },
      });
      const code = lastCode();
      expect(code).toMatch(/^\d{6}$/);
      const doc = await f
        .db()
        .collection('whatsapp_recipients')
        .findOne({ organizationId: f.orgId(), userId: f.userId('analyst') });
      expect(doc?.['codeHash']).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(doc)).not.toContain(`"${code}"`);
      const expire = new Date(doc?.['codeExpiresAt'] as Date).getTime() - Date.now();
      expect(expire).toBeGreaterThan(9 * 60_000);
      expect(expire).toBeLessThanOrEqual(10 * 60_000);
      expect((await f.get('analyst', '/work/whatsapp')).body.quota.used).toBe(1);
    });

    it('mauvais code : essais décomptés ; bon code : numéro vérifié', async () => {
      const code = lastCode();
      const wrong = code === '000000' ? '111111' : '000000';
      const ko = await f.post('analyst', '/work/whatsapp/number/verify', { code: wrong });
      expect(ko.status).toBe(400);
      expect(ko.body).toMatchObject({
        code: 'WHATSAPP_CODE_INVALID',
        details: { attemptsLeft: 4 },
      });
      const ok = await f.post('analyst', '/work/whatsapp/number/verify', { code });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.number).toMatchObject({ status: 'verified', code: null });
      expect(ok.body.number.verifiedAt).not.toBeNull();
      const again = await f.post('analyst', '/work/whatsapp/number', { phone: PHONES.analyst });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('WHATSAPP_ALREADY_VERIFIED');
    });

    it('5 essais au plus, puis code effacé ; code expiré refusé', async () => {
      expect(
        (await f.post('accountant', '/work/whatsapp/number', { phone: '+243811111111' })).status,
      ).toBe(200);
      const code = lastCode();
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 4; i >= 0; i -= 1) {
        const r = await f.post('accountant', '/work/whatsapp/number/verify', { code: wrong });
        expect(r.status).toBe(400);
        expect(r.body.details.attemptsLeft).toBe(i);
      }
      const none = await f.post('accountant', '/work/whatsapp/number/verify', { code });
      expect(none.status).toBe(404);
      expect(none.body.code).toBe('WHATSAPP_NO_PENDING_CODE');

      await f.post('accountant', '/work/whatsapp/number', { phone: '+243811111111' });
      await f
        .db()
        .collection('whatsapp_recipients')
        .updateOne(
          { organizationId: f.orgId(), userId: f.userId('accountant') },
          { $set: { codeExpiresAt: new Date(Date.now() - 1000) } },
        );
      const old = await f.post('accountant', '/work/whatsapp/number/verify', { code: lastCode() });
      expect(old.status).toBe(410);
      expect(old.body.code).toBe('WHATSAPP_CODE_EXPIRED');
    });

    it('3 codes par heure et par personne, même en changeant de numéro', async () => {
      for (const n of ['+243820000001', '+243820000002', '+243820000003']) {
        expect((await f.post('viewer', '/work/whatsapp/number', { phone: n })).status).toBe(200);
      }
      const r = await f.post('viewer', '/work/whatsapp/number', { phone: '+243820000004' });
      expect(r.status).toBe(429);
      expect(r.body.code).toBe('WHATSAPP_CODE_RATE_LIMITED');
      expect(r.body.details.retryAt).toBeTruthy();
      // Retirer puis ressaisir ne contourne pas la limite.
      expect((await f.del('viewer', '/work/whatsapp/number')).status).toBe(200);
      const v = await f.get('viewer', '/work/whatsapp');
      expect(v.body).toMatchObject({ number: null, codesLeftThisHour: 0 });
      expect(
        (await f.post('viewer', '/work/whatsapp/number', { phone: '+243820000004' })).status,
      ).toBe(429);
      expect(calls).toHaveLength(3);
    });
  });

  describe('donnée personnelle', () => {
    it('ni un collègue, ni le Propriétaire, ni l’organisation B ne lisent le numéro', async () => {
      const own = await f.get('owner', '/work/whatsapp');
      expect(own.body.number).toBeNull();
      expect(JSON.stringify(own.body)).not.toContain('812345612');
      const members = await f.get('owner', `/organizations/${f.orgId()}/members`);
      expect(members.status).toBe(200);
      expect(JSON.stringify(members.body)).not.toContain('812345612');
      const b = await f.get('ownerB', '/work/whatsapp');
      expect(b.body).toMatchObject({ number: null, quota: { used: 0 } });
      expect(JSON.stringify(b.body)).not.toContain('812345612');
      // Aucune trace du numéro (même masqué) dans l'audit.
      const audit = await f
        .db()
        .collection('audit_events')
        .find({ action: /^whatsapp\./ })
        .toArray();
      expect(audit.map((a) => a['action'])).toEqual(
        expect.arrayContaining(['whatsapp.code_sent', 'whatsapp.number_verified']),
      );
      expect(JSON.stringify(audit)).not.toMatch(/\+243|812345612|\*\*\*/);
    });
  });

  describe('préférences', () => {
    it('activer WhatsApp exige un numéro vérifié ; un ancien écran ne remet rien à zéro', async () => {
      const refus = await setPrefs('owner', { comment_on_followed: { whatsapp: true } });
      expect(refus.status).toBe(409);
      expect(refus.body.code).toBe('WHATSAPP_NUMBER_NOT_VERIFIED');
      // Renvoyer les défauts tels quels reste permis.
      expect((await setPrefs('owner', { mentioned: { email: false } })).status).toBe(200);

      const off = await setPrefs('analyst', { task_overdue: { whatsapp: false } });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const legacy = Object.fromEntries(
        Object.entries(off.body.events as Record<string, { bell: boolean; email: boolean }>).map(
          ([e, c]) => [e, { bell: c.bell, email: c.email }],
        ),
      );
      const again = await f.put('analyst', '/work/notification-preferences', {
        expectedRevision: off.body.revision,
        events: legacy,
        digest: off.body.digest,
      });
      expect(again.status).toBe(200);
      expect(again.body.events.task_overdue.whatsapp).toBe(false);
      expect(again.body.events.task_assigned.whatsapp).toBe(true);
    });
  });

  describe('envois', () => {
    it('assignation : modèle lalanda_tache_assignee au numéro vérifié, journal, quota', async () => {
      const before = (await f.get('owner', '/work/whatsapp')).body.quota.used as number;
      const p = await project('Refonte du site');
      await task(p.id, { title: 'Maquette accueil', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(templates()).toEqual(['lalanda_tache_assignee']);
      const body = calls[0]!.body;
      expect(body.to).toBe('243812345612');
      const params = body.template.components[0]!.parameters.map((x) => x.text);
      expect(params[0]).toContain('Maquette accueil');
      expect(params[1]).toBe('Refonte du site');
      expect(body.template.components[1]!.parameters[0]!.text).toMatch(
        /^projets\/[0-9a-f]{24}\?tache=/,
      );
      expect((await f.get('owner', '/work/whatsapp')).body.quota.used).toBe(before + 1);
      const log = await f
        .db()
        .collection('whatsapp_messages')
        .findOne({ organizationId: f.orgId(), template: 'lalanda_tache_assignee' });
      expect(log).toMatchObject({ userId: f.userId('analyst'), status: 'accepted' });
      expect(JSON.stringify(log)).not.toContain('812345612');
    });

    it('jamais ses propres gestes ; préférence coupée : rien', async () => {
      await verifyNumber('owner');
      calls.length = 0;
      const p = await project('Mes gestes');
      await task(p.id, { title: 'À moi', assigneeUserId: f.userId('owner') });
      expect((await setPrefs('analyst', { task_assigned: { whatsapp: false } })).status).toBe(200);
      await task(p.id, { title: 'Muet', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
      expect((await setPrefs('analyst', { task_assigned: { whatsapp: true } })).status).toBe(200);
    });

    it('jamais vers quelqu’un qui ne voit plus le projet', async () => {
      expect((await setPrefs('analyst', { task_status_changed: { whatsapp: true } })).status).toBe(
        200,
      );
      const p = await project('Bientôt privé');
      const t = await task(p.id, { title: 'Discret', assigneeUserId: f.userId('analyst') });
      await flush();
      calls.length = 0;
      await f
        .db()
        .collection('work_projects')
        .updateOne(
          { organizationId: f.orgId(), name: 'Bientôt privé' },
          { $set: { visibility: 'private' } },
        );
      const moved = await f.post('owner', `/work/tasks/${t.id}/move`, {
        columnKey: 'doing',
        expectedRevision: t.revision,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      await flush();
      expect(calls).toEqual([]);
    });

    it('limite de débit Meta : nouvelle tentative bornée puis envoi', async () => {
      handlers = [() => ({ status: 429, body: { error: { code: 130429 } } })];
      const p = await project('Débit');
      await task(p.id, { title: 'Patience', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(sleeps).toEqual([1000]);
      expect(templates()).toEqual(['lalanda_tache_assignee', 'lalanda_tache_assignee']);
    });

    it('numéro injoignable (131026) : « à vérifier », plus rien ne part, jamais d’erreur au geste', async () => {
      handlers = [() => ({ status: 400, body: { error: { code: 131026 } } })];
      const p = await project('Injoignable');
      await task(p.id, { title: 'Perdu', assigneeUserId: f.userId('analyst') });
      await flush();
      expect((await f.get('analyst', '/work/whatsapp')).body.number.status).toBe('to_verify');
      calls.length = 0;
      await task(p.id, { title: 'Toujours perdu', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
      await verifyNumber('analyst');
    });

    it('plafond mensuel : au-delà plus d’envoi, et l’écran le dit', async () => {
      const used = (await f.get('owner', '/work/whatsapp')).body.quota.used as number;
      await configure({ monthlyLimitPerOrganization: String(used + 1) });
      calls.length = 0;
      const p = await project('Plafond');
      await task(p.id, { title: 'Dernier', assigneeUserId: f.userId('analyst') });
      await flush();
      await task(p.id, { title: 'De trop', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(templates()).toEqual(['lalanda_tache_assignee']);
      const v = await f.get('analyst', '/work/whatsapp');
      expect(v.body.quota).toMatchObject({ used: used + 1, limit: used + 1, reached: true });
      const code = await f.post('admin', '/work/whatsapp/number', { phone: '+243830000001' });
      expect(code.status).toBe(409);
      expect(code.body.code).toBe('WHATSAPP_QUOTA_REACHED');
      // L'organisation B a son propre compteur.
      expect((await f.get('ownerB', '/work/whatsapp')).body.quota.reached).toBe(false);
      await configure({ monthlyLimitPerOrganization: '1000' });
    });

    it('jeton refusé (190) : fournisseur signalé dans /admin, envois suspendus', async () => {
      handlers = [() => ({ status: 401, body: { error: { code: 190, message: ACCESS_TOKEN } } })];
      const p = await project('Jeton');
      await task(p.id, { title: 'Refusé', assigneeUserId: f.userId('analyst') });
      await flush();
      const v = await f.get('analyst', '/work/whatsapp');
      expect(v.body).toMatchObject({ available: false, unavailableReason: 'provider_error' });
      const integ = await f.db().collection('integrations').findOne({ provider: 'whatsapp' });
      expect(integ?.['lastTest']).toMatchObject({ status: 'failed' });
      expect(String(integ?.['lastTest']?.['detail'])).toContain('190');
      noSecretIn('lastTest', integ?.['lastTest']);
      calls.length = 0;
      await task(p.id, { title: 'Suspendu', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
      // Un nouveau test réussi (nouvelle saisie dans /admin) rétablit les envois.
      await configure();
      expect((await f.get('analyst', '/work/whatsapp')).body.available).toBe(true);
    });

    it('WHATSAPP_ENABLED=false coupe tout envoi', async () => {
      process.env['WHATSAPP_ENABLED'] = 'false';
      const v = await f.get('analyst', '/work/whatsapp');
      expect(v.body).toMatchObject({ available: false, unavailableReason: 'switched_off' });
      expect(v.body.number.status).toBe('verified');
      const p = await project('Coupé');
      await task(p.id, { title: 'Rien', assigneeUserId: f.userId('analyst') });
      await flush();
      const c = await f.post('admin', '/work/whatsapp/number', { phone: '+243830000001' });
      expect(c.status).toBe(503);
      expect(calls).toEqual([]);
    });

    it('isolation : les événements de A ne vont qu’aux numéros de A', async () => {
      await verifyNumber('ownerB');
      calls.length = 0;
      const p = await project('Chez A');
      await task(p.id, { title: 'Pour A', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls.map((c) => c.body.to)).toEqual(['243812345612']);
      const b = await f.get('ownerB', '/work/whatsapp');
      expect(b.body.number.phone).toBe(PHONES.ownerB);
      expect(b.body.quota.used).toBe(1);
      const a = await f.get('analyst', '/work/whatsapp');
      expect(JSON.stringify(a.body)).not.toContain('899999988');
    });
  });

  describe('webhook Meta', () => {
    it('poignée de main : jeton de vérification exact, challenge renvoyé en texte', async () => {
      const server = f.app().getHttpServer();
      const ok = await request(server).get(
        `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
      );
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('1158201444');
      const bad = await request(server).get(
        '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=1',
      );
      expect(bad.status).toBe(403);
      const xss = await request(server).get(
        `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=%3Cscript%3E`,
      );
      expect(xss.status).toBe(403);
    });

    it('signature absente ou fausse : 401, rien n’est appliqué', async () => {
      const server = f.app().getHttpServer();
      const none = await request(server)
        .post('/whatsapp/webhook')
        .set('content-type', 'application/json')
        .send(JSON.stringify({ object: 'whatsapp_business_account' }));
      expect(none.status).toBe(401);
      const stop = change({
        messages: [{ from: '243812345612', type: 'text', text: { body: 'STOP' } }],
      });
      expect((await webhook(stop, '0'.repeat(32))).status).toBe(401);
      expect((await f.get('analyst', '/work/whatsapp')).body.number.status).toBe('verified');
    });

    it('statuts : jamais de recul (lu > remis > envoyé), autre numéro ignoré', async () => {
      const log = await f.db().collection('whatsapp_messages').findOne({
        organizationId: f.orgId(),
        template: 'lalanda_tache_assignee',
        status: 'accepted',
      });
      const id = String(log?.['wamid']);
      const st = (status: string) => ({
        id,
        status,
        timestamp: '1700000000',
        recipient_id: '243812345612',
      });
      expect((await webhook(change({ statuses: [st('delivered')] }))).status).toBe(200);
      expect((await webhook(change({ statuses: [st('sent')] }))).status).toBe(200);
      const mid = await f.db().collection('whatsapp_messages').findOne({ wamid: id });
      expect(mid?.['status']).toBe('delivered');
      await webhook(change({ statuses: [st('read')] }, '999999999999'));
      expect(
        (await f.db().collection('whatsapp_messages').findOne({ wamid: id }))?.['status'],
      ).toBe('delivered');
      await webhook(change({ statuses: [st('read')] }));
      expect(
        (await f.db().collection('whatsapp_messages').findOne({ wamid: id }))?.['status'],
      ).toBe('read');
    });

    it('échec annoncé (131026) : numéro « à vérifier »', async () => {
      const log = await f.db().collection('whatsapp_messages').findOne({
        organizationId: f.orgId(),
        template: 'lalanda_tache_assignee',
        status: 'accepted',
      });
      const r = await webhook(
        change({
          statuses: [
            {
              id: String(log?.['wamid']),
              status: 'failed',
              recipient_id: '243812345612',
              errors: [{ code: 131026, title: 'Message undeliverable' }],
            },
          ],
        }),
      );
      expect(r.status).toBe(200);
      expect((await f.get('analyst', '/work/whatsapp')).body.number.status).toBe('to_verify');
      await verifyNumber('analyst');
    });

    it('« ARRÊT » reçu : WhatsApp désactivé pour ce numéro, même interrupteur coupé', async () => {
      process.env['WHATSAPP_ENABLED'] = 'false';
      const r = await webhook(
        change({
          messages: [
            { from: '243823456701', id: 'wamid.IN1', type: 'text', text: { body: 'Arrêt' } },
          ],
        }),
      );
      expect(r.status).toBe(200);
      delete process.env['WHATSAPP_ENABLED'];
      const v = await f.get('owner', '/work/whatsapp');
      expect(v.body.number.status).toBe('opted_out');
      expect((await f.get('analyst', '/work/whatsapp')).body.number.status).toBe('verified');
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ organizationId: f.orgId(), action: 'whatsapp.opted_out' });
      expect(audit?.['targetId']).toBe(f.userId('owner'));
      // Plus rien vers ce numéro : l'analyste assigne au Propriétaire… par l'intermédiaire
      // d'un tiers (le Propriétaire ne reçoit jamais ses propres gestes).
      calls.length = 0;
      const p = await project('Après STOP');
      const t = await f.post('admin', `/work/projects/${p.id}/tasks`, {
        title: 'Pour le Propriétaire',
        assigneeUserId: f.userId('owner'),
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      await flush();
      expect(calls.filter((c) => c.body.to === '243823456701')).toEqual([]);
    });
  });

  describe('retrait du numéro', () => {
    it('retiré à tout moment : plus aucun envoi', async () => {
      const del = await f.del('analyst', '/work/whatsapp/number');
      expect(del.status).toBe(200);
      expect(del.body.number).toBeNull();
      calls.length = 0;
      const p = await project('Après retrait');
      await task(p.id, { title: 'Plus rien', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({
          organizationId: f.orgId(),
          action: 'whatsapp.number_removed',
          actorUserId: f.userId('analyst'),
        });
      expect(audit).not.toBeNull();
    });
  });
});
