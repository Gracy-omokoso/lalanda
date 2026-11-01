// Constantes des commandes clients, contrats, avenants, acomptes et abonnements
// (ADR-0050 §§ 1 à 9). ADR-0050 — V0.
//
// Libellé d'interface ↔ code (ADR-0050 § 1) : « Commande client » = `sales_orders`,
// « Contrat » = `sales_contracts`, « Version » = `previousVersions`, « Avenant » =
// `sales_contract_amendments`, « Conditions en vigueur » = `termsAt` (moteur), « Terme » =
// période contractuelle en cours, « Échéance » = occurrence de facturation, « Abonnement » =
// `billing.kind = 'recurring'`, « Facture d'acompte » = facture `FT`/`ET` existante reliée,
// « Copie signée » = `sales_contract_files`.
//
// Ce fichier ne contient que des unions fermées, des bornes, des valeurs par défaut, des
// codes et des textes d'avertissement : AUCUNE règle fiscale ni juridique (§ 10). Les
// clauses de durée, de reconduction et de préavis sont SAISIES par l'utilisateur ; Lalanda
// calcule des dates (`@lalanda/engine`, module `contracts`, lot V1) sans en juger la
// validité. Aucun montant n'est calculé ici : les totaux viennent du moteur `invoice-totals`.

// ── Commandes clients (§ 2.2) ───────────────────────────────────────────────

/** Statut STOCKÉ d'une commande client. Contenu modifiable en `draft` seulement. */
export const SALES_ORDER_STATUSES = ['draft', 'confirmed', 'closed', 'cancelled'] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

/** État de facturation DÉRIVÉ par le moteur (`orderInvoicing`, § 7), jamais stocké. */
export const SALES_ORDER_INVOICING_STATUSES = [
  'not_invoiced',
  'partially_invoiced',
  'invoiced',
] as const;
export type SalesOrderInvoicingStatus = (typeof SALES_ORDER_INVOICING_STATUSES)[number];

/** Origine d'une commande (§ 2.2) ; `null` pour une commande saisie sans devis. */
export const SALES_ORDER_SOURCE_KINDS = ['quote', 'contract'] as const;
export type SalesOrderSourceKind = (typeof SALES_ORDER_SOURCE_KINDS)[number];

// ── Contrats (§ 2.3) ────────────────────────────────────────────────────────

/** Statut STOCKÉ d'un contrat (cycle du § 2.3). */
export const SALES_CONTRACT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'signed',
  'terminated',
  'cancelled',
] as const;
export type SalesContractStatus = (typeof SALES_CONTRACT_STATUSES)[number];

/**
 * Statut DÉRIVÉ à la lecture d'un contrat `signed` (`contractTerms`, § 7) : début futur,
 * en vigueur, fin de terme proche (`termEndAlertDays`), terme échu sans reconduction
 * constatée ni à constater.
 */
export const SALES_CONTRACT_DERIVED_STATUSES = [
  'upcoming',
  'in_force',
  'expiring',
  'ended',
] as const;
export type SalesContractDerivedStatus = (typeof SALES_CONTRACT_DERIVED_STATUSES)[number];

/** Avenant : même cycle que le contrat, sans « Résilier » (§ 2.5). */
export const SALES_CONTRACT_AMENDMENT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'signed',
  'cancelled',
] as const;
export type SalesContractAmendmentStatus = (typeof SALES_CONTRACT_AMENDMENT_STATUSES)[number];

/** Objet d'un avenant : modification, ou renouvellement exprès (§ 5.3). */
export const SALES_CONTRACT_AMENDMENT_PURPOSES = ['change', 'renewal'] as const;
export type SalesContractAmendmentPurpose = (typeof SALES_CONTRACT_AMENDMENT_PURPOSES)[number];

/** Origine d'un contrat (§ 2.3) ; `null` pour un contrat saisi sans devis. */
export const SALES_CONTRACT_SOURCE_KINDS = ['quote'] as const;
export type SalesContractSourceKind = (typeof SALES_CONTRACT_SOURCE_KINDS)[number];

/**
 * Mode de reconduction — **clause saisie** (§ 2.3, O7). `tacit` : le moteur propose le
 * terme suivant, un humain le CONSTATE (décision ouverte n° 9) ; `explicit` : le
 * renouvellement est un avenant `purpose: 'renewal'` ; `none` : le contrat finit au terme.
 */
export const SALES_CONTRACT_RENEWAL_MODES = ['none', 'tacit', 'explicit'] as const;
export type SalesContractRenewalMode = (typeof SALES_CONTRACT_RENEWAL_MODES)[number];

