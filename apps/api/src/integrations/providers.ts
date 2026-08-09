// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE DES INTÉGRATIONS — ADR-0013 §1
//
// Ce fichier déclare, pour chacun des cinq fournisseurs, ce qui est SECRET et ce
// qui ne l'est pas. C'est la liste blanche dont ADR-0013 §1 dit que « toute clé
// hors liste blanche est refusée en 400 » : sans elle, un opérateur pressé
// glisserait `secretKey` dans `config` et le stockerait en clair.
//
// Deux listes par fournisseur, et elles sont DISJOINTES par construction (vérifié
// par `providers.test.ts`) :
//   - `secrets` : noms de valeurs chiffrées, jamais relues par l'API;
//   - `config`  : noms de valeurs en clair, requêtables et affichables.
// ─────────────────────────────────────────────────────────────────────────────

/** Les cinq fournisseurs à secret (ADR-0013 § Contexte). */
export const INTEGRATION_PROVIDERS = ['openai', 'stripe', 'paypal', 'smtp', 's3'] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return typeof value === 'string' && (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export interface ProviderSpec {
  /** Libellé français affiché dans `/admin`. */
  label: string;
  /** Noms de secrets acceptés. Tout autre nom → 400. */
  secrets: readonly string[];
  /** Secrets sans lesquels le fournisseur ne peut pas être testé ni utilisé. */
  requiredSecrets: readonly string[];
  /** Liste blanche de `config` — valeurs NON secrètes, stockées en clair. */
  config: readonly string[];
  /** Clés de `config` sans lesquelles le test de connexion ne peut pas s'exécuter. */
  requiredConfig: readonly string[];
  /**
   * Variable d'environnement de SECOURS par secret (ADR-0013 option C, « chemin de
   * migration borné »). Vide pour les fournisseurs qui n'ont jamais transité par
   * l'environnement : y ajouter une entrée serait recréer l'hybride permanent que
   * l'ADR rejette.
   */
  envFallback: Readonly<Record<string, string>>;
  /** Description du test de connexion, affichée dans l'interface. */
  testDescription: string;
}

export const PROVIDER_SPECS: Readonly<Record<IntegrationProvider, ProviderSpec>> = {
  openai: {
    label: 'OpenAI',
    secrets: ['apiKey'],
    requiredSecrets: ['apiKey'],
    config: ['modelReasoning', 'modelLite', 'baseUrl', 'organization'],
    requiredConfig: [],
    // ADR-0013 §8 : transitoire, à retirer au sprint de sortie.
    envFallback: { apiKey: 'OPENAI_API_KEY' },
    testDescription: 'GET /v1/models — sans coût, non facturé.',
  },
  stripe: {
    label: 'Stripe',
    // ADR-0013 §7 : `restrictedKey` et non `secretKey`. Le nom du champ porte la
    // recommandation : on ne peut pas enregistrer une `sk_…` « par défaut » sans
    // remarquer qu'on la range dans un emplacement nommé « clé restreinte ».
    secrets: ['restrictedKey', 'webhookSecret'],
    requiredSecrets: ['restrictedKey'],
    config: ['publishableKey', 'webhookEndpoint', 'accountCountry'],
    requiredConfig: [],
    envFallback: {},
    testDescription: 'GET /v1/account — sans coût.',
  },
  paypal: {
    label: 'PayPal',
    secrets: ['clientSecret'],
    requiredSecrets: ['clientSecret'],
    config: ['clientId', 'environment'],
    requiredConfig: ['clientId', 'environment'],
    envFallback: {},
    testDescription: "Demande d'un jeton OAuth — sans coût.",
  },
  smtp: {
    label: 'SMTP',
    secrets: ['password'],
    requiredSecrets: ['password'],
    config: ['host', 'port', 'secure', 'user', 'fromAddress', 'fromName'],
    requiredConfig: ['host', 'port', 'user'],
    envFallback: {},
    testDescription: 'verify() sur le transport — aucun email envoyé.',
  },
  s3: {
    label: 'S3 / Spaces',
    secrets: ['secretKey'],
    requiredSecrets: ['secretKey'],
    config: [
      'endpoint',
      'region',
      'accessKey',
      'bucketExports',
      'bucketSnapshots',
      'bucketUploads',
      'forcePathStyle',
    ],
    requiredConfig: ['endpoint', 'bucketExports'],
    // ADR-0013 §8 : transitoire, au même titre qu'`OPENAI_API_KEY`.
    envFallback: { secretKey: 'S3_SECRET_KEY' },
    testDescription: 'HeadBucket sur le bucket des exports — sans coût.',
  },
};

/**
 * `accessKey` de S3 est dans `config` et non dans `secrets` : c'est un
 * IDENTIFIANT, publiable au même titre qu'un nom d'utilisateur — seule la
 * `secretKey` ouvre quoi que ce soit. Même raisonnement pour `stripe.publishableKey`
 * (publique par conception, ADR-0013 §7) et `smtp.user`.
 *
 * Le piège inverse existe : `paypal.clientId` ressemble à un secret et n'en est
 * pas un; `paypal.clientSecret` en est un. C'est pourquoi la frontière est
 * déclarée ici, une fois, plutôt que devinée à chaque écriture.
 */
export function isKnownSecretName(provider: IntegrationProvider, name: string): boolean {
  return PROVIDER_SPECS[provider].secrets.includes(name);
}

export function isKnownConfigKey(provider: IntegrationProvider, key: string): boolean {
  return PROVIDER_SPECS[provider].config.includes(key);
}
