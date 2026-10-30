// ─────────────────────────────────────────────────────────────────────────────
// Achats et fournisseurs — types (ADR-0044 § 7)
//
// Module PUR : aucune base, aucun réseau, aucune horloge (le jour de référence
// est un paramètre, jour civil de Kinshasa déjà calculé par l'appelant,
// ADR-0027). Montants en chaînes décimales (deux décimales au plus),
// quantités en chaînes décimales (trois décimales au plus) ; arithmétique en
// entiers `bigint`, jamais en flottant ; JAMAIS de conversion entre devises.
//
// Aucune règle fiscale (ADR-0044 § 9) : les taxes sont celles DÉCLARÉES par le
// fournisseur, additionnées telles quelles ; la TVA déductible n'entre dans
// aucun calcul de ce module.
// ─────────────────────────────────────────────────────────────────────────────

/** Toute évolution d'un calcul de ce module incrémente cette version. */
export const PURCHASES_VERSION = '1.0.0';

/** Devises des achats — celles de la trésorerie (ADR-0044 § 1). */
export const PURCHASE_CURRENCIES = ['CDF', 'USD'] as const;
export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];

/** Date civile `AAAA-MM-JJ` (jour de Kinshasa). */
export type PurchaseDay = string;
/** Montant décimal positif ou nul, deux décimales au plus (« 1250.50 »). */
export type PurchaseAmount = string;
/** Quantité décimale, trois décimales au plus (« 2.5 »). */
export type PurchaseQuantity = string;

// ─── Commandes ───────────────────────────────────────────────────────────────

/** Statuts d'une demande puis d'une commande (ADR-0044 § 2.3). */
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

/**
 * Ligne de commande (ou de facture fournisseur) pour le calcul d'un montant :
 * quantité × prix unitaire HT × (1 − remise), un seul arrondi au centime.
 */
export interface PurchaseLineInput {
  /** Identifiant de la ligne, recopié dans le résultat (facultatif). */
  id?: string;
  /** > 0, trois décimales au plus. */
  quantity: PurchaseQuantity;
  /** ≥ 0, HT, deux décimales au plus. */
  unitPrice: PurchaseAmount;
  /** 0 à 100, deux décimales au plus ; absent ou `null` = aucune remise. */
  discountPercent?: string | null;
}

/** Taxe telle qu'indiquée par le fournisseur — jamais calculée. */
export interface DeclaredTaxInput {
  label: string;
  amount: PurchaseAmount;
}

export interface OrderTotalsLine {
  id: string | null;
  /** Montant HT de la ligne, arrondi une seule fois au centime (demi vers le haut). */
  amount: PurchaseAmount;
}

export interface OrderTotals {
  version: string;
  lines: OrderTotalsLine[];
  /** Σ des lignes (HT). */
  subtotal: PurchaseAmount;
  /** Σ des taxes déclarées. */
  taxes: PurchaseAmount;
  /** Sous-total + taxes (TTC). */
  total: PurchaseAmount;
}

/** Palier d'approbation (ADR-0044 § 2.2). */
export interface ApprovalTier {
  /** Seuil TTC à partir duquel le palier s'applique (inclus), ≥ 0. */
  from: PurchaseAmount;
  approvals: number;
}

/** Paliers par devise ; chaque devise a les siens, jamais convertis. */
export type ApprovalTiersByCurrency = Partial<Record<PurchaseCurrency, readonly ApprovalTier[]>>;

export type ApprovalTierIssueCode =
  | 'APPROVAL_TIERS_EMPTY'
  | 'APPROVAL_TIER_FROM_INVALID'
  | 'APPROVAL_TIER_FIRST_NOT_ZERO'
  | 'APPROVAL_TIERS_NOT_INCREASING'
  | 'APPROVAL_TIER_APPROVALS_INVALID';

export interface ApprovalTierIssue {
  code: ApprovalTierIssueCode;
  tierIndex: number | null;
  message: string;
}

export interface ApprovalTiersCheck {
  ok: boolean;
  issues: ApprovalTierIssue[];
}

export interface RequiredApprovals {
  version: string;
  currency: PurchaseCurrency;
  /** 0, 1 ou 2. */
  approvals: number;
  /** Index du palier retenu dans la liste de la devise. */
  tierIndex: number;
  /** Seuil du palier retenu. */
  from: PurchaseAmount;
}

// ─── Réceptions ──────────────────────────────────────────────────────────────

export interface PurchaseOrderLineInput extends PurchaseLineInput {
  id: string;
  /** Ligne « à réceptionner » (biens) ; une ligne de service ne l'est pas par défaut. */
  receivable: boolean;
  /** Catégorie de dépense (ADR-0034 § 1) — utilisée par le résumé. */
  category?: string | null;
  /** Projet RUN visé — recopié tel quel. */
  workProjectId?: string | null;
}

