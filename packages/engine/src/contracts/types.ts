// ─────────────────────────────────────────────────────────────────────────────
// Contrats clients, commandes clients, acomptes et abonnements — types
// (ADR-0050 § 7)
//
// Module PUR : aucune base, aucun réseau, aucune horloge (le jour de référence
// est un paramètre, jour civil de Kinshasa déjà calculé par l'appelant,
// ADR-0027). Dates civiles `AAAA-MM-JJ` ; montants en chaînes décimales (deux
// décimales au plus) ; quantités en chaînes décimales (trois décimales au plus) ;
// arithmétique en `bigint`, jamais en flottant ; JAMAIS de conversion de devise.
//
// Aucune règle fiscale ni juridique (ADR-0050 § 10) : les clauses de durée, de
// reconduction et de préavis sont CELLES SAISIES par l'utilisateur ; ce module
// calcule des dates à partir d'elles, n'en juge jamais la validité. Aucune
// imputation d'acompte, aucun prorata, aucun pourcentage (décisions ouvertes
// n° 11, 13 et 14) ; aucun montant n'est recalculé ici (les totaux viennent de
// `compose` ou des factures figées).
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const CONTRACTS_VERSION = '1.0.0';

/** Devises d'une commande ou d'un contrat — celles des documents de vente. */
export const CONTRACT_CURRENCIES = ['CDF', 'USD'] as const;
export type ContractCurrency = (typeof CONTRACT_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa). */
export type ContractDay = string;
/** Montant décimal positif ou nul, deux décimales au plus. */
export type ContractAmount = string;
/** Quantité décimale, trois décimales au plus. */
export type ContractQuantity = string;

// ─── Conditions et avenants (§ 2.3, § 2.5) ───────────────────────────────────

export const RENEWAL_MODES = ['none', 'tacit', 'explicit'] as const;
export type RenewalMode = (typeof RENEWAL_MODES)[number];

/** Clause de reconduction SAISIE (§ 2.3). */
export interface RenewalClause {
  mode: RenewalMode;
  /** 1 à 60 mois, ou `null`. */
  periodMonths: number | null;
  /** Nombre maximal de reconductions, ou `null` (sans maximum saisi). */
  maxRenewals: number | null;
}

export const BILLING_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const BILLING_TIMINGS = ['in_advance', 'in_arrears'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

export interface ScheduleItem<L = unknown> {
  itemRef: string;
  dueDate: ContractDay;
  label?: string | null;
  lines?: readonly L[];
}

/** Échéancier (§ 2.4). Aucun pourcentage : chaque échéance porte ses lignes. */
export type ContractBilling<L = unknown> =
  | { kind: 'none' }
  | { kind: 'schedule'; items: readonly ScheduleItem<L>[] }
  | {
      kind: 'recurring';
      frequency: BillingFrequency;
      anchorDate: ContractDay;
      timing: BillingTiming;
      autoPrepare: boolean;
    };

/** Champs modifiables d'un contrat, donc d'un avenant (§ 2.5). */
export interface ContractTermsContent<L = unknown> {
  lines: readonly L[];
  billing: ContractBilling<L>;
  /** 1 à 120 mois, ou `null` (durée indéterminée). */
  initialTermMonths: number | null;
  renewal: RenewalClause;
  /** Préavis SAISI, 0 à 365 jours. */
  noticeDays: number;
  clauses: string | null;
}

export const CONTRACT_STORED_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'signed',
  'terminated',
  'cancelled',
] as const;
export type ContractStoredStatus = (typeof CONTRACT_STORED_STATUSES)[number];

export const AMENDMENT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'signed',
  'cancelled',
] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export interface ContractInput<L = unknown> extends ContractTermsContent<L> {
  startDate: ContractDay;
  status?: ContractStoredStatus;
}

export interface AmendmentInput<L = unknown> {
  /** Avenant n° 1, 2… — unique par contrat. */
  index: number;
  effectiveDate: ContractDay;
  status: AmendmentStatus;
  /** Ce qui n'est pas fourni est repris des conditions précédentes. */
  changes: Partial<ContractTermsContent<L>>;
}

export interface TermsAtResult<L = unknown> {
  version: string;
  date: ContractDay;
  terms: ContractTermsContent<L>;
  /** Index des avenants signés appliqués, dans l'ordre d'application. */
  appliedAmendments: number[];
  /**
   * Avenants NON signés (ni annulés) dont la date d'effet est atteinte : sans
   * effet, motif `AMENDMENT_PENDING` d'une échéance bloquée (§ 5.3).
   */
  pendingAmendments: number[];
}

// ─── Termes, reconduction, résiliation (§ 2.3, § 5.3) ───────────────────────

export interface RecordedRenewal {
  /** 1 pour la première reconduction, 2 pour la suivante… */
  termIndex: number;
  from: ContractDay;
  to: ContractDay;
  mode: 'tacit_recorded' | 'explicit_amendment';
}

