// Client de l'API Web de Slack — ADR-0064 § 5.
//
// `fetch` natif, aucune dépendance (le SDK `@slack/web-api` apporterait un arbre de
// paquets dans le processus qui détient `SECRETS_MASTER_KEY`, ADR-0013 §10). Six
// méthodes suffisent : échange OAuth, révocation, recherche d'un membre par e-mail,
// liste des canaux publics, ouverture d'un message privé, publication.
//
// ── Testable sans jamais joindre Slack ───────────────────────────────────────
//
// `http` et `sleep` sont publics et REMPLAÇABLES (motif de `WorkNotifier.port`) : les
// tests substituent un faux `fetch` qui enregistre méthode, en-têtes et corps, et un
// faux sommeil. Garde-fou de plus : le `fetch` par défaut REFUSE de partir quand le
// processus tourne sous vitest — un test qui oublierait de simuler Slack échoue au
// lieu d'appeler l'API réelle.
//
// ── Erreurs ──────────────────────────────────────────────────────────────────
//
// Slack répond `200 { ok: false, error: "<code>" }` pour presque tout, et `429` avec
// `Retry-After` (secondes) quand on dépasse le quota. Le 429 est réessayé ici (deux
// fois au plus, attente plafonnée) ; tout le reste devient une `SlackApiError` portant
// le seul CODE Slack — jamais le jeton, jamais le corps de la requête.

import { Injectable } from '@nestjs/common';

export const SLACK_API_BASE = 'https://slack.com/api';

/** Attente maximale honorée sur un `Retry-After` (secondes). Au-delà : échec compté. */
export const SLACK_RETRY_AFTER_MAX_S = 30;
/** Nombre de nouvelles tentatives après un 429. */
export const SLACK_RATE_LIMIT_RETRIES = 2;

export type SlackHttp = (url: string, init: RequestInit) => Promise<Response>;

/** Codes Slack qui signifient « le jeton ne vaut plus rien » → connexion à reconnecter. */
export const SLACK_DEAD_TOKEN_ERRORS = [
  'token_revoked',
  'account_inactive',
  'invalid_auth',
  'not_authed',
  'token_expired',
] as const;

export class SlackApiError extends Error {
  constructor(
    readonly code: string,
    readonly method: string,
    readonly retryAfterS: number | null = null,
  ) {
    super(`Slack ${method} : ${code}`);
    this.name = 'SlackApiError';
  }

  get deadToken(): boolean {
    return (SLACK_DEAD_TOKEN_ERRORS as readonly string[]).includes(this.code);
  }
}

/** `fetch` réel — refusé sous vitest (aucun appel réel à Slack dans les tests). */
export const realSlackHttp: SlackHttp = (url, init) => {
  if (process.env['VITEST']) {
    return Promise.reject(
      new Error('Appel réel à Slack refusé pendant les tests : simulez `SlackApi.http`.'),
    );
  }
  return fetch(url, init);
};

export interface SlackOAuthAccess {
  accessToken: string;
  tokenType: string;
  scope: string;
  botUserId: string | null;
  appId: string | null;
  teamId: string;
  teamName: string;
}

interface CallOptions {
  /** Jeton du bot (`Authorization: Bearer`). */
  token?: string;
  /** Corps formulaire (`application/x-www-form-urlencoded`). */
  form?: Record<string, string>;
  /** Corps JSON (`application/json; charset=utf-8`). */
  json?: unknown;
}

