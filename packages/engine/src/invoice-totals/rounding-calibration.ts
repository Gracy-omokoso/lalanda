// ─────────────────────────────────────────────────────────────────────────────
// Relevé d'étalonnage des arrondis — ADR-0024 § 7.3 (jalon F0)
//
// La politique d'arrondi appliquée aux factures (`DGI_ROUNDING_POLICY`) est une
// règle de calcul fiscal : elle est versionnée avec le code, jamais réglée par
// une variable d'environnement (ADR-0024, option O5). Ce relevé dit si elle a
// été vérifiée contre l'environnement de TEST de la DGI, quand, et sur quels
// cas.
//
// Livré à `not_calibrated` : aucun étalonnage n'a encore eu lieu. Le chantier
// F4 le remplit à la main depuis le rapport de l'outil d'étalonnage (rapport
// conservé hors dépôt, dans `dgi/etalonnage/`), après l'étalonnage réel.
// Tant qu'il vaut `not_calibrated`, la production DGI refuse de s'ouvrir
// (`loadDgiPlatformConfig`, apps/api).
// ─────────────────────────────────────────────────────────────────────────────

export interface RoundingCalibrationRecord {
  status: 'not_calibrated' | 'calibrated';
  /** Doit égaler `DGI_ROUNDING_POLICY.id`. */
  policyId: string;
  /** 'AAAA-MM-JJ'. */
  calibratedAt: string | null;
  environment: 'test';
  /** « Étalonnage e-DEF test, rapport sha256 … ». */
  source: string;
  /** Empreinte du rapport local (hors dépôt). */
  reportSha256: string | null;
  cases: readonly {
    caseId: string;
    priceMode: 'ttc' | 'ht';
    matchedPolicies: readonly string[];
    /** Champs comparés, tels que reçus. */
    dgiTotals: Readonly<Record<string, string>>;
  }[];
}

export const ROUNDING_CALIBRATION: RoundingCalibrationRecord = Object.freeze({
  status: 'not_calibrated',
  policyId: 'dgi-cd-2026.1',
  calibratedAt: null,
  environment: 'test',
  source: 'Aucun étalonnage : politique par défaut dgi-cd-2026.1 (ADR-0022), non vérifiée.',
  reportSha256: null,
  cases: Object.freeze([]),
});
