// Notifications des Projets par Slack — ADR-0064.
//
// AUCUN appel réel à Slack : `SlackApi.http` est remplacé par un faux `fetch` qui
// enregistre chaque appel (méthode, en-têtes, corps) et répond ce que le test décide.
// Aucun e-mail réel : le transport est espionné. Les secrets de l'application Slack
// et le jeton du bot sont des valeurs inventées.
//
// Couvre : application non configurée ; connexion OAuth (state signé lié à
// l'organisation, à l'utilisateur et expirant ; session vérifiée au retour) ;
// isolation entre organisations (B ne lit, n'utilise ni ne déconnecte la connexion de
// A) ; jeton jamais renvoyé ni stocké en clair ; messages privés selon préférences ;
// destinataire introuvable compté et mis en cache ; canal d'un projet et règle des
// projets privés ; `ratelimited` + `Retry-After` ; jeton révoqué → « à reconnecter » ;
// interrupteur `SLACK_ENABLED` ; Events API signée ; déconnexion (révocation) et
// espace partagé par deux organisations.

import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Coffre : clé maîtresse de test, posée AVANT le montage de l'application.
process.env['SECRETS_MASTER_KEY'] = randomBytes(32).toString('base64');
process.env['SECRETS_MASTER_KEY_ID'] = 'k-slack-e2e';

import { IntegrationsService } from '../integrations/integrations.service.js';
import { MailTransport } from '../mail/mail.transport.js';
import type { MailMessage } from '../mail/mail.types.js';
import { SlackApi } from '../slack/slack-api.js';
import { SlackNotifier } from '../slack/slack-notifier.service.js';
import { signSlackState, slackSignature } from '../slack/slack-security.js';
import { e2eSuite } from './e2e-utils.js';
import { useWorkFixture } from './work-e2e-fixtures.js';

const CLIENT_ID = '1111111111.2222222222';
const CLIENT_SECRET = 'ANTIFUITE-slack-client-secret-9d2e';
const SIGNING_SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN_A = 'xoxb-ANTIFUITE-org-a-5f1c9e03b7';
const TOKEN_B = 'xoxb-ANTIFUITE-org-b-8a4d27c6e1';
const TOKENS = [TOKEN_A, TOKEN_B, CLIENT_SECRET, SIGNING_SECRET];

interface SlackCall {
  method: string;
  headers: Record<string, string>;
  body: string;
}

