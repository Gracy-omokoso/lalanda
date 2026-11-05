// Tests unitaires de l'intégration Slack — ADR-0064. Aucun appel réseau : le client
// HTTP est simulé, et le `fetch` réel refuse de partir sous vitest (vérifié ici).

import { describe, expect, it } from 'vitest';

import { SlackApi, SlackApiError, realSlackHttp, slackApiBase } from './slack-api.js';
import { lalandaLink, slackEscape, slackWorkMessage } from './slack-messages.js';
import {
  SLACK_STATE_TTL_MS,
  signSlackState,
  slackSignature,
  verifySlackSignature,
  verifySlackState,
} from './slack-security.js';
import { slackEnabled } from './slack-connections.service.js';

const AUTH_SECRET = 'secret-de-session-de-test-assez-long-pour-hkdf-0123';

describe('state OAuth signé', () => {
  it('aller-retour : organisation, utilisateur, échéance', () => {
    const now = 1_800_000_000_000;
    const s = signSlackState({ organizationId: 'org-a', userId: 'u-1', now }, AUTH_SECRET);
    expect(verifySlackState(s, AUTH_SECRET, now + 1000)).toEqual({
      organizationId: 'org-a',
      userId: 'u-1',
      expiresAt: now + SLACK_STATE_TTL_MS,
    });
  });

  it('refuse un état expiré, falsifié, signé avec une autre clé ou mal formé', () => {
    const now = 1_800_000_000_000;
    const s = signSlackState({ organizationId: 'org-a', userId: 'u-1', now }, AUTH_SECRET);
    expect(verifySlackState(s, AUTH_SECRET, now + SLACK_STATE_TTL_MS + 1)).toBeNull();
    const [body, sig] = s.split('.');
    const forged = Buffer.from(
      JSON.stringify({ o: 'org-b', u: 'u-1', e: now + 60_000, n: 'x' }),
    ).toString('base64url');
    expect(verifySlackState(`${forged}.${sig}`, AUTH_SECRET, now)).toBeNull();
    expect(verifySlackState(`${body}.${sig}`, `${AUTH_SECRET}-autre`, now)).toBeNull();
    for (const bad of ['', 'a', 'a.b.c', 42, null, `${body}.`]) {
      expect(verifySlackState(bad, AUTH_SECRET, now)).toBeNull();
    }
  });

  it('refuse de signer sans AUTH_SECRET suffisant', () => {
    expect(() => signSlackState({ organizationId: 'o', userId: 'u' }, 'court')).toThrow();
  });
});

describe('signature des événements Slack', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const body = '{"type":"url_verification","challenge":"abc"}';
  const nowS = 1_800_000_000;

  it('accepte une signature exacte et fraîche', () => {
    const ts = String(nowS);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: slackSignature(secret, ts, body),
        rawBody: body,
        nowS,
      }),
    ).toBe(true);
  });

  it('refuse : horodatage de plus de 5 minutes, corps altéré, autre secret, en-têtes absents', () => {
    const vieux = String(nowS - 301);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: vieux,
        signature: slackSignature(secret, vieux, body),
        rawBody: body,
        nowS,
      }),
    ).toBe(false);
    const ts = String(nowS);
    const sig = slackSignature(secret, ts, body);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sig,
        rawBody: `${body} `,
        nowS,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: 'autre',
        timestamp: ts,
        signature: sig,
        rawBody: body,
        nowS,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: undefined,
        signature: sig,
        rawBody: body,
        nowS,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: 'v0=00',
        rawBody: body,
        nowS,
      }),
    ).toBe(false);
  });
});

describe('messages Block Kit', () => {
  it('court, en français, échappé, avec un bouton vers Lalanda', () => {
    const m = slackWorkMessage({
      eventLabel: 'Une tâche m’est assignée',
      title: 'Awa vous a assigné #3 <script> & co',
      projectName: 'Site web',
      organizationName: 'Go freelance',
      url: 'https://app.lalanda.co/projets/p/liste?tache=t',
    });
    const json = JSON.stringify(m.blocks);
    expect(json).toContain('&lt;script&gt; &amp; co');
    expect(json).not.toContain('<script>');
    expect(json).toContain('Ouvrir dans Lalanda');
    expect(json).toContain('Projet : Site web');
    expect(m.text).toContain('Une tâche m’est assignée');
  });

  it('un lien absolu reçu n’est jamais suivi', () => {
    expect(lalandaLink('https://app.lalanda.co/', '/projets/1')).toBe(
      'https://app.lalanda.co/projets/1',
    );
    expect(lalandaLink('https://app.lalanda.co', 'https://pirate.test')).toBe(
      'https://app.lalanda.co/projets',
    );
    expect(lalandaLink('https://app.lalanda.co', '//pirate.test')).toBe(
      'https://app.lalanda.co/projets',
    );
    expect(slackEscape('a<b>&')).toBe('a&lt;b&gt;&amp;');
  });
});

