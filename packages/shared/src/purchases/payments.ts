// Paiements fournisseurs, dettes et doublons — corps, requêtes et vues (ADR-0044
// § 2.6, § 3.6, § 6.2, O3). ADR-0044 — P5.
//
// Un paiement fournisseur EST une dépense réalisée : il crée lui-même ses dépenses
// de trésorerie (`treasury_expenses`, `origin.kind = 'supplier_payment'`), que la
// trésorerie ne peut plus modifier (`409 EXPENSE_OWNED_BY_PURCHASES`). Une dépense
// directe déjà saisie peut devenir le paiement d'une facture (`from-expense`) : elle
// est rattachée, jamais recopiée. Tous les montants rendus viennent du moteur
// (`payableSettlement`, `splitAllocation`, `payablesSchedule`, `payablesAging`,
// `possibleDuplicateExpenses`, `checkSupplierPayment`).

import { z } from 'zod';

import {
  PurchaseCalendarDay,
  PurchaseExpectedRevision,
  PurchaseId,
  PurchasePositiveAmount,
  purchaseFr,
  purchaseIssue,
  purchaseOptionalText,
  purchaseRequiredText,
} from './common.js';
import {
  PURCHASE_LIMITS,
  PURCHASE_PAGE_LIMIT_DEFAULT,
  PURCHASE_PAGE_LIMIT_MAX,
  SUPPLIER_PAYMENT_CHANNELS,
  SUPPLIER_PAYMENT_STATUSES,
  type PayableSettlementStatus,
  type PurchaseCurrency,
  type PurchaseSectionStatus,
  type SupplierPaymentChannel,
  type SupplierPaymentOrigin,
  type SupplierPaymentStatus,
} from './constants.js';

const L = PURCHASE_LIMITS;

/** Codes propres au lot P5, en plus de ceux nommés par l'ADR (`PURCHASE_ERROR_CODES`). */
export const SUPPLIER_PAYMENT_P5_ERROR_CODES = [
  'SUPPLIER_PAYMENT_NOT_FOUND',
  'SUPPLIER_PAYMENT_CANCELLED',
  'SUPPLIER_PAYMENT_AMOUNT_INVALID',
  'SUPPLIER_PAYMENT_NO_ALLOCATION',
  'SUPPLIER_PAYMENT_ALLOCATION_INVALID',
  'SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE',
  'SUPPLIER_PAYMENT_SUPPLIER_MISMATCH',
  'SUPPLIER_PAYMENT_CURRENCY_MISMATCH',
  'SUPPLIER_PAYMENT_METHOD_NOT_FOUND',
  'SUPPLIER_INVOICE_NOT_FOUND',
  'SUPPLIER_INVOICE_NOT_PAYABLE',
  'SUPPLIER_INVOICE_DISPUTED',
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_MERGED',
  'EXPENSE_NOT_FOUND',
  'EXPENSE_CANCELLED',
  'EXPENSE_OWNED_BY_PURCHASES',
  'EXPENSE_SUPPLIER_MISMATCH',
  'PURCHASE_DATE_IN_FUTURE',
] as const;
export type SupplierPaymentP5ErrorCode = (typeof SUPPLIER_PAYMENT_P5_ERROR_CODES)[number];

/** Libellés des moyens de paiement utilisés (écran « À payer »). */
export const SUPPLIER_PAYMENT_CHANNEL_LABELS: Readonly<Record<SupplierPaymentChannel, string>> =
  Object.freeze({
    bank_transfer: 'Virement bancaire',
    mobile_money: 'Mobile money',
    cash: 'Espèces',
    cheque: 'Chèque',
    other: 'Autre',
  });

// ── Corps ───────────────────────────────────────────────────────────────────

export const SupplierPaymentAllocationInput = z
  .object({
    invoiceId: PurchaseId,
    amount: PurchasePositiveAmount,
  })
  .strict();
export type SupplierPaymentAllocationInput = z.infer<typeof SupplierPaymentAllocationInput>;

