// Code à usage unique et jeton de session de l'espace externe — ADR-0078 § 3.
//
// Clés DISTINCTES dérivées d'`AUTH_SECRET` par HKDF (motif de `lead-form-crypto.ts`) :
// une empreinte de code ne vaut ni empreinte d'adresse, ni empreinte d'IP.
//
//   - code : six chiffres tirés par `randomInt` (uniforme), stocké HACHÉ (HMAC lié à
//     l'identifiant du défi : deux défis au même code n'ont pas la même empreinte),
//     comparé à temps constant ;
//   - jeton de session : 32 octets aléatoires (base64url) ; seul son SHA-256 est stocké.

import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

function key(label: string): Buffer {
  const racine = process.env['AUTH_SECRET'];
  if (!racine) throw new Error('AUTH_SECRET absente : espace externe indisponible.');
  return Buffer.from(hkdfSync('sha256', racine, label, 'v1', 32));
}

/** Code numérique à six chiffres, tirage uniforme. */
export function newExternalCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Empreinte d'un code, liée au défi. */
export function hashExternalCode(challengeId: string, code: string): string {
  return createHmac('sha256', key('lalanda/external-code'))
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) {
    // Comparaison factice : même coût qu'une vraie, résultat faux.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Jeton de session (cookie) : 32 octets aléatoires. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 d'un jeton de session (clé de recherche ; le jeton n'est jamais stocké). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Empreinte d'une adresse (seau de débit) : jamais l'adresse en clair, même en mémoire. */
export function emailBucket(email: string): string {
  return createHmac('sha256', key('lalanda/external-email'))
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

/** Empreinte d'une adresse IP (seau de débit). */
export function ipBucket(ip: string | null | undefined): string {
  return createHmac('sha256', key('lalanda/external-ip'))
    .update(ip && ip.length > 0 ? ip : 'unknown')
    .digest('hex')
    .slice(0, 32);
}

/**
 * ADR-0079 § 9 : jeton du lien de désinscription d'un compte externe — organisation,
 * compte et HMAC-SHA256 (clé HKDF distincte). Ne donne accès qu'au réglage des e-mails du
 * compte, jamais à l'espace externe ; sans expiration (un lien de pied de page doit
 * rester valable).
 */
export function externalPreferenceToken(organizationId: string, accountId: string): string {
  const sig = createHmac('sha256', key('lalanda/external-notification-preferences'))
    .update(`${organizationId}:${accountId}`)
    .digest('base64url');
  return `${organizationId}.${accountId}.${sig}`;
}

/** Jeton → (organisation, compte), ou `null` s'il est faux. Comparaison à temps constant. */
export function readExternalPreferenceToken(
  token: string,
): { organizationId: string; accountId: string } | null {
  const m = /^([0-9a-f]{24})\.([0-9a-f]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(externalPreferenceToken(m[1]!, m[2]!));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { organizationId: m[1]!, accountId: m[2]! };
}
