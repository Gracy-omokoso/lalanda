// ADR-0053 — P8 : TOTP (RFC 6238), anti-rejeu, codes de secours hachés, secret chiffré
// sous `SECRETS_MASTER_KEY` et rotation `secrets:rewrap`.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_TWO_FACTOR,
  formatBackupCode,
  looksLikeBackupCode,
  looksLikeTotpCode,
  normalizeTwoFactorInput,
} from '@lalanda/shared/platform';

import { keyringFromEnv, SecretDecryptionError } from '../integrations/secrets-crypto.js';
import {
  backupCodeMatches,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  newBackupCodeSalt,
  totpCodeAt,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp.js';
import { openTotpSecret, rewrapTotpSecret, sealTotpSecret } from './two-factor-crypto.js';

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);

describe('TOTP (RFC 6238)', () => {
  it('vecteur de la RFC 6238 (SHA-1, 59 s → 287082 en six chiffres)', () => {
    // Secret ASCII « 12345678901234567890 » en base32.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpCodeAt(secret, 59_000)).toBe('287082');
    expect(
      verifyTotp({ secretBase32: secret, code: '287082', nowMs: 59_000, lastUsedStep: null }),
    ).toBe(1);
  });

  it('secret de 160 bits, URI lisible par une application usuelle', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = totpUri(secret, 'gracy@lalanda.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Lalanda:gracy%40lalanda.test\?/);
    expect(uri).toContain('issuer=Lalanda');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('accepte un pas de dérive, refuse au-delà', () => {
    const secret = generateTotpSecret();
    const avant = totpCodeAt(secret, T0 - 30_000);
    const loin = totpCodeAt(secret, T0 - 90_000);
    expect(verifyTotp({ secretBase32: secret, code: avant, nowMs: T0, lastUsedStep: null })).toBe(
      totpStep(T0) - 1,
    );
    expect(
      verifyTotp({ secretBase32: secret, code: loin, nowMs: T0, lastUsedStep: null }),
    ).toBeNull();
  });

  it('anti-rejeu : un code déjà accepté (ou plus ancien) est refusé', () => {
    const secret = generateTotpSecret();
    const code = totpCodeAt(secret, T0);
    const pas = verifyTotp({ secretBase32: secret, code, nowMs: T0, lastUsedStep: null })!;
    expect(verifyTotp({ secretBase32: secret, code, nowMs: T0, lastUsedStep: pas })).toBeNull();
    const suivant = totpCodeAt(secret, T0 + 30_000);
    expect(
      verifyTotp({ secretBase32: secret, code: suivant, nowMs: T0 + 30_000, lastUsedStep: pas }),
    ).toBe(pas + 1);
  });

  it('refuse ce qui n’est pas six chiffres', () => {
    const secret = generateTotpSecret();
    for (const code of ['', '12345', '1234567', 'abcdef']) {
      expect(verifyTotp({ secretBase32: secret, code, nowMs: T0, lastUsedStep: null })).toBeNull();
    }
    expect(looksLikeTotpCode(' 123 456 ')).toBe(true);
  });
});

describe('codes de secours', () => {
  it('dix codes distincts de 12 caractères (60 bits)', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(PLATFORM_TWO_FACTOR.backupCodeCount);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(looksLikeBackupCode(c)).toBe(true);
  });

  it('haché salé : le haché ne contient pas le code, la saisie normalisée est reconnue', () => {
    const [code] = generateBackupCodes(1) as [string];
    const salt = newBackupCodeSalt();
    const hash = hashBackupCode(code, salt);
    expect(hash).not.toContain(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(backupCodeMatches(formatBackupCode(code).toLowerCase(), salt, hash)).toBe(true);
    expect(backupCodeMatches(code, newBackupCodeSalt(), hash)).toBe(false);
    expect(hashBackupCode(code, salt)).not.toBe(hashBackupCode(code, newBackupCodeSalt()));
  });

  it('normalisation de Crockford (O → 0, I et L → 1)', () => {
    expect(normalizeTwoFactorInput('abo-il 9')).toBe('AB0119');
  });
});

describe('secret TOTP chiffré sous SECRETS_MASTER_KEY, rotation', () => {
  const k1 = randomBytes(32).toString('base64');
  const k2 = randomBytes(32).toString('base64');
  const avantRotation = keyringFromEnv({ SECRETS_MASTER_KEY: k1, SECRETS_MASTER_KEY_ID: 'k1' })!;
  const pendantRotation = keyringFromEnv({
    SECRETS_MASTER_KEY: k2,
    SECRETS_MASTER_KEY_ID: 'k2',
    SECRETS_MASTER_KEY_PREVIOUS: k1,
    SECRETS_MASTER_KEY_PREVIOUS_ID: 'k1',
  })!;
  const apresRotation = keyringFromEnv({ SECRETS_MASTER_KEY: k2, SECRETS_MASTER_KEY_ID: 'k2' })!;
  const userId = '65a1b2c3d4e5f60718293a4b';

  it('rien en clair, déchiffrable au même emplacement seulement', () => {
    const secret = generateTotpSecret();
    const record = sealTotpSecret({ userId, secretBase32: secret, keyring: avantRotation });
    expect(JSON.stringify(record)).not.toContain(secret);
    expect(record.last4).toBeNull();
    expect(record.keyId).toBe('k1');
    expect(openTotpSecret({ userId, record, keyring: avantRotation })).toBe(secret);
    expect(() =>
      openTotpSecret({ userId: '65a1b2c3d4e5f60718293a4c', record, keyring: avantRotation }),
    ).toThrow(SecretDecryptionError);
  });

  it('rotation : re-chiffré sous la clé courante, même secret, idempotente', () => {
    const secret = generateTotpSecret();
    const record = sealTotpSecret({ userId, secretBase32: secret, keyring: avantRotation });
    const out = rewrapTotpSecret({ userId, record, keyring: pendantRotation });
    expect(out.changed).toBe(true);
    expect(out.record.keyId).toBe('k2');
    expect(out.record.last4).toBeNull();
    // L'ancienne clé retirée, le secret se lit toujours : les codes restent valides.
    expect(openTotpSecret({ userId, record: out.record, keyring: apresRotation })).toBe(secret);
    expect(rewrapTotpSecret({ userId, record: out.record, keyring: pendantRotation }).changed).toBe(
      false,
    );
  });
});