const allocations = z
  .array(SupplierPaymentAllocationInput, purchaseFr('Imputations attendues.'))
  .min(1, { message: 'Imputez le paiement à au moins une facture validée.' })
  .max(L.paymentAllocationsMax, {
    message: `${L.paymentAllocationsMax} imputations au plus.`,
  });

function uniqueInvoices(v: { allocations: { invoiceId: string }[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  v.allocations.forEach((a, i) => {
    if (seen.has(a.invoiceId)) {
      purchaseIssue(
        ctx,
        'SUPPLIER_PAYMENT_ALLOCATION_DUPLICATE',
        'Une même facture ne figure qu’une fois dans un paiement.',
        ['allocations', i, 'invoiceId'],
      );
    }
    seen.add(a.invoiceId);
  });
}

/**
 * `POST /purchases/payments` (`payables.pay`) : Σ des imputations = montant (moteur,
 * `checkSupplierPayment`) ; les dépenses de trésorerie sont créées dans la même
 * transaction, une par part d'imputation de coût (`splitAllocation`).
 */
export const CreateSupplierPaymentBody = z
  .object({
    supplierId: PurchaseId,
    /** Jamais future ; ≥ ouverture du compte (règle de la trésorerie). */
    paidOn: PurchaseCalendarDay,
    amount: PurchasePositiveAmount,
    /** Facultatif comme pour une dépense ; même devise, compte actif. */
    accountId: PurchaseId.nullable().optional(),
    method: z.enum(
      SUPPLIER_PAYMENT_CHANNELS,
      purchaseFr('Moyen : bank_transfer, mobile_money, cash, cheque ou other.'),
    ),
    /** Coordonnée du fournisseur utilisée (§ 2.1.1), facultative. */
    paymentMethodId: z.string().trim().min(1).max(64).nullable().optional(),
    reference: purchaseOptionalText(L.paymentReference).optional(),
    allocations,
  })
  .strict()
  .superRefine(uniqueInvoices);
export type CreateSupplierPaymentBody = z.infer<typeof CreateSupplierPaymentBody>;

/**
 * `POST /purchases/payments/from-expense` (`payables.pay` + `treasury.manage`) :
 * la dépense directe existante DEVIENT le paiement (O3 b). Son montant, sa devise,
 * sa date et son compte font foi ; `expectedRevision` est celle de la dépense.
 */
export const SupplierPaymentFromExpenseBody = z
  .object({
    expenseId: PurchaseId,
    allocations,
    expectedRevision: PurchaseExpectedRevision,
    method: z
      .enum(
        SUPPLIER_PAYMENT_CHANNELS,
        purchaseFr('Moyen : bank_transfer, mobile_money, cash, cheque ou other.'),
      )
      .optional(),
  })
  .strict()
  .superRefine(uniqueInvoices);
export type SupplierPaymentFromExpenseBody = z.infer<typeof SupplierPaymentFromExpenseBody>;

/** Annulation : motif obligatoire ; annule les dépenses créées dans la même transaction. */
export const CancelSupplierPaymentBody = z
  .object({
    reason: purchaseRequiredText(L.cancellationReason, 'Motif'),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type CancelSupplierPaymentBody = z.infer<typeof CancelSupplierPaymentBody>;

export const ListSupplierPaymentsQuery = z
  .object({
    supplierId: PurchaseId.optional(),
    invoiceId: PurchaseId.optional(),
    status: z.enum(SUPPLIER_PAYMENT_STATUSES).optional(),
    from: PurchaseCalendarDay.optional(),
    to: PurchaseCalendarDay.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PURCHASE_PAGE_LIMIT_MAX)
      .default(PURCHASE_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListSupplierPaymentsQuery = z.infer<typeof ListSupplierPaymentsQuery>;

/** `GET /purchases/payables?asOf=&supplierId=` : jour de référence (défaut : aujourd'hui à Kinshasa). */
export const PayablesQuery = z
  .object({
    asOf: PurchaseCalendarDay.optional(),
    supplierId: PurchaseId.optional(),
  })
  .strict();
export type PayablesQuery = z.infer<typeof PayablesQuery>;

export const PurchaseDuplicatesQuery = z
  .object({
    supplierId: PurchaseId.optional(),
  })
  .strict();
export type PurchaseDuplicatesQuery = z.infer<typeof PurchaseDuplicatesQuery>;

// ── Vues ────────────────────────────────────────────────────────────────────

export interface SupplierPaymentAllocationView {
  invoiceId: string;
  internalNumber: string | null;
  supplierReference: string | null;
  amount: string;
}

/** Dépense de trésorerie créée (ou rattachée) par le paiement. */
export interface SupplierPaymentExpenseView {
  id: string;
  invoiceId: string | null;
  allocationIndex: number | null;
  amount: string;
  category: string;
  workProjectId: string | null;
  status: 'recorded' | 'cancelled';
}

export interface SupplierPaymentListItem {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string | null;
  currency: PurchaseCurrency;
  paidOn: string;
  amount: string;
  accountId: string | null;
  method: SupplierPaymentChannel;
  reference: string | null;
  origin: SupplierPaymentOrigin;
  status: SupplierPaymentStatus;
  allocations: SupplierPaymentAllocationView[];
  updatedAt: string;
}

export interface SupplierPaymentView extends SupplierPaymentListItem {
  paymentMethodId: string | null;
  expenseIds: string[];
  expenses: SupplierPaymentExpenseView[];
  /** `from-expense` : la dépense directe d'origine (gardée ou remplacée par des parts). */
  linkedExpense: { id: string; mode: 'kept' | 'replaced' } | null;
  cancellation: { at: string; by: string; reason: string } | null;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface SupplierPaymentPage {
  items: SupplierPaymentListItem[];
  nextCursor: string | null;
}

/** Facture à payer (échéancier) : reste à payer rendu par `payableSettlement`. */
export interface PayableInvoiceItem {
  id: string;
  internalNumber: string;
  supplierId: string;
  supplierName: string | null;
  supplierReference: string;
  currency: PurchaseCurrency;
  invoiceDate: string;
  dueDate: string;
  total: string;
  paid: string;
  credited: string;
  remaining: string;
  settlementStatus: PayableSettlementStatus;
  disputed: boolean;
  /** Échéance strictement antérieure au jour de référence. */
  overdue: boolean;
}

export interface AmountCountView {
  amount: string;
  count: number;
}

/** Échéancier par devise (moteur, `payablesSchedule`) — jamais additionné entre devises. */
export interface PayablesScheduleCurrencyView {
  currency: PurchaseCurrency;
  overdue: AmountCountView;
  dueSoon: AmountCountView;
  weeks: (AmountCountView & { from: string; to: string })[];
  months: (AmountCountView & { month: string })[];
  open: AmountCountView;
  disputed: AmountCountView;
}

/** Ancienneté par devise (moteur, `payablesAging`). */
export interface PayablesAgingCurrencyView {
  currency: PurchaseCurrency;
  notDue: AmountCountView;
  days1To30: AmountCountView;
  days31To60: AmountCountView;
  days61To90: AmountCountView;
  over90: AmountCountView;
  open: AmountCountView;
  disputed: AmountCountView;
}

export interface PayablesView {
  version: string;
  asOf: string;
  dueSoonDays: number;
  dueSoonUntil: string;
  schedule: PayablesScheduleCurrencyView[];
  aging: PayablesAgingCurrencyView[];
  /** Factures validées au reste non nul, échéance croissante. */
  invoices: PayableInvoiceItem[];
  /** Doublons probables : nombre, si l'appelant détient aussi `treasury.read`. */
  duplicates: { status: PurchaseSectionStatus; count: number };
}

/** Doublon probable dépense directe ↔ paiement (O3 c) : signalé, jamais annulé. */
export interface PossibleDuplicateView {
  code: 'POSSIBLE_DUPLICATE_EXPENSE';
  paymentId: string;
  paymentNumber: string | null;
  paidOn: string | null;
  expenseId: string;
  spentOn: string | null;
  expenseLabel: string | null;
  supplierId: string;
  supplierName: string | null;
  currency: PurchaseCurrency;
  amount: string;
  daysApart: number;
}

export interface PurchaseDuplicatesView {
  version: string;
  windowDays: number;
  duplicates: PossibleDuplicateView[];
}