export interface ReceptionOrderInput {
  status: PurchaseOrderStatus;
  /** La commande a été transmise au fournisseur (`sentAt` posé). */
  sent: boolean;
  lines: readonly Pick<PurchaseOrderLineInput, 'id' | 'quantity' | 'receivable'>[];
}

export interface PurchaseReceptionInput {
  id?: string;
  status: 'recorded' | 'cancelled';
  lines: readonly { orderLineId: string; quantity: PurchaseQuantity }[];
}

export interface OrderReceptionLine {
  orderLineId: string;
  receivable: boolean;
  ordered: PurchaseQuantity;
  /** Σ des réceptions non annulées. */
  received: PurchaseQuantity;
  /** max(0, commandé − reçu). */
  remaining: PurchaseQuantity;
  /** max(0, reçu − commandé) : écart `RECEIVED_OVER_ORDERED`, pas un refus. */
  overReceived: PurchaseQuantity;
}

export interface OrderReceptionStatus {
  version: string;
  /** Statut dérivé ; inchangé hors des statuts d'une commande vivante. */
  status: PurchaseOrderStatus;
  lines: OrderReceptionLine[];
  /** Au moins une quantité reçue sur une ligne à réceptionner. */
  anyReceived: boolean;
  /** Toutes les lignes à réceptionner reçues en totalité (faux sans ligne à réceptionner). */
  fullyReceived: boolean;
}

// ─── Factures fournisseurs et rapprochement ──────────────────────────────────

export type SupplierInvoiceKind = 'invoice' | 'credit_note';
export type SupplierInvoiceStatus = 'draft' | 'validated' | 'cancelled';

export interface SupplierInvoiceLineInput extends PurchaseLineInput {
  /** Ligne de commande visée, ou `null` (ligne hors commande). */
  orderLineId: string | null;
}

export interface MatchOrderInput {
  id: string;
  currency: PurchaseCurrency;
  /** Total TTC à l'approbation complète. */
  approvedTotal: PurchaseAmount;
  lines: readonly PurchaseOrderLineInput[];
  declaredTaxes: readonly DeclaredTaxInput[];
}

export interface MatchReceptionInput extends PurchaseReceptionInput {
  orderId: string;
}

export interface MatchInvoiceInput {
  id: string;
  kind: SupplierInvoiceKind;
  status: SupplierInvoiceStatus;
  currency: PurchaseCurrency;
  orderIds: readonly string[];
  lines: readonly SupplierInvoiceLineInput[];
  taxes: readonly DeclaredTaxInput[];
  /** TTC tel qu'imprimé. */
  total: PurchaseAmount;
}

export interface MatchTolerances {
  /** Tolérance de prix en pour cent, '0' à '10', deux décimales au plus. */
  pricePercent: string;
  /** Tolérance absolue sur le total cumulé, par devise ; absente = 0. */
  amountAbsolute: Partial<Record<PurchaseCurrency, PurchaseAmount>>;
}

export type MatchingMode = 'none' | 'two_way' | 'three_way';
export type MatchingStatus = 'not_applicable' | 'matched' | 'variance';

export type MatchVarianceCode =
  | 'PRICE_ABOVE_ORDER'
  | 'QUANTITY_ABOVE_ORDER'
  | 'QUANTITY_ABOVE_RECEIVED'
  | 'LINE_NOT_ON_ORDER'
  | 'TOTAL_ABOVE_ORDER'
  | 'TAXES_DIFFER_FROM_ORDER'
  | 'RECEIVED_OVER_ORDERED'
  | 'PRICE_BELOW_ORDER'
  | 'QUANTITY_BELOW_ORDER';

/** Codes bloquants : une facture qui en porte un n'est validable que forcée. */
export const BLOCKING_VARIANCE_CODES: readonly MatchVarianceCode[] = [
  'PRICE_ABOVE_ORDER',
  'QUANTITY_ABOVE_ORDER',
  'QUANTITY_ABOVE_RECEIVED',
  'LINE_NOT_ON_ORDER',
  'TOTAL_ABOVE_ORDER',
];

export interface MatchVariance {
  code: MatchVarianceCode;
  blocking: boolean;
  orderId: string | null;
  orderLineId: string | null;
  /** Ligne de la facture en cause ; `null` pour un écart cumulé ou global. */
  invoiceLineIndex: number | null;
  /** `unit_price` : prix unitaire NET de remise, jusqu'à six décimales. */
  unit: 'quantity' | 'unit_price' | 'amount';
  expected: string;
  actual: string;
  /** constaté − attendu, signé. */
  difference: string;
}

