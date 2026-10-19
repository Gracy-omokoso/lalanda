// ─────────────────────────────────────────────────────────────────────────────
// Contrat HTTP des documents de vente — ADR-0023 § S25e.14 (jalon E0)
//
// FICHIER FIGÉ : l'API (chantier E2) implémente ces formes, l'interface (E3) code
// contre elles avec des réponses simulées, S25f et S25g les lisent. Types
// seulement (et les listes fermées qui fondent les unions) : aucune logique.
// Toute modification passe par le CTO et un amendement d'ADR-0023.
//
// Amendé par ADR-0024 (jalon F0) : ajouts seulement — trois événements de
// journal, deux codes 409, champs de `NormalizationView` (§ 9.2), corps de
// `declare-not-normalized` et `DgiExchangePage` (§ 9).
//
// Montants : TOUJOURS des chaînes décimales canoniques (`"4064.00"`), jamais des
// `number` (docs/26). Dates : chaînes ISO 8601 en JSON.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DecimalString,
  DocumentCurrency,
  InvoiceCheckIssue,
  InvoiceTotals,
  InvoiceTotalsIssue,
  ItemType,
  LineDiscount,
  PaymentInput,
  PaymentMethod,
  PaymentsCheck,
  PriceMode,
  SpecificTax,
  TaxGroupLetter,
} from '@lalanda/engine';

import type { CustomerType } from '../sales.dto.js';

// ── Listes fermées ───────────────────────────────────────────────────────────

/** Cycle de vie (§ S25e.1). */
export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'pending_normalization',
  'normalized',
  'normalization_failed',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Filtre de liste : les statuts, plus `final` (`issued` + `normalized`) et `all`. */
export const INVOICE_LIST_STATUSES = [...INVOICE_STATUSES, 'final', 'all'] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];

/** Six types de facture e-DEF : vente, acompte, avoir, et leurs pendants à l'export. */
export const INVOICE_TYPES = ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** Types qui portent un `creditNote` (avoirs). */
export const CREDIT_NOTE_TYPES = ['FA', 'EA'] as const satisfies readonly InvoiceType[];
export type CreditNoteType = (typeof CREDIT_NOTE_TYPES)[number];

/** Natures d'avoir (`referenceType` e-DEF). */
export const CREDIT_NOTE_NATURES = ['COR', 'RAN', 'RAM', 'RRR'] as const;
export type CreditNoteNature = (typeof CREDIT_NOTE_NATURES)[number];

/** Préremplissage d'un brouillon d'avoir. */
export const CREDIT_NOTE_SCOPES = ['remaining', 'empty'] as const;
export type CreditNoteScope = (typeof CREDIT_NOTE_SCOPES)[number];

export type EmissionMode = 'standard' | 'normalized';
export type DgiEnvironment = 'test' | 'production';

/** Ce que l'on peut imprimer : `invoice` seulement pour `issued` et `normalized`. */
export type DocumentKind = 'proforma' | 'invoice';

/** Séries de numérotation (§ S25e.3). */
export type InvoiceSeries = 'real' | 'test' | 'proforma';

export const INVOICE_LINE_SOURCES = ['catalog', 'free', 'origin'] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

/** Huit lignes de commentaire e-DEF ; seules A et C sont saisissables (§ S25e.7). */
export const COMMENT_LINES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type CommentLine = (typeof COMMENT_LINES)[number];
export type InvoiceComments = Readonly<Record<CommentLine, string | null>>;

export type ConversionRateSource =
  'dgi_currency_rates' | 'user_within_tolerance' | 'identity' | 'origin_invoice';

/** Événements du journal électronique (§ S25e.12). */
export const JOURNAL_EVENTS = [
  'issued',
  'submitted',
  'number_reserved',
  'normalized',
  'normalization_failed',
  'number_released',
  'returned_to_draft',
  'duplicate_issued',
  'report_issued',
  // ADR-0024 § 10
  'normalization_uncertain',
  'normalization_review_required',
  'number_abandoned',
] as const;
export type JournalEvent = (typeof JOURNAL_EVENTS)[number];

// ── Corps de requête ─────────────────────────────────────────────────────────

/** Client du document : fiche existante, ou vente de comptoir (type `PP` imposé). */
export type InvoiceCustomerBody =
  | { customerId: string; printContactDetails: boolean }
  | { customerId: null; walkIn: { name: string | null } };

export interface CatalogLineBody {
  source: 'catalog';
  catalogItemId: string;
  quantity: DecimalString;
  /** `null` : prix de l'article (si l'article est dans la devise du document). */
  unitPrice: DecimalString | null;
  discount: LineDiscount | null;
}