/** Nature d'une reconduction enregistrée (`renewals[]`, ajout seul). */
export const SALES_CONTRACT_RENEWAL_RECORD_MODES = [
  'tacit_recorded',
  'explicit_amendment',
] as const;
export type SalesContractRenewalRecordMode = (typeof SALES_CONTRACT_RENEWAL_RECORD_MODES)[number];

/** Décision d'approbation interne (`approvals[]`, motif ADR-0044). */
export const SALES_CONTRACT_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type SalesContractApprovalDecision = (typeof SALES_CONTRACT_APPROVAL_DECISIONS)[number];

/** Côté d'un signataire déclaré ; au moins un de chaque côté (§ 2.3). */
export const SALES_CONTRACT_SIGNATORY_SIDES = ['customer', 'organization'] as const;
export type SalesContractSignatorySide = (typeof SALES_CONTRACT_SIGNATORY_SIDES)[number];

/** Partie qui notifie la résiliation (§ 2.3). */
export const SALES_CONTRACT_TERMINATION_PARTIES = ['customer', 'organization'] as const;
export type SalesContractTerminationParty = (typeof SALES_CONTRACT_TERMINATION_PARTIES)[number];

/**
 * Comparaison d'une résiliation au préavis **saisi** (`noticeCheck`, § 7). Elle n'est
 * jamais un refus : la validité juridique n'est pas jugée par Lalanda (critère 14).
 */
export const SALES_CONTRACT_NOTICE_CHECKS = ['meets_clause', 'below_clause'] as const;
export type SalesContractNoticeCheck = (typeof SALES_CONTRACT_NOTICE_CHECKS)[number];

/**
 * Libellés d'écran de `noticeCheck`. Le § 2.3 écrit « conforme à la clause saisie » ; le
 * critère 18 interdit le mot « conforme » à l'écran : la formulation ci-dessous dit la même
 * comparaison sans lui (écart d'écriture, aucun écart de règle).
 */
export const SALES_CONTRACT_NOTICE_CHECK_LABELS: Readonly<
  Record<SalesContractNoticeCheck, string>
> = Object.freeze({
  meets_clause: 'Préavis au moins égal à la clause saisie',
  below_clause: 'Préavis en deçà de la clause saisie',
});

// ── Échéancier (§ 2.4) ──────────────────────────────────────────────────────

/** `none` : contrat-cadre ; `schedule` : dates fixes ; `recurring` : abonnement. */
export const SALES_CONTRACT_BILLING_KINDS = ['none', 'schedule', 'recurring'] as const;
export type SalesContractBillingKind = (typeof SALES_CONTRACT_BILLING_KINDS)[number];

/** Fréquences d'un abonnement ; occurrences par `occurrencesOf` (ADR-0034 § 3). */
export const SALES_CONTRACT_BILLING_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const;
export type SalesContractBillingFrequency = (typeof SALES_CONTRACT_BILLING_FREQUENCIES)[number];

/** Ne change que le LIBELLÉ de période porté par le brouillon, jamais un montant. */
export const SALES_CONTRACT_BILLING_TIMINGS = ['in_advance', 'in_arrears'] as const;
export type SalesContractBillingTiming = (typeof SALES_CONTRACT_BILLING_TIMINGS)[number];

/** État d'une échéance (`occurrenceStatus`, § 7 ; `GET …/schedule`). */
export const SALES_CONTRACT_OCCURRENCE_STATUSES = [
  'prepared',
  'to_prepare',
  'upcoming',
  'blocked',
] as const;
export type SalesContractOccurrenceStatus = (typeof SALES_CONTRACT_OCCURRENCE_STATUSES)[number];

/** Motifs d'une échéance bloquée : aucun brouillon, motif affiché (§ 5.3). */
export const SALES_CONTRACT_OCCURRENCE_BLOCKS = [
  'CUSTOMER_ARCHIVED',
  'CALCULATION_ERROR',
  'RENEWAL_NOT_RECORDED',
  'CONTRACT_TERMINATED',
  'AMENDMENT_PENDING',
] as const;
export type SalesContractOccurrenceBlock = (typeof SALES_CONTRACT_OCCURRENCE_BLOCKS)[number];

// ── Pièces et liens (§§ 2.6, 2.7) ───────────────────────────────────────────

/** Nature d'une pièce téléversée ; PDF seul, téléchargement inerte. */
export const SALES_CONTRACT_FILE_KINDS = ['draft_copy', 'signed_copy', 'customer_order'] as const;
export type SalesContractFileKind = (typeof SALES_CONTRACT_FILE_KINDS)[number];

