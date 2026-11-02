// ─────────────────────────────────────────────────────────────────────────────
// Comptabilité SYSCOHADA (projet à valider) — types communs (ADR-0049 § 12)
//
// Fichier possédé par le lot K2 (ADR-0049 § Zones de conflit) : K1 et K3 le
// LISENT, ils n'y écrivent pas.
//
// Module PUR : aucune base, aucun réseau, aucune horloge. Montants en chaînes
// décimales (deux décimales au plus), arithmétique en entiers `bigint`
// (centimes), JAMAIS de flottant, JAMAIS de conversion de devise sans taux
// fourni en entrée.
//
// AUCUN numéro de compte n'est écrit dans ce module : les comptes viennent des
// règles de correspondance VALIDÉES par l'organisation (§ 2.4) et du compte
// d'attente désigné par la configuration (§ 6.0).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toute évolution d'un calcul du module comptable incrémente cette version.
 * 1.1.0 (ADR-0051 H13) : dépenses possédées par les RH comptabilisées ; motif
 * d'attente `SETTLED_BY_EMPLOYEE_ADVANCE` ; clés `hr.advance.*` sans règle.
 */
export const ACCOUNTING_VERSION = '1.1.0';

/** Devises des pièces et monnaies de tenue admises (ADR-0049 § 2.2). */
export const ACCOUNTING_CURRENCIES = ['CDF', 'USD'] as const;
export type AccountingCurrency = (typeof ACCOUNTING_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa, ADR-0027). */
export type AccountingDay = string;
/** Montant décimal positif ou nul, deux décimales au plus (« 1250.50 »). */
export type AccountingAmount = string;
/** Taux de change décimal strictement positif, huit décimales au plus. */
export type AccountingRate = string;

export type EntrySide = 'debit' | 'credit';

// ─── Règles de correspondance (§ 2.4) ────────────────────────────────────────

/** Jetons résolus à l'exécution, jamais des numéros (§ 2.4). */
export const ACCOUNT_TOKENS = ['{customer}', '{supplier}', '{treasuryAccount}'] as const;
export type AccountToken = (typeof ACCOUNT_TOKENS)[number];

/** Numéro de compte du plan de l'organisation (chiffres), ou jeton. */
export type AccountRef = string;

/**
 * Règle « telle opération → tels comptes ». `debit` sert quand la ligne de
 * cette opération est au débit, `credit` quand elle est au crédit : une clé
 * toujours du même côté laisse l'autre liste vide. Une liste doit contenir
 * exactement un compte pour être employée (sinon : compte d'attente).
 */
export interface MappingRule {
  key: string;
  debit: readonly AccountRef[];
  credit: readonly AccountRef[];
  /** `true` : règle encore « à confirmer » — jamais appliquée (compte d'attente). */
  requiresReview: boolean;
}

export type RuleSetStatus = 'draft' | 'validated' | 'superseded';

export interface MappingRuleSet {
  version: number;
  status: RuleSetStatus;
  rules: readonly MappingRule[];
}

/** Pourquoi une ligne va au compte d'attente (§ 6.0). */
export const SUSPENSE_REASONS = [
  /** Aucun jeu de règles, ou jeu non `validated`. */
  'NO_VALIDATED_RULE_SET',
  /** Aucune règle pour cette clé d'opération. */
  'NO_RULE',
  /** Règle marquée `requiresReview`. */
  'RULE_REQUIRES_REVIEW',
  /** La règle n'a aucun compte pour ce côté. */
  'RULE_SIDE_MISSING',
  /** La règle a plusieurs comptes pour ce côté : le moteur ne choisit pas. */
  'RULE_SIDE_AMBIGUOUS',
  /** Référence de compte illisible (ni numéro, ni jeton connu). */
  'RULE_ACCOUNT_INVALID',
  /** Compte de trésorerie de la pièce inconnu ou absent. */
  'NO_TREASURY_ACCOUNT',
  /** Compte auxiliaire du client ou du fournisseur non fourni. */
  'PARTY_ACCOUNT_UNKNOWN',
  /** Écart de change à qualifier (§ 5, décision ouverte n° 12). */
  'EXCHANGE_DIFFERENCE',
  /** Nature d'un autre mouvement de trésorerie inconnue de la pièce (§ 6.6). */
  'NATURE_UNKNOWN',
  /**
   * Dépense de note de frais soldée par une avance au personnel : l'argent est sorti
   * au versement de l'avance ; la contrepartie attend la réponse de l'expert
   * (ADR-0051 § 7.4, question C2).
   */
  'SETTLED_BY_EMPLOYEE_ADVANCE',
] as const;
export type SuspenseReason = (typeof SUSPENSE_REASONS)[number];