export interface FreeLineBody {
  source: 'free';
  code: string | null;
  name: string;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  unit: string | null;
  quantity: DecimalString;
  unitPrice: DecimalString;
  specificTax: SpecificTax | null;
  discount: LineDiscount | null;
}

/** Ligne d'avoir hors RRR : reprise d'une ligne de l'origine, seule la quantité varie. */
export interface OriginLineBody {
  source: 'origin';
  originLineIndex: number;
  quantity: DecimalString;
}

export type InvoiceLineBody = CatalogLineBody | FreeLineBody | OriginLineBody;

/** `POST /sales/invoices` — brouillon. */
export interface CreateInvoiceBody {
  type: InvoiceType;
  currency: DocumentCurrency;
  priceMode: PriceMode;
  customer: InvoiceCustomerBody;
  /** `null` : le seul point de vente actif, s'il y en a un. */
  pointOfSaleId: string | null;
  lines: readonly InvoiceLineBody[];
  /** Dans la devise du document. */
  payments: readonly PaymentInput[];
  /** Seules A et C sont acceptées ; B, D à H → `COMMENT_LINE_RESERVED`. */
  comments: { A: string | null; C: string | null };
  /** Requis pour `FA`/`EA`, interdit sinon. */
  creditNote: { nature: CreditNoteNature; originInvoiceId: string | null } | null;
  /** Document en CDF : indiquer la contre-valeur USD à la normalisation. */
  showUsdCounterValue: boolean;
}

/** `PUT /sales/invoices/:invoiceId` — corps COMPLET, brouillon seulement. */
export interface PutInvoiceBody extends CreateInvoiceBody {
  expectedRevision: number;
}

/** `POST /sales/invoices/:invoiceId/credit-notes`. */
export interface CreateCreditNoteBody {
  nature: CreditNoteNature;
  scope: CreditNoteScope;
}

/** `POST /sales/invoices/:invoiceId/issue` (organisation ordinaire). */
export interface IssueInvoiceBody {
  expectedRevision: number;
}

/** `POST /sales/invoices/:invoiceId/normalize` (organisation en facture normalisée). */
export interface NormalizeInvoiceBody {
  expectedRevision: number;
  /** `null` : taux officiel DGI du jour ; sinon un taux à ±1 % de celui-ci. */
  exchangeRate: { rate: DecimalString; date: string } | null;
}

/** `POST /sales/invoices/:invoiceId/normalization/declare-not-normalized` (ADR-0024 § 9.1). */
export interface DeclareNotNormalizedBody {
  /** 20 à 500 caractères. */
  reason: string;
}

/** `POST /sales/invoices/:invoiceId/back-to-draft`. */
export interface BackToDraftBody {
  expectedRevision: number;
}

/** `GET /sales/invoices` — paramètres de requête. */
export interface ListInvoicesQuery {
  status?: InvoiceListStatus;
  type?: InvoiceType;
  currency?: DocumentCurrency;
  customerId?: string;
  year?: number;
  /** Cherche dans le numéro, la référence de pro forma et le nom du client. */
  q?: string;
  limit?: number;
  /** Curseur opaque (`INVALID_CURSOR` s'il est illisible). */
  cursor?: string;
}

/** `GET /sales/journal` — paramètres de requête. */
export interface ListJournalQuery {
  limit?: number;
  cursor?: string;
}

// ── Vues ─────────────────────────────────────────────────────────────────────

export interface InvoiceCustomerView {
  customerId: string | null;
  type: CustomerType;
  typeLabel: string;
  name: string | null;
  nif: string | null;
  exemptionReference: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  printContactDetails: boolean;
}

export interface InvoiceLineView {
  index: number;
  source: InvoiceLineSource;
  catalogItemId: string | null;
  originLineIndex?: number | null;
  code: string | null;
  edefCode: string | null;
  name: string;
  unit: string | null;
  itemType: ItemType;
  taxGroup: TaxGroupLetter;
  outOfScope: boolean;
  quantity: DecimalString;
  originalPrice: DecimalString | null;
  discount: LineDiscount | null;
  /** Prix après remise, dans la devise du document. */
  unitPrice: DecimalString;
  priceModification: string | null;
  priceOverridden: boolean;
  specificTax: SpecificTax | null;
  amount: DecimalString | null;
  /** Facture d'origine seulement : quantités déjà créditées et restantes. */
  credited?: DecimalString;
  remaining?: DecimalString;
}

export interface InvoicePaymentView {
  method: PaymentMethod;
  methodLabel: string;
  amount: DecimalString;
}

