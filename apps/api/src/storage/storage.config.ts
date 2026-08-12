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
//
// ── Pourquoi les variables restent nommées `S3_*` alors qu'on vise R2 ─────────
//
// `S3_*` nomme un PROTOCOLE, pas un fournisseur. MinIO, DigitalOcean Spaces et
// Cloudflare R2 parlent tous les trois le même : même signature SigV4, même nom
// de service (`s3`) dans le scope, mêmes verbes. Renommer en `R2_*` aurait exigé
// de modifier `packages/shared/src/env`, `docker-compose.prod.yml` (le service
// MinIO lit `S3_ACCESS_KEY`/`S3_SECRET_KEY`) et `apps/api/src/__tests__/` en même
// temps, pour un déploiement où une seule variable oubliée coupe silencieusement
// les photos de profil en production. ADR-0013 §8 programme de toute façon le
// retrait de ces variables au profit du coffre : en créer de nouvelles
// aujourd'hui reviendrait à fabriquer des variables destinées à être supprimées.
//
// ── Ce qui change RÉELLEMENT entre MinIO/Spaces et R2 ─────────────────────────
//
// Rien dans la signature (`sigv4.ts` est inchangé), rien dans les verbes. Deux
// points seulement, tous deux portés par la configuration :
//
//   1. L'ENDPOINT : `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
//   2. La RÉGION : R2 n'a pas de région au sens AWS, mais SigV4 EXIGE un jeton de
//      région dans le scope de signature — il n'existe pas de signature sans. R2
//      attend le littéral `auto` (`us-east-1` et la chaîne vide y sont alias,
//      d'après la documentation Cloudflare). D'où le défaut dérivé de l'hôte
//      ci-dessous : `auto` pour un endpoint R2, `us-east-1` sinon.
//
// Le choix se fait donc par CONFIGURATION et par une seule valeur — l'endpoint —
// et non par un drapeau `STORAGE_PROVIDER` supplémentaire qui serait une seconde
// source de vérité, libre de contredire l'endpoint réellement contacté.

/** Dialecte déduit de l'endpoint. Sert à choisir les défauts, jamais à brancher. */
export type StorageFlavor = 'r2' | 's3';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  bucketUploads: string;
  /** `r2` quand l'endpoint est celui de Cloudflare R2, `s3` pour MinIO/Spaces/AWS. */
  flavor: StorageFlavor;
}

/** Suffixe d'hôte de l'API S3 de Cloudflare R2. */
const R2_HOST_SUFFIX = '.r2.cloudflarestorage.com';

/**
 * Dialecte d'un hôte.
 *
 * Comparaison sur le SUFFIXE d'hôte et non `includes` : un bucket MinIO nommé
 * `r2.cloudflarestorage.com.sauvegardes` ne doit pas basculer les défauts d'un
 * serveur qui n'est pas R2.
 */
export function flavorOfHost(host: string): StorageFlavor {
  return host.toLowerCase().endsWith(R2_HOST_SUFFIX) ? 'r2' : 's3';
}

export type StorageAvailability =
  { available: true; config: StorageConfig } | { available: false; reason: string };

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

  const flavor = flavorOfHost(parsed.host);

  return {
    available: true,
    config: {
      endpoint: parsed.origin,
      // `S3_REGION` explicite gagne TOUJOURS : le défaut ne doit pas rendre
      // impossible de signer pour une région que l'exploitant a de bonnes raisons
      // d'imposer (`ams3` sur Spaces, par exemple). Il ne comble que le silence.
      region: env['S3_REGION']?.trim() || (flavor === 'r2' ? 'auto' : 'us-east-1'),
      accessKey: accessKey!,
      secretKey: secretKey!,
      // Défaut `true` : MinIO ne sert pas les buckets en style hôte virtuel sans
      // DNS générique. Le défaut applicatif suit celui de `.env.example` et de
      // `packages/shared/src/env` — un défaut `false` casserait le local.
      // R2 accepte lui aussi le style de chemin (`use_path_style = true` dans la
      // documentation Terraform de Cloudflare), donc le défaut convient aux deux
      // et le passage à R2 ne demande PAS de toucher à cette variable.
      forcePathStyle: env['S3_FORCE_PATH_STYLE']?.trim() !== 'false',
      bucketUploads: bucketUploads!,
      flavor,
    },
  };
}
