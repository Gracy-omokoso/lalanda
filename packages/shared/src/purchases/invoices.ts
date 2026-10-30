// Factures fournisseurs et rapprochement — corps, requêtes et vues (ADR-0044 § 2.5,
// § 3.5, § 5). ADR-0044 — P4.
//
// Les taxes sont RECOPIÉES de la facture du fournisseur, jamais calculées (§ 9) ; la
// TVA déductible est DÉCLARÉE et conservée pour le comptable, jamais utilisée dans
// un calcul. Le total est saisi tel qu'imprimé ; le moteur vérifie l'addition au
// centime. Le rapprochement (`matching`) est rendu par le moteur (`matchInvoice`),
// jamais par l'écran. « Payée » est DÉRIVÉE des paiements, jamais stockée.

import { z } from 'zod';

import {
  PurchaseAmount,
  PurchaseCalendarDay,
  PurchaseCurrencySchema,
  PurchaseExpectedRevision,
  PurchaseId,
  PurchasePositiveAmount,
  PurchaseQuantity,
  purchaseBooleanParam,
  purchaseFr,
  purchaseIssue,
  purchaseOptionalText,
  purchaseRequiredText,
} from './common.js';
import {
  PURCHASE_LIMITS,
  PURCHASE_MATCHING_STATUSES,
  PURCHASE_PAGE_LIMIT_DEFAULT,
  PURCHASE_PAGE_LIMIT_MAX,
  SUPPLIER_INVOICE_KINDS,
  SUPPLIER_INVOICE_STATUSES,
  type PayableSettlementStatus,
  type PurchaseCurrency,
  type PurchaseMatchingMode,
  type PurchaseMatchingStatus,
  type SupplierInvoiceKind,
  type SupplierInvoiceStatus,
} from './constants.js';
import type { PurchaseOrderView } from './orders.js';
import type { PurchaseAttachmentView, PurchaseReceptionView } from './receptions.js';
import { PurchaseCategoryCode } from './suppliers.js';

const L = PURCHASE_LIMITS;

/** Codes propres au lot P4, en plus de ceux nommés par l'ADR (`PURCHASE_ERROR_CODES`). */
export const SUPPLIER_INVOICE_P4_ERROR_CODES = [
  'PURCHASE_ORDER_NOT_FOUND',
  'PURCHASE_ORDER_LINE_NOT_FOUND',
  'PURCHASE_ORDER_NOT_RECEIVABLE',
  'PURCHASE_ORDER_NOT_INVOICEABLE',
  'PURCHASE_RECEPTION_NOT_FOUND',
  'PURCHASE_RECEPTION_CANCELLED',
  'PURCHASE_DATE_IN_FUTURE',
  'PURCHASE_ATTACHMENT_NOT_FOUND',
  'PURCHASE_STORAGE_FULL',
  'SUPPLIER_INVOICE_NOT_FOUND',
  'SUPPLIER_INVOICE_NOT_DRAFT',
  'SUPPLIER_INVOICE_CANCELLED',
  'SUPPLIER_INVOICE_ORDER_SUPPLIER_MISMATCH',
  'SUPPLIER_INVOICE_ORDER_REQUIRED',
  'SUPPLIER_INVOICE_LINES_REQUIRED',
  'SUPPLIER_INVOICE_SUBTOTAL_REQUIRED',
  'SUPPLIER_INVOICE_CATEGORY_REQUIRED',
  'SUPPLIER_INVOICE_DUE_BEFORE_INVOICE',
  'SUPPLIER_INVOICE_DEDUCTIBLE_VAT_ABOVE_TAXES',
  'SUPPLIER_INVOICE_NOT_IN_VARIANCE',
  'SUPPLIER_INVOICE_NOT_DISPUTED',
  'SUPPLIER_CREDIT_NOTE_TARGET_REQUIRED',
  'SUPPLIER_CREDIT_NOTE_TARGET_MISMATCH',
] as const;

/** Paramètre `due` de la liste (§ 3.5) : en retard, à payer bientôt, toutes. */
export const SUPPLIER_INVOICE_DUE_FILTERS = ['overdue', 'soon', 'all'] as const;
export type SupplierInvoiceDueFilter = (typeof SUPPLIER_INVOICE_DUE_FILTERS)[number];

// ── Corps ───────────────────────────────────────────────────────────────────

const discountPercent = z
  .string(purchaseFr('Remise attendue sous forme de chaîne.'))
  .trim()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/, { message: 'Remise : 0 à 100, deux décimales au plus.' })
  .refine((v) => Number(v) <= 100, { message: 'Remise : 0 à 100.' })
  .nullable();