type Handler = (call: SlackCall) => {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

e2eSuite('notifications des Projets par Slack (ADR-0064)', () => {
  const f = useWorkFixture('slack');
  const calls: SlackCall[] = [];
  const handlers = new Map<string, Handler | Handler[]>();
  const sleeps: number[] = [];
  const mails: MailMessage[] = [];
  let nextToken = TOKEN_A;
  let nextTeam = { id: 'TTEAMA0001', name: 'Espace Go freelance' };

  const notifier = () => f.app().get(SlackNotifier);
  const flush = () => notifier().flush();
  const methods = () => calls.map((c) => c.method);
  const callsOf = (m: string) => calls.filter((c) => c.method === m);

  function defaultHandler(call: SlackCall): ReturnType<Handler> {
    switch (call.method) {
      case 'oauth.v2.access':
        return {
          body: {
            ok: true,
            access_token: nextToken,
            token_type: 'bot',
            scope:
              'chat:write,chat:write.public,users:read,users:read.email,im:write,channels:read',
            bot_user_id: 'UBOT00001',
            app_id: 'AAPP00001',
            team: nextTeam,
          },
        };
      case 'users.lookupByEmail': {
        const email = new URLSearchParams(call.body).get('email') ?? '';
        return email.includes('-analyst-')
          ? { body: { ok: true, user: { id: 'UANALYST01' } } }
          : email.includes('-admin-')
            ? { body: { ok: true, user: { id: 'UADMIN0001' } } }
            : { body: { ok: false, error: 'users_not_found' } };
      }
      case 'conversations.open': {
        const users = (JSON.parse(call.body) as { users: string }).users;
        return { body: { ok: true, channel: { id: `D${users}` } } };
      }
      case 'conversations.list':
        return {
          body: {
            ok: true,
            channels: [
              { id: 'CGENERAL01', name: 'general' },
              { id: 'CPROJET001', name: 'projets' },
            ],
            response_metadata: { next_cursor: '' },
          },
        };
      default:
        return { body: { ok: true } };
    }
  }

  async function configureApp(enabled = true): Promise<void> {
    const svc = f.app().get(IntegrationsService) as unknown as {
      tester: { test: () => Promise<{ ok: boolean; latencyMs: number; detail: string }> };
      update: IntegrationsService['update'];
    };
    // Le test de connexion appellerait Slack : simulé.
    svc.tester = { test: async () => ({ ok: true, latencyMs: 0, detail: 'simulé' }) };
    await svc.update(
      'slack',
      {
        config: { clientId: CLIENT_ID },
        secrets: { clientSecret: CLIENT_SECRET, signingSecret: SIGNING_SECRET },
        enabled,
      },
      { userId: 'platform-admin', platformRole: 'platform_super_admin', ip: null, userAgent: null },
      false,
    );
    f.app().get(IntegrationsService);
    // Cache de 60 s de `SecretsService` : invalidé par l'écriture elle-même.
  }

  async function connect(who: 'owner' | 'ownerB'): Promise<request.Response> {
    const start = await f.post(who, '/work/slack/connect');
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const url = new URL(start.body.authorizeUrl as string);
    return request(f.app().getHttpServer())
      .get(`/slack/oauth/callback?code=code-${who}&state=${url.searchParams.get('state')}`)
      .set('Cookie', f.as(who));
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

  /** Aucune réponse, aucun document Slack, aucun audit ne contient un secret. */
  function noSecretIn(label: string, payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const s of TOKENS) expect(text.includes(s), `${label} contient un secret`).toBe(false);
  }

  beforeAll(() => {
    const api = f.app().get(SlackApi);
    api.http = async (url, init) => {
      const call: SlackCall = {
        method: url.replace('https://slack.com/api/', ''),
        headers: init.headers as Record<string, string>,
        body: typeof init.body === 'string' ? init.body : '',
      };
      expect(url.startsWith('https://slack.com/api/')).toBe(true);
      calls.push(call);
      const h = handlers.get(call.method);
      const handler = Array.isArray(h) ? (h.shift() ?? defaultHandler) : (h ?? defaultHandler);
      const r = handler(call);
      return new Response(JSON.stringify(r.body ?? { ok: true }), {
        status: r.status ?? 200,
        headers: r.headers ?? {},
      });
    };
    api.sleep = async (ms) => {
      sleeps.push(ms);
    };
    vi.spyOn(f.app().get(MailTransport), 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { delivered: true } as never;
    });
  });

  afterEach(async () => {
    await flush();
    calls.length = 0;
    handlers.clear();
    sleeps.length = 0;
    delete process.env['SLACK_ENABLED'];
  });

  describe('application non configurée', () => {
    it('rien ne casse : indisponible, bouton expliqué, aucun appel', async () => {
      const v = await f.get('owner', '/work/slack');
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({ available: false, connected: false, canManage: true });
      const c = await f.post('owner', '/work/slack/connect');
      expect(c.status).toBe(503);
      expect(c.body.code).toBe('SLACK_NOT_AVAILABLE');
      const p = await project('Avant Slack');
      await task(p.id, { title: 'Sans Slack', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
    });
  });

  describe('connexion OAuth de l’organisation', () => {
    beforeAll(async () => {
      await configureApp();
    });

    it('réservée à organization.manage ; work.read voit l’état sans pouvoir gérer', async () => {
      expect((await f.post('accountant', '/work/slack/connect')).status).toBe(403);
      expect((await f.del('analyst', '/work/slack')).status).toBe(403);
      const v = await f.get('analyst', '/work/slack');
      expect(v.status).toBe(200);
      expect(v.body).toMatchObject({ available: true, connected: false, canManage: false });
    });

    it('adresse d’autorisation : client ID, portées minimales, retour API, state signé', async () => {
      const start = await f.post('owner', '/work/slack/connect');
      expect(start.status).toBe(200);
      const url = new URL(start.body.authorizeUrl as string);
      expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('scope')).toBe(
        'chat:write,chat:write.public,users:read,users:read.email,im:write,channels:read',
      );
      expect(url.searchParams.get('redirect_uri')).toMatch(/\/slack\/oauth\/callback$/);
      expect(url.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/);
      noSecretIn('POST /work/slack/connect', start.body);
    });

    it('retour refusé : state falsifié, autre session, droit insuffisant, refus Slack', async () => {
      const server = f.app().getHttpServer();
      const bad = await request(server)
        .get('/slack/oauth/callback?code=x&state=faux.etat')
        .set('Cookie', f.as('owner'));
      expect(bad.status).toBe(302);
      expect(bad.headers['location']).toContain('slack=erreur-etat');

      // State de A rejoué par la session de B.
      const start = await f.post('owner', '/work/slack/connect');
      const stateA = new URL(start.body.authorizeUrl as string).searchParams.get('state');
      const autre = await request(server)
        .get(`/slack/oauth/callback?code=x&state=${stateA}`)
        .set('Cookie', f.as('ownerB'));
      expect(autre.headers['location']).toContain('slack=erreur-session');
      const sansSession = await request(server).get(`/slack/oauth/callback?code=x&state=${stateA}`);
      expect(sansSession.headers['location']).toContain('slack=erreur-session');

      // State correctement signé pour un membre sans organization.manage.
      const stateAnalyst = signSlackState(
        { organizationId: f.orgId(), userId: f.userId('analyst') },
        process.env['AUTH_SECRET'] ?? '',
      );
      const droit = await request(server)
        .get(`/slack/oauth/callback?code=x&state=${encodeURIComponent(stateAnalyst)}`)
        .set('Cookie', f.as('analyst'));
      expect(droit.headers['location']).toContain('slack=erreur-droit');

      // State expiré.
      const expire = signSlackState(
        { organizationId: f.orgId(), userId: f.userId('owner'), now: Date.now() - 11 * 60_000 },
        process.env['AUTH_SECRET'] ?? '',
      );
      const vieux = await request(server)
        .get(`/slack/oauth/callback?code=x&state=${encodeURIComponent(expire)}`)
        .set('Cookie', f.as('owner'));
      expect(vieux.headers['location']).toContain('slack=erreur-etat');

      const refus = await request(server)
        .get(`/slack/oauth/callback?error=access_denied&state=${stateA}`)
        .set('Cookie', f.as('owner'));
      expect(refus.headers['location']).toContain('slack=annule');
      // Aucun échange de code n'a eu lieu.
      expect(callsOf('oauth.v2.access')).toEqual([]);
    });

    it('connexion réussie : jeton chiffré dans le coffre, vue sans jeton, audit', async () => {
      const res = await connect('owner');
      expect(res.status).toBe(302);
      expect(res.headers['location']).toMatch(
        /\/projets\/parametres\?onglet=slack&slack=connecte$/,
      );
      const echange = callsOf('oauth.v2.access')[0]!;
      const form = new URLSearchParams(echange.body);
      expect(form.get('client_id')).toBe(CLIENT_ID);
      expect(form.get('client_secret')).toBe(CLIENT_SECRET);
      expect(form.get('code')).toBe('code-owner');

      const v = await f.get('owner', '/work/slack');
      expect(v.body).toMatchObject({
        available: true,
        connected: true,
        status: 'active',
        teamName: 'Espace Go freelance',
        connectedBy: { userId: f.userId('owner'), name: 'Membre owner' },
      });
      noSecretIn('GET /work/slack', v.body);

      const db = f.db();
      const conn = await db.collection('slack_connections').findOne({ organizationId: f.orgId() });
      noSecretIn('slack_connections', conn);
      const secret = await db
        .collection('organization_secrets')
        .findOne({ organizationId: f.orgId(), kind: 'slack_bot_token' });
      expect(secret).not.toBeNull();
      noSecretIn('organization_secrets', secret);
      const audit = await db
        .collection('audit_events')
        .find({ organizationId: f.orgId(), action: /^slack\./ })
        .toArray();
      expect(audit.map((a) => a['action'])).toContain('slack.connected');
      noSecretIn('audit', audit);
    });
  });

  describe('isolation entre organisations', () => {
    it('B ne lit, n’utilise ni ne déconnecte la connexion de A', async () => {
      const v = await f.get('ownerB', '/work/slack');
      expect(v.body).toMatchObject({ connected: false, teamName: null });
      const del = await f.del('ownerB', '/work/slack');
      expect(del.status).toBe(404);
      expect(del.body.code).toBe('SLACK_NOT_CONNECTED');
      const ch = await f.get('ownerB', '/work/slack/channels');
      expect(ch.status).toBe(404);
      const p = await project('Projet de A');
      const put = await f.put('ownerB', `/work/projects/${p.id}/slack-channel`, {
        channelId: 'CGENERAL01',
      });
      expect(put.status).toBe(404);
      expect(calls).toEqual([]);
      // A est intacte.
      expect((await f.get('owner', '/work/slack')).body.status).toBe('active');
    });
  });

  describe('messages privés', () => {
    it('assignation : message privé à l’assigné (défaut), Block Kit, jeton de A en Bearer', async () => {
      const p = await project('Refonte du site');
      await task(p.id, { title: 'Maquette accueil', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(methods()).toEqual(['users.lookupByEmail', 'conversations.open', 'chat.postMessage']);
      for (const c of calls) expect(c.headers['authorization']).toBe(`Bearer ${TOKEN_A}`);
      expect(new URLSearchParams(calls[0]!.body).get('email')).toContain('-analyst-');
      const post = JSON.parse(callsOf('chat.postMessage')[0]!.body) as {
        channel: string;
        text: string;
        blocks: unknown[];
      };
      expect(post.channel).toBe('DUANALYST01');
      const blocs = JSON.stringify(post.blocks);
      expect(blocs).toContain('Une tâche m’est assignée');
      expect(blocs).toContain('Maquette accueil');
      expect(blocs).toContain('Projet : Refonte du site');
      expect(blocs).toContain('Ouvrir dans Lalanda');
      expect(blocs).toMatch(/"url":"https?:\/\/[^"]+\/projets\//);
      expect((await f.get('owner', '/work/slack')).body.stats.sent).toBeGreaterThanOrEqual(1);
    });

    it('jamais ses propres gestes ; destinataire introuvable : silencieux, compté, mis en cache', async () => {
      const p = await project('Introuvables');
      await task(p.id, { title: 'À moi', assigneeUserId: f.userId('owner') });
      await flush();
      expect(callsOf('chat.postMessage')).toEqual([]);

      const before = (await f.get('owner', '/work/slack')).body.stats.unmatched as number;
      await task(p.id, { title: 'Compta 1', assigneeUserId: f.userId('accountant') });
      await flush();
      expect(methods()).toEqual(['users.lookupByEmail']);
      calls.length = 0;
      await task(p.id, { title: 'Compta 2', assigneeUserId: f.userId('accountant') });
      await flush();
      // Cache : pas de nouvelle recherche, toujours rien d'envoyé.
      expect(calls).toEqual([]);
      expect((await f.get('owner', '/work/slack')).body.stats.unmatched).toBe(before + 2);
    });

    it('préférence Slack coupée : aucun message ; colonne Slack enregistrée', async () => {
      const cur = await f.get('analyst', '/work/notification-preferences');
      expect(cur.body.events.task_assigned).toEqual({ bell: true, email: true, slack: true });
      expect(cur.body.events.task_overdue.slack).toBe(false);
      const events = {
        ...cur.body.events,
        task_assigned: { bell: true, email: false, slack: false },
      };
      const put = await f.put('analyst', '/work/notification-preferences', {
        expectedRevision: cur.body.revision,
        events,
        digest: cur.body.digest,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const p = await project('Sans Slack');
      await task(p.id, { title: 'Muet', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(callsOf('chat.postMessage')).toEqual([]);

      // Ancien client sans colonne Slack : la valeur enregistrée est gardée.
      const legacy = Object.fromEntries(
        Object.entries(put.body.events as Record<string, { bell: boolean; email: boolean }>).map(
          ([e, c]) => [e, { bell: c.bell, email: c.email }],
        ),
      );
      const again = await f.put('analyst', '/work/notification-preferences', {
        expectedRevision: put.body.revision,
        events: legacy,
        digest: cur.body.digest,
      });
      expect(again.status).toBe(200);
      expect(again.body.events.task_assigned.slack).toBe(false);
    });

    it('ratelimited : Retry-After respecté puis envoi', async () => {
      handlers.set('chat.postMessage', [
        () => ({ status: 429, headers: { 'retry-after': '2' } }),
        () => ({ body: { ok: true } }),
      ]);
      const p = await project('Débit');
      await task(p.id, { title: 'Patience', assigneeUserId: f.userId('admin') });
      await flush();
      expect(sleeps).toEqual([2000]);
      expect(callsOf('chat.postMessage')).toHaveLength(2);
    });
  });

  describe('canal d’un projet', () => {
    it('liste des canaux (work.manage), réglage, publication des événements', async () => {
      expect((await f.get('accountant', '/work/slack/channels')).status).toBe(403);
      const list = await f.get('owner', '/work/slack/channels');
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        { id: 'CGENERAL01', name: 'general' },
        { id: 'CPROJET001', name: 'projets' },
      ]);
      const p = await project('Lancement');
      expect(
        (
          await f.put('accountant', `/work/projects/${p.id}/slack-channel`, {
            channelId: 'CPROJET001',
          })
        ).status,
      ).toBe(403);
      const bad = await f.put('owner', `/work/projects/${p.id}/slack-channel`, {
        channelId: 'DPRIVE0001',
      });
      expect(bad.status).toBe(400);
      const put = await f.put('owner', `/work/projects/${p.id}/slack-channel`, {
        channelId: 'CPROJET001',
        channelName: 'projets',
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body).toMatchObject({
        connected: true,
        publishing: true,
        channel: { id: 'CPROJET001', name: 'projets' },
      });
      expect((await f.get('analyst', `/work/projects/${p.id}/slack-channel`)).body.canManage).toBe(
        false,
      );

      calls.length = 0;
      const t = await task(p.id, { title: 'Communiqué', assigneeUserId: f.userId('owner') });
      const moved = await f.post('owner', `/work/tasks/${t.id}/move`, {
        columnKey: 'doing',
        expectedRevision: t.revision,
      });
      expect(moved.status).toBe(200);
      await flush();
      const posts = callsOf('chat.postMessage').map(
        (c) => JSON.parse(c.body) as { channel: string; text: string },
      );
      const canal = posts.filter((m) => m.channel === 'CPROJET001');
      expect(canal.map((m) => m.text.split(' — ')[0])).toEqual([
        'Tâche assignée',
        'Tâche déplacée',
      ]);
    });

    it('projet privé : confirmation exigée ; passé en privé sans confirmation, plus rien', async () => {
      const prive = await project('Privé RH', { visibility: 'private' });
      const sans = await f.put('owner', `/work/projects/${prive.id}/slack-channel`, {
        channelId: 'CGENERAL01',
      });
      expect(sans.status).toBe(400);
      expect(sans.body.code).toBe('SLACK_PRIVATE_PROJECT_CONFIRMATION_REQUIRED');
      const avec = await f.put('owner', `/work/projects/${prive.id}/slack-channel`, {
        channelId: 'CGENERAL01',
        confirmPrivate: true,
      });
      expect(avec.status).toBe(200);
      expect(avec.body.channel.privateConfirmed).toBe(true);

      const p = await project('Bientôt privé');
      await f.put('owner', `/work/projects/${p.id}/slack-channel`, { channelId: 'CPROJET001' });
      await f
        .db()
        .collection('work_projects')
        .updateOne(
          { organizationId: f.orgId(), name: 'Bientôt privé' },
          { $set: { visibility: 'private' } },
        );
      expect((await f.get('owner', `/work/projects/${p.id}/slack-channel`)).body.publishing).toBe(
        false,
      );
      calls.length = 0;
      await task(p.id, { title: 'Discret', assigneeUserId: f.userId('owner') });
      await flush();
      expect(callsOf('chat.postMessage')).toEqual([]);

      const retire = await f.put('owner', `/work/projects/${p.id}/slack-channel`, {
        channelId: null,
      });
      expect(retire.body.channel).toBeNull();
    });
  });

  describe('interrupteurs et erreurs', () => {
    it('SLACK_ENABLED=false coupe tout envoi et rend Slack indisponible', async () => {
      process.env['SLACK_ENABLED'] = 'false';
      expect((await f.get('owner', '/work/slack')).body.available).toBe(false);
      const p = await project('Coupé');
      await task(p.id, { title: 'Rien', assigneeUserId: f.userId('analyst') });
      await flush();
      expect(calls).toEqual([]);
    });

    it('token_revoked : connexion « à reconnecter », plus aucun envoi, geste jamais en erreur', async () => {
      handlers.set('chat.postMessage', () => ({ body: { ok: false, error: 'token_revoked' } }));
      const p = await project('Révoqué');
      const t = await f.post('owner', `/work/projects/${p.id}/tasks`, {
        title: 'Toujours créée',
        assigneeUserId: f.userId('admin'),
      });
      expect(t.status).toBe(201);
      await flush();
      const v = await f.get('owner', '/work/slack');
      expect(v.body.status).toBe('reconnect_required');
      expect(v.body.stats.failed).toBeGreaterThanOrEqual(1);
      calls.length = 0;
      await task(p.id, { title: 'Après', assigneeUserId: f.userId('admin') });
      await flush();
      expect(calls).toEqual([]);
      // Reconnexion : redevient active.
      expect((await connect('owner')).headers['location']).toContain('slack=connecte');
      expect((await f.get('owner', '/work/slack')).body.status).toBe('active');
    });
  });

  describe('événements Slack (Events API)', () => {
    function signed(body: unknown, secret = SIGNING_SECRET, ts = Math.floor(Date.now() / 1000)) {
      const raw = JSON.stringify(body);
      return request(f.app().getHttpServer())
        .post('/slack/events')
        .set('content-type', 'application/json')
        .set('x-slack-request-timestamp', String(ts))
        .set('x-slack-signature', slackSignature(secret, String(ts), raw))
        .send(raw);
    }

    it('url_verification signée → challenge ; signature fausse ou périmée → 401', async () => {
      const ok = await signed({ type: 'url_verification', challenge: 'defi-123' });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ challenge: 'defi-123' });
      expect(
        (await signed({ type: 'url_verification', challenge: 'x' }, 'f'.repeat(32))).status,
      ).toBe(401);
      const vieux = Math.floor(Date.now() / 1000) - 600;
      expect(
        (await signed({ type: 'url_verification', challenge: 'x' }, SIGNING_SECRET, vieux)).status,
      ).toBe(401);
      const sans = await request(f.app().getHttpServer())
        .post('/slack/events')
        .send({ type: 'url_verification', challenge: 'x' });
      expect(sans.status).toBe(401);
    });

    it('app_uninstalled : connexion marquée désinstallée, jeton détruit', async () => {
      const res = await signed({
        type: 'event_callback',
        team_id: 'TTEAMA0001',
        api_app_id: 'AAPP00001',
        event: { type: 'app_uninstalled' },
      });
      expect(res.status).toBe(200);
      expect((await f.get('owner', '/work/slack')).body.status).toBe('uninstalled');
      expect(
        await f
          .db()
          .collection('organization_secrets')
          .findOne({ organizationId: f.orgId(), kind: 'slack_bot_token' }),
      ).toBeNull();
      // Reconnexion pour la suite.
      await connect('owner');
    });

    it('tokens_revoked (jeton de bot) : à reconnecter', async () => {
      await signed({
        type: 'event_callback',
        team_id: 'TTEAMA0001',
        api_app_id: 'AAPP00001',
        event: { type: 'tokens_revoked', tokens: { bot: ['UBOT00001'] } },
      });
      expect((await f.get('owner', '/work/slack')).body.status).toBe('reconnect_required');
      await connect('owner');
    });
  });

  describe('déconnexion', () => {
    it('espace partagé : A se déconnecte sans révoquer le jeton dont B se sert', async () => {
      nextToken = TOKEN_B;
      expect((await connect('ownerB')).headers['location']).toContain('slack=connecte');
      nextToken = TOKEN_A;
      calls.length = 0;
      const del = await f.del('owner', '/work/slack');
      expect(del.status).toBe(200);
      expect(del.body.connected).toBe(false);
      noSecretIn('DELETE /work/slack', del.body);
      expect(callsOf('auth.revoke')).toEqual([]);
      expect((await f.get('ownerB', '/work/slack')).body.status).toBe('active');
    });

    it('seule : auth.revoke avec son jeton, coffre vidé, audit', async () => {
      calls.length = 0;
      const del = await f.del('ownerB', '/work/slack');
      expect(del.status).toBe(200);
      expect(callsOf('auth.revoke')).toHaveLength(1);
      expect(callsOf('auth.revoke')[0]!.headers['authorization']).toBe(`Bearer ${TOKEN_B}`);
      expect(
        await f
          .db()
          .collection('organization_secrets')
          .findOne({ organizationId: f.orgB(), kind: 'slack_bot_token' }),
      ).toBeNull();
      const audit = await f
        .db()
        .collection('audit_events')
        .findOne({ organizationId: f.orgB(), action: 'slack.disconnected' });
      expect(audit).not.toBeNull();
      noSecretIn('audit B', audit);
      expect((await f.del('ownerB', '/work/slack')).status).toBe(404);
    });
  });
});