/** Seul type de pièce admis (§ 2.6). */
export const SALES_CONTRACT_FILE_MIME_TYPE = 'application/pdf';

/** Nature d'un lien facture ↔ engagement (`sales_document_links`). */
export const SALES_DOCUMENT_LINK_KINDS = [
  'order_invoice',
  'order_deposit',
  'contract_invoice',
  'contract_deposit',
  'schedule_item',
  'subscription_occurrence',
] as const;
export type SalesDocumentLinkKind = (typeof SALES_DOCUMENT_LINK_KINDS)[number];

/** Types e-DEF d'une facture d'acompte préparée depuis un engagement (O4, § 5.1). */
export const SALES_DEPOSIT_INVOICE_TYPES = ['FT', 'ET'] as const;
export type SalesDepositInvoiceType = (typeof SALES_DEPOSIT_INVOICE_TYPES)[number];

/** Types e-DEF d'une facture finale, d'échéance ou d'abonnement (§ 4.3). */
export const SALES_ENGAGEMENT_INVOICE_TYPES = ['FV', 'EV'] as const;
export type SalesEngagementInvoiceType = (typeof SALES_ENGAGEMENT_INVOICE_TYPES)[number];

// ── Numérotation (§§ 2.2, 2.3, 2.5 ; décision ouverte n° 21) ────────────────

/** Préfixes des pièces internes, hors série fiscale, trous admis (ADR-0027). */
export const SALES_ORDER_NUMBER_PREFIX = 'CC';
export const SALES_CONTRACT_NUMBER_PREFIX = 'CT';

/** `CC{AA}{MM}-NNNNNN`. */
export const SALES_ORDER_NUMBER_PATTERN = /^CC\d{4}-\d{6}$/;
/** `CT{AA}{MM}-NNNNNN`. */
export const SALES_CONTRACT_NUMBER_PATTERN = /^CT\d{4}-\d{6}$/;
/** Numéro affiché d'un avenant : `CT{AA}{MM}-NNNNNN-A{index}`. */
export const SALES_CONTRACT_AMENDMENT_NUMBER_PATTERN = /^CT\d{4}-\d{6}-A[1-9]\d*$/;

// ── Bornes (§§ 2 à 5) ───────────────────────────────────────────────────────

export const SALES_CONTRACT_LIMITS = Object.freeze({
  titleMax: 200,
  notesMax: 1000,
  clausesMax: 4000,
  customerReferenceMax: 60,
  reasonMax: 500,
  commentMax: 1000,
  labelMax: 200,
  signatoryNameMax: 120,
  signatoryTitleMax: 120,
  signatoriesMax: 10,
  initialTermMonthsMin: 1,
  initialTermMonthsMax: 120,
  renewalPeriodMonthsMin: 1,
  renewalPeriodMonthsMax: 60,
  maxRenewalsMax: 100,
  noticeDaysMin: 0,
  noticeDaysMax: 365,
  scheduleItemsMin: 1,
  scheduleItemsMax: 60,
  alertDaysMax: 365,
  subscriptionLeadDaysMax: 30,
  /** Fenêtre de rattrapage de la tâche quotidienne (§ 5.3). */
  catchUpDays: 90,
  /** Alerte « copie signée manquante » d'un avenant approuvé (§ 6). */
  missingSignedCopyAlertDays: 15,
  /** Pièce PDF : 10 Mio (motif ADR-0039 § 2.5). */
  fileMaxBytes: 10 * 1024 * 1024,
  fileNameMax: 200,
});

// ── Réglages (§ 2.1 ; décisions ouvertes n° 7 et 10) ────────────────────────

export interface SalesContractSettingsValues {
  readonly noticeAlertDays: number;
  readonly termEndAlertDays: number;
  readonly subscriptionLeadDays: number;
  readonly autoPrepareSubscriptionDrafts: boolean;
  readonly allowSoleApprover: boolean;
}

/** Défaut implicite d'une organisation sans réglage enregistré. */
export const SALES_CONTRACT_SETTINGS_DEFAULTS: SalesContractSettingsValues = Object.freeze({
  noticeAlertDays: 30,
  termEndAlertDays: 60,
  subscriptionLeadDays: 0,
  autoPrepareSubscriptionDrafts: true,
  allowSoleApprover: true,
});

// ── Acteur système, tâche, agenda (§§ 5.3, 6) ───────────────────────────────

