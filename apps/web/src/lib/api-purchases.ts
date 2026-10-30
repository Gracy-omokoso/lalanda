// Client de l'API des achats et fournisseurs — ADR-0044 § 3 (lot P7).
//
// Fichier voisin de `api.ts` (même `jsonRequest`, mêmes erreurs). AUCUN montant
// n'est calculé ici : totaux, restes à payer et anciennetés viennent de l'API
// (moteur `@lalanda/engine`, module `purchases`), en chaînes décimales.
//
// Contrats : les fournisseurs reprennent `@lalanda/shared/purchases` (lot P0).
// Les demandes et commandes (P3), la fiche 360° (P6), l'échéancier (P5, P6) et
// les factures (P4) n'ont pas encore de contrat partagé : les vues ci-dessous
// recopient l'ADR (§ 2.3, § 3.1.1, § 3.5, § 3.6) au plus près et seront
// remplacées par les contrats de ces lots à leur fusion. Tant qu'une route
// n'existe pas, l'API répond 404 : les écrans le disent, rien n'est inventé.

import type {
  CreateSupplierBody,
  PurchaseCurrency,
  PurchaseOrderPhase,
  PurchaseOrderSentVia,
  PurchaseOrderStatus,
  PurchaseLineKind,
  PurchaseMatchingStatus,
  SupplierOverviewSection,
  SupplierPage,
  SupplierPaymentMethodRevealView,
  SupplierView,
  SupplierWriteResult,
  SupplierInvoiceStatus,
} from '@lalanda/shared/purchases';

import {
  API_URL,
  jsonRequest,
  salesQuery,
  type DocumentEmailDraft,
  type DocumentEmailInput,
  type DocumentEmailResult,
} from './api';

export type {
  PurchaseCurrency,
  PurchaseOrderStatus,
  SupplierListItem,
  SupplierPage,
  SupplierPaymentMethodRevealView,
  SupplierPaymentMethodView,
  SupplierView,
  SupplierWriteResult,
} from '@lalanda/shared/purchases';

type DecimalString = string;

/** Corps de création d'un fournisseur, tel que le web l'envoie (forme d'entrée). */
export type CreateSupplierInput = {
  [K in keyof CreateSupplierBody]?: CreateSupplierBody[K] | undefined;
} & { name: string };

export interface ListSuppliersParams {
  q?: string;
  active?: 'true' | 'false';
  cursor?: string;
  limit?: number;
}

// ─── Fiche 360° (§ 3.1.1) — contrat du lot P6 ───────────────────────────────

/** Montant TTC par devise rendu par le moteur ; jamais additionné entre devises. */
export interface PurchaseCurrencyTotal {
  currency: PurchaseCurrency;
  total: DecimalString;
  count: number;
}

export interface PurchaseOrderBrief {
  id: string;
  number: string | null;
  title: string;
  status: PurchaseOrderStatus;
  currency: PurchaseCurrency;
  total: DecimalString;
  updatedAt: string;
}

export interface SupplierInvoiceBrief {
  id: string;
  internalNumber: string;
  supplierReference: string;
  status: SupplierInvoiceStatus;
  matchingStatus: PurchaseMatchingStatus;
  currency: PurchaseCurrency;
  total: DecimalString;
  remaining: DecimalString;
  dueDate: string;
  disputed: boolean;
}

/** Ancienneté de la dette d'une devise (`payablesAging`). */
export interface SupplierAgingRow {
  currency: PurchaseCurrency;
  remaining: DecimalString;
  notDue: DecimalString;
  days1to30: DecimalString;
  days31to60: DecimalString;
  days61to90: DecimalString;
  over90: DecimalString;
  disputed: DecimalString;
}

export interface SupplierPaymentBrief {
  id: string;
  number: string;
  paidOn: string;
  currency: PurchaseCurrency;
  amount: DecimalString;
  status: 'recorded' | 'cancelled';
}

export interface SupplierExpenseBrief {
  id: string;
  spentOn: string;
  label: string;
  currency: PurchaseCurrency;
  amount: DecimalString;
  possibleDuplicate: boolean;
}