export interface TerminationInput {
  noticeGivenOn: ContractDay;
  /** Date d'effet : dernier jour couvert par le contrat (inclus). */
  effectiveOn: ContractDay;
}

export interface ContractTerm {
  /** 0 = terme initial. */
  index: number;
  from: ContractDay;
  /** Dernier jour du terme (inclus) ; `null` = durée indéterminée. */
  to: ContractDay | null;
  origin: 'initial' | 'tacit_recorded' | 'explicit_amendment';
}

export type ContractDerivedStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'cancelled'
  | 'terminated'
  | 'upcoming'
  | 'in_force'
  | 'expiring'
  | 'ended';

export type ContractTermsIssueCode =
  /** Reconduction enregistrée non contiguë (rang ou dates) : elle et les suivantes sont ignorées. */
  | 'RENEWAL_INCOHERENT'
  /** Reconduction tacite saisie sans durée de période : aucun terme proposé. */
  | 'RENEWAL_PERIOD_MISSING'
  /** Plus de reconductions enregistrées que le maximum saisi. */
  | 'RENEWALS_ABOVE_MAXIMUM';

export interface ContractTermsIssue {
  code: ContractTermsIssueCode;
  termIndex: number | null;
}

export interface ContractTermsOptions {
  /** Défaut 60 (`sales_contract_settings.termEndAlertDays`). */
  termEndAlertDays?: number;
}

export interface ContractTermsResult {
  version: string;
  today: ContractDay;
  status: ContractDerivedStatus;
  /** Termes connus : initial puis reconductions enregistrées et cohérentes. */
  terms: ContractTerm[];
  /**
   * Terme qui contient `today` ; avant le début, le terme initial ; après la fin
   * du dernier terme connu, ce dernier terme (`termElapsed = true`).
   */
  currentTerm: ContractTerm;
  termElapsed: boolean;
  /** Fin du dernier terme connu (`null` = durée indéterminée). */
  lastTermEnd: ContractDay | null;
  /** Date limite de préavis du terme en cours = fin − `noticeDays` (jour civil). */
  noticeDeadline: ContractDay | null;
  /**
   * Reconduction tacite à constater par un humain (jamais appliquée par le moteur) :
   * terme qui suivrait le dernier terme connu.
   */
  proposedNextTerm: ContractTerm | null;
  /**
   * Dernier jour facturable : fin du dernier terme connu, ou date d'effet de la
   * résiliation si elle est antérieure ; `null` = sans borne. Aucune échéance ne
   * vient au-delà (§ 2.4).
   */
  billableUntil: ContractDay | null;
  renewalsRecorded: number;
  issues: ContractTermsIssue[];
}

// ─── Préavis (§ 2.3) ────────────────────────────────────────────────────────

export interface NoticeCheckResult {
  version: string;
  noticeGivenOn: ContractDay;
  effectiveOn: ContractDay;
  noticeDays: number;
  /** Jours civils entre la notification et la date d'effet (négatif si l'effet précède). */
  daysGiven: number;
  /** Dernier jour où notifier pour respecter la clause saisie = effet − préavis. */
  latestNoticeDate: ContractDay;
  /** Comparaison à la CLAUSE SAISIE, jamais un jugement de validité ; jamais un refus. */
  result: 'meets_clause' | 'below_clause';
}

// ─── Échéances (§ 2.4) ──────────────────────────────────────────────────────

/** Bornes facturables : début du contrat, `billableUntil` de `contractTerms`. */
export interface BillingBounds {
  startDate: ContractDay;
  endDate: ContractDay | null;
}

export interface BillingOccurrence {
  /** Clé stable : la date (`AAAA-MM-JJ`) d'un abonnement, `item:<itemRef>` d'un échéancier. */
  key: string;
  kind: 'schedule_item' | 'subscription_occurrence';
  date: ContractDay;
  itemRef: string | null;
  /** Rang de l'occurrence dans la récurrence (0 = date d'ancrage) ; `null` pour un échéancier. */
  rank: number | null;
  /**
   * LIBELLÉ de période d'un abonnement (§ 2.4) : celle qui commence à l'échéance
   * (`in_advance`) ou qui s'y termine (`in_arrears`). Aucun montant n'en dépend.
   */
  periodStart: ContractDay | null;
  periodEnd: ContractDay | null;
  /** La période libellée déborde des bornes facturables (constat ; aucun prorata). */
  periodExceedsBounds: boolean;
}

export interface ExcludedScheduleItem {
  itemRef: string;
  date: ContractDay;
  reason: 'BEFORE_START' | 'AFTER_END';
}

