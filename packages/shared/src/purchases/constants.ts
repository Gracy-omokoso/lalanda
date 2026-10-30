// Constantes des achats et fournisseurs (ADR-0044 § 1 et § 2). ADR-0044 — P0.
//
// Libellé d'interface ↔ code (ADR-0044 § 1) : « Fournisseur » = `Supplier`,
// « Demande d'achat » puis « Bon de commande » = `PurchaseOrder` (`phase`),
// « Réception » = `PurchaseReception` (jamais `receipt`, déjà pris par les
// encaissements), « Facture fournisseur » = `SupplierInvoice`, « Paiement
// fournisseur » = `SupplierPayment`, « Reste à payer » = `remaining` (calculé).
//
// Ce fichier ne contient que des unions fermées, des bornes, des valeurs par défaut
// et des codes : aucune règle financière ni fiscale (ADR-0044 § 9). Les calculs
// (totaux, paliers, rapprochement, échéances) appartiennent au moteur
// `@lalanda/engine` (`purchases`, lot P1).

/** Devises des achats : celles de la trésorerie (ADR-0044 § 1). Jamais de conversion. */
export const PURCHASE_CURRENCIES = ['CDF', 'USD'] as const;
export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];

// ── Fournisseurs (§ 2.1) ────────────────────────────────────────────────────

/** Nature d'un fournisseur (informatif). */
export const SUPPLIER_KINDS = ['company', 'individual'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

/** Conditions de paiement ; l'échéance en est déduite par le moteur (`dueDateOf`). */
export const SUPPLIER_PAYMENT_TERMS_KINDS = ['immediate', 'net', 'end_of_month'] as const;
export type SupplierPaymentTermsKind = (typeof SUPPLIER_PAYMENT_TERMS_KINDS)[number];

/** Moyen de paiement d'un fournisseur (coordonnées chiffrées, § 2.1.1). */
export const SUPPLIER_PAYMENT_METHOD_KINDS = ['bank', 'mobile_money'] as const;
export type SupplierPaymentMethodKind = (typeof SUPPLIER_PAYMENT_METHOD_KINDS)[number];

// ── Demandes et commandes (§ 2.3) ───────────────────────────────────────────

/** Un seul document, deux phases (O1) : il naît demande, devient bon de commande. */
export const PURCHASE_ORDER_PHASES = ['request', 'order'] as const;
export type PurchaseOrderPhase = (typeof PURCHASE_ORDER_PHASES)[number];

/**
 * Statuts, dans l'ordre du cycle de vie. Demande : `draft` → `submitted` →
 * `approved` | `rejected` ; commande : `approved` → `sent` → `partially_received` →
 * `received` → `closed` ; `cancelled` avant `received`. `partially_received` et
 * `received` sont DÉRIVÉS des réceptions par le moteur.
 */
export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** Nature d'une ligne : un bien se réceptionne par défaut, un service non. */
export const PURCHASE_LINE_KINDS = ['goods', 'service'] as const;
export type PurchaseLineKind = (typeof PURCHASE_LINE_KINDS)[number];

/** Décision portée par une approbation (`purchase_orders.approvals`). */
export const PURCHASE_APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type PurchaseApprovalDecisionValue = (typeof PURCHASE_APPROVAL_DECISIONS)[number];

/** Nombre d'approbations distinctes qu'un palier peut exiger (O4). */
export const PURCHASE_APPROVAL_COUNTS = [0, 1, 2] as const;
export type PurchaseApprovalCount = (typeof PURCHASE_APPROVAL_COUNTS)[number];

/** Transmission du bon de commande au fournisseur (§ 3.3). */
export const PURCHASE_ORDER_SENT_VIA = ['email', 'manual'] as const;
export type PurchaseOrderSentVia = (typeof PURCHASE_ORDER_SENT_VIA)[number];

/** Filtre « les miennes » (`requestedBy=me`) de la liste des demandes (§ 3.2). */
export const PURCHASE_REQUESTED_BY_ME = 'me' as const;

// ── Réceptions (§ 2.4) ──────────────────────────────────────────────────────

export const PURCHASE_RECEPTION_STATUSES = ['recorded', 'cancelled'] as const;
export type PurchaseReceptionStatus = (typeof PURCHASE_RECEPTION_STATUSES)[number];

// ── Factures fournisseurs (§ 2.5) et rapprochement (§ 5) ────────────────────

/** Un avoir fournisseur diminue la dette. */
export const SUPPLIER_INVOICE_KINDS = ['invoice', 'credit_note'] as const;
export type SupplierInvoiceKind = (typeof SUPPLIER_INVOICE_KINDS)[number];

/** Statuts stockés ; « payée » est DÉRIVÉE des paiements, jamais stockée. */
export const SUPPLIER_INVOICE_STATUSES = ['draft', 'validated', 'cancelled'] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];

