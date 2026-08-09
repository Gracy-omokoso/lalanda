// Tests du schéma d'environnement API (S16a — durcissement sécurité).
// Vérifie notamment que les variables non consommées (Redis, S3) sont optionnelles
// et que le flag de vérification d'email est parsé strictement.

import { describe, expect, it } from 'vitest';

import { ApiEnvSchema } from './index.js';

/**
 * Clé maîtresse FACTICE — 32 octets de `A` en base64. Valeur évidemment fausse
 * et sans usage : aucune vraie clé, même de test, n'entre dans le dépôt.
 */
const FAKE_MASTER_KEY = Buffer.alloc(32, 0x41).toString('base64');

/** Environnement minimal valide — uniquement les variables réellement requises. */
const MINIMAL_ENV = {
  MONGODB_URI: 'mongodb://localhost:27017/lalanda',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3001',
  SECRETS_MASTER_KEY: FAKE_MASTER_KEY,
};

describe('ApiEnvSchema (S16a)', () => {
  it('démarre sans REDIS_URL ni S3_* (requis seulement à partir des exports asynchrones)', () => {
    const parsed = ApiEnvSchema.safeParse(MINIMAL_ENV);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });

  it('refuse de démarrer sans MONGODB_URI', () => {
    const { MONGODB_URI: _omitted, ...rest } = MINIMAL_ENV;
    expect(ApiEnvSchema.safeParse(rest).success).toBe(false);
  });

  it('refuse un AUTH_SECRET trop court', () => {
    expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, AUTH_SECRET: 'court' }).success).toBe(false);
  });

  it('AUTH_REQUIRE_EMAIL_VERIFICATION vaut false par défaut', () => {
    const parsed = ApiEnvSchema.parse(MINIMAL_ENV);
    expect(parsed.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });

  it('AUTH_REQUIRE_EMAIL_VERIFICATION="true" → true', () => {
    const parsed = ApiEnvSchema.parse({ ...MINIMAL_ENV, AUTH_REQUIRE_EMAIL_VERIFICATION: 'true' });
    expect(parsed.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(true);
  });

  it('AUTH_REQUIRE_EMAIL_VERIFICATION="false" → false (pas de coercion truthy)', () => {
    const parsed = ApiEnvSchema.parse({ ...MINIMAL_ENV, AUTH_REQUIRE_EMAIL_VERIFICATION: 'false' });
    expect(parsed.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
  });

  it('AUTH_REQUIRE_EMAIL_VERIFICATION="yes" → rejeté (valeur ambiguë)', () => {
    expect(
      ApiEnvSchema.safeParse({ ...MINIMAL_ENV, AUTH_REQUIRE_EMAIL_VERIFICATION: 'yes' }).success,
    ).toBe(false);
  });
});

describe('coffre des secrets d’intégration (S21b — ADR-0013)', () => {
  it('refuse de démarrer sans SECRETS_MASTER_KEY', () => {
    const { SECRETS_MASTER_KEY: _omitted, ...rest } = MINIMAL_ENV;
    expect(ApiEnvSchema.safeParse(rest).success).toBe(false);
  });

  it('refuse une SECRETS_MASTER_KEY de longueur invalide', () => {
    // 16 octets au lieu de 32 : la moitié d'une clé AES-256 passerait silencieusement
    // si la longueur n'était pas vérifiée APRÈS décodage base64.
    const tooShort = Buffer.alloc(16, 0x41).toString('base64');
    const parsed = ApiEnvSchema.safeParse({ ...MINIMAL_ENV, SECRETS_MASTER_KEY: tooShort });
    expect(parsed.success).toBe(false);
  });

  it('refuse une SECRETS_MASTER_KEY qui n’est pas du base64 valide', () => {
    expect(
      ApiEnvSchema.safeParse({ ...MINIMAL_ENV, SECRETS_MASTER_KEY: 'pas-du-base64-de-32-octets' })
        .success,
    ).toBe(false);
  });

  it('SECRETS_MASTER_KEY_ID vaut « k1 » par défaut', () => {
    expect(ApiEnvSchema.parse(MINIMAL_ENV).SECRETS_MASTER_KEY_ID).toBe('k1');
  });

  it('accepte une clé précédente pendant une rotation', () => {
    const parsed = ApiEnvSchema.safeParse({
      ...MINIMAL_ENV,
      SECRETS_MASTER_KEY_ID: 'k2',
      SECRETS_MASTER_KEY_PREVIOUS: Buffer.alloc(32, 0x42).toString('base64'),
      SECRETS_MASTER_KEY_PREVIOUS_ID: 'k1',
    });
    expect(parsed.success).toBe(true);
  });

  it('OPENAI_API_KEY est devenue optionnelle (ADR-0013 : résolution par la base)', () => {
    // Elle reste ACCEPTÉE comme secours pendant la migration, mais son absence ne
    // doit plus empêcher l'API de démarrer : la clé vit désormais en base.
    const parsed = ApiEnvSchema.safeParse(MINIMAL_ENV);
    expect(parsed.success).toBe(true);
    expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, OPENAI_API_KEY: 'sk-factice' }).success).toBe(
      true,
    );
  });
});
