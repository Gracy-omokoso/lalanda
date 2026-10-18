// Paramètres plateforme de la facture normalisée DGI — ADR-0021 §5 et §11 (jalon A0).
//
// L'ISF identifie le LOGICIEL homologué (Lalanda, éditeur Go Freelance SARLU),
// pas une organisation cliente : c'est un paramètre de la plateforme, fixé au
// déploiement (ADR-0021 O4). Les jetons e-MCF, eux, appartiennent à chaque
// organisation et vivent dans son coffre chiffré (ADR-0021 §4.2) — jamais ici.
//
// Les signatures exportées sont un CONTRAT : le chantier B (`edef/`, `fiscal/`)
// code contre elles. Elles ne changent plus sans accord du CTO.

import { DgiEnvSchema, withoutEmptyValues } from '@lalanda/shared';

export type EdefEnvironment = 'test' | 'production';

export interface DgiPlatformConfig {
  /** URL de base de l'API e-DEF, sans barre oblique finale. */
  baseUrl: Readonly<Record<EdefEnvironment, string>>;
  isf: Readonly<{ test: string | null; production: string | null }>;
  /**
   * Production DGI ouverte. Fermée tant que Lalanda n'est pas homologué : le
   * client e-DEF n'émet alors AUCUN appel réseau vers la production
   * (`production_disabled`, ADR-0021 §6).
   */
  productionEnabled: boolean;
  httpTimeoutMs: number;
}

/** Jeton d'injection — `@Inject(DGI_PLATFORM_CONFIG) config: DgiPlatformConfig`. */
export const DGI_PLATFORM_CONFIG = Symbol('DGI_PLATFORM_CONFIG');

/**
 * Lit et valide les variables `DGI_*`.
 *
 * Pourquoi relire l'environnement ici plutôt que recevoir l'objet parsé par
 * `main.ts` : les tests e2e démarrent l'application sans `main.ts`. Valider à cet
 * endroit garantit que la règle « pas de production sans ISF » vaut aussi pour
 * eux, avec le MÊME schéma (`DgiEnvSchema`, défini une seule fois dans
 * `@lalanda/shared`).
 *
 * Une configuration invalide LÈVE : Nest échoue alors au démarrage, ce qui est
 * l'effet voulu (ADR-0021 §5, « refus de démarrer »). Les chaînes vides valent
 * absence, comme pour le reste de l'environnement (`.env.production.example`
 * livre `DGI_ISF_PRODUCTION=`).
 *
 * Le résultat est gelé : une configuration plateforme ne se modifie pas en cours
 * d'exécution, et un appelant qui tenterait d'ouvrir la production en mémoire
 * doit échouer, pas réussir en silence.
 */
export function loadDgiPlatformConfig(raw: NodeJS.ProcessEnv = process.env): DgiPlatformConfig {
  const parsed = DgiEnvSchema.safeParse(withoutEmptyValues(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join(' ; ');
    throw new Error(`Configuration DGI invalide — ${issues}`);
  }
  const env = parsed.data;
  return Object.freeze({
    baseUrl: Object.freeze({
      test: env.DGI_EDEF_TEST_URL,
      production: env.DGI_EDEF_PRODUCTION_URL,
    }),
    isf: Object.freeze({
      test: env.DGI_ISF_TEST ?? null,
      production: env.DGI_ISF_PRODUCTION ?? null,
    }),
    productionEnabled: env.DGI_PRODUCTION_ENABLED,
    httpTimeoutMs: env.DGI_HTTP_TIMEOUT_MS,
  });
}
