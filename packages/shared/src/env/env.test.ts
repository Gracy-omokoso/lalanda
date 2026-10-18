// Tests du schéma d'environnement API (S16a — durcissement sécurité).
// Vérifie notamment que les variables non consommées (Redis, S3) sont optionnelles
// et que le flag de vérification d'email est parsé strictement.

import { describe, expect, it } from 'vitest';

import { ApiEnvSchema, parseEnv } from './index.js';

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

describe('variables facultatives laissées vides (S22l)', () => {
  // `.env.production.example` livre `GOOGLE_CLIENT_ID=`, `SMTP_HOST=` etc. —
  // la façon habituelle d'écrire « non configuré » dans un fichier .env.
  // Zod voyait une chaîne PRÉSENTE et refusait le `min(1)` : l'API sortait en
  // exit 1 au démarrage, en production, en suivant la procédure documentée.
  const base = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://mongo:27017/lalanda',
    MONGODB_DB: 'lalanda',
    AUTH_SECRET: 'x'.repeat(32),
    AUTH_URL: 'https://api.exemple.co',
    API_URL: 'https://api.exemple.co',
    WEB_URL: 'https://exemple.co',
    SECRETS_MASTER_KEY: 'Q0ktQ0xFLUZBQ1RJQ0UtTk9OLVBST0RVQ1RJT04tMzI=',
  } as NodeJS.ProcessEnv;

  it('accepte une variable facultative vide, et la rend indéfinie', () => {
    const env = parseEnv(ApiEnvSchema, {
      ...base,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      OPENAI_API_KEY: '',
    });

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('conserve une variable facultative réellement renseignée', () => {
    const env = parseEnv(ApiEnvSchema, { ...base, SMTP_HOST: 'smtp.exemple.co' });
    expect(env.SMTP_HOST).toBe('smtp.exemple.co');
  });
});

describe('paramètres plateforme DGI (ADR-0021 §5)', () => {
  it('valeurs par défaut : URL DGI officielles, production fermée, délai de 15 s', () => {
    const env = ApiEnvSchema.parse(MINIMAL_ENV);
    expect(env.DGI_EDEF_TEST_URL).toBe('https://developper.dgirdc.cd/edef');
    expect(env.DGI_EDEF_PRODUCTION_URL).toBe('https://edef.dgirdc.cd');
    expect(env.DGI_PRODUCTION_ENABLED).toBe(false);
    expect(env.DGI_HTTP_TIMEOUT_MS).toBe(15_000);
    expect(env.DGI_ISF_TEST).toBeUndefined();
    expect(env.DGI_ISF_PRODUCTION).toBeUndefined();
  });

  it('refuse de démarrer si la production est ouverte sans ISF de production', () => {
    const parsed = ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_PRODUCTION_ENABLED: 'true' });
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : parsed.error.issues.map((i) => i.message).join(' ');
    expect(message).toContain('DGI_PRODUCTION_ENABLED=true exige DGI_ISF_PRODUCTION');
  });

  it('ouvre la production avec un ISF au bon format', () => {
    const env = ApiEnvSchema.parse({
      ...MINIMAL_ENV,
      DGI_PRODUCTION_ENABLED: 'true',
      DGI_ISF_PRODUCTION: 'AB1-CD2-E3',
    });
    expect(env.DGI_PRODUCTION_ENABLED).toBe(true);
  });

  it('refuse un ISF de production mal formé', () => {
    for (const isf of ['ab1-cd2-e3', 'AB1CD2E3', 'AB1-CD2-E34', '']) {
      expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_ISF_PRODUCTION: isf }).success, isf).toBe(
        false,
      );
    }
  });

  it('DGI_PRODUCTION_ENABLED : parse strict, « yes » refusé, « false » reste fermé', () => {
    expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_PRODUCTION_ENABLED: 'yes' }).success).toBe(
      false,
    );
    expect(ApiEnvSchema.parse({ ...MINIMAL_ENV, DGI_PRODUCTION_ENABLED: 'false' })).toMatchObject({
      DGI_PRODUCTION_ENABLED: false,
    });
  });

  it('DGI_HTTP_TIMEOUT_MS borné entre 10 000 et 60 000', () => {
    for (const v of ['9999', '60001', 'abc']) {
      expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_HTTP_TIMEOUT_MS: v }).success, v).toBe(
        false,
      );
    }
    expect(ApiEnvSchema.parse({ ...MINIMAL_ENV, DGI_HTTP_TIMEOUT_MS: '10000' })).toMatchObject({
      DGI_HTTP_TIMEOUT_MS: 10_000,
    });
  });

  it('DGI_ISF_TEST : format libre, 32 caractères au plus', () => {
    expect(ApiEnvSchema.parse({ ...MINIMAL_ENV, DGI_ISF_TEST: 'isf test 01' })).toMatchObject({
      DGI_ISF_TEST: 'isf test 01',
    });
    expect(ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_ISF_TEST: 'x'.repeat(33) }).success).toBe(
      false,
    );
  });

  it('URL : https exigé ; http seulement vers localhost, et jamais en production', () => {
    expect(
      ApiEnvSchema.safeParse({ ...MINIMAL_ENV, DGI_EDEF_TEST_URL: 'http://dgi.exemple.cd' })
        .success,
    ).toBe(false);
    const local = ApiEnvSchema.parse({
      ...MINIMAL_ENV,
      DGI_EDEF_TEST_URL: 'http://127.0.0.1:45678/',
    });
    expect(local.DGI_EDEF_TEST_URL).toBe('http://127.0.0.1:45678');
    expect(
      ApiEnvSchema.safeParse({
        ...MINIMAL_ENV,
        NODE_ENV: 'production',
        DGI_EDEF_TEST_URL: 'http://127.0.0.1:45678',
      }).success,
    ).toBe(false);
  });

  it('la barre oblique finale est retirée (les appelants concatènent /api/…)', () => {
    const env = ApiEnvSchema.parse({
      ...MINIMAL_ENV,
      DGI_EDEF_PRODUCTION_URL: 'https://edef.dgirdc.cd/',
    });
    expect(env.DGI_EDEF_PRODUCTION_URL).toBe('https://edef.dgirdc.cd');
  });
});
