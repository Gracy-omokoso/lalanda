// ─────────────────────────────────────────────────────────────────────────────
// TESTS DE CONNEXION — ADR-0013 §5
//
// « Une clé invalide n'entre jamais en base — c'est ce qui évite de découvrir la
// panne au premier paiement client. » Chacun des cinq tests est choisi pour être
// GRATUIT et SANS EFFET DE BORD : lecture de compte, liste de modèles, demande de
// jeton, `verify()` SMTP sans envoi, `HeadBucket` sans lecture d'objet.
//
// ── Pourquoi aucune dépendance n'est ajoutée ─────────────────────────────────
//
// Trois des cinq tests sont de simples requêtes HTTP (`fetch` natif). Les deux
// autres — SMTP et S3 — auraient justifié `nodemailer` et `@aws-sdk/client-s3`,
// soit deux arbres de dépendances complets importés dans le processus qui
// détient `SECRETS_MASTER_KEY`. ADR-0013 §10 nomme la chaîne d'approvisionnement
// npm comme « le maillon faible » de tout le dispositif : ajouter des centaines
// de paquets transitifs pour deux appels de vérification serait agrandir la
// surface exacte que l'ADR désigne comme non couverte. Les deux protocoles sont
// donc parlés directement — une poignée de lignes, aucun nouveau paquet.
//
// Ces clients de TEST ne remplacent pas les futurs clients d'usage : le jour où
// des emails partent réellement, `nodemailer` sera un choix défendable, discuté
// à ce moment-là et pour cet usage-là.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createHmac } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

import { sanitizeProviderMessage } from './redaction.js';
import type { IntegrationProvider } from './providers.js';

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  /** Message assaini — jamais brut, jamais porteur d'un secret. */
  detail: string;
}

/** Configuration + secrets EN CLAIR soumis au test. Vit uniquement en mémoire. */
export interface ConnectionTestInput {
  provider: IntegrationProvider;
  config: Record<string, string | number | boolean>;
  /** Secrets en clair, par nom. Ceux du corps de la requête ET ceux déjà en base. */
  secrets: Record<string, string>;
}

/**
 * Contrat testable. Le service dépend de cette interface et non des fonctions
 * concrètes : les suites e2e injectent un testeur simulé en échec pour vérifier
 * qu'aucune écriture n'a lieu (ADR-0013 § Plan de validation).
 */
export interface ConnectionTester {
  test(input: ConnectionTestInput): Promise<ConnectionTestResult>;
}

/** Jeton d'injection — permet aux suites e2e de substituer un testeur simulé. */
export const CONNECTION_TESTER = Symbol('CONNECTION_TESTER');

/** Délai maximal d'un test. Au-delà, échec : un test qui pend bloque une écriture. */
export const CONNECTION_TEST_TIMEOUT_MS = 10_000;

export class HttpConnectionTester implements ConnectionTester {
  async test(input: ConnectionTestInput): Promise<ConnectionTestResult> {
    const started = Date.now();
    const knownSecrets = Object.values(input.secrets);
    try {
      const detail = await withTimeout(runProviderTest(input), CONNECTION_TEST_TIMEOUT_MS);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        detail: sanitizeProviderMessage(detail, knownSecrets),
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitizeProviderMessage(err, knownSecrets),
      };
    }
  }
}

async function runProviderTest(input: ConnectionTestInput): Promise<string> {
  switch (input.provider) {
    case 'openai':
      return testOpenAI(input);
    case 'stripe':
      return testStripe(input);
    case 'paypal':
      return testPayPal(input);
    case 'smtp':
      return testSmtp(input);
    case 's3':
      return testS3(input);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Délai dépassé (${ms} ms).`)), ms).unref?.(),
    ),
  ]);
}

function str(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return v === undefined || v === null ? '' : String(v);
}

function requireSecret(input: ConnectionTestInput, name: string): string {
  const v = input.secrets[name];
  if (!v) throw new Error(`Secret « ${name} » absent : test impossible.`);
  return v;
}

// ─── OpenAI : GET /v1/models (ADR-0013 §5, coût nul) ─────────────────────────

async function testOpenAI(input: ConnectionTestInput): Promise<string> {
  const apiKey = requireSecret(input, 'apiKey');
  const baseUrl = str(input.config, 'baseUrl') || 'https://api.openai.com';
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenAI a refusé la clé (HTTP ${res.status}).`);
  const body = (await res.json()) as { data?: unknown[] };
  return `Clé acceptée — ${body.data?.length ?? 0} modèles accessibles.`;
}