export interface MatchLine {
  orderId: string;
  orderLineId: string;
  mode: 'two_way' | 'three_way';
  ordered: PurchaseQuantity;
  /** `null` pour une ligne non à réceptionner (deux voies). */
  received: PurchaseQuantity | null;
  /** Σ des factures validées (hors celle-ci). */
  invoicedBefore: PurchaseQuantity;
  /** Σ des lignes de cette facture. */
  invoicedNow: PurchaseQuantity;
  invoicedCumulative: PurchaseQuantity;
}

export interface InvoiceMatching {
  version: string;
  mode: MatchingMode;
  status: MatchingStatus;
  variances: MatchVariance[];
  lines: MatchLine[];
}

export interface InvoiceTotalCheck {
  version: string;
  ok: boolean;
  /** `SUPPLIER_INVOICE_TOTAL_MISMATCH` quand `ok` est faux. */
  code: 'SUPPLIER_INVOICE_TOTAL_MISMATCH' | null;
  /** sous-total + Σ taxes. */
  expected: PurchaseAmount;
  /** Total saisi. */
  actual: PurchaseAmount;
  /** saisi − attendu, signé. */
  difference: string;
}

export interface CostAllocationInput {
  category: string;
  workProjectId?: string | null;
  amount: PurchaseAmount;
}

export interface CostAllocationsCheck {
  version: string;
  ok: boolean;
  code: 'SUPPLIER_INVOICE_ALLOCATION_MISMATCH' | null;
  allocated: PurchaseAmount;
  total: PurchaseAmount;
  /** imputé − total, signé. */
  difference: string;
}

// ─── Échéances et dettes ─────────────────────────────────────────────────────

export type PaymentTerms =
  { kind: 'immediate' } | { kind: 'net'; days: number } | { kind: 'end_of_month'; days: number };

export interface DueDate {
  version: string;
  dueDate: PurchaseDay;
}

export type PayableStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface PayableSettlement {
  version: string;
  status: PayableStatus;
  total: PurchaseAmount;
  /** Σ des imputations de paiements non annulés. */
  paid: PurchaseAmount;
  /** Σ des avoirs fournisseurs validés imputés. */
  credited: PurchaseAmount;
  /** max(0, total − payé − avoirs) — le reste à payer, jamais stocké. */
  remaining: PurchaseAmount;
  /** Excédent payé ou crédité, rendu à part, jamais compensé. */
  overpaid: PurchaseAmount;
}

/** Facture validée et son reste à payer (rendu par `payableSettlement`). */
export interface PayableInput {
  id?: string;
  currency: PurchaseCurrency;
  dueDate: PurchaseDay;
  remaining: PurchaseAmount;
  /** En litige : rendue à part, hors des tranches. */
  disputed: boolean;
}

export interface AmountCount {
  amount: PurchaseAmount;
  count: number;
}

export interface CurrencyAging {
  currency: PurchaseCurrency;
  /** Échéance aujourd'hui ou plus tard. */
  notDue: AmountCount;
  days1To30: AmountCount;
  days31To60: AmountCount;
  days61To90: AmountCount;
  over90: AmountCount;
  /** Σ des tranches (hors litiges). */
  open: AmountCount;
  disputed: AmountCount;
}

export interface PayablesAging {
  version: string;
  asOf: PurchaseDay;
  /** Une entrée par devise rencontrée, ordre alphabétique. */
  byCurrency: CurrencyAging[];
}

export interface ScheduleWeek extends AmountCount {
  /** Premier et dernier jour (inclus) de la semaine glissante. */
  from: PurchaseDay;
  to: PurchaseDay;
}

export interface ScheduleMonth extends AmountCount {
  /** Mois civil `AAAA-MM`. */
  month: string;
}

export interface CurrencySchedule {
  currency: PurchaseCurrency;
  /** Échéance avant `asOf`. */
  overdue: AmountCount;
  /** Échéance de `asOf` à `asOf + dueSoonDays` inclus. */
  dueSoon: AmountCount;
  /** Semaines glissantes de 7 jours qui suivent la fenêtre « bientôt ». */
  weeks: ScheduleWeek[];
  /** Au-delà des semaines, par mois civil, dans l'ordre. */
  months: ScheduleMonth[];
  /** Σ hors litiges. */
  open: AmountCount;
  disputed: AmountCount;
}

export interface PayablesSchedule {
  version: string;
  asOf: PurchaseDay;
  dueSoonDays: number;
  dueSoonUntil: PurchaseDay;
  byCurrency: CurrencySchedule[];
}

// ─── Paiements ───────────────────────────────────────────────────────────────

export interface SplitAllocation {
  version: string;
  /** Parts, dans l'ordre des poids ; Σ = montant, au centime. */
  shares: PurchaseAmount[];
}