export const SupplierInvoiceLineInput = z
  .object({
    /** Ligne de commande visée ; `null` = ligne hors commande (écart sur une facture liée). */
    orderLineId: z.string().trim().min(1).max(64).nullable().optional(),
    /** Facultatif si `orderLineId` est posé : le libellé de la commande est repris. */
    label: purchaseOptionalText(L.lineLabel).optional(),
    quantity: PurchaseQuantity,
    unitPrice: PurchaseAmount,
    discountPercent: discountPercent.optional(),
  })
  .strict();
export type SupplierInvoiceLineInput = z.infer<typeof SupplierInvoiceLineInput>;

export const SupplierInvoiceTaxInput = z
  .object({
    label: purchaseRequiredText(L.taxLabel, 'Libellé de la taxe'),
    amount: PurchaseAmount,
  })
  .strict();
export type SupplierInvoiceTaxInput = z.infer<typeof SupplierInvoiceTaxInput>;

export const SupplierInvoiceCostAllocationInput = z
  .object({
    category: PurchaseCategoryCode,
    workProjectId: PurchaseId.nullable().optional(),
    amount: PurchaseAmount,
  })
  .strict();
export type SupplierInvoiceCostAllocationInput = z.infer<
  typeof SupplierInvoiceCostAllocationInput
>;

const invoiceFields = {
  supplierId: PurchaseId,
  supplierReference: purchaseRequiredText(L.supplierReference, 'Référence du fournisseur'),
  kind: z.enum(SUPPLIER_INVOICE_KINDS, purchaseFr('Nature : invoice ou credit_note.')).optional(),
  /** Avoir seulement : facture du même fournisseur et de la même devise qu'il diminue. */
  creditedInvoiceId: PurchaseId.nullable().optional(),
  invoiceDate: PurchaseCalendarDay,
  receivedOn: PurchaseCalendarDay.optional(),
  /** Défaut : `dueDateOf(conditions du fournisseur, invoiceDate)` (moteur). */
  dueDate: PurchaseCalendarDay.optional(),
  currency: PurchaseCurrencySchema,
  orderIds: z
    .array(PurchaseId)
    .max(L.invoiceOrdersMax, { message: `${L.invoiceOrdersMax} commandes au plus.` })
    .optional(),
  lines: z
    .array(SupplierInvoiceLineInput)
    .max(L.linesMax, { message: `${L.linesMax} lignes au plus.` })
    .optional(),
  /** HT : SAISI seulement sans ligne ; calculé par le moteur sinon. */
  subtotal: PurchaseAmount.optional(),
  taxes: z
    .array(SupplierInvoiceTaxInput)
    .max(L.declaredTaxesMax, { message: `${L.declaredTaxesMax} taxes au plus.` })
    .optional(),
  /** TTC tel qu'imprimé. */
  total: PurchasePositiveAmount,
  /** Déclarée, conservée, jamais utilisée dans un calcul (§ 9). */
  deductibleVat: PurchaseAmount.nullable().optional(),
  costAllocations: z
    .array(SupplierInvoiceCostAllocationInput)
    .min(1, { message: 'Au moins une imputation.' })
    .max(L.costAllocationsMax, { message: `${L.costAllocationsMax} imputations au plus.` })
    .optional(),
};

function uniqueOrders(v: { orderIds?: string[] | undefined }, ctx: z.RefinementCtx): void {
  const ids = v.orderIds ?? [];
  if (new Set(ids).size !== ids.length) {
    purchaseIssue(ctx, 'DUPLICATE_ORDER', 'Une commande figure deux fois.', ['orderIds']);
  }
}

export const CreateSupplierInvoiceBody = z.object(invoiceFields).strict().superRefine(uniqueOrders);
export type CreateSupplierInvoiceBody = z.infer<typeof CreateSupplierInvoiceBody>;

export const UpdateSupplierInvoiceBody = z
  .object({ ...invoiceFields, expectedRevision: PurchaseExpectedRevision })
  .strict()
  .superRefine(uniqueOrders);
export type UpdateSupplierInvoiceBody = z.infer<typeof UpdateSupplierInvoiceBody>;

export const SupplierInvoiceFromOrderBody = z.object({ orderId: PurchaseId }).strict();
export type SupplierInvoiceFromOrderBody = z.infer<typeof SupplierInvoiceFromOrderBody>;

export const SupplierInvoiceRevisionBody = z
  .object({ expectedRevision: PurchaseExpectedRevision })
  .strict();
export type SupplierInvoiceRevisionBody = z.infer<typeof SupplierInvoiceRevisionBody>;

/** Forçage, litige, annulation : un motif obligatoire. */
export const SupplierInvoiceReasonBody = z
  .object({
    reason: purchaseRequiredText(L.cancellationReason, 'Motif'),
    expectedRevision: PurchaseExpectedRevision,
  })
  .strict();
export type SupplierInvoiceReasonBody = z.infer<typeof SupplierInvoiceReasonBody>;