/**
 * Résultat de `computeInvoiceTotals` tel qu'exposé : en brouillon, `ok: false`,
 * `totals: null` et tous les problèmes ; le brouillon s'enregistre quand même.
 */
export interface InvoiceCalculationView {
  ok: boolean;
  issues: readonly InvoiceTotalsIssue[];
  totals: InvoiceTotals | null;
}

/** « Montants du document (USD) » ou « (CDF) » : devise choisie par l'utilisateur. */
export interface DocumentAmountsView {
  label: string;
  currency: DocumentCurrency;
  calculation: InvoiceCalculationView;
  payments: readonly InvoicePaymentView[];
  paymentsCheck: PaymentsCheck | null;
}

export interface ConversionView {
  from: DocumentCurrency;
  to: 'CDF';
  /** CDF pour 1 USD ; "1" si `from` = CDF. */
  rate: DecimalString;
  rateDate: string;
  rateSource: ConversionRateSource;
  reference: {
    rate: DecimalString;
    date: string;
    environment: DgiEnvironment;
    sha256: string;
  } | null;
  /** Avoir : conversion reprise de l'origine. */
  originInvoiceId: string | null;
  conversionVersion: string;
}

export interface NormalizedLineView {
  index: number;
  unitPrice: DecimalString;
  originalPrice: DecimalString | null;
  priceModification: string | null;
  specificTax: SpecificTax | null;
}

/** « Montants normalisés (CDF) — font foi » : les seuls qui ont valeur fiscale. */
export interface NormalizedAmountsView {
  label: string;
  currency: 'CDF';
  lines: readonly NormalizedLineView[];
  payments: readonly PaymentInput[];
  calculation: InvoiceTotals;
  counterValueUsd: { amount: DecimalString; rate: DecimalString; date: string } | null;
}

/** Instantané des taux figé au gel ; la vue n'expose pas la table elle-même. */
export interface InvoiceTaxRatesView {
  source: 'dgi_snapshot';
  environment: DgiEnvironment;
  fetchedAt: string;
  sha256: string;
}

export interface CreditNoteView {
  nature: CreditNoteNature;
  /** Requis sauf RRR. */
  originInvoiceId: string | null;
  /** Recopié au gel. */
  originNumber: string | null;
  /** Au gel : code DEF/DGI de l'origine normalisée, `RRR` pour un RRR, numéro de l'origine ordinaire. */
  reference: string | null;
}

/** Avoir émis sur un document d'origine (liste `creditNotes` de la vue). */
export interface InvoiceCreditNoteSummary {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  proformaRef: string;
  number: string | null;
  nature: CreditNoteNature;
}

export interface SellerView {
  legalName: string;
  tradeName: string | null;
  nif: string;
  rccm: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatRegistered: boolean;
}

export interface OperatorView {
  userId: string;
  name: string;
}

/** Phase exposée (ADR-0024 § 9.2) : `submitting`, `comparing`, `cancelling` et
 *  `confirming` se lisent `in_progress`. */
export const NORMALIZATION_VIEW_PHASES = [
  'queued',
  'in_progress',
  'uncertain',
  'needs_review',
  'done',
  'failed',
] as const;
export type NormalizationViewPhase = (typeof NORMALIZATION_VIEW_PHASES)[number];

/** Catégorie d'une erreur de normalisation (ADR-0024 § 5 et § 9.2). */
export const NORMALIZATION_ERROR_CATEGORIES = [
  'data',
  'configuration',
  'capacity',
  'temporary',
  'server',
  'state',
  'totals_mismatch',
  'duplicate_pending',
  'unknown',
  'network',
  'token_rejected',
  'precondition',
] as const;
export type NormalizationErrorCategory = (typeof NORMALIZATION_ERROR_CATEGORIES)[number];

/** Partie de `normalization` exposée à l'interface (sous-document écrit par S25f). */
export interface NormalizationView {
  attempts: number;
  /** JAMAIS affiché comme numéro de facture. */
  reservedNumber: string | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  dgiDateTime: string | null;
  qrCode: string | null;
  /** Élargi par ADR-0024 § 9.2 : notre message, PUIS code et libellé DGI tels quels. */
  lastError: {
    /** Code Lalanda. */
    code: string;
    category: NormalizationErrorCategory | null;
    /** Français, à afficher. */
    message: string;
    dgiErrorCode: string | null;
    dgiMessage: string | null;
    retryable: boolean;
  } | null;
  normalizedAt: string | null;