@Injectable()
export class SlackApi {
  /** Remplaçable par les tests. */
  http: SlackHttp = realSlackHttp;
  /** Remplaçable par les tests (sommeil d'un `Retry-After`). */
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms).unref?.());

  async call(method: string, opts: CallOptions = {}): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.form).toString();
    }

    for (let attempt = 0; ; attempt += 1) {
      const res = await this.http(`${SLACK_API_BASE}/${method}`, {
        method: 'POST',
        headers,
        ...(body !== undefined ? { body } : {}),
      });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        const wait = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1;
        if (attempt >= SLACK_RATE_LIMIT_RETRIES || wait > SLACK_RETRY_AFTER_MAX_S) {
          throw new SlackApiError('ratelimited', method, wait);
        }
        await this.sleep(wait * 1000);
        continue;
      }
      if (!res.ok) throw new SlackApiError(`http_${res.status}`, method);
      let payload: Record<string, unknown>;
      try {
        payload = (await res.json()) as Record<string, unknown>;
      } catch {
        throw new SlackApiError('invalid_response', method);
      }
      if (payload['ok'] !== true) {
        const code = typeof payload['error'] === 'string' ? payload['error'] : 'unknown_error';
        throw new SlackApiError(code, method);
      }
      return payload;
    }
  }

  /** Échange du code d'autorisation contre le jeton du bot (`oauth.v2.access`). */
  async oauthAccess(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackOAuthAccess> {
    const p = await this.call('oauth.v2.access', {
      form: {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      },
    });
    const team = (p['team'] ?? {}) as Record<string, unknown>;
    const accessToken = typeof p['access_token'] === 'string' ? p['access_token'] : '';
    const teamId = typeof team['id'] === 'string' ? team['id'] : '';
    if (!accessToken || !teamId) throw new SlackApiError('invalid_response', 'oauth.v2.access');
    return {
      accessToken,
      tokenType: typeof p['token_type'] === 'string' ? p['token_type'] : '',
      scope: typeof p['scope'] === 'string' ? p['scope'] : '',
      botUserId: typeof p['bot_user_id'] === 'string' ? p['bot_user_id'] : null,
      appId: typeof p['app_id'] === 'string' ? p['app_id'] : null,
      teamId,
      teamName: typeof team['name'] === 'string' ? team['name'] : teamId,
    };
  }

  async authRevoke(token: string): Promise<void> {
    await this.call('auth.revoke', { token, form: {} });
  }

  /** Identifiant Slack d'un membre par son adresse, ou `null` s'il est introuvable. */
  async lookupUserByEmail(token: string, email: string): Promise<string | null> {
    try {
      const p = await this.call('users.lookupByEmail', { token, form: { email } });
      const user = (p['user'] ?? {}) as Record<string, unknown>;
      if (user['deleted'] === true || user['is_bot'] === true) return null;
      return typeof user['id'] === 'string' ? user['id'] : null;
    } catch (err) {
      if (err instanceof SlackApiError && err.code === 'users_not_found') return null;
      throw err;
    }
  }

  /** Canaux publics non archivés, paginés (5 pages de 200 au plus). */
  async listPublicChannels(token: string): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const p = await this.call('conversations.list', {
        token,
        form: {
          types: 'public_channel',
          exclude_archived: 'true',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
      });
      for (const c of (p['channels'] as Array<Record<string, unknown>> | undefined) ?? []) {
        if (typeof c['id'] === 'string' && typeof c['name'] === 'string') {
          out.push({ id: c['id'], name: c['name'] });
        }
      }
      const meta = (p['response_metadata'] ?? {}) as Record<string, unknown>;
      cursor = typeof meta['next_cursor'] === 'string' ? meta['next_cursor'] : '';
      if (!cursor) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Ouvre (ou retrouve) le message privé du bot avec un membre (`im:write`). */
  async openDirectMessage(token: string, slackUserId: string): Promise<string> {
    const p = await this.call('conversations.open', { token, json: { users: slackUserId } });
    const channel = (p['channel'] ?? {}) as Record<string, unknown>;
    if (typeof channel['id'] !== 'string') {
      throw new SlackApiError('invalid_response', 'conversations.open');
    }
    return channel['id'];
  }

  async postMessage(
    token: string,
    message: { channel: string; text: string; blocks: unknown[] },
  ): Promise<void> {
    await this.call('chat.postMessage', {
      token,
      json: { ...message, unfurl_links: false, unfurl_media: false },
    });
  }
}
