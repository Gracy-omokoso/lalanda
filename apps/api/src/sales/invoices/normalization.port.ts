// ─────────────────────────────────────────────────────────────────────────────
// Port de normalisation des documents de vente — ADR-0023 § S25e.10 (jalon E0)
//
// FICHIER FIGÉ : S25e (chantier E2) appelle ce port après la validation du gel
// d'un document `pending_normalization` ; S25f (connexion DGI) en fournit
// l'implémentation réelle en remplaçant le fournisseur dans `SalesModule`, sans
// toucher au reste. Toute modification passe par le CTO et un amendement
// d'ADR-0023.
//
// Amendé par ADR-0024 (jalon F0) : ajouts seulement — phases de la
// normalisation (§ 4.1), prise en main, empreinte de la requête, écarts,
// revue humaine, `lastError` élargi (§ 10). Aucun champ retiré, aucun sens
// changé.
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_INVOICE_NORMALIZER = Symbol('SALES_INVOICE_NORMALIZER');

export type NormalizeNowOutcome = 'normalized' | 'failed' | 'uncertain' | 'deferred';

export interface SalesInvoiceNormalizer {
  /** Après la validation du gel, pour un document pending_normalization. Idempotent ;
   *  ne lève pas pour un refus DGI. */
  normalizeNow(organizationId: string, invoiceId: string): Promise<NormalizeNowOutcome>;
}

/** Phases de la machine à états de la normalisation (ADR-0024 § 4.1). */
export const NORMALIZATION_PHASES = [
  'queued',
  'submitting',
  'comparing',
  'cancelling',
  'confirming',
  'uncertain',
  'needs_review',
  'done',
  'failed',
] as const;
export type NormalizationPhase = (typeof NORMALIZATION_PHASES)[number];

/** Étape restée sans réponse sûre (ADR-0024 § 4.1). */
export type NormalizationUncertainStep = 'submit' | 'confirm' | 'cancel';

/** Sous-document `normalization`, ÉCRIT PAR S25f SEULEMENT après sa création par S25e. */
export interface InvoiceNormalizationState {
  pointOfSaleId: string;
  /** 0 à la création. */
  attempts: number;
  lastAttemptAt: Date | null;
  /** Via InvoiceNumberingService.reserve. */
  reservedNumber: string | null;
  uid: string | null;
  dgiTotals: Readonly<Record<string, string>> | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  dgiDateTime: string | null;
  qrCode: string | null;
  /** Affichés à l'utilisateur. Élargi par ADR-0024 § 10 (champs ajoutés optionnels,
   *  compatibles avec les documents écrits avant). */
  lastError: {
    code: string;
    message: string;
    category?: string;
    dgiErrorCode?: string | null;
    dgiMessage?: string | null;
    retryable?: boolean;
  } | null;
  normalizedAt: Date | null;

  // ── ADR-0024 § 10 (jalon F0) ──
  /** Initialisée à `queued` par le gel ; un document gelé avant S25f (sans `phase`) se lit `queued`. */
  phase: NormalizationPhase;
  uncertainStep: NormalizationUncertainStep | null;
  attemptId: string | null;
  /** Prise en main vivante (requête utilisateur ou rattrapage). */
  claim: { attemptId: string; until: Date } | null;
  /** Empreinte du corps e-MCF, identique à chaque tentative. */
  requestSha256: string | null;
  submittedAt: Date | null;
  confirmStartedAt: Date | null;
  /** Rattrapage permis à partir de cette date (dernier appel DGI + 150 s). */
  reconcileAfter: Date | null;
  uncertainSince: Date | null;
  /** Écart de totaux constaté (champ, nous, DGI). */
  differences: readonly { field: string; ours: string | null; dgi: string | null }[] | null;
  review: { since: Date; reason: string } | null;
}
