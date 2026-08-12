// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE DES INTÉGRATIONS — ADR-0013 §1
//
// Ce fichier déclare, pour chaque fournisseur, ce qui est SECRET et ce
// qui ne l'est pas. C'est la liste blanche dont ADR-0013 §1 dit que « toute clé
// hors liste blanche est refusée en 400 » : sans elle, un opérateur pressé
// glisserait `secretKey` dans `config` et le stockerait en clair.
//
// Deux listes par fournisseur, et elles sont DISJOINTES par construction (vérifié
// par `providers.test.ts`) :
//   - `secrets` : noms de valeurs chiffrées, jamais relues par l'API;
//   - `config`  : noms de valeurs en clair, requêtables et affichables.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les fournisseurs à secret. ADR-0013 § Contexte en déclarait cinq; trois
 * évolutions se sont ajoutées depuis :
 *
 *   - `s3` est devenu `r2` (Cloudflare R2). Le PROTOCOLE ne change pas — R2
 *     expose une API compatible S3, signée SigV4 avec le même nom de service
 *     `s3` — seul le fournisseur cible change. Les documents `integrations`
 *     portant encore `provider: 's3'` sont repris par `provider-rename.ts` : le
 *     renommage ne peut pas être un simple `$set`, l'AAD des secrets contient le
 *     nom du fournisseur (ADR-0013 §2) et un chiffré renommé à la main ne se
 *     déchiffrerait plus.
 *   - `elevenlabs` est ajouté pour un futur assistant vocal. CONFIGURATION
 *     SEULEMENT à ce stade : aucune synthèse vocale n'est implémentée, et
 *     l'usage produit n'est pas spécifié.
 *   - `zeptomail` est ajouté (ADR-0014 § S22m) SANS retirer `smtp` : ADR-0014
 *     fait de ZeptoMail le chemin d'envoi PRÉFÉRÉ, pas le chemin unique — SMTP
 *     reste le repli, et un développeur local continue de brancher MailHog.
 */
export const INTEGRATION_PROVIDERS = [
  'openai',
  'stripe',
  'paypal',
  'smtp',
  'r2',
  'elevenlabs',
  'zeptomail',
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Nom de fournisseur retiré du catalogue, encore possiblement présent en base.
 *
 * `s3` n'est plus un fournisseur valide, mais un déploiement en cours
 * d'exploitation en porte un document. Il est déclaré ici pour que la migration
 * sache quoi chercher, et NON ajouté à `INTEGRATION_PROVIDERS` : l'y laisser
 * ferait apparaître dans `/admin` un sixième fournisseur fantôme dont personne
 * ne saurait dire s'il faut le remplir.
 */
export const LEGACY_PROVIDER_RENAMES: Readonly<Record<string, IntegrationProvider>> = {
  s3: 'r2',
};

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
  r2: {
    // Le libellé nomme le fournisseur visé ET le protocole : un exploitant qui
    // tourne encore sur MinIO doit reconnaître où ranger ses identifiants, sans
    // quoi il croirait l'entrée inapplicable à son installation.
    label: 'Cloudflare R2 (API compatible S3)',
    secrets: ['secretKey'],
    requiredSecrets: ['secretKey'],
    // Liste INCHANGÉE par rapport à l'ancienne entrée `s3` : R2 se configure avec
    // exactement les mêmes champs. C'est ce qui permet à la migration de recopier
    // `config` tel quel, sans traduction et donc sans occasion de se tromper.
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
    // ADR-0013 §8 : transitoire, au même titre qu'`OPENAI_API_KEY`. Le NOM de la
    // variable reste `S3_SECRET_KEY` — elle nomme le protocole, elle est déjà
    // posée en production et lue par le service MinIO de `docker-compose.prod.yml`.
    // La renommer couperait le secours au premier déploiement.
    envFallback: { secretKey: 'S3_SECRET_KEY' },
    testDescription: 'HeadBucket sur le bucket des exports — sans coût.',
  },
  elevenlabs: {
    label: 'ElevenLabs',
    secrets: ['apiKey'],
    requiredSecrets: ['apiKey'],
    // `baseUrl` seul : ElevenLabs publie des points d'entrée régionaux, et le
    // surcharger est aussi ce qui rend le test simulable. Aucun `voiceId`, aucun
    // `modelId` — le périmètre est la CONFIGURATION, pas l'usage, et déclarer un
    // champ d'usage aujourd'hui préjugerait d'une décision produit non prise.
    config: ['baseUrl'],
    requiredConfig: [],
    // Vide : cette clé n'a jamais transité par l'environnement. « Y ajouter une
    // entrée serait recréer l'hybride permanent que l'ADR rejette. »
    envFallback: {},
    testDescription: 'GET /v2/voices — lecture seule, sans coût ni crédit consommé.',
  },
  zeptomail: {
    label: 'ZeptoMail (Zoho)',
    // `sendMailToken` reprend le nom que Zoho donne à cette valeur dans sa
    // console (« Send Mail Token »). Un opérateur qui cherche quoi coller ne doit
    // pas avoir à traduire : le libellé du champ est celui de l'écran d'origine.
    secrets: ['sendMailToken'],
    requiredSecrets: ['sendMailToken'],
    // VOLONTAIREMENT VIDE. Les deux seuls réglages non secrets de l'envoi —
    // l'adresse d'expédition et le point d'entrée régional de l'API — sont déjà
    // portés par l'environnement (`SMTP_FROM`, `ZEPTOMAIL_API_URL`), d'où le
    // transport les lit. Les redéclarer ici créerait deux sources de vérité pour
    // la même valeur, c'est-à-dire le défaut qu'ADR-0013 option C nomme
    // explicitement : « une variable d'environnement oubliée masque
    // silencieusement » ce qui a pourtant été saisi en base.
    config: [],
    requiredConfig: [],
    // VIDE, et ce n'est pas un oubli (verrou vérifié par `providers.test.ts`).
    // ZeptoMail n'a jamais transité par l'environnement : lui donner un secours
    // `ZEPTOMAIL_TOKEN` recréerait l'hybride permanent qu'ADR-0013 rejette. Le
    // critère de partage d'ADR-0013 §8 tranche sans ambiguïté — l'envoi d'un
    // email a lieu bien après la lecture de la base, donc le coffre.
    envFallback: {},
    testDescription:
      'Appel de /v1.1/email avec une charge délibérément incomplète — ' +
      'le jeton est validé, aucun email ne part.',
  },
};

/**
 * `accessKey` de R2 est dans `config` et non dans `secrets` : c'est un
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
