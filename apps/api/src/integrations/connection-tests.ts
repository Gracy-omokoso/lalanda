// ─────────────────────────────────────────────────────────────────────────────
// TESTS DE CONNEXION — ADR-0013 §5
//
// « Une clé invalide n'entre jamais en base — c'est ce qui évite de découvrir la
// panne au premier paiement client. » Chacun des six tests est choisi pour être
// GRATUIT et SANS EFFET DE BORD : lecture de compte, liste de modèles, demande de
// jeton, `verify()` SMTP sans envoi, `HeadBucket` sans lecture d'objet, liste des
// voix sans synthèse.
//
// Le critère vaut pour les deux fournisseurs ajoutés ici. R2 est facturé aux
// opérations et aux octets sortants : `HeadBucket` ne lit aucun objet et n'en
// écrit aucun. ElevenLabs est facturé AU CARACTÈRE SYNTHÉTISÉ : brancher le
// bouton « Tester » sur un point de génération coûterait de l'argent à chaque
// clic, `GET /v2/voices` n'en coûte aucun.
//
// ── Pourquoi aucune dépendance n'est ajoutée ─────────────────────────────────
//
// Quatre des six tests sont de simples requêtes HTTP (`fetch` natif). Les deux
// autres — SMTP et R2 — auraient justifié `nodemailer` et `@aws-sdk/client-s3`,
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
    case 'r2':
      return testR2(input);
    case 'elevenlabs':
      return testElevenLabs(input);
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

// ─── R2 : HeadBucket signé SigV4 (ADR-0013 §5) ───────────────────────────────

/** Suffixe d'hôte de l'API S3 de Cloudflare R2. */
const R2_HOST_SUFFIX = '.r2.cloudflarestorage.com';

/**
 * HeadBucket sur le bucket des exports — gratuit, sans lecture d'objet.
 *
 * Fonctionne à l'identique sur R2, MinIO et Spaces : les trois parlent le même
 * protocole, signé SigV4 avec le même nom de service `s3`. Le seul écart tient à
 * la RÉGION.
 *
 * R2 n'a pas de région au sens AWS — mais SigV4 en exige une dans le scope, il
 * n'existe pas de signature sans jeton de région. Cloudflare attend le littéral
 * `auto` (sa documentation indique que `us-east-1` et la chaîne vide y sont
 * alias). Le défaut est donc déduit de l'hôte, exactement comme dans
 * `storage/storage.config.ts`, plutôt que d'exiger de l'opératrice qu'elle
 * devine une valeur pour un service qui n'a pas de régions : une région erronée
 * produit un 403 dont le message accuse les identifiants, ce qui envoie chercher
 * le problème du mauvais côté.
 */
async function testR2(input: ConnectionTestInput): Promise<string> {
  const endpoint = str(input.config, 'endpoint');
  const accessKey = str(input.config, 'accessKey');
  const bucket = str(input.config, 'bucketExports');
  const forcePathStyle = str(input.config, 'forcePathStyle') !== 'false';
  if (!endpoint) throw new Error('`endpoint` absent de la configuration R2.');
  if (!accessKey) throw new Error('`accessKey` absent de la configuration R2.');
  if (!bucket) throw new Error('`bucketExports` absent de la configuration R2.');
  const secretKey = requireSecret(input, 'secretKey');

  let base: URL;
  try {
    base = new URL(endpoint);
  } catch {
    throw new Error(`\`endpoint\` n'est pas une URL valide : « ${endpoint} ».`);
  }

  const estR2 = base.host.toLowerCase().endsWith(R2_HOST_SUFFIX);
  const region = str(input.config, 'region') || (estR2 ? 'auto' : 'us-east-1');

  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path = forcePathStyle ? `/${bucket}` : '/';
  const url = `${base.protocol}//${host}${path}`;

  const headers = signV4({
    method: 'HEAD',
    host,
    path,
    region,
    // Le nom de service reste `s3` chez R2 : c'est ce qui rend la signature
    // identique d'un fournisseur à l'autre.
    service: 's3',
    accessKey,
    secretKey,
  });

  const res = await fetch(url, { method: 'HEAD', headers });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Identifiants refusés (HTTP ${res.status}). Vérifiez la clé d'accès, la clé secrète, ` +
        `et la région signée (« ${region} » ici ; R2 attend « auto »).`,
    );
  }
  if (res.status === 404) throw new Error(`Bucket « ${bucket} » introuvable (HTTP 404).`);
  if (!res.ok) throw new Error(`HeadBucket a échoué (HTTP ${res.status}).`);
  return `Bucket « ${bucket} » accessible (région signée : ${region}).`;
}

// ─── ElevenLabs : GET /v2/voices (lecture seule, sans crédit) ─────────────────

/**
 * Liste des voix — le point de lecture le moins coûteux de l'API.
 *
 * Choisi pour la même raison que `GET /v1/models` chez OpenAI : il valide la
 * clé sans rien produire. AUCUNE synthèse n'est déclenchée, donc aucun crédit
 * n'est consommé — ce qui compte pour un fournisseur facturé au caractère, où un
 * bouton « Tester » branché sur un point de génération coûterait de l'argent à
 * chaque clic.
 *
 * L'authentification se fait par l'en-tête `xi-api-key`, et non par
 * `Authorization: Bearer` : c'est l'écart le plus facile à manquer en recopiant
 * le test d'OpenAI juste au-dessus.
 */
async function testElevenLabs(input: ConnectionTestInput): Promise<string> {
  const apiKey = requireSecret(input, 'apiKey');
  const baseUrl = str(input.config, 'baseUrl') || 'https://api.elevenlabs.io';
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v2/voices`, {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
  });
  if (res.status === 401) throw new Error('ElevenLabs a refusé la clé (HTTP 401).');
  if (!res.ok) throw new Error(`ElevenLabs a refusé la requête (HTTP ${res.status}).`);
  const body = (await res.json()) as { voices?: unknown[] };
  return `Clé acceptée — ${body.voices?.length ?? 0} voix accessibles (aucune synthèse déclenchée).`;
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