/** Mode de rapprochement : le plus exigeant des lignes de la facture (§ 5.1). */
export const PURCHASE_MATCHING_MODES = ['none', 'two_way', 'three_way'] as const;
export type PurchaseMatchingMode = (typeof PURCHASE_MATCHING_MODES)[number];

export const PURCHASE_MATCHING_STATUSES = ['not_applicable', 'matched', 'variance'] as const;
export type PurchaseMatchingStatus = (typeof PURCHASE_MATCHING_STATUSES)[number];

/** Écarts BLOQUANTS (§ 5.2) : une facture qui en porte n'est validée que forcée. */
export const PURCHASE_BLOCKING_VARIANCE_CODES = [
  'PRICE_ABOVE_ORDER',
  'QUANTITY_ABOVE_ORDER',
  'QUANTITY_ABOVE_RECEIVED',
  'LINE_NOT_ON_ORDER',
  'TOTAL_ABOVE_ORDER',
] as const;

/**
 * Écarts d'INFORMATION nommés par l'ADR (§ 5.2) : affichés, jamais bloquants ; aucun
 * contrôle fiscal. Un prix ou une quantité INFÉRIEURS sont aussi rendus en information
 * (facture partielle) ; l'ADR ne leur donne pas de code, le moteur (P1) le fixera.
 */
export const PURCHASE_INFO_VARIANCE_CODES = [
  'TAXES_DIFFER_FROM_ORDER',
  'RECEIVED_OVER_ORDERED',
] as const;

export const PURCHASE_VARIANCE_CODES = [
  ...PURCHASE_BLOCKING_VARIANCE_CODES,
  ...PURCHASE_INFO_VARIANCE_CODES,
] as const;
export type PurchaseVarianceCode = (typeof PURCHASE_VARIANCE_CODES)[number];

/** Règlement d'une facture, dérivé par le moteur (`payableSettlement`). */
export const PAYABLE_SETTLEMENT_STATUSES = ['unpaid', 'partially_paid', 'paid'] as const;
export type PayableSettlementStatus = (typeof PAYABLE_SETTLEMENT_STATUSES)[number];

// ── Paiements fournisseurs (§ 2.6) ──────────────────────────────────────────

/** Moyen utilisé pour payer (distinct des coordonnées du fournisseur). */
export const SUPPLIER_PAYMENT_CHANNELS = [
  'bank_transfer',
  'mobile_money',
  'cash',
  'cheque',
  'other',
] as const;
export type SupplierPaymentChannel = (typeof SUPPLIER_PAYMENT_CHANNELS)[number];

/** Saisi dans les achats, ou dépense directe existante rattachée (O3). */
export const SUPPLIER_PAYMENT_ORIGINS = ['recorded', 'linked_expense'] as const;
export type SupplierPaymentOrigin = (typeof SUPPLIER_PAYMENT_ORIGINS)[number];

export const SUPPLIER_PAYMENT_STATUSES = ['recorded', 'cancelled'] as const;
export type SupplierPaymentStatus = (typeof SUPPLIER_PAYMENT_STATUSES)[number];