export type RuleResolution =
  | { status: 'rule'; rule: MappingRule; ruleSetVersion: number }
  | { status: 'suspense'; reason: SuspenseReason };

// ─── Contexte de génération ──────────────────────────────────────────────────

/** Compte auxiliaire d'un tiers et son collectif (§ 2.3). */
export interface AuxiliaryAccount {
  collectiveNumber: string;
  auxiliaryNumber: string;
}

/** Taux SAISI par un humain (`accounting_exchange_rates`, § 2.7) : 1 `from` = `rate` `to`. */
export interface EnteredRate {
  date: AccountingDay;
  from: AccountingCurrency;
  to: AccountingCurrency;
  rate: AccountingRate;
  /** Référence affichée (source déclarée, identifiant de la saisie). */
  ref?: string | null;
}

/** Tout ce que l'appelant (API, lot K5) fournit ; le moteur ne lit rien d'autre. */
export interface PostingContext {
  /** Jeu de règles en vigueur ; `null` ou non `validated` → tout va en attente. */
  ruleSet: MappingRuleSet | null;
  /** Compte d'attente désigné (classe 47 par l'expert, `ATTENTE` en simulation). */
  suspenseAccount: string;
  bookCurrency: AccountingCurrency;
  /** Date de bascule : une pièce antérieure n'est jamais comptabilisée (§ 3.2). */
  cutoverDate: AccountingDay;
  enteredRates: readonly EnteredRate[];
  chartPack: { slug: string; version: number } | null;
  /** Auxiliaires par identifiant de fiche client / fournisseur. */
  customerAccounts: Readonly<Record<string, AuxiliaryAccount>>;
  supplierAccounts: Readonly<Record<string, AuxiliaryAccount>>;
  /** Compte du plan rattaché à chaque compte de trésorerie d'ADR-0034. */
  treasuryAccounts: Readonly<Record<string, string>>;
  /** Organisation assujettie à la TVA selon sa fiche fiscale (`seller-vat-status`). */
  vatRegistered: boolean;
  /** Option d'inventaire permanent (§ 6.7) ; défaut `off`. */
  stockPosting: 'off' | 'perpetual';
}

// ─── Écritures ───────────────────────────────────────────────────────────────

export type RateSource = 'same_currency' | 'document' | 'observed' | 'entered';

export type JournalKind = 'sales' | 'purchases' | 'treasury' | 'misc' | 'opening';

/** Journal visé ; l'API le traduit en code (`VE`, `AC`, `T01`…). */
export interface JournalRef {
  kind: JournalKind;
  treasuryAccountId: string | null;
}

