// Configuration du stockage objet, lue depuis l'environnement (`S3_*`).
//
// Les variables existent dans `.env` et dans `packages/shared/src/env` depuis
// S16a, où elles ont été déclarées OPTIONNELLES avec la mention « rien ne les
// consomme aujourd'hui » (docs/17 § Schéma d'environnement). Ce module est le
// premier consommateur. Elles restent optionnelles : une API sans stockage
// démarre — elle refuse simplement les uploads, en le disant.
//
// POURQUOI PAS DE LECTURE DU COFFRE (`integrations/`, ADR-0013) : le coffre
// stocke déjà un fournisseur `s3` avec sa `secretKey` chiffrée, et la résolution
// « base d'abord, environnement ensuite » y est la règle. Brancher cette
// résolution ici demanderait d'injecter `SecretsService` dans un module de
// stockage, donc de faire dépendre le stockage du coffre — et le coffre lit
// `S3_SECRET_KEY` en secours, ce qui boucle. Ce lot lit l'environnement, point.
// La bascule vers le coffre est un travail à part, nommé dans le rapport.

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  bucketUploads: string;
}

export type StorageAvailability =
  | { available: true; config: StorageConfig }
  | { available: false; reason: string };

/**
 * Résout la configuration à chaque appel plutôt qu'une fois au démarrage.
 *
 * Ce n'est pas de la négligence : les suites de tests montent plusieurs
 * applications dans le même process et modifient `process.env` entre-temps. Un
 * cache de module figerait la première valeur lue et rendrait impossible de
 * tester le cas « stockage indisponible » après un cas nominal — c'est-à-dire
 * précisément le test qui prouve que l'indisponibilité est annoncée.
 */
export function resolveStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageAvailability {
  const endpoint = env['S3_ENDPOINT']?.trim();
  const accessKey = env['S3_ACCESS_KEY']?.trim();
  const secretKey = env['S3_SECRET_KEY'];
  const bucketUploads = env['S3_BUCKET_UPLOADS']?.trim();

  const missing = [
    endpoint ? null : 'S3_ENDPOINT',
    accessKey ? null : 'S3_ACCESS_KEY',
    secretKey ? null : 'S3_SECRET_KEY',
    bucketUploads ? null : 'S3_BUCKET_UPLOADS',
  ].filter((v): v is string => v !== null);

  if (missing.length > 0) {
    return {
      available: false,
      reason: `Stockage objet non configuré — variables manquantes : ${missing.join(', ')}.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint!);
  } catch {
    return { available: false, reason: `S3_ENDPOINT n'est pas une URL valide : « ${endpoint} ».` };
  }

  return {
    available: true,
    config: {
      endpoint: parsed.origin,
      region: env['S3_REGION']?.trim() || 'us-east-1',
      accessKey: accessKey!,
      secretKey: secretKey!,
      // Défaut `true` : MinIO ne sert pas les buckets en style hôte virtuel sans
      // DNS générique. Le défaut applicatif suit celui de `.env.example` et de
      // `packages/shared/src/env` — un défaut `false` casserait le local.
      forcePathStyle: env['S3_FORCE_PATH_STYLE']?.trim() !== 'false',
      bucketUploads: bucketUploads!,
    },
  };
}