// ── Numérotation (§ 2.3 à § 2.6) ────────────────────────────────────────────

/**
 * Préfixes des pièces internes, format `{P}{AA}{MM}-NNNNNN` (motif d'ADR-0035) :
 * compteurs annuels au jour de Kinshasa, trous admis, HORS série fiscale.
 */
export const PURCHASE_NUMBER_PREFIXES = Object.freeze({
  request: 'DA',
  order: 'BC',
  invoice: 'FF',
  payment: 'PF',
} as const);
export type PurchaseNumberKind = keyof typeof PURCHASE_NUMBER_PREFIXES;

/** `DA2610-000001`, `BC2611-000042`… */
export const PURCHASE_NUMBER_PATTERN = /^(DA|BC|FF|PF)\d{2}(0[1-9]|1[0-2])-\d{6}$/;

// ── Réglages (§ 2.2) : valeurs par défaut des décisions ouvertes n° 3, 6 et 9 ─

/**
 * Valeurs par défaut de `purchase_settings`, appliquées tant que la dirigeante ne
 * tranche pas autrement : une approbation pour toute commande dans chaque devise
 * (aucun montant fixé par Lalanda), approbateur unique permis, tolérances nulles,
 * « bientôt » à 7 jours, facture sans commande permise, alerte de coordonnées 7 jours.
 */
export const PURCHASE_SETTINGS_DEFAULTS = Object.freeze({
  approvalTiers: Object.freeze({
    CDF: Object.freeze([Object.freeze({ from: '0', approvals: 1 as PurchaseApprovalCount })]),
    USD: Object.freeze([Object.freeze({ from: '0', approvals: 1 as PurchaseApprovalCount })]),
  }),
  allowSoleApprover: true,
  matchingTolerances: Object.freeze({
    pricePercent: '0',
    amountAbsolute: Object.freeze({ CDF: '0', USD: '0' }),
  }),
  dueSoonDays: 7,
  requireOrderForInvoice: false,
  paymentDetailsAlertDays: 7,
});

// ── Bornes techniques (§ 2) ─────────────────────────────────────────────────

export const PURCHASE_LIMITS = Object.freeze({
  // Fournisseur (§ 2.1) ; coordonnées : bornes de la fiche client.
  supplierName: 200,
  rccm: 64,
  nationalId: 64,
  address: 255,
  phone: 30,
  email: 254,
  website: 255,
  notes: 5_000,
  contactsMax: 10,
  contactName: 120,
  contactRole: 80,
  paymentMethodsMax: 5,
  paymentMethodLabel: 60,
  paymentTermsDaysMax: 180,
  netDaysMin: 1,
  search: 100,
  // Coordonnées en clair, à l'écriture seulement (§ 2.1.1) — forme seulement.
  bankName: 120,
  accountHolder: 120,
  accountNumber: 40,
  iban: 34,
  swift: 11,
  mobileOperator: 60,
  holderName: 120,
  // Demandes et commandes (§ 2.3).
  title: 200,
  justification: 2_000,
  linesMax: 100,
  lineLabel: 200,
  lineUnit: 20,
  itemRef: 100,
  declaredTaxesMax: 5,
  taxLabel: 60,
  deliveryAddress: 500,
  approvalComment: 2_000,
  cancellationReason: 1_000,
  // Réceptions (§ 2.4).
  deliveryNoteRef: 100,
  receptionNote: 1_000,
  // Factures (§ 2.5).
  supplierReference: 100,
  invoiceOrdersMax: 10,
  costAllocationsMax: 20,
  // Paiements (§ 2.6).
  paymentReference: 100,
  paymentAllocationsMax: 50,
  // Réglages (§ 2.2).
  tiersMaxPerCurrency: 10,
  pricePercentMax: 10,
  dueSoonDaysMin: 1,
  dueSoonDaysMax: 30,
  paymentDetailsAlertDaysMax: 30,
});