export interface BillingOccurrencesResult {
  version: string;
  occurrences: BillingOccurrence[];
  /** Échéances d'un échéancier, dans la fenêtre, mais hors des bornes facturables. */
  excluded: ExcludedScheduleItem[];
}

export const OCCURRENCE_BLOCK_REASONS = [
  'CUSTOMER_ARCHIVED',
  'COMPUTATION_ERROR',
  'RENEWAL_NOT_RECORDED',
  'TERMINATED',
  'AMENDMENT_PENDING',
] as const;
export type OccurrenceBlockReason = (typeof OCCURRENCE_BLOCK_REASONS)[number];

/**
 * Blocage : sur une occurrence (`key`), à partir d'une date (`fromDate`, incluse),
 * ou sur toutes (ni l'un ni l'autre).
 */
export interface OccurrenceBlock {
  reason: OccurrenceBlockReason;
  key?: string | null;
  fromDate?: ContractDay | null;
}

/** Lien `sales_document_links` lu : un lien orphelin (brouillon supprimé) est ignoré. */
export interface OccurrenceLink {
  key: string;
  invoiceId: string;
  orphan?: boolean;
}

export type OccurrenceState = 'prepared' | 'to_prepare' | 'upcoming' | 'blocked';

export interface OccurrenceStatusEntry {
  key: string;
  date: ContractDay;
  state: OccurrenceState;
  invoiceId: string | null;
  /** Motifs de blocage, triés (vide sauf `blocked`). */
  reasons: OccurrenceBlockReason[];
}

export interface OccurrenceStatusOptions {
  today: ContractDay;
  /** Préparation N jours avant l'échéance (0 à 30 ; défaut 0). */
  leadDays?: number;
}

export interface OccurrenceStatusResult {
  version: string;
  entries: OccurrenceStatusEntry[];
  /** Liens vivants dont la clé ne correspond à aucune occurrence fournie. */
  unknownLinks: string[];
  /** Clés portant plusieurs liens vivants (l'index unique devrait l'empêcher). */
  duplicateLinks: string[];
}

// ─── Reste à facturer d'une commande (§ 2.2, § 7) ────────────────────────────

export interface OrderLineInput {
  lineRef: string;
  catalogItemId: string | null;
  /** Prix unitaire figé de la commande (mode de prix du document). */
  unitPrice: ContractAmount;
  quantity: ContractQuantity;
}

export interface LinkedInvoiceLine {
  index: number;
  catalogItemId: string | null;
  unitPrice: ContractAmount;
  quantity: ContractQuantity;
}

export interface LinkedInvoiceInput {
  invoiceId: string;
  /** `draft` = brouillon en cours ; `issued` = émise ou normalisée (figée). */
  state: 'draft' | 'issued';
  lines: readonly LinkedInvoiceLine[];
  lineMap: readonly { invoiceLineIndex: number; lineRef: string; quantity: ContractQuantity }[];
}

export type OrderInvoicingIssueCode =
  /** Article ou prix unitaire différent de la ligne de commande : rien n'est compté. */
  | 'UNMATCHED_LINE'
  /** `invoiceLineIndex` absent de la facture. */
  | 'MISSING_INVOICE_LINE'
  /** `lineRef` inconnu de la commande. */
  | 'UNKNOWN_LINE_REF'
  /** Une même ligne de facture rattachée deux fois : comptée une seule fois. */
  | 'DUPLICATE_MAPPING'
  /** Facturé au-delà de la quantité commandée (le reste reste à zéro). */
  | 'OVER_INVOICED';

export interface OrderInvoicingIssue {
  code: OrderInvoicingIssueCode;
  invoiceId: string | null;
  lineRef: string | null;
  invoiceLineIndex: number | null;
}

export interface OrderInvoicingLine {
  lineRef: string;
  ordered: ContractQuantity;
  /** Quantité des factures émises. */
  invoiced: ContractQuantity;
  /** Quantité des brouillons en cours. */
  inDraft: ContractQuantity;
  /** Commandé − émis, jamais négatif. */
  remainingToInvoice: ContractQuantity;
  /** Commandé − émis − brouillons, jamais négatif : ce que propose une nouvelle préparation. */
  remainingToPrepare: ContractQuantity;
  /** Émis au-delà du commandé (0 sinon). */
  overInvoiced: ContractQuantity;
}

export interface OrderInvoicingResult {
  version: string;
  status: 'not_invoiced' | 'partially_invoiced' | 'invoiced';
  /** Tout est facturé : « Clore » est proposé (jamais appliqué). */
  closeSuggested: boolean;
  lines: OrderInvoicingLine[];
  issues: OrderInvoicingIssue[];
}

// ─── Acomptes (§ 5.1, § 5.2) ─────────────────────────────────────────────────

