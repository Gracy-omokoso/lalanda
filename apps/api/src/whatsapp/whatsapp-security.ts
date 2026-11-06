// Vérifications cryptographiques de l'intégration WhatsApp — ADR-0065 § 2 et § 5.
// Fonctions pures, sans état, testées par `whatsapp.unit.test.ts`.
//
// 1. Signature des webhooks (`X-Hub-Signature-256`) : `sha256=` + HMAC-SHA256 du CORPS
//    BRUT avec la clé secrète de l'application Meta, comparée à temps constant.
// 2. Jeton de vérification de la poignée de main (`hub.verify_token`) : comparé à temps
//    constant (empreintes de même longueur).
// 3. Code de vérification : 6 chiffres tirés par `randomInt` ; seule son EMPREINTE est
//    gardée — HMAC-SHA256 avec une clé dérivée (HKDF) d'`AUTH_SECRET`, liée à
//    l'organisation, à la personne et au numéro. Une empreinte recopiée vers un autre
//    numéro ou une autre personne ne vérifie rien.

import { createHash, createHmac, hkdfSync, randomInt, timingSafeEqual } from 'node:crypto';

/** `sha256=<hex>` d'un corps — exportée pour les tests (simuler Meta). */
export function hubSignature(appSecret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Vrai seulement si la requête vient de Meta et n'a pas été altérée. */
export function verifyHubSignature(input: {
  appSecret: string;
  signature: string | undefined;
  rawBody: string | Buffer;
}): boolean {
  const { appSecret, signature, rawBody } = input;
  if (!appSecret || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(hubSignature(appSecret, rawBody), 'utf8');
  const given = Buffer.from(signature.toLowerCase(), 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Égalité à temps constant de deux chaînes quelconques (par empreinte). */
export function safeEqualText(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || a === '' || b === '') return false;
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Code à 6 chiffres, zéros de tête compris. */
export function generateWhatsAppCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function codeKey(authSecret: string): Buffer {
  if (!authSecret || authSecret.length < 32) {
    throw new Error('AUTH_SECRET absent ou trop court : code WhatsApp impossible à protéger.');
  }
  return Buffer.from(
    hkdfSync('sha256', authSecret, 'lalanda:whatsapp', 'lalanda:whatsapp:otp:v1', 32),
  );
}

/** Empreinte d'un code, liée à l'organisation, à la personne et au numéro. */
export function hashWhatsAppCode(
  input: { organizationId: string; userId: string; phone: string; code: string },
  authSecret: string,
): string {
  return createHmac('sha256', codeKey(authSecret))
    .update(`${input.organizationId}\n${input.userId}\n${input.phone}\n${input.code}`)
    .digest('hex');
}

/** Comparaison à temps constant d'un code saisi avec l'empreinte gardée. */
export function verifyWhatsAppCode(
  input: { organizationId: string; userId: string; phone: string; code: string },
  expectedHash: string,
  authSecret: string,
): boolean {
  const given = Buffer.from(hashWhatsAppCode(input, authSecret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