export interface SupplierOverview {
  supplier: SupplierView;
  sections: {
    orders: SupplierOverviewSection<{
      totalsByCurrency: PurchaseCurrencyTotal[];
      recent: PurchaseOrderBrief[];
    }>;
    receptions: SupplierOverviewSection<{
      toReceive: { orderId: string; orderNumber: string | null; title: string }[];
    }>;
    invoices: SupplierOverviewSection<{ recent: SupplierInvoiceBrief[] }>;
    balance: SupplierOverviewSection<{ byCurrency: SupplierAgingRow[] }>;
    payments: SupplierOverviewSection<{ recent: SupplierPaymentBrief[] }>;
    directExpenses: SupplierOverviewSection<{ recent: SupplierExpenseBrief[] }>;
  };
}

// ─── Demandes et commandes (§ 2.3, § 3.2) — contrat du lot P3 ───────────────

export interface PurchaseOrderLineView {
  id: string;
  label: string;
  quantity: string;
  unit: string | null;
  unitPrice: DecimalString;
  discountPercent: string | null;
  kind: PurchaseLineKind;
  receivable: boolean;
  category: string | null;
  workProjectId: string | null;
  itemRef: string | null;
  /** Montant HT de la ligne, rendu par le moteur (`computeOrderTotals`). */
  amount: DecimalString;
}

export interface PurchaseDeclaredTaxView {
  label: string;
  amount: DecimalString;
}

export interface PurchaseOrderTotalsView {
  subtotal: DecimalString;
  taxes: DecimalString;
  total: DecimalString;
}

export interface PurchaseApprovalView {
  userId: string;
  decision: 'approved' | 'rejected';
  at: string;
  comment: string | null;
  soleApprover: boolean;
}

