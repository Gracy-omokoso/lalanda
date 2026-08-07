// Tests du schéma d'environnement API (S16a — durcissement sécurité).
// Vérifie notamment que les variables non consommées (Redis, S3) sont optionnelles
// et que le flag de vérification d'email est parsé strictement.

import { describe, expect, it } from 'vitest';

import { ApiEnvSchema } from './index.js';

/** Environnement minimal valide — uniquement les variables réellement requises. */
const MINIMAL_ENV = {
  MONGODB_URI: 'mongodb://localhost:27017/lalanda',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3001',
  OPENAI_API_KEY: 'sk-test',
};

describe('ApiEnvSchema (S16a)', () => {
  it("démarre sans REDIS_URL ni S3_* (requis seulement à partir des exports asynchrones)", () => {
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
