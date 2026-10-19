// Paramètres plateforme de la facture normalisée DGI — ADR-0021 §5 et §11 (jalon A0).
//
// L'ISF identifie le LOGICIEL homologué (Lalanda, éditeur Go Freelance SARLU),
// pas une organisation cliente : c'est un paramètre de la plateforme, fixé au
// déploiement (ADR-0021 O4). Les jetons e-MCF, eux, appartiennent à chaque
// organisation et vivent dans son coffre chiffré (ADR-0021 §4.2) — jamais ici.
//
// Les signatures exportées sont un CONTRAT : le chantier B (`edef/`, `fiscal/`)
// code contre elles. Elles ne changent plus sans accord du CTO.
// Amendé par ADR-0024 (jalon F0) : ajouts seulement — délais de la
// normalisation, refus d'ouvrir la production sans étalonnage des arrondis.

import { ROUNDING_CALIBRATION, type RoundingCalibrationRecord } from '@lalanda/engine';
import { DgiEnvSchema, withoutEmptyValues } from '@lalanda/shared';

export type EdefEnvironment = 'test' | 'production';

// ── Délais de la normalisation — ADR-0024 § 6 (jalon F0) ────────────────────

/** Au-delà, on n'envoie plus le `confirm` : la DGI expire une demande à 120 s, 30 s de marge. */
export const CONFIRM_DEADLINE_MS = 90_000;
/** Durée de vie d'une demande non finalisée à la DGI (documentation DGI). */
export const DGI_PENDING_EXPIRY_MS = 120_000;
/** Délai après le dernier appel DGI avant le rattrapage : la demande a expiré, l'état est stable. */
export const RECONCILE_DELAY_MS = 150_000;
/** Plafond d'incertitude : au-delà, le document passe en `needs_review`. */
export const UNCERTAINTY_CAP_MS = 30 * 60_000;

/** Délais de la normalisation, surchargeables en test (ADR-0024 § 6). */
export interface NormalizationTimings {
  confirmDeadlineMs: number;
  pendingExpiryMs: number;
  reconcileDelayMs: number;
  uncertaintyCapMs: number;
}

export const DEFAULT_NORMALIZATION_TIMINGS: Readonly<NormalizationTimings> = Object.freeze({
  confirmDeadlineMs: CONFIRM_DEADLINE_MS,
  pendingExpiryMs: DGI_PENDING_EXPIRY_MS,
  reconcileDelayMs: RECONCILE_DELAY_MS,
  uncertaintyCapMs: UNCERTAINTY_CAP_MS,
});

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
  /** ADR-0024 § 6 — les tests construisent leur configuration avec des délais courts. */
  normalizationTimings: Readonly<NormalizationTimings>;
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
 *
 * ADR-0024 § 7.3 : la production ne s'ouvre pas tant que la politique d'arrondi
 * n'a pas été étalonnée contre l'environnement de test de la DGI
 * (`ROUNDING_CALIBRATION.status = 'calibrated'`, relevé versionné dans le
 * moteur). `calibration` n'est un paramètre que pour les tests.
 */
export function loadDgiPlatformConfig(
  raw: NodeJS.ProcessEnv = process.env,
  calibration: Pick<RoundingCalibrationRecord, 'status'> = ROUNDING_CALIBRATION,
): DgiPlatformConfig {
  const parsed = DgiEnvSchema.safeParse(withoutEmptyValues(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join(' ; ');
    throw new Error(`Configuration DGI invalide — ${issues}`);
  }
  const env = parsed.data;
  if (env.DGI_PRODUCTION_ENABLED && calibration.status !== 'calibrated') {
    throw new Error(
      'Configuration DGI invalide — DGI_PRODUCTION_ENABLED=true exige un étalonnage des ' +
        "arrondis enregistré (ROUNDING_CALIBRATION.status = 'calibrated', ADR-0024 § 7.3) : " +
        "la production DGI ne s'ouvre pas avec une politique d'arrondi non vérifiée.",
    );
  }
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
    normalizationTimings: DEFAULT_NORMALIZATION_TIMINGS,
  });
}
