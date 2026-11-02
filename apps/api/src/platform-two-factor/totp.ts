// TOTP et codes de secours de la console Lalanda (ADR-0053 — P8). FONCTIONS PURES.
//
// ── Pourquoi `otpauth` et pas le greffon `twoFactor` de better-auth ─────────────
//
// better-auth 1.7 propose `twoFactor`, mais il contredit trois exigences du lot :
//   1. il chiffre le secret TOTP avec `AUTH_SECRET`, hors du coffre d'ADR-0013 : ni
//      `SECRETS_MASTER_KEY`, ni rotation `secrets:rewrap` ;
//   2. il conserve les codes de secours de façon DÉCHIFFRABLE (il les relit pour les
//      comparer et pour les « revoir ») — l'exigence est un stockage haché ;
//   3. il expose `/two-factor/disable` contre le seul mot de passe : un opérateur (ou
//      quiconque tient son mot de passe) retirerait sa double authentification, alors que
//      la réinitialisation doit passer par un AUTRE super-administrateur ;
// et il intercepte la connexion de TOUS les comptes, organisations comprises.
// `otpauth` (RFC 4226 / 6238, une seule dépendance : `@noble/hashes`, déjà présente via
// better-auth) ne fait que le calcul ; le stockage, le verrouillage et l'audit sont ici.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import {
  BACKUP_CODE_ALPHABET,
  PLATFORM_TWO_FACTOR,
  normalizeTwoFactorInput,
} from '@lalanda/shared/platform';
import { Secret, TOTP } from 'otpauth';

/** Nouveau secret TOTP, en base32 (la forme que saisit une application à la main). */
export function generateTotpSecret(): string {
  return new Secret({ size: PLATFORM_TWO_FACTOR.secretBytes }).base32;
}

function totpOf(secretBase32: string, label = ''): TOTP {
  return new TOTP({
    issuer: PLATFORM_TWO_FACTOR.issuer,
    label,
    algorithm: 'SHA1',
    digits: PLATFORM_TWO_FACTOR.digits,
    period: PLATFORM_TWO_FACTOR.periodSeconds,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** URI `otpauth://` encodée dans le QR code. */
export function totpUri(secretBase32: string, accountLabel: string): string {
  return totpOf(secretBase32, accountLabel).toString();
}

/** Pas de temps (compteur RFC 6238) d'un instant. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / PLATFORM_TWO_FACTOR.periodSeconds);
}

/** Code d'un instant — pour les tests et la démonstration, jamais servi par l'API. */
export function totpCodeAt(secretBase32: string, nowMs: number): string {
  return totpOf(secretBase32).generate({ timestamp: nowMs });
}

/**
 * Vérifie un code TOTP. Rend le PAS accepté, ou `null`.
 *
 * Anti-rejeu (RFC 6238 § 5.2) : un pas inférieur ou égal au dernier pas accepté est
 * refusé — un code vu par-dessus l'épaule ne sert pas une seconde fois.
 */
export function verifyTotp(input: {
  secretBase32: string;
  code: string;
  nowMs: number;
  lastUsedStep: number | null;
}): number | null {
  const token = normalizeTwoFactorInput(input.code);
  if (!new RegExp(`^\\d{${PLATFORM_TWO_FACTOR.digits}}$`).test(token)) return null;
  const delta = totpOf(input.secretBase32).validate({
    token,
    timestamp: input.nowMs,
    window: PLATFORM_TWO_FACTOR.window,
  });
  if (delta === null) return null;
  const step = totpStep(input.nowMs) + delta;
  if (input.lastUsedStep !== null && step <= input.lastUsedStep) return null;
  return step;
}

/** Codes de secours : 12 caractères de Crockford chacun, soit 60 bits d'entropie. */
export function generateBackupCodes(count: number = PLATFORM_TWO_FACTOR.backupCodeCount): string[] {
  return Array.from({ length: count }, () =>
    Array.from(
      { length: PLATFORM_TWO_FACTOR.backupCodeLength },
      () => BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)],
    ).join(''),
  );
}

/** Sel propre à chaque code (stocké à côté du haché). */
export function newBackupCodeSalt(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Haché d'un code de secours : SHA-256(sel ‖ code normalisé). Le code porte 60 bits
 * aléatoires et un sel par code : un vidage de la base ne permet ni de le relire ni de
 * le retrouver par dictionnaire.
 */
export function hashBackupCode(code: string, salt: string): string {
  return createHash('sha256')
    .update(`${salt}:${normalizeTwoFactorInput(code)}`)
    .digest('hex');
}

/** Comparaison à temps constant d'un code saisi et d'un haché stocké. */
export function backupCodeMatches(code: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashBackupCode(code, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