export interface DepositInvoiceInput {
  invoiceId: string;
  currency: ContractCurrency;
  state: 'draft' | 'issued';
  /** Total TTC du document, calculé par le moteur des factures (figé si émise). */
  total: ContractAmount;
  /** Somme lettrée par les encaissements (lecture), 0 pour un brouillon. */
  paid: ContractAmount;
  /** Montant demandé posé sur le lien, dans la devise du document. */
  requestedAmount: ContractAmount | null;
}

export interface FinalInvoiceInput {
  invoiceId: string;
  state: 'draft' | 'issued';
}

export interface DepositLine {
  invoiceId: string;
  currency: ContractCurrency;
  state: 'draft' | 'issued';
  total: ContractAmount;
  paid: ContractAmount;
  requestedAmount: ContractAmount | null;
  /** Total − demandé (signé) : écart SIGNALÉ, jamais corrigé ; `null` sans montant demandé. */
  gapToRequested: string | null;
  resolved: boolean;
}

export interface DepositCurrencyTotals {
  currency: ContractCurrency;
  requested: ContractAmount;
  /** Σ des totaux des acomptes émis. */
  invoiced: ContractAmount;
  /** Σ des totaux des brouillons d'acompte. */
  inDraft: ContractAmount;
  /** Σ encaissé sur les acomptes émis. */
  paid: ContractAmount;
}

export interface DepositSummaryResult {
  version: string;
  deposits: DepositLine[];
  /** Par devise, triées ; aucune somme entre devises. */
  byCurrency: DepositCurrencyTotals[];
  /** `DEPOSIT_NOT_RESOLVED` : acomptes émis non « traités » alors qu'une facture finale existe. */
  unresolved: string[];
  issues: { code: 'DEPOSIT_NOT_RESOLVED'; invoiceIds: string[] }[];
}

// ─── Alertes « Mes tâches » (§ 6) ────────────────────────────────────────────

export interface ContractAlertSettings {
  /** 0 à 365 (défaut 30). */
  noticeAlertDays: number;
  /** 0 à 365 (défaut 60). */
  termEndAlertDays: number;
}

export const DEFAULT_CONTRACT_ALERT_SETTINGS: Readonly<ContractAlertSettings> = {
  noticeAlertDays: 30,
  termEndAlertDays: 60,
};

/** Délai après approbation d'un avenant au-delà duquel la copie signée manquante est signalée. */
export const SIGNED_COPY_MISSING_DAYS = 15;

export interface AlertAmendmentInput {
  id: string;
  index: number;
  status: AmendmentStatus;
  submittedOn: ContractDay | null;
  submittedBy: string | null;
  approvedOn: ContractDay | null;
  hasSignedCopy: boolean;
}

export interface AlertContractInput {
  id: string;
  ownerUserId: string;
  status: ContractStoredStatus;
  submittedOn: ContractDay | null;
  submittedBy: string | null;
  startDate: ContractDay;
  /** Conditions EN VIGUEUR (résultat de `termsAt`), pour la durée, la reconduction et le préavis. */
  initialTermMonths: number | null;
  renewal: RenewalClause;
  noticeDays: number;
  renewals: readonly RecordedRenewal[];
  termination: TerminationInput | null;
  amendments: readonly AlertAmendmentInput[];
  /** Brouillons d'échéance préparés et non émis (dates d'échéance). */
  draftOccurrenceDates: readonly ContractDay[];
  /** Échéances bloquées (résultat de `occurrenceStatus`). */
  blockedOccurrences: readonly { key: string; date: ContractDay; reasons: readonly string[] }[];
}

export type ContractAlertKind =
  | 'contract_to_approve'
  | 'amendment_to_approve'
  | 'notice_deadline'
  | 'term_end'
  | 'renewal_to_record'
  | 'signed_copy_missing'
  | 'subscription_drafts_to_issue'
  | 'occurrence_blocked';

/**
 * Destinataires, résolus par l'appelant sur les droits EFFECTIFS (ADR-0041) :
 * `approvers` = détenteurs de `sales.contract.approve` (moins `excludeUserId`,
 * sauf approbateur unique) ; `owner` = responsable ; `invoicers` = détenteurs de
 * `sales.invoice`.
 */
export interface ContractAlert {
  /** Identifiant stable, préfixé `sct:`. */
  id: string;
  kind: ContractAlertKind;
  contractId: string | null;
  amendmentId: string | null;
  audience: 'approvers' | 'owner' | 'invoicers';
  ownerUserId: string | null;
  excludeUserId: string | null;
  /** Échéance affichée. */
  dueDate: ContractDay | null;
  /** Début de la fenêtre d'affichage (`null` = dès maintenant). */
  visibleFrom: ContractDay | null;
  /** Nombre agrégé (brouillons à émettre), 1 sinon. */
  count: number;
  reasons: string[];
}

export interface ContractAlertsResult {
  version: string;
  today: ContractDay;
  alerts: ContractAlert[];
}