export const SOURCE_KINDS = [
  'sales_invoice',
  'sales_receipt',
  'treasury_expense',
  'supplier_invoice',
  'supplier_payment',
  'treasury_movement',
  'stock_movement',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Copie d'affichage de la pièce (§ 2.6 `source`). */
export interface EntrySource {
  kind: SourceKind;
  id: string;
  /** Événement de la pièce : `issue`, `paid_at_issue`, `r3`, `validate`, `record`, `out`, `in`, `cancel`… */
  event: string;
  number: string | null;
  date: AccountingDay;
  partyName: string | null;
}

export interface EntryLine {
  /** Clé d'opération qui a choisi le compte (§ 6). */
  operationKey: string;
  side: EntrySide;
  accountNumber: string;
  auxiliaryAccountNumber: string | null;
  label: string;
  /** Devise et montant DE LA PIÈCE, strictement positif (nul seulement pour un écart de change). */
  currency: AccountingCurrency;
  amount: AccountingAmount;
  /** Montant en monnaie de tenue ; `null` tant que le taux manque. */
  bookAmount: AccountingAmount | null;
  /** Débit et crédit en monnaie de tenue : le montant du côté, `0.00` de l'autre ; `null` sans taux. */
  debit: AccountingAmount | null;
  credit: AccountingAmount | null;
  rate: AccountingRate | null;
  rateSource: RateSource | null;
  rateRef: string | null;
  /** Code de lettrage, attribué par le lettrage (K3, K5) ; toujours `null` à la génération. */
  letteringCode: string | null;
  /** Pièce à lettrer avec (`sales_invoice:<id>`, `supplier_invoice:<id>`) — lettrage automatique (§ 6.11). */
  matchRef: string | null;
  /** Motif quand la ligne vise le compte d'attente. */
  suspenseReason: SuspenseReason | null;
  /** Ligne d'écart de change : montant de pièce nul, seul le montant en monnaie de tenue compte. */
  exchangeDifference: boolean;
}

/** `ready` : prête à être validée (`posted` par l'API) ; `awaiting_rate` : hors balance (§ 5). */
export type ProposedEntryStatus = 'ready' | 'awaiting_rate';

export interface EntryGeneration {
  ruleSetVersion: number | null;
  chartPack: { slug: string; version: number } | null;
  engineVersion: string;
}

export interface ProposedEntry {
  sourceKey: string;
  status: ProposedEntryStatus;
  journal: JournalRef;
  date: AccountingDay;
  bookCurrency: AccountingCurrency;
  label: string;
  source: EntrySource;
  lines: EntryLine[];
  /** Clé de source de l'écriture contre-passée. */
  reversalOf: string | null;
  /** Motif d'une contre-passation (`SOURCE_CANCELLED`, `SOURCE_REVISED`, `SOURCE_CHANGED_IN_CLOSED_PERIOD`…). */
  reversalReason: string | null;
  generation: EntryGeneration;
  /** Vrai si une ligne vise le compte d'attente. */
  suspense: boolean;
}

// ─── Résultat d'une génération ───────────────────────────────────────────────

/** Pièce lue mais volontairement non comptabilisée. */
export const SKIP_REASONS = [
  'BEFORE_CUTOVER',
  'NOT_FINAL',
  'TEST_SERIES',
  'NOT_VALIDATED',
  'CREATED_BY_SUPPLIER_PAYMENT',
  'STOCK_POSTING_OFF',
  'NO_VALUE',
  'ZERO_AMOUNT',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Motifs « À comptabiliser » (§ 2.7 `accounting_pending`) que le moteur sait constater. */
export const PENDING_REASONS = [
  'NO_TREASURY_ACCOUNT',
  'RATE_MISSING',
  'UNSUPPORTED_SOURCE',
  'STOCK_COST_PENDING',
] as const;
export type PendingReason = (typeof PENDING_REASONS)[number];

/** Constats sans effet sur les écritures, rendus pour l'écran. */
export const POSTING_NOTES = [
  /** Règle de TVA validée, mais organisation non assujettie : règle ignorée (§ 6.3). */
  'VAT_RULE_IGNORED_NOT_REGISTERED',
  /** TVA déclarée nulle, négative ou ≥ au montant : laissée dans la charge. */
  'VAT_DECLARED_IGNORED',
  /** Paiements déclarés à l'émission invisibles de la trésorerie (décision ouverte n° 9). */
  'PAYMENTS_AT_ISSUE_NOT_IN_TREASURY',
] as const;
export type PostingNote = (typeof POSTING_NOTES)[number];

export interface PostingResult {
  version: string;
  source: { kind: SourceKind; id: string };
  /**
   * Écritures qui DOIVENT être actives pour cette pièce, à son état actuel. Une
   * pièce annulée n'en a aucune : ses écritures actives sont contre-passées
   * (`syncSourceEntries`).
   */
  entries: ProposedEntry[];
  cancelled: boolean;
  skipped: SkipReason | null;
  pending: PendingReason[];
  notes: PostingNote[];
}

// ─── Vues des pièces sources (lecture seule, ADR-0049 § 6) ───────────────────

/** Totaux figés d'un groupe de taxation (`InvoiceTotals.groups[]`). */
export interface SalesInvoiceGroupView {
  group: string;
  /** Base HT, taxe spécifique comprise. */
  ht: AccountingAmount;
  vat: AccountingAmount;
  /** TTC du groupe = `ht + vat`. */
  total: AccountingAmount;
  specificTax: AccountingAmount;
}

/** Ligne figée, pour répartir la base d'un groupe entre biens et services. */
export interface SalesInvoiceLineView {
  taxGroup: string;
  itemType: 'BIE' | 'SER' | 'TAX';
  /** Montant figé de la ligne (`LineTotals.amount`), dans le mode de prix de la facture. */
  amount: AccountingAmount;
}

/** Facture ou avoir de vente figé (§ 6.1). */
export interface SalesInvoiceView {
  id: string;
  number: string | null;
  status: string;
  /** `FV`, `FT`, `EV`, `ET` (factures, dont acomptes) ; `FA`, `EA` (avoirs). */
  type: string;
  series: 'real' | 'test' | 'proforma' | null;
  date: AccountingDay;
  currency: AccountingCurrency;
  customerId: string;
  customerName: string | null;
  /** Totaux par groupe : `normalizedAmounts.calculation` s'il existe, sinon `documentAmounts.calculation`. */
  groups: readonly SalesInvoiceGroupView[];
  lines: readonly SalesInvoiceLineView[];
  total: AccountingAmount;
  /** Paiements déclarés à l'émission ; la part `CREDIT` n'est pas réglée. */
  payments: readonly { method: string; amount: AccountingAmount }[];
  /** Conversion figée d'une facture en devise (§ 5, taux « de la pièce »). */
  conversion: {
    from: AccountingCurrency;
    to: AccountingCurrency;
    rate: AccountingRate;
    reference: string | null;
  } | null;
}

/** Imputation d'un encaissement ou d'un paiement à une facture. */
export interface SettlementAllocationView {
  invoiceId: string;
  invoiceNumber: string | null;
  amount: AccountingAmount;
  /**
   * Taux auquel l'écriture de la facture a été passée (devise de la pièce →
   * monnaie de tenue). Sert à porter l'écart de change au compte d'attente ;
   * `null` si inconnu (aucun écart n'est alors calculé).
   */
  invoiceBookRate: { rate: AccountingRate; rateSource: RateSource; rateRef: string | null } | null;
}

/** Encaissement (§ 6.2). */
export interface ReceiptView {
  id: string;
  number: string | null;
  status: 'recorded' | 'cancelled';
  revision: number;
  receivedOn: AccountingDay;
  amount: AccountingAmount;
  currency: AccountingCurrency;
  method: string;
  accountId: string | null;
  customerId: string;
  customerName: string | null;
  allocations: readonly SettlementAllocationView[];
}

/** Dépense de trésorerie (§ 6.3). */
export interface ExpenseView {
  id: string;
  status: 'recorded' | 'cancelled';
  revision: number;
  spentOn: AccountingDay;
  amount: AccountingAmount;
  currency: AccountingCurrency;
  category: string;
  label: string;
  supplierName: string | null;
  accountId: string | null;
  deductibleVat: AccountingAmount | null;
  reference: string | null;
  /**
   * Propriétaire de la dépense (§ 6.3 amendé par ADR-0051 § 7.4), ou `null` (directe).
   * - `supplier_payment` : ignorée, le paiement fournisseur la comptabilise déjà ;
   * - `expense_report` : comptabilisée comme une dépense ; `settledByAdvanceId` non nul
   *   (dépense sans compte) → contrepartie au compte d'attente ;
   * - toute autre nature : « À comptabiliser », jamais devinée.
   */
  origin: ExpenseOriginView | null;
}

/** Natures de propriétaire d'une dépense connues du moteur. */
export const EXPENSE_ORIGIN_KINDS = ['supplier_payment', 'expense_report'] as const;

/** Propriétaire d'une dépense : paiement fournisseur ou note de frais (`id` de la pièce). */
export interface ExpenseOriginView {
  kind: string;
  id: string;
  /** Avance au personnel qui solde la dépense (`expense_report` seulement), sinon `null`. */
  settledByAdvanceId: string | null;
}

/** Facture ou avoir fournisseur (§ 6.4). */
export interface SupplierInvoiceView {
  id: string;
  number: string | null;
  kind: 'invoice' | 'credit_note';
  status: 'draft' | 'validated' | 'cancelled';
  /** Vrai si la facture a été validée avant d'être annulée. */
  wasValidated: boolean;
  invoiceDate: AccountingDay;
  currency: AccountingCurrency;
  supplierId: string;
  supplierName: string | null;
  total: AccountingAmount;
  deductibleVat: AccountingAmount | null;
  /** Imputations (somme = total TTC). */
  costAllocations: readonly { category: string; amount: AccountingAmount }[];
}

/** Paiement fournisseur (§ 6.5). */
export interface SupplierPaymentView {
  id: string;
  number: string | null;
  status: 'recorded' | 'cancelled';
  paidOn: AccountingDay;
  amount: AccountingAmount;
  currency: AccountingCurrency;
  method: string;
  accountId: string | null;
  supplierId: string;
  supplierName: string | null;
  allocations: readonly SettlementAllocationView[];
}

/** Mouvement de trésorerie (§ 6.6). */
export interface TreasuryMovementView {
  id: string;
  kind: 'transfer' | 'other_in' | 'other_out';
  status: 'recorded' | 'cancelled';
  date: AccountingDay;
  label: string;
  fromAccountId: string | null;
  fromCurrency: AccountingCurrency | null;
  toAccountId: string | null;
  toCurrency: AccountingCurrency | null;
  amountOut: AccountingAmount | null;
  amountIn: AccountingAmount | null;
  reference: string | null;
}

/** Mouvement de stock valorisé par le moteur `stock` (§ 6.7). */
export interface StockMovementView {
  id: string;
  kind: string;
  occurredOn: AccountingDay;
  costStatus: 'valued' | 'pending_cost' | 'not_applicable';
  /** Valeur absolue du mouvement au coût moyen de gestion ; `null` si inconnue. */
  value: AccountingAmount | null;
  currency: AccountingCurrency;
  label: string | null;
}

// ─── Contrôle d'une écriture ─────────────────────────────────────────────────

export const ENTRY_ISSUE_CODES = [
  'ENTRY_NO_LINES',
  'ENTRY_DATE_INVALID',
  'ENTRY_BOOK_CURRENCY_INVALID',
  'LINE_SIDE_INVALID',
  'LINE_CURRENCY_INVALID',
  'LINE_AMOUNT_INVALID',
  'LINE_BOOK_AMOUNT_INVALID',
  'LINE_DEBIT_CREDIT_MISMATCH',
  'LINE_SAME_CURRENCY_RATE',
  'LINE_ACCOUNT_MISSING',
  'ACCOUNT_NOT_IN_CHART',
  'SUSPENSE_FLAG_MISMATCH',
  'ENTRY_UNBALANCED',
  'ENTRY_UNBALANCED_IN_CURRENCY',
  'ENTRY_STATUS_MISMATCH',
  'ACCOUNTING_PERIOD_CLOSED',
] as const;
export type EntryIssueCode = (typeof ENTRY_ISSUE_CODES)[number];

export interface EntryIssue {
  code: EntryIssueCode;
  lineIndex: number | null;
  message: string;
}

export interface EntryCheck {
  version: string;
  ok: boolean;
  issues: EntryIssue[];
  /** Totaux en monnaie de tenue (`null` pour une écriture en attente de taux). */
  bookTotals: { debit: AccountingAmount; credit: AccountingAmount } | null;
  /** Totaux par devise de pièce (lignes d'écart de change exclues : montant nul). */
  currencyTotals: {
    currency: AccountingCurrency;
    debit: AccountingAmount;
    credit: AccountingAmount;
  }[];
}