/** `createdBy` des brouillons préparés par la tâche (journalisé ; jamais émetteur). */
export const SALES_SUBSCRIPTIONS_SYSTEM_ACTOR = 'system:subscriptions';

/** Nom de la tâche quotidienne de l'ordonnanceur (ADR-0020). */
export const SALES_SUBSCRIPTIONS_JOB_NAME = 'sales.subscriptions.prepare';

/** Préfixe des identifiants d'éléments de « Mes tâches » (`source: 'sales_contracts'`). */
export const SALES_CONTRACTS_MY_TASK_PREFIX = 'sct:';

// ── Codes d'erreur et d'avertissement ───────────────────────────────────────

/** Codes métier des réponses d'erreur du module (§§ 2 à 5, critères d'acceptation). */
export const SALES_CONTRACT_ERROR_CODES = [
  'STALE_REVISION',
  'SELF_APPROVAL_FORBIDDEN',
  'ORDER_EXISTS_FOR_QUOTE',
  'ORDER_NOT_DRAFT',
  'ORDER_NOT_CONFIRMED',
  'ORDER_HAS_ISSUED_INVOICE',
  'CONTRACT_NOT_DRAFT',
  'CONTRACT_NOT_SUBMITTED',
  'CONTRACT_NOT_APPROVED',
  'CONTRACT_NOT_SIGNED',
  'CONTRACT_ALREADY_SUBMITTED',
  'AMENDMENT_NOT_DRAFT',
  'AMENDMENT_BEFORE_PREPARED_OCCURRENCE',
  'AMENDMENT_BEFORE_CONTRACT_START',
  'SIGNED_COPY_REQUIRED',
  'SIGNATORIES_REQUIRED',
  'FILE_NOT_PDF',
  'FILE_TOO_LARGE',
  'QUOTE_NOT_ACCEPTED',
  'CUSTOMER_REQUIRED',
  'OWNER_WITHOUT_SALES_READ',
  'RENEWAL_NOT_PROPOSED',
  'OCCURRENCE_ALREADY_PREPARED',
  'OCCURRENCE_BLOCKED',
  'TAX_GROUP_REQUIRED',
] as const;
export type SalesContractErrorCode = (typeof SALES_CONTRACT_ERROR_CODES)[number];

/** Avertissements (réponse `{ …, warnings }`), jamais des refus. */
export const SALES_CONTRACT_WARNING_CODES = [
  'QUOTE_ALREADY_CONVERTED',
  'UNMATCHED_LINE',
  'DEPOSIT_NOT_RESOLVED',
  'DEPOSIT_AMOUNT_MISMATCH',
  'COMMENT_TRUNCATED',
  'NOTICE_BELOW_CLAUSE',
] as const;
export type SalesContractWarningCode = (typeof SALES_CONTRACT_WARNING_CODES)[number];

// ── Textes constants (§§ 5.2, 9) et mots interdits (critère 18) ─────────────

/** Bandeau constant de la fiche contrat (§ 9). */
export const SALES_CONTRACT_CLAUSES_BANNER =
  'Les clauses de durée, de reconduction et de préavis sont celles que vous avez saisies. ' +
  'Lalanda calcule les dates ; il ne vérifie pas leur validité juridique.';

/** Avertissement affiché à côté d'une facture finale d'un engagement avec acompte (§ 5.2). */
export const SALES_DEPOSIT_FINAL_INVOICE_WARNING =
  'Comment la facture finale tient compte de l’acompte est à confirmer avec votre ' +
  'expert-comptable. Lalanda ne retire rien automatiquement.';

/**
 * Expressions qu'aucun écran, export ni réponse ne doit porter (critère 18) : Lalanda ne
 * juge ni la conformité ni la validité juridique d'un contrat, et ne reconduit rien seul.
 */
export const SALES_CONTRACT_FORBIDDEN_WORDS = [
  'conforme',
  'valable juridiquement',
  'reconduit automatiquement',
] as const;

/**
 * Expressions interdites trouvées dans un texte (casse et accents de la casse ignorés),
 * dans l'ordre de `SALES_CONTRACT_FORBIDDEN_WORDS`. « non conforme » et « conformité »
 * comptent aussi : la règle porte sur le jugement, pas sur l'adjectif seul.
 */
export function findForbiddenSalesContractWords(text: string): string[] {
  const lower = text.toLocaleLowerCase('fr');
  return SALES_CONTRACT_FORBIDDEN_WORDS.filter((w) =>
    w === 'conforme' ? /conform/.test(lower) : lower.includes(w),
  );
}