/** Pagination par curseur des listes (motif de `time-cursor.ts`). */
export const PURCHASE_PAGE_LIMIT_DEFAULT = 50;
export const PURCHASE_PAGE_LIMIT_MAX = 100;

/** Motif de téléphone de la fiche client (`sales.dto.ts`, `crm.dto.ts`). */
export const PURCHASE_PHONE_PATTERN = /^\+?[0-9][0-9 .-]{6,19}$/;

/** NIF : forme seulement, comme celui de l'organisation (décision ouverte n° 14). */
export const SUPPLIER_NIF_PATTERN = /^[A-Z0-9]{5,20}$/;

/** Majuscules, espaces et tirets retirés (même normalisation que `normalizeNif`). */
export function normalizeSupplierNif(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Clé de référence d'une facture fournisseur (§ 2.5) : majuscules, sans espace ni
 * tiret — « FA 001 » et « fa-001 » sont un même doublon (critère 9 : le tiret doit
 * tomber pour que l'exemple de l'ADR soit un doublon).
 */
export function supplierReferenceKey(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

// ── Codes stables (le web les traduit, les tests les citent) ────────────────

/**
 * Codes d'erreur NOMMÉS par l'ADR. Un lot qui a besoin d'un code de plus le déclare
 * dans son propre fichier (zones de conflit : on n'écrit pas dans le fichier d'un
 * autre lot).
 */
export const PURCHASE_ERROR_CODES = [
  'STALE_REVISION',
  // Fournisseurs (§ 2.1, § 3.1).
  'SUPPLIER_NIF_EXISTS',
  'SUPPLIER_HAS_OPEN_PAYABLES',
  'SUPPLIER_IN_USE',
  'SECRETS_NOT_CONFIGURED',
  // Demandes et commandes (§ 2.3, § 3.2).
  'PURCHASE_ORDER_INVOICED',
  'PURCHASE_WORK_PROJECT_UNKNOWN',
  'SELF_APPROVAL_FORBIDDEN',
  'APPROVER_ALREADY_APPROVED',
  'DOCUMENT_NOT_SENDABLE',
  // Pièces (§ 2.7).
  'PURCHASE_ATTACHMENT_TYPE',
  // Factures (§ 2.5, § 5).
  'SUPPLIER_INVOICE_DUPLICATE',
  'SUPPLIER_INVOICE_CURRENCY_MISMATCH',
  'SUPPLIER_INVOICE_TOTAL_MISMATCH',
  'SUPPLIER_INVOICE_ALLOCATION_MISMATCH',
  'SUPPLIER_INVOICE_VARIANCE',
  'SUPPLIER_INVOICE_DISPUTED',
  'SUPPLIER_INVOICE_PAID',
  // Paiements (§ 2.6, § 6.2).
  'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH',
  'SUPPLIER_PAYMENT_EXCEEDS_REMAINING',
  'EXPENSE_OWNED_BY_PURCHASES',
] as const;
export type PurchaseErrorCode = (typeof PURCHASE_ERROR_CODES)[number];

/** Avertissements : rien n'est refusé, l'écran les montre (§ 2.1, O3). */
export const PURCHASE_WARNING_CODES = [
  'SUPPLIER_SIMILAR_NAME',
  'SUPPLIER_PAYMENT_DETAILS_SHARED',
  'POSSIBLE_DUPLICATE_EXPENSE',
] as const;
export type PurchaseWarningCode = (typeof PURCHASE_WARNING_CODES)[number];

/**
 * État d'une section de la fiche 360° (§ 3.1.1, motif d'ADR-0040) : connue, masquée
 * faute de droit, ou vide. Une section masquée ne porte AUCUNE donnée.
 */
export const PURCHASE_SECTION_STATUSES = ['known', 'hidden', 'empty'] as const;
export type PurchaseSectionStatus = (typeof PURCHASE_SECTION_STATUSES)[number];