export const ListSupplierInvoicesQuery = z
  .object({
    status: z.enum(SUPPLIER_INVOICE_STATUSES).optional(),
    supplierId: PurchaseId.optional(),
    orderId: PurchaseId.optional(),
    due: z.enum(SUPPLIER_INVOICE_DUE_FILTERS).optional(),
    matching: z.enum(PURCHASE_MATCHING_STATUSES).optional(),
    disputed: purchaseBooleanParam.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PURCHASE_PAGE_LIMIT_MAX)
      .default(PURCHASE_PAGE_LIMIT_DEFAULT),
  })
  .strict();
export type ListSupplierInvoicesQuery = z.infer<typeof ListSupplierInvoicesQuery>;

// ── Vues ────────────────────────────────────────────────────────────────────

export interface SupplierInvoiceVarianceView {
  code: string;
  blocking: boolean;
  orderId: string | null;
  orderLineId: string | null;
  invoiceLineIndex: number | null;
  unit: 'quantity' | 'unit_price' | 'amount';
  expected: string;
  actual: string;
  difference: string;
}

export interface SupplierInvoiceMatchingView {
  /** Version du moteur qui a rendu le rapprochement. */
  version: string;
  mode: PurchaseMatchingMode;
  status: PurchaseMatchingStatus;
  variances: SupplierInvoiceVarianceView[];
  lines: {
    orderId: string;
    orderLineId: string;
    mode: 'two_way' | 'three_way';
    ordered: string;
    received: string | null;
    invoicedBefore: string;
    invoicedNow: string;
    invoicedCumulative: string;
  }[];
}

export interface SupplierInvoiceLineView {
  orderLineId: string | null;
  label: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string | null;
  /** HT, arrondi une fois au centime par le moteur. */
  amount: string;
}

export interface SupplierInvoiceSettlementView {
  status: PayableSettlementStatus;
  paid: string;
  credited: string;
  remaining: string;
  overpaid: string;
}

/** Ligne de liste : forme lue par l'application web (`SupplierInvoiceBrief`). */
export interface SupplierInvoiceListItem {
  id: string;
  internalNumber: string;
  supplierId: string;
  supplierName: string | null;
  supplierReference: string;
  kind: SupplierInvoiceKind;
  status: SupplierInvoiceStatus;
  matchingMode: PurchaseMatchingMode;
  matchingStatus: PurchaseMatchingStatus;
  currency: PurchaseCurrency;
  invoiceDate: string;
  dueDate: string;
  total: string;
  /** Reste à payer (moteur, `payableSettlement`) ; égal au total tant qu'elle n'est pas validée. */
  remaining: string;
  settlementStatus: PayableSettlementStatus;
  disputed: boolean;
  forced: boolean;
  hasAttachment: boolean;
  orderIds: string[];
  updatedAt: string;
}

export interface SupplierInvoiceView extends SupplierInvoiceListItem {
  creditedInvoiceId: string | null;
  receivedOn: string;
  lines: SupplierInvoiceLineView[];
  subtotal: string;
  taxes: { label: string; amount: string }[];
  deductibleVat: string | null;
  costAllocations: { category: string; workProjectId: string | null; amount: string }[];
  attachment: PurchaseAttachmentView | null;
  matching: SupplierInvoiceMatchingView;
  settlement: SupplierInvoiceSettlementView;
  forcedValidation: { by: string; at: string; reason: string; soleApprover: boolean } | null;
  dispute: { by: string; at: string; reason: string } | null;
  validatedAt: string | null;
  validatedBy: string | null;
  cancellation: { at: string; by: string; reason: string } | null;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface SupplierInvoicePage {
  items: SupplierInvoiceListItem[];
  nextCursor: string | null;
}

/**
 * Préremplissage (`POST /purchases/invoices/from-order`) : rien n'est enregistré.
 * Les lignes portent le reste à facturer de la commande (moteur,
 * `orderRemainingToInvoice`) ; la référence et la date du fournisseur restent à saisir.
 */
export interface SupplierInvoicePrefill {
  supplierId: string;
  currency: PurchaseCurrency;
  orderIds: string[];
  lines: {
    orderLineId: string;
    label: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string | null;
  }[];
  subtotal: string;
  /** Par catégorie et projet des lignes ; catégorie `null` si ni la ligne ni la fiche n'en portent. */
  costAllocations: { category: string | null; workProjectId: string | null; amount: string }[];
  remainingToInvoice: string;
}

/**
 * Fiche d'une demande ou commande (`GET /purchases/orders/:id`, § 3.2) : la vue du lot
 * P3 et, ajoutées par P4, ses réceptions et ses factures fournisseurs liées.
 */
export interface PurchaseOrderLinksView {
  receptions: PurchaseReceptionView[];
  invoices: SupplierInvoiceListItem[];
}
export type PurchaseOrderDetailView = PurchaseOrderView & PurchaseOrderLinksView;