// ─── Stripe : GET /v1/account (ADR-0013 §5 et §7) ────────────────────────────

async function testStripe(input: ConnectionTestInput): Promise<string> {
  const key = requireSecret(input, 'restrictedKey');
  const res = await fetch('https://api.stripe.com/v1/account', {
    method: 'GET',
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Stripe a refusé la clé (HTTP ${res.status}).`);
  const body = (await res.json()) as { id?: string; charges_enabled?: boolean };
  // Recommandation d'ADR-0013 §7 rappelée AU MOMENT où elle est actionnable.
  const restreinte = key.startsWith('rk_')
    ? 'clé restreinte'
    : 'clé NON restreinte — ADR-0013 §7 recommande une clé rk_…';
  return `Compte ${body.id ?? 'inconnu'} accessible (${restreinte}).`;
}

// ─── PayPal : demande de jeton OAuth (ADR-0013 §5) ───────────────────────────

async function testPayPal(input: ConnectionTestInput): Promise<string> {
  const clientId = str(input.config, 'clientId');
  const environment = str(input.config, 'environment') || 'sandbox';
  if (!clientId) throw new Error('`clientId` absent de la configuration PayPal.');
  if (environment !== 'sandbox' && environment !== 'live') {
    throw new Error('`environment` doit valoir `sandbox` ou `live`.');
  }
  const secret = requireSecret(input, 'clientSecret');
  const host =
    environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const basic = Buffer.from(`${clientId}:${secret}`, 'utf8').toString('base64');
  const res = await fetch(`${host}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal a refusé les identifiants (HTTP ${res.status}).`);
  return `Jeton OAuth obtenu (environnement ${environment}).`;
}

// ─── SMTP : verify() sur le transport, aucun email envoyé ────────────────────

/**
 * Vérification SMTP : greeting → EHLO → STARTTLS si demandé → AUTH LOGIN → QUIT.
 *
 * Aucun `MAIL FROM`, aucun `RCPT TO`, aucun `DATA` : la session s'arrête après
 * l'authentification. C'est exactement ce que fait le `verify()` de nodemailer,
 * et c'est ce qui rend le test gratuit et sans effet de bord (ADR-0013 §5).
 */
async function testSmtp(input: ConnectionTestInput): Promise<string> {
  const host = str(input.config, 'host');
  const port = Number.parseInt(str(input.config, 'port'), 10);
  const user = str(input.config, 'user');
  const secure = str(input.config, 'secure') === 'true';
  if (!host) throw new Error('`host` absent de la configuration SMTP.');
  if (!Number.isFinite(port) || port <= 0) throw new Error('`port` SMTP invalide.');
  if (!user) throw new Error('`user` absent de la configuration SMTP.');
  const password = requireSecret(input, 'password');

  const session = new SmtpSession(host, port, secure);
  try {
    await session.open();
    await session.expect(220, 'greeting');
    await session.command(`EHLO lalanda.local`, 250);
    if (!secure) {
      // Port 587 : la session démarre en clair et DOIT être élevée en TLS avant
      // AUTH. Sans STARTTLS, `AUTH LOGIN` enverrait le mot de passe en base64 sur
      // le réseau — un encodage, pas un chiffrement.
      await session.command('STARTTLS', 220);
      await session.upgradeToTls();
      await session.command(`EHLO lalanda.local`, 250);
    }
    await session.command('AUTH LOGIN', 334);
    await session.command(Buffer.from(user, 'utf8').toString('base64'), 334);
    await session.command(Buffer.from(password, 'utf8').toString('base64'), 235);
    await session.write('QUIT');
    return `Authentification acceptée par ${host}:${port} (aucun email envoyé).`;
  } finally {
    session.close();
  }
}

/** Session SMTP minimale, ligne à ligne. Suffisante pour un `verify()`. */
class SmtpSession {
  private socket: Socket | undefined;
  private buffer = '';
  private waiters: Array<(line: string) => void> = [];

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly secure: boolean,
  ) {}

  async open(): Promise<void> {
    this.socket = this.secure
      ? tlsConnect({ host: this.host, port: this.port, servername: this.host })
      : netConnect({ host: this.host, port: this.port });
    this.bind(this.socket);
    await new Promise<void>((resolve, reject) => {
      const s = this.socket!;
      s.once(this.secure ? 'secureConnect' : 'connect', () => resolve());
      s.once('error', reject);
    });
  }

  async upgradeToTls(): Promise<void> {
    const plain = this.socket!;
    plain.removeAllListeners('data');
    const upgraded = tlsConnect({ socket: plain, servername: this.host });
    this.socket = upgraded;
    this.buffer = '';
    this.bind(upgraded);
    await new Promise<void>((resolve, reject) => {
      upgraded.once('secureConnect', () => resolve());
      upgraded.once('error', reject);
    });
  }

  private bind(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      // Une réponse SMTP multi-ligne se termine par « NNN<espace> » : les lignes
      // intermédiaires portent « NNN- ». Attendre la dernière évite de prendre
      // une capacité EHLO pour un code de retour.
      let match: RegExpMatchArray | null;
      while ((match = this.buffer.match(/^(?:\d{3}-[^\r\n]*\r?\n)*\d{3} [^\r\n]*\r?\n/))) {
        const complete = match[0];
        this.buffer = this.buffer.slice(complete.length);
        this.waiters.shift()?.(complete.trim());
      }
    });
  }

  private nextResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Serveur SMTP muet.')), 8000);
      timer.unref?.();
      this.waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  async expect(code: number, what: string): Promise<string> {
    const line = await this.nextResponse();
    if (!line.startsWith(String(code))) {
      throw new Error(`SMTP ${what} : réponse inattendue « ${line.slice(0, 80)} ».`);
    }
    return line;
  }

  async write(text: string): Promise<void> {
    this.socket!.write(`${text}\r\n`);
  }

  async command(text: string, expected: number): Promise<string> {
    await this.write(text);
    // Le texte de la commande n'est jamais repris dans le message d'erreur :
    // pour `AUTH LOGIN`, il CONTIENT le mot de passe encodé en base64.
    return this.expect(expected, 'commande');
  }

  close(): void {
    this.socket?.destroy();
  }
}

// ─── S3 : HeadBucket signé SigV4 (ADR-0013 §5) ───────────────────────────────

async function testS3(input: ConnectionTestInput): Promise<string> {
  const endpoint = str(input.config, 'endpoint');
  const region = str(input.config, 'region') || 'us-east-1';
  const accessKey = str(input.config, 'accessKey');
  const bucket = str(input.config, 'bucketExports');
  const forcePathStyle = str(input.config, 'forcePathStyle') !== 'false';
  if (!endpoint) throw new Error('`endpoint` absent de la configuration S3.');
  if (!accessKey) throw new Error('`accessKey` absent de la configuration S3.');
  if (!bucket) throw new Error('`bucketExports` absent de la configuration S3.');
  const secretKey = requireSecret(input, 'secretKey');

  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}` : '/';
  const url = `${base.protocol}//${host}${path}`;

  const headers = signV4({
    method: 'HEAD',
    host,
    path,
    region,
    service: 's3',
    accessKey,
    secretKey,
  });

  const res = await fetch(url, { method: 'HEAD', headers });
  if (res.status === 403) throw new Error('S3 : identifiants refusés (HTTP 403).');
  if (res.status === 404) throw new Error(`S3 : bucket « ${bucket} » introuvable (HTTP 404).`);
  if (!res.ok) throw new Error(`S3 : HeadBucket a échoué (HTTP ${res.status}).`);
  return `Bucket « ${bucket} » accessible en ${region}.`;
}

/**
 * Signature AWS SigV4 d'une requête sans corps.
 *
 * `x-amz-content-sha256` porte l'empreinte du corps vide — obligatoire pour S3,
 * et c'est l'oubli classique : sans lui, MinIO et Spaces répondent 403 avec un
 * message qui accuse les identifiants, ce qui envoie chercher le problème du
 * mauvais côté.
 */
function signV4(req: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
}): Record<string, string> {
  const now = new Date();
  const amzDate = `${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const emptyHash = createHash('sha256').update('').digest('hex');

  const canonicalHeaders = `host:${req.host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    req.method,
    req.path,
    '',
    canonicalHeaders,
    signedHeaders,
    emptyHash,
  ].join('\n');

  const scope = `${dateStamp}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (key: Buffer | string, data: string): Buffer =>
    createHmac('sha256', key).update(data).digest();
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${req.secretKey}`, dateStamp), req.region), req.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    host: req.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': emptyHash,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${req.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