export interface PurchaseOrderView {
  id: string;
  phase: PurchaseOrderPhase;
  status: PurchaseOrderStatus;
  requestNumber: string | null;
  orderNumber: string | null;
  requestedBy: string;
  createdBy: string;
  title: string;
  justification: string | null;
  supplierId: string | null;
  /** Copie d'affichage du nom de la fiche fournisseur. */
  supplierName: string | null;
  currency: PurchaseCurrency;
  lines: PurchaseOrderLineView[];
  declaredTaxes: PurchaseDeclaredTaxView[];
  totals: PurchaseOrderTotalsView;
  expectedOn: string | null;
  deliveryAddress: string | null;
  /** Figé à la soumission par le moteur ; `null` pour un brouillon. */
  requiredApprovals: 0 | 1 | 2 | null;
  approvals: PurchaseApprovalView[];
  approvedTotal: DecimalString | null;
  sentAt: string | null;
  sentVia: PurchaseOrderSentVia | null;
  cancellation: { at: string; by: string; reason: string } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderPage {
  items: PurchaseOrderView[];
  nextCursor: string | null;
}

export interface ListOrdersParams {
  phase?: PurchaseOrderPhase;
  status?: PurchaseOrderStatus;
  supplierId?: string;
  requestedBy?: string;
  workProjectId?: string;
  cursor?: string;
  limit?: number;
}

export interface PurchaseOrderLineInput {
  label: string;
  quantity: string;
  unit?: string | null;
  unitPrice: DecimalString;
  discountPercent?: string | null;
  kind: PurchaseLineKind;
}

export interface CreatePurchaseOrderInput {
  title: string;
  justification?: string | null;
  supplierId?: string | null;
  currency: PurchaseCurrency;
  lines: PurchaseOrderLineInput[];
  declaredTaxes?: PurchaseDeclaredTaxView[];
  expectedOn?: string | null;
  deliveryAddress?: string | null;
}

// ─── Lectures de la vue d'ensemble — contrats des lots P4 à P6 ──────────────

export interface SupplierInvoicePage {
  items: SupplierInvoiceBrief[];
  nextCursor: string | null;
}

/** Échéancier d'une devise (§ 3.6) : montants et nombres rendus par le moteur. */
export interface PayablesCurrencyView {
  currency: PurchaseCurrency;
  overdue: { amount: DecimalString; count: number };
  dueSoon: { amount: DecimalString; count: number };
  disputed: { amount: DecimalString; count: number };
}

export interface PayablesView {
  asOf: string;
  dueSoonDays: number;
  byCurrency: PayablesCurrencyView[];
}

// ─── Client ─────────────────────────────────────────────────────────────────

const id = encodeURIComponent;

/** PDF d'un bon de commande ; erreurs sous la forme de `jsonRequest`. */
async function orderPdf(
  orderId: string,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}/purchases/orders/${id(orderId)}/pdf`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text);
    } catch {
      /* garde le texte brut */
    }
    const err = new Error(
      typeof detail === 'object' && detail !== null && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `HTTP ${res.status}`,
    ) as Error & { status: number; detail: unknown };
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  const match = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match?.[1] ?? fallbackName };
}

export const purchasesApi = {
  // Fournisseurs (§ 3.1)
  listSuppliers: (params: ListSuppliersParams = {}) =>
    jsonRequest<SupplierPage>(`/purchases/suppliers${salesQuery(params)}`, { method: 'GET' }),
  createSupplier: (body: CreateSupplierInput) =>
    jsonRequest<SupplierWriteResult>('/purchases/suppliers', { method: 'POST', body }),
  getSupplierOverview: (supplierId: string) =>
    jsonRequest<SupplierOverview>(`/purchases/suppliers/${id(supplierId)}/overview`, {
      method: 'GET',
    }),
  /** Clair d'un moyen de paiement : `payables.pay`, journalisé strictement par l'API. */
  revealPaymentMethod: (supplierId: string, methodId: string) =>
    jsonRequest<SupplierPaymentMethodRevealView>(
      `/purchases/suppliers/${id(supplierId)}/payment-methods/${id(methodId)}/reveal`,
      { method: 'POST', body: {} },
    ),

  // Demandes et commandes (§ 3.2)
  listOrders: (params: ListOrdersParams = {}) =>
    jsonRequest<PurchaseOrderPage>(`/purchases/orders${salesQuery(params)}`, { method: 'GET' }),
  getOrder: (orderId: string) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}`, { method: 'GET' }),
  createOrder: (body: CreatePurchaseOrderInput) =>
    jsonRequest<PurchaseOrderView>('/purchases/orders', { method: 'POST', body }),
  deleteOrder: (orderId: string) =>
    jsonRequest<void>(`/purchases/orders/${id(orderId)}`, { method: 'DELETE' }),
  submitOrder: (orderId: string, expectedRevision: number) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/submit`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  approveOrder: (orderId: string, body: { comment?: string; expectedRevision: number }) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/approve`, {
      method: 'POST',
      body,
    }),
  rejectOrder: (orderId: string, body: { comment: string; expectedRevision: number }) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/reject`, {
      method: 'POST',
      body,
    }),
  duplicateOrder: (orderId: string) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/duplicate`, {
      method: 'POST',
      body: {},
    }),
  markOrderSent: (orderId: string, expectedRevision: number) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/mark-sent`, {
      method: 'POST',
      body: { expectedRevision },
    }),
  cancelOrder: (orderId: string, body: { reason: string; expectedRevision: number }) =>
    jsonRequest<PurchaseOrderView>(`/purchases/orders/${id(orderId)}/cancel`, {
      method: 'POST',
      body,
    }),
  downloadOrderPdf: orderPdf,
  getOrderEmailDraft: (orderId: string) =>
    jsonRequest<DocumentEmailDraft>(`/purchases/orders/${id(orderId)}/email`, { method: 'GET' }),
  sendOrderEmail: (orderId: string, body: DocumentEmailInput) =>
    jsonRequest<DocumentEmailResult>(`/purchases/orders/${id(orderId)}/email`, {
      method: 'POST',
      body,
    }),
  listPendingApprovals: (params: { cursor?: string; limit?: number } = {}) =>
    jsonRequest<PurchaseOrderPage>(`/purchases/approvals/pending${salesQuery(params)}`, {
      method: 'GET',
    }),

  // Lectures de la vue d'ensemble (§ 3.5, § 3.6)
  listInvoices: (params: { status?: string; matching?: string; limit?: number } = {}) =>
    jsonRequest<SupplierInvoicePage>(`/purchases/invoices${salesQuery(params)}`, {
      method: 'GET',
    }),
  getPayables: () => jsonRequest<PayablesView>('/purchases/payables', { method: 'GET' }),
};
