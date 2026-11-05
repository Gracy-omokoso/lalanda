// Deux vérifications cryptographiques de l'intégration Slack — ADR-0064 § 2 et § 6.
// Fonctions pures, sans état, testées par `slack.unit.test.ts`.
//
// 1. `state` OAuth : lie l'aller-retour vers Slack à UNE organisation, UN utilisateur
//    et une échéance. Signé par HMAC-SHA256 avec une clé dérivée (HKDF) d'`AUTH_SECRET`
//    — jamais du secret client Slack, pour qu'une rotation côté Slack n'invalide pas
//    les connexions en cours et qu'aucune valeur de Slack ne serve à autre chose.
//    Vérifié au retour : signature, échéance, et identité de la session courante.
//
// 2. Signature des événements (`X-Slack-Signature`) : `v0=` + HMAC-SHA256 du secret de
//    signature sur `v0:<horodatage>:<corps brut>`. Horodatage à moins de 5 minutes
//    (rejeu), comparaison à temps constant.

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Durée de validité d'un `state` OAuth. */
export const SLACK_STATE_TTL_MS = 10 * 60_000;
/** Écart maximal toléré entre l'horodatage d'un événement et l'horloge locale. */
export const SLACK_SIGNATURE_MAX_SKEW_S = 5 * 60;

export interface SlackOAuthState {
  organizationId: string;
  userId: string;
  /** Échéance (ms depuis l'époque). */
  expiresAt: number;
}

function stateKey(authSecret: string): Buffer {
  if (!authSecret || authSecret.length < 32) {
    throw new Error('AUTH_SECRET absent ou trop court : état OAuth Slack impossible à signer.');
  }
  return Buffer.from(
    hkdfSync('sha256', authSecret, 'lalanda:slack', 'lalanda:slack:oauth-state:v1', 32),
  );
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** `<charge base64url>.<signature base64url>` — la charge porte un aléa (unicité). */
export function signSlackState(
  input: { organizationId: string; userId: string; now?: number },
  authSecret: string,
): string {
  const payload = {
    o: input.organizationId,
    u: input.userId,
    e: (input.now ?? Date.now()) + SLACK_STATE_TTL_MS,
    n: b64url(randomBytes(12)),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', stateKey(authSecret)).update(body).digest());
  return `${body}.${sig}`;
}

/** État vérifié, ou `null` (signature fausse, format invalide, échéance passée). */
export function verifySlackState(
  state: unknown,
  authSecret: string,
  now: number = Date.now(),
): SlackOAuthState | null {
  if (typeof state !== 'string' || state.length > 1024) return null;
  const [body, sig, extra] = state.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', stateKey(authSecret)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof p['o'] !== 'string' || typeof p['u'] !== 'string' || typeof p['e'] !== 'number') {
      return null;
    }
    if (p['e'] <= now) return null;
    return { organizationId: p['o'], userId: p['u'], expiresAt: p['e'] };
  } catch {
    return null;
  }
}

/** Signature `v0=…` d'un corps — exportée pour les tests (simuler Slack). */
export function slackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
}

/** Vrai seulement si la requête vient de Slack, fraîche, et non altérée. */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowS?: number;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!signingSecret || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const nowS = input.nowS ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowS - Number(timestamp)) > SLACK_SIGNATURE_MAX_SKEW_S) return false;
  const expected = Buffer.from(slackSignature(signingSecret, timestamp, rawBody), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