  // ── ADR-0024 § 9.2 (jalon F0) ──
  phase: NormalizationViewPhase;
  /** `uid` DGI, utile à l'assistance DGI ; `null` avant le `POST`. */
  dgiRequestId: string | null;
  /** Écart de totaux : `[{ field: "vab", ours: "64.00", dgi: "64.01" }]`. */
  differences: readonly { field: string; ours: string | null; dgi: string | null }[] | null;
  /** `uncertain` et `needs_review` : prochaine vérification. */
  nextCheckAt: string | null;
  /** `needs_review` seulement. */
  review: { since: string; reason: string } | null;
  /** Calculé par l'API selon la phase ET les permissions : l'interface n'en déduit rien d'autre. */
  actions: {
    retry: boolean;
    check: boolean;
    declareNotNormalized: boolean;
    backToDraft: boolean;
  };
}

export interface InvoiceReadiness {
  /** Brouillon : `issue` (organisation ordinaire) ou `normalize` (mode normalisé). */
  action: 'issue' | 'normalize';
  ready: boolean;
  blockers: readonly { code: ReadinessBlockerCode; message: string; lineIndex?: number | null }[];
}

export interface InvoiceView {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  /** « Pro forma — non valable comme facture » tant que `documentKind = proforma`. */
  documentLabel: string;
  proformaRef: string;
  number: string | null;
  series: InvoiceSeries | null;
  fiscalYear: number | null;
  issuedAt: string | null;
  type: InvoiceType;
  typeLabel: string;
  currency: DocumentCurrency;
  priceMode: PriceMode;
  /** Document en CDF : contre-valeur USD demandée (relue à la réouverture d'un brouillon).
   *  Ajout pur au contrat (chantier E2, à la demande d'E3). */
  showUsdCounterValue: boolean;
  emissionMode: EmissionMode | null;
  environment: DgiEnvironment | null;
  isf: string | null;
  customer: InvoiceCustomerView;
  pointOfSaleId: string | null;
  lines: readonly InvoiceLineView[];
  documentAmounts: DocumentAmountsView;
  conversion: ConversionView | null;
  normalizedAmounts: NormalizedAmountsView | null;
  calculationVersion: string | null;
  roundingPolicyId: string | null;
  taxRates: InvoiceTaxRatesView | null;
  comments: InvoiceComments;
  creditNote: CreditNoteView | null;
  creditNotes: readonly InvoiceCreditNoteSummary[];
  seller: SellerView | null;
  operator: OperatorView | null;
  normalization: NormalizationView | null;
  readiness: InvoiceReadiness;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummary {
  id: string;
  status: InvoiceStatus;
  documentKind: DocumentKind;
  proformaRef: string;
  number: string | null;
  type: InvoiceType;
  currency: DocumentCurrency;
  issuedAt: string | null;
  customer: { name: string | null; type: CustomerType };
  /** Seul `calculation.totals.total` est repris ; `totals` vaut `null` si le calcul échoue. */
  documentAmounts: { calculation: { totals: { total: DecimalString } | null } };
  /** Seul `calculation.total` est repris ; `null` avant la normalisation. */
  normalizedAmounts: { calculation: { total: DecimalString } } | null;
  emissionMode: EmissionMode | null;
  revision: number;
}

export interface InvoicePage {
  items: readonly InvoiceSummary[];
  nextCursor: string | null;
}

export interface JournalEntryView {
  seq: number;
  at: string;
  event: JournalEvent;
  invoiceId: string | null;
  proformaRef: string | null;
  number: string | null;
  series: InvoiceSeries | null;
  type: InvoiceType | null;
  creditNature: CreditNoteNature | null;
  originNumber: string | null;
  documentTotals: {
    currency: DocumentCurrency;
    total: DecimalString;
    vatTotal: DecimalString;
  } | null;
  normalizedTotals: {
    total: DecimalString;
    vatTotal: DecimalString;
    specificTax: DecimalString;
  } | null;
  conversion: { rate: DecimalString; rateDate: string; rateSource: ConversionRateSource } | null;
  contentSha256: string | null;
  codeDefDgi: string | null;
  nim: string | null;
  counters: string | null;
  /** `null` pour l'ordonnanceur. */
  actor: OperatorView | null;
  hash: string;
}

export interface JournalPage {
  items: readonly JournalEntryView[];
  nextCursor: string | null;
  /** Le chaînage `prevHash` → `hash` est-il intact ? */
  chainValid: boolean;
}

/** Entrée du journal `edef_exchanges` d'un document (ADR-0024 § 6 et § 9.3).
 *  Corps rédigés ; JAMAIS d'en-tête ni de jeton. */
export interface DgiExchangeView {
  at: string;
  /** Lie la requête à sa réponse. */
  exchangeId: string;
  entry: 'request' | 'response' | 'complete';
  method: string;
  path: string;
  httpStatus: number | null;
  durationMs: number | null;
  /** `ok` ou un `EdefFailureKind` ; `null` pour une entrée `request`. */
  outcome: string | null;
  dgiErrorCode: string | null;
  body: string | null;
}

/** `GET /sales/invoices/:invoiceId/dgi-exchanges` — ordre chronologique. */
export interface DgiExchangePage {
  items: readonly DgiExchangeView[];
}

/** `GET /sales/exchange-rate-reference`. */
export interface ExchangeRateReference {
  currency: 'USD';
  rate: DecimalString;
  /** Date DGI conservée telle quelle, décalage horaire compris. */
  date: string;
  source: 'dgi_snapshot';
  environment: DgiEnvironment;
  fetchedAt: string;
  tolerancePercent: DecimalString;
}

// ── Codes d'erreur ───────────────────────────────────────────────────────────

/** Codes de premier niveau (`code` de la réponse), par statut HTTP (§ S25e.14). */
export const INVOICE_ERROR_CODES = {
  400: ['INVALID_REQUEST', 'INVALID_CURSOR'],
  404: [
    'INVOICE_NOT_FOUND',
    'CUSTOMER_NOT_FOUND',
    'CATALOG_ITEM_NOT_FOUND',
    'POINT_OF_SALE_NOT_FOUND',
    'EXCHANGE_RATE_REFERENCE_UNAVAILABLE',
  ],
  409: [
    'STALE_REVISION',
    'INVOICE_NOT_DRAFT',
    'NORMALIZATION_REQUIRED',
    'NORMALIZATION_NOT_ENABLED',
    'CUSTOMER_INACTIVE',
    'CATALOG_ITEM_INACTIVE',
    'TAX_GROUP_UNAVAILABLE',
    'FISCAL_PROFILE_REQUIRED',
    'POINT_OF_SALE_NOT_ACTIVE',
    'TAX_RATES_UNAVAILABLE',
    'EXCHANGE_RATE_REFERENCE_UNAVAILABLE',
    'CREDIT_NOTE_ORIGIN_TYPE',
    'CREDIT_NOTE_ORIGIN_NOT_FINAL',
    'CREDIT_NOTE_ORIGIN_MODE_MISMATCH',
    'CREDIT_NOTE_CURRENCY_MISMATCH',
    'CREDIT_NOTE_PRICE_MODE_MISMATCH',
    'CREDIT_NOTE_NOTHING_REMAINING',
    'NOT_RETURNABLE_TO_DRAFT',
    'NUMBER_RESERVED',
    'NORMALIZATION_IN_PROGRESS',
    // ADR-0024 § 9.1
    'NORMALIZATION_NOT_RETRYABLE',
    'NORMALIZATION_NOT_UNDER_REVIEW',
  ],
  422: ['INVOICE_NOT_ISSUABLE'],
} as const;
export type InvoiceErrorCode =
  (typeof INVOICE_ERROR_CODES)[keyof typeof INVOICE_ERROR_CODES][number];

/** Codes de `details.issues` d'un 400 `INVALID_REQUEST` propres aux documents de vente
 *  (s'ajoutent aux codes de forme et aux problèmes d'article d'ADR-0022). */
export type InvoiceRequestIssueCode =
  | 'DECIMAL_MUST_BE_STRING'
  | 'COMMENT_LINE_RESERVED'
  | 'LINE_LIMIT_EXCEEDED'
  | 'CREDIT_NOTE_REQUIRED_FOR_TYPE'
  | 'CREDIT_NOTE_NOT_ALLOWED_FOR_TYPE'
  | 'WALK_IN_MUST_BE_PP';

/** Codes de `details.issues` d'un 422 `INVOICE_NOT_ISSUABLE` : TOUS les problèmes. */
export type InvoiceNotIssuableIssueCode =
  InvoiceCheckIssue['code'] | InvoiceTotalsIssue['code'] | 'EXCHANGE_RATE_OUT_OF_TOLERANCE';

/** Ce qui empêche l'émission ou la normalisation d'un brouillon (`readiness.blockers`). */
export type ReadinessBlockerCode =
  | 'NO_LINES'
  | 'PAYMENTS_TOTAL_MISMATCH'
  | 'CATALOG_CURRENCY_MISMATCH'
  | 'POINT_OF_SALE_REQUIRED'
  | 'TAX_RATES_UNAVAILABLE'
  | 'EXCHANGE_RATE_REFERENCE_UNAVAILABLE'
  | 'CUSTOMER_INACTIVE'
  | 'FISCAL_PROFILE_REQUIRED'
  | InvoiceNotIssuableIssueCode;
