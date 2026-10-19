// ─────────────────────────────────────────────────────────────────────────────
// Port de normalisation des documents de vente — ADR-0023 § S25e.10 (jalon E0)
//
// FICHIER FIGÉ : S25e (chantier E2) appelle ce port après la validation du gel
// d'un document `pending_normalization` ; S25f (connexion DGI) en fournit
// l'implémentation réelle en remplaçant le fournisseur dans `SalesModule`, sans
// toucher au reste. Toute modification passe par le CTO et un amendement
// d'ADR-0023.
// ─────────────────────────────────────────────────────────────────────────────

export const SALES_INVOICE_NORMALIZER = Symbol('SALES_INVOICE_NORMALIZER');

export type NormalizeNowOutcome = 'normalized' | 'failed' | 'uncertain' | 'deferred';

export interface SalesInvoiceNormalizer {
  /** Après la validation du gel, pour un document pending_normalization. Idempotent ;
   *  ne lève pas pour un refus DGI. */
  normalizeNow(organizationId: string, invoiceId: string): Promise<NormalizeNowOutcome>;
}

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
  /** Affichés à l'utilisateur. */
  lastError: { code: string; message: string } | null;
  normalizedAt: Date | null;
}
