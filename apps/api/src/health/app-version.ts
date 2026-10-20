// Version du logiciel — ADR-0026 § 6.2 (écart C1 du dossier d'homologation).
//
// La version de RELEASE est celle de l'étiquette Git `vX.Y.Z` qui a déclenché le
// déploiement : le workflow `deploy.yml` la passe au build de l'image
// (`--build-arg APP_VERSION=X.Y.Z`), le Dockerfile la pose en variable
// d'environnement. Hors image (développement, tests), repli sur le
// `package.json` de l'API suivi de « -dev », marqué `source: 'package'` : ce
// n'est PAS une version de release et l'écran comme le PDF le disent.
//
// Lue une fois au démarrage : une version ne change pas pendant la vie du processus.

import { createRequire } from 'node:module';

export interface AppVersion {
  /** `X.Y.Z` (sans « v »), éventuellement suivi d'un suffixe de pré-version. */
  version: string;
  /** `release` : étiquette Git injectée au build ; `package` : repli de développement. */
  source: 'release' | 'package';
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Version d'une valeur d'environnement : `v0.9.3` ou `0.9.3` → `0.9.3` ; sinon `null`. */
export function releaseVersionOf(raw: string | undefined): string | null {
  const v = (raw ?? '').trim().replace(/^v/, '');
  return SEMVER.test(v) ? v : null;
}

function packageVersion(): string {
  try {
    // `src/health/` comme `dist/health/` : le package.json de l'API est deux niveaux au-dessus.
    const pkg = createRequire(import.meta.url)('../../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' && SEMVER.test(pkg.version) ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): AppVersion {
  const release = releaseVersionOf(env['APP_VERSION']);
  return release !== null
    ? { version: release, source: 'release' }
    : // Suffixe « -dev » : une facture gelée hors image ne se fait pas passer pour une release.
      { version: `${packageVersion()}-dev`, source: 'package' };
}

/** Version du processus en cours. */
export const APP_VERSION: AppVersion = resolveAppVersion();