export interface SupplierPaymentCheckInput {
  amount: PurchaseAmount;
  allocations: readonly { invoiceId: string; amount: PurchaseAmount }[];
  /** Reste à payer de chaque facture visée (rendu par `payableSettlement`). */
  remainingByInvoice: Readonly<Record<string, PurchaseAmount>>;
}

export type SupplierPaymentIssueCode =
  | 'SUPPLIER_PAYMENT_AMOUNT_INVALID'
  | 'SUPPLIER_PAYMENT_NO_ALLOCATION'
  | 'SUPPLIER_PAYMENT_ALLOCATION_INVALID'
  | 'SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE'
  | 'SUPPLIER_PAYMENT_EXCEEDS_REMAINING'
  | 'SUPPLIER_PAYMENT_ALLOCATION_MISMATCH';

export interface SupplierPaymentIssue {
  code: SupplierPaymentIssueCode;
  allocationIndex: number | null;
  message: string;
  details?: Record<string, string>;
}

export interface SupplierPaymentCheck {
  version: string;
  ok: boolean;
  issues: SupplierPaymentIssue[];
}

export interface DuplicatePaymentInput {
  id: string;
  supplierId: string;
  currency: PurchaseCurrency;
  amount: PurchaseAmount;
  paidOn: PurchaseDay;
}

/** Dépense DIRECTE (sans `origin`) ; l'appelant écarte les dépenses possédées. */
export interface DuplicateExpenseInput {
  id: string;
  supplierId: string | null;
  currency: PurchaseCurrency;
  amount: PurchaseAmount;
  spentOn: PurchaseDay;
}

export interface PossibleDuplicate {
  code: 'POSSIBLE_DUPLICATE_EXPENSE';
  paymentId: string;
  expenseId: string;
  supplierId: string;
  currency: PurchaseCurrency;
  amount: PurchaseAmount;
  /** |date du paiement − date de la dépense|, en jours. */
  daysApart: number;
}

export interface PossibleDuplicates {
  version: string;
  windowDays: number;
  duplicates: PossibleDuplicate[];
}

// ─── Reste à facturer et résumé ──────────────────────────────────────────────

/** Facture fournisseur pour le cumul facturé (seules les factures validées comptent). */
export interface InvoicedLinesInput {
  id: string;
  kind: SupplierInvoiceKind;
  status: SupplierInvoiceStatus;
  lines: readonly Pick<SupplierInvoiceLineInput, 'orderLineId' | 'quantity'>[];
}

export interface RemainingToInvoiceOrderInput {
  currency: PurchaseCurrency;
  lines: readonly PurchaseOrderLineInput[];
}

export interface RemainingToInvoiceLine {
  orderLineId: string;
  category: string | null;
  workProjectId: string | null;
  ordered: PurchaseQuantity;
  invoiced: PurchaseQuantity;
  remainingQuantity: PurchaseQuantity;
  /** Reste × prix net, HT, un seul arrondi au centime. */
  remainingAmount: PurchaseAmount;
}

export interface RemainingToInvoice {
  version: string;
  currency: PurchaseCurrency;
  lines: RemainingToInvoiceLine[];
  /** Σ des lignes (HT). */
  remainingAmount: PurchaseAmount;
}

export interface SummaryOrderInput extends RemainingToInvoiceOrderInput {
  id: string;
  supplierId: string;
}

export interface SummaryInvoiceInput extends InvoicedLinesInput {
  supplierId: string;
  currency: PurchaseCurrency;
  total: PurchaseAmount;
  costAllocations: readonly CostAllocationInput[];
  /** Règlement rendu par `payableSettlement`. */
  settlement: Pick<PayableSettlement, 'paid' | 'credited' | 'remaining'>;
}

export interface PurchasesSummaryInput {
  /** Commandes approuvées retenues par l'appelant (période, statut). */
  orders: readonly SummaryOrderInput[];
  /** Factures et avoirs ; seules les factures validées comptent. */
  invoices: readonly SummaryInvoiceInput[];
}

export interface SummaryFigures {
  /** Engagé : reste à facturer des commandes (HT). */
  committed: PurchaseAmount;
  /** Facturé : Σ des totaux TTC des factures validées. */
  invoiced: PurchaseAmount;
  credited: PurchaseAmount;
  paid: PurchaseAmount;
  remaining: PurchaseAmount;
}

export interface PurchasesSummary {
  version: string;
  byCurrency: (SummaryFigures & { currency: PurchaseCurrency })[];
  bySupplier: (SummaryFigures & { supplierId: string; currency: PurchaseCurrency })[];
  byCategory: (SummaryFigures & { category: string; currency: PurchaseCurrency })[];
}