describe('client Slack simulé', () => {
  function client(
    reponses: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>,
  ) {
    const api = new SlackApi();
    const vues: Array<{ url: string; init: RequestInit }> = [];
    const sommeils: number[] = [];
    api.http = async (url, init) => {
      vues.push({ url, init });
      const r = reponses.shift() ?? { body: { ok: true } };
      return new Response(JSON.stringify(r.body ?? {}), {
        status: r.status ?? 200,
        headers: r.headers ?? {},
      });
    };
    api.sleep = async (ms) => {
      sommeils.push(ms);
    };
    return { api, vues, sommeils };
  }

  it('chat.postMessage : jeton en Bearer, JSON, aucun dépliage de lien', async () => {
    const { api, vues } = client([{ body: { ok: true } }]);
    await api.postMessage('xoxb-jeton-de-test', { channel: 'C123', text: 't', blocks: [] });
    expect(vues[0]!.url).toBe('https://slack.com/api/chat.postMessage');
    const h = vues[0]!.init.headers as Record<string, string>;
    expect(h['authorization']).toBe('Bearer xoxb-jeton-de-test');
    expect(h['content-type']).toContain('application/json');
    expect(JSON.parse(String(vues[0]!.init.body))).toMatchObject({
      channel: 'C123',
      unfurl_links: false,
    });
  });

  it('429 : respecte Retry-After puis réessaie', async () => {
    const { api, vues, sommeils } = client([
      { status: 429, headers: { 'retry-after': '3' } },
      { body: { ok: true } },
    ]);
    await api.postMessage('xoxb-x', { channel: 'C1', text: 't', blocks: [] });
    expect(sommeils).toEqual([3000]);
    expect(vues).toHaveLength(2);
  });

  it('429 répétés : abandon avec `ratelimited`', async () => {
    const { api } = client([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 429, headers: { 'retry-after': '1' } },
    ]);
    await expect(
      api.postMessage('x', { channel: 'C1', text: 't', blocks: [] }),
    ).rejects.toMatchObject({
      code: 'ratelimited',
    });
  });

  it('token_revoked et account_inactive signalent un jeton mort', async () => {
    for (const code of ['token_revoked', 'account_inactive']) {
      const { api } = client([{ body: { ok: false, error: code } }]);
      const err = await api
        .postMessage('x', { channel: 'C1', text: 't', blocks: [] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SlackApiError);
      expect((err as SlackApiError).deadToken).toBe(true);
      expect(String(err)).not.toContain('x');
    }
  });

  it('users.lookupByEmail : introuvable → null, sans exception', async () => {
    const { api, vues } = client([{ body: { ok: false, error: 'users_not_found' } }]);
    expect(await api.lookupUserByEmail('xoxb-x', 'absent@exemple.test')).toBeNull();
    expect(String(vues[0]!.init.body)).toBe('email=absent%40exemple.test');
  });

  it('oauth.v2.access : formulaire, réponse lue', async () => {
    const { api, vues } = client([
      {
        body: {
          ok: true,
          access_token: 'xoxb-nouveau',
          token_type: 'bot',
          scope: 'chat:write',
          bot_user_id: 'U1',
          app_id: 'A1',
          team: { id: 'T1', name: 'Équipe' },
        },
      },
    ]);
    const r = await api.oauthAccess({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'code',
      redirectUri: 'https://api.lalanda.co/slack/oauth/callback',
    });
    expect(r).toMatchObject({ teamId: 'T1', teamName: 'Équipe', tokenType: 'bot' });
    const form = new URLSearchParams(String(vues[0]!.init.body));
    expect(form.get('redirect_uri')).toBe('https://api.lalanda.co/slack/oauth/callback');
  });

  it('le fetch réel refuse de partir pendant les tests', async () => {
    await expect(realSlackHttp('https://slack.com/api/auth.test', {})).rejects.toThrow(
      /refusé pendant les tests/,
    );
  });
});

describe('faux Slack local', () => {
  it('seulement hors production et seulement en boucle locale', () => {
    expect(slackApiBase({})).toBe('https://slack.com/api');
    expect(slackApiBase({ SLACK_API_BASE_URL: 'http://127.0.0.1:3399/api/' })).toBe(
      'http://127.0.0.1:3399/api',
    );
    expect(
      slackApiBase({ SLACK_API_BASE_URL: 'http://127.0.0.1:3399/api', NODE_ENV: 'production' }),
    ).toBe('https://slack.com/api');
    expect(slackApiBase({ SLACK_API_BASE_URL: 'https://pirate.test/api' })).toBe(
      'https://slack.com/api',
    );
  });
});

describe('interrupteur SLACK_ENABLED', () => {
  it('allumé par défaut, seule la valeur false coupe', () => {
    expect(slackEnabled({})).toBe(true);
    expect(slackEnabled({ SLACK_ENABLED: 'true' })).toBe(true);
    expect(slackEnabled({ SLACK_ENABLED: ' FALSE ' })).toBe(false);
  });
});
